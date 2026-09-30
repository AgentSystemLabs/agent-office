import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { closeSync, fstatSync, openSync, readSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { CloneProgress } from '../shared/protocol.js';

// One `gh repo clone`, run so the office can see how it's getting on. git's progress goes to a log
// file, which the office reads every second: that says how far along it is, and a log that stops
// growing is a clone that's stuck. The clone runs in its own session with no terminal, so an ssh
// host-key question or a password prompt fails it straight away instead of waiting, unseen, on the
// terminal the office was started in. Writing to a file (not a pipe) and being its own process
// group lets it outlive an office restart, for the next office to pick up (see CloneRun.adopt).

/** Signals go to the whole clone (gh, git, ssh, index-pack) as a process group, except on Windows. */
const GROUPS = process.platform !== 'win32';
/** How long git can go without a word before the clone is given up on as stuck. */
export const STALL_MS = 3 * 60_000;
const TAIL_BYTES = 16 * 1024;

/** What git says it's doing, in words for the elevator. */
const STEPS: Record<string, string> = {
  'Enumerating objects': 'GitHub is packing it up',
  'Counting objects': 'GitHub is packing it up',
  'Compressing objects': 'GitHub is packing it up',
  'Receiving objects': 'Downloading',
  'Resolving deltas': 'Unpacking',
  'Checking connectivity': 'Checking it over',
  'Updating files': 'Checking out files',
  'Filtering content': 'Downloading LFS files',
};

const PROGRESS = /^(?:remote: )?([A-Z][a-z]+ [a-z]+):\s+(?:(\d{1,3})%(?: \(\d+\/\d+\))?|\d+)(?:, ([\d.]+ [KMGT]?i?B)(?: \| ([\d.]+ [KMGT]?i?B\/s))?)?/;

/** How far a clone has got, from the latest progress line in git's output (lines end in \r or \n). */
export function parseProgress(output: string): CloneProgress | undefined {
  const lines = output.split(/[\r\n]+/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = PROGRESS.exec(lines[i].trim());
    if (m && STEPS[m[1]]) {
      const detail = [m[3], m[4]].filter(Boolean).join(' · ');
      return { step: STEPS[m[1]], ...(m[2] ? { percent: Math.min(100, Number(m[2])) } : {}), ...(detail ? { detail } : {}) };
    }
    if (/^Cloning into /.test(lines[i].trim())) return { step: 'Connecting to GitHub' };
  }
  return undefined;
}

/** Why a clone failed, from what gh and git said, in terms of what to do about it on the office's machine. */
export function whyCloneFailed(output: string): string {
  const said = output
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l && !PROGRESS.test(l) && !/^Cloning into /.test(l));
  const all = said.join('\n');
  if (/Host key verification failed/i.test(all)) return "ssh on the office's machine hasn't accepted github.com's host key yet. Run `ssh -T git@github.com` there once, or clone over https with `gh config set git_protocol https`";
  if (/passphrase/i.test(all)) return "the office's ssh key needs its passphrase. Add it to the ssh agent (`ssh-add`), or clone over https with `gh config set git_protocol https`";
  if (/Permission denied \(publickey/i.test(all)) return "GitHub didn't take the office's ssh key. Add it with `gh ssh-key add`, or clone over https with `gh config set git_protocol https`";
  if (/terminal prompts disabled|could not read (Username|Password)|Authentication failed/i.test(all)) return "git wanted a GitHub password. Run `gh auth setup-git` on the office's machine so git uses gh's login";
  return said.slice(-2).join(' ') || 'gh failed';
}

/** How a clone ended: stopped (and why), or the process's exit code (null when an office before this one started it). */
export interface CloneEnd {
  stopped?: string;
  code?: number | null;
  /** The end of what gh and git said. */
  output: string;
}

export interface CloneRunOptions {
  /** Hears about new progress, at most once a tick. */
  changed?: () => void;
  stallMs?: number;
  tickMs?: number;
}

/** A clone the office is watching, whether it started it or an office before it did. */
export class CloneRun {
  progress?: CloneProgress;
  readonly done: Promise<CloneEnd>;
  private finish!: (end: CloneEnd) => void;
  private stopped?: string;
  private ended = false;
  private size = -1;
  private grewAt = Date.now();
  private timer?: NodeJS.Timeout;
  private killTimer?: NodeJS.Timeout;

  private constructor(
    readonly pid: number,
    /** Where gh and git write; the office reads it. */
    readonly log: string,
    private child: ChildProcess | undefined,
    private opts: CloneRunOptions,
  ) {
    this.done = new Promise((resolve) => (this.finish = resolve));
    this.timer = setInterval(() => this.tick(), opts.tickMs ?? 1000);
  }

  /** Starts `gh repo clone repo dest`, writing to `log`. Resolves once it's running, or to why it couldn't start. */
  static start(repo: string, dest: string, log: string, opts: CloneRunOptions = {}): Promise<CloneRun | string> {
    let fd: number;
    try {
      fd = openSync(log, 'w', 0o600);
    } catch (err) {
      return Promise.resolve(`Couldn't write ${log}: ${(err as Error).message}`);
    }
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        child = spawn('gh', ['repo', 'clone', repo, dest, '--', '--progress'], {
          cwd: path.dirname(dest),
          detached: GROUPS,
          stdio: ['ignore', fd, fd],
          windowsHide: true,
          // No prompts: nobody would see them. What would have asked says so and fails instead.
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' },
        });
      } finally {
        closeSync(fd);
      }
      child.once('error', (err: NodeJS.ErrnoException) => resolve(err.code === 'ENOENT' ? "The GitHub CLI (gh) isn't installed on the office's machine" : `Couldn't run gh: ${err.message}`));
      child.once('spawn', () => {
        const run = new CloneRun(child.pid!, log, child, opts);
        child.once('exit', (code) => run.end(code));
        resolve(run);
      });
    });
  }

  /**
   * Picks up a clone an office before this one started, if it's still going: its log is still
   * being written, so it goes on like any other. Undefined if that process is gone (or isn't a clone).
   */
  static adopt(pid: number, log: string, opts: CloneRunOptions = {}): CloneRun | undefined {
    if (!GROUPS || !alive(pid) || !isClone(pid)) return undefined;
    return new CloneRun(pid, log, undefined, opts);
  }

  /** Stops the clone (git tidies away what it had cloned). `done` says `why`. */
  stop(why: string) {
    if (this.ended) return;
    this.stopped ??= why;
    this.signal('SIGTERM');
    this.killTimer ??= setTimeout(() => this.signal('SIGKILL'), 10_000);
    this.killTimer.unref();
  }

  /** Stops watching and leaves the clone running, for the next office to pick up. */
  release() {
    clearInterval(this.timer);
    clearTimeout(this.killTimer);
    this.child?.removeAllListeners('exit');
    this.child?.unref();
    this.ended = true;
  }

  private signal(sig: NodeJS.Signals) {
    // An adopted clone's pid was only checked when it was picked up: make sure it hasn't been handed
    // to something else since, so a stall or a Stop never signals a stranger's process group.
    if (!this.child && !(alive(this.pid) && isClone(this.pid))) return;
    try {
      process.kill(GROUPS ? -this.pid : this.pid, sig);
    } catch {
      // gone already
    }
  }

  private tick() {
    if (this.ended) return;
    // One an office before this one started: nothing says when it exits but its pid going away.
    if (!this.child && !alive(this.pid)) return this.end(null);
    const { text, size } = this.read();
    const stallMs = this.opts.stallMs ?? STALL_MS;
    if (size !== this.size) {
      this.size = size;
      this.grewAt = Date.now();
      const progress = parseProgress(text);
      if (JSON.stringify(progress) !== JSON.stringify(this.progress)) {
        this.progress = progress;
        this.opts.changed?.();
      }
    } else if (Date.now() - this.grewAt > stallMs) {
      const mins = Math.max(1, Math.round(stallMs / 60_000));
      this.stop(`Cloning stalled: nothing new from GitHub in ${mins} minute${mins === 1 ? '' : 's'}. Try again, or check the office machine's connection`);
    }
  }

  /** The end of the log, and how long it is. */
  private read(): { text: string; size: number } {
    let fd: number | undefined;
    try {
      fd = openSync(this.log, 'r');
      const size = fstatSync(fd).size;
      const len = Math.min(TAIL_BYTES, size);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, size - len);
      return { text: buf.toString('utf8'), size };
    } catch {
      return { text: '', size: 0 };
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  private end(code: number | null) {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    clearTimeout(this.killTimer);
    // gh goes at once on SIGTERM; a git, ssh or index-pack still hanging in its group goes with it.
    if (this.stopped && this.child && GROUPS) {
      try {
        process.kill(-this.pid, 'SIGKILL');
      } catch {
        // nothing left in it
      }
    }
    const output = this.read().text;
    this.finish({ ...(this.stopped ? { stopped: this.stopped } : {}), code, output });
  }
}

/** Deletes a clone's log. On Windows a clone still writing it holds it open: it stays until next time. */
export function dropLog(log: string) {
  try {
    rmSync(log, { force: true });
  } catch {
    // in use
  }
}

/** The process is still there. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The process is a `gh repo clone` (the pid wasn't handed to something else since). */
function isClone(pid: number): boolean {
  try {
    return /\brepo clone\b/.test(execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }));
  } catch {
    return false;
  }
}
