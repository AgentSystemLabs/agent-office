import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ImageResult } from './decor.js';
import { changedImageType, type ChangedFile, type ChangeStatus, type ChangesState } from '../shared/protocol.js';

// What a worker changed, for the Changes window at its desk: the files it touched and their diff,
// against the branch the office was opened on. While anyone has the window open, the office polls
// that worker's checkout (its worktree, or the project folder) every couple of seconds and pushes
// the file list whenever it changes. Diffs of single files are fetched on demand.

const POLL_MS = 2000;
const MAX_FILES = 400;
const MAX_DIFF = 200_000;
/** Untracked files bigger than this aren't read to count their lines. */
const MAX_COUNT_BYTES = 8 * 1024 * 1024;
/** Pictures bigger than this aren't previewed. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ChangesTarget {
  /** The worker's name, for toasts. */
  name: string;
  /** Absolute directory it works in. */
  cwd: string;
  /** That directory relative to the office dir ('' for the project itself). */
  rel: string;
  /** The commit its worktree branched from, when it has one. */
  worktreeBase?: string;
}

export interface ChangesEvents {
  state(state: ChangesState, clients: string[]): void;
  toast(text: string, level: 'info' | 'warn' | 'error'): void;
  /** Something changed on GitHub (a PR was opened): refresh the boards. */
  refreshGitHub(): void;
}

interface Watch {
  clients: Set<string>;
  timer?: NodeJS.Timeout;
  polling: boolean;
  last?: ChangesState;
  /** The last state without its timestamp, to send only real changes. */
  lastKey?: string;
  busy?: string;
}

class GitError extends Error {}

interface Result {
  out: string;
  err: string;
  code: number;
}

/** Runs a command; a non-zero exit is a result, not an error. Only "can't run it at all" throws. */
function run(cmd: string, args: string[], cwd: string, timeout = 30_000): Promise<Result> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout, stderr) => {
      if (!err) return resolve({ out: stdout, err: stderr, code: 0 });
      const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
      if (typeof e.code === 'number') return resolve({ out: stdout, err: stderr, code: e.code });
      if (e.code === 'ENOENT') return reject(new GitError(`${cmd} is not installed on the server`));
      if (e.killed) return reject(new GitError(`${cmd} ${args[0]} took more than ${Math.round(timeout / 1000)}s and was stopped`));
      reject(new GitError(String(e.message || err)));
    });
  });
}

/** Like run(), for output that isn't text: a file's bytes at some commit. A failing command throws. */
function runBytes(cmd: string, args: string[], cwd: string, maxBytes: number, timeout = 30_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, encoding: 'buffer', maxBuffer: maxBytes, timeout, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
      if (typeof e.code === 'number') return reject(new GitError(reason({ out: '', err: stderr.toString('utf8'), code: e.code }, `${cmd} ${args[0]} failed`)));
      if (e.code === 'ENOENT') return reject(new GitError(`${cmd} is not installed on the server`));
      if (e.killed) return reject(new GitError(`${cmd} ${args[0]} took more than ${Math.round(timeout / 1000)}s and was stopped`));
      reject(new GitError(String(e.message || err)));
    });
  });
}

/** The line of stderr worth showing a person: git's "fatal:"/"error:" line, else the last one. */
function reason(r: Result, fallback: string): string {
  const lines = r.err.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => /^(fatal|error):/i.test(l)) ?? lines[lines.length - 1];
  return line ? line.replace(/^(fatal|error):\s*/i, '') : fallback;
}

async function git(args: string[], cwd: string, timeout?: number): Promise<string> {
  const r = await run('git', args, cwd, timeout);
  if (r.code !== 0) throw new GitError(reason(r, `git ${args[0]} failed`));
  return r.out.replace(/\n$/, '');
}

/** Like git(), but a failing command (a missing ref, no upstream) is just `undefined`. */
async function gitMaybe(args: string[], cwd: string): Promise<string | undefined> {
  try {
    return await git(args, cwd);
  } catch {
    return undefined;
  }
}

/** Records of `git ... -z` output: NUL-separated fields. */
function fields(out: string): string[] {
  const f = out.split('\0');
  if (f[f.length - 1] === '') f.pop();
  return f;
}

async function countLines(file: string): Promise<{ lines: number; binary: boolean }> {
  try {
    const s = await stat(file);
    if (!s.isFile() || s.size > MAX_COUNT_BYTES) return { lines: 0, binary: false };
    const buf = await readFile(file);
    if (buf.subarray(0, 8000).includes(0)) return { lines: 0, binary: true };
    let n = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
    if (buf.length && buf[buf.length - 1] !== 10) n++;
    return { lines: n, binary: false };
  } catch {
    return { lines: 0, binary: false };
  }
}

/**
 * Where a file of a checkout really is, or undefined when it's missing or leads outside the checkout
 * (a symlink pointing elsewhere, a path with `..` in it).
 */
export async function insideCheckout(cwd: string, file: string): Promise<string | undefined> {
  try {
    const root = await realpath(cwd);
    const abs = await realpath(path.resolve(root, file));
    const rel = path.relative(root, abs);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return undefined;
    return abs;
  } catch {
    return undefined;
  }
}

async function signature(file: string): Promise<string> {
  try {
    const s = await stat(file);
    return `${s.size}:${Math.round(s.mtimeMs)}`;
  } catch {
    return '';
  }
}

export class Changes {
  private watches = new Map<string, Watch>();
  /** PRs opened from the office, until the GitHub boards catch up. */
  private opened = new Map<string, { number: number; url: string }>();

  constructor(
    private dir: string,
    /** The branch the office was opened on: what diffs are taken against and what PRs target. */
    private baseBranch: string | undefined,
    private target: (workerId: string) => ChangesTarget | undefined,
    /** An open pull request whose head is that branch, from the PR board. */
    private openPull: (branch: string) => { number: number; url: string } | undefined,
    private events: ChangesEvents,
  ) {
    if (baseBranch === 'HEAD') this.baseBranch = undefined;
  }

  watch(workerId: string, clientId: string) {
    let w = this.watches.get(workerId);
    if (!w) {
      w = { clients: new Set(), polling: false };
      this.watches.set(workerId, w);
    }
    // An entry an action made (see action()) has no timer yet.
    w.timer ??= setInterval(() => void this.poll(workerId), POLL_MS);
    w.clients.add(clientId);
    if (w.last) this.events.state(w.last, [clientId]);
    void this.poll(workerId, true);
  }

  unwatch(workerId: string, clientId: string) {
    const w = this.watches.get(workerId);
    if (!w) return;
    w.clients.delete(clientId);
    // Keep the entry while an action runs, so its outcome still reaches whoever asked for it.
    if (!w.clients.size && !w.busy) this.drop(workerId);
  }

  unwatchAll(clientId: string) {
    for (const id of [...this.watches.keys()]) this.unwatch(id, clientId);
  }

  /** The worker is gone. */
  forget(workerId: string) {
    this.drop(workerId);
  }

  stop() {
    for (const id of [...this.watches.keys()]) this.drop(id);
  }

  /** The diff of one changed file, as `git diff` prints it. */
  async diff(workerId: string, filePath: string): Promise<{ diff: string; truncated: boolean } | string> {
    const t = this.target(workerId);
    if (!t) return 'No such worker';
    const file = await this.changedFile(workerId, t, filePath);
    if (typeof file === 'string') return file;
    try {
      let out: string;
      if (file.status === '?') {
        // Exit code 1 just means the file isn't empty.
        const r = await run('git', ['diff', '--no-index', '--', '/dev/null', file.path], t.cwd);
        if (r.code > 1) throw new GitError(reason(r, 'git diff failed'));
        out = r.out;
      } else {
        const base = await this.baseCommit(t);
        const r = await run('git', ['diff', '-M', base.commit, '--', ...(file.from ? [file.from] : []), file.path], t.cwd);
        if (r.code !== 0) throw new GitError(reason(r, 'git diff failed'));
        out = r.out;
      }
      const truncated = out.length > MAX_DIFF;
      return { diff: truncated ? out.slice(0, MAX_DIFF) : out, truncated };
    } catch (err) {
      return (err as Error).message;
    }
  }

  /**
   * One side of a changed picture, for the preview in the Changes window: 'old' is the file at the
   * commit the diff is taken from, 'new' is what's in the checkout now. Only files in the worker's
   * list of changes are served, and only pictures.
   */
  async file(workerId: string, filePath: string, side: 'old' | 'new'): Promise<ImageResult> {
    if (!changedImageType(filePath)) return { status: 415, error: 'Only pictures can be previewed' };
    const t = this.target(workerId);
    if (!t) return { status: 404, error: 'No such worker' };
    const file = await this.changedFile(workerId, t, filePath);
    if (typeof file === 'string') return { status: 404, error: file };
    // A renamed file was something else before; its old side is only a picture if that name was one.
    const name = side === 'old' ? file.from ?? file.path : file.path;
    const type = changedImageType(name);
    if (!type) return { status: 415, error: 'Only pictures can be previewed' };
    try {
      if (side === 'new') {
        if (file.status === 'D') return { status: 404, error: 'That file was deleted' };
        const abs = await insideCheckout(t.cwd, name);
        if (!abs) return { status: 404, error: 'That file is not in the checkout' };
        const s = await stat(abs);
        if (!s.isFile()) return { status: 404, error: 'That is not a file' };
        if (s.size > MAX_IMAGE_BYTES) return { status: 413, error: `That picture is over ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
        return { type, body: await readFile(abs) };
      }
      if (file.status === '?' || file.status === 'A') return { status: 404, error: 'That file is new' };
      // `cat-file`, not `show`: show would run the file through any textconv filter the repo sets.
      const object = `${(await this.baseCommit(t)).commit}:${name}`;
      const size = Number(await git(['cat-file', '-s', object], t.cwd));
      if (size > MAX_IMAGE_BYTES) return { status: 413, error: `That picture is over ${MAX_IMAGE_BYTES / 1024 / 1024} MB` };
      return { type, body: await runBytes('git', ['cat-file', 'blob', object], t.cwd, MAX_IMAGE_BYTES + 1) };
    } catch (err) {
      // It went away between the last poll and this request.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 404, error: 'That file is gone' };
      return { status: 500, error: (err as Error).message };
    }
  }

  /** Stages everything in the checkout and commits it. */
  async commit(workerId: string, message: string, who: string): Promise<string | undefined> {
    const msg = message.trim();
    if (!msg) return 'The commit needs a message';
    return this.action(workerId, 'Committing…', async (t) => {
      await git(['add', '-A'], t.cwd);
      await git(['commit', '-q', '-m', msg], t.cwd, 120_000);
      const subject = msg.split('\n')[0];
      this.events.toast(`${who} committed “${subject.length > 60 ? `${subject.slice(0, 59)}…` : subject}” at ${t.name}'s desk`, 'info');
    });
  }

  /** Throws away uncommitted changes: one file's, or every one in the checkout. */
  async discard(workerId: string, filePath: string | undefined, who: string): Promise<string | undefined> {
    return this.action(workerId, 'Discarding…', async (t, w) => {
      if (filePath !== undefined) {
        const file = w.last?.files.find((f) => f.path === filePath);
        if (!file?.uncommitted) return 'That file has no uncommitted changes';
        if (file.status === '?') await git(['clean', '-f', '--', file.path], t.cwd);
        else await git(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...(file.from ? [file.from] : []), file.path], t.cwd);
        this.events.toast(`${who} discarded the changes to ${path.basename(file.path)} at ${t.name}'s desk`, 'info');
      } else {
        const n = w.last?.files.filter((f) => f.uncommitted).length ?? 0;
        await git(['reset', '-q', '--hard'], t.cwd);
        await git(['clean', '-fd'], t.cwd);
        this.events.toast(`${who} discarded ${n ? `${n} uncommitted change${n > 1 ? 's' : ''}` : 'the uncommitted changes'} at ${t.name}'s desk`, 'info');
      }
      return undefined;
    });
  }

  /** Pushes the branch and opens a pull request for it with `gh`. */
  async pullRequest(workerId: string, title: string, body: string, who: string): Promise<string | undefined> {
    if (!title.trim()) return 'The pull request needs a title';
    return this.action(workerId, 'Pushing the branch and opening a pull request…', async (t, w) => {
      const s = w.last ?? (await this.compute(workerId, t));
      if (!s.branch || !s.prBase) return "This checkout isn't on a branch of its own";
      if (s.pr) return `There's already a pull request for ${s.branch}: ${s.pr.url}`;
      if (s.files.some((f) => f.uncommitted)) return 'Commit the changes first';
      if (!s.ahead) return `${s.branch} has no commits that ${s.prBase} lacks`;
      const remotes = (await git(['remote'], t.cwd)).split('\n').filter(Boolean);
      const remote = remotes.includes('origin') ? 'origin' : remotes[0];
      if (!remote) return 'This project has no git remote to push to';
      await git(['push', '-u', remote, s.branch], t.cwd, 120_000);
      const r = await run('gh', ['pr', 'create', '--head', s.branch, '--base', s.prBase, '--title', title.trim(), '--body', body], t.cwd, 120_000);
      const url = r.out.trim().split('\n').pop() ?? '';
      if (r.code !== 0 || !/^https?:\/\//.test(url)) throw new GitError(reason(r, url || 'gh pr create failed'));
      const number = Number(/\/(\d+)$/.exec(url)?.[1] ?? 0);
      this.opened.set(s.branch, { number, url });
      this.events.toast(`${who} opened a pull request for ${t.name}: ${url}`, 'info');
      this.events.refreshGitHub();
      return undefined;
    });
  }

  // ---------------------------------------------------------------------------

  private drop(workerId: string) {
    const w = this.watches.get(workerId);
    if (!w) return;
    clearInterval(w.timer);
    this.watches.delete(workerId);
  }

  /** A file in the worker's list of changes, looking again when it isn't in the last one. */
  private async changedFile(workerId: string, t: ChangesTarget, filePath: string): Promise<ChangedFile | string> {
    let state = this.watches.get(workerId)?.last;
    if (!state?.files.some((f) => f.path === filePath)) state = await this.compute(workerId, t);
    return state.files.find((f) => f.path === filePath) ?? state.error ?? 'That file has no changes';
  }

  /** Runs one commit / discard / PR at a time per worker, showing watchers that it's in progress. */
  private async action(workerId: string, label: string, fn: (t: ChangesTarget, w: Watch) => Promise<string | undefined>): Promise<string | undefined> {
    const t = this.target(workerId);
    if (!t) return 'No such worker';
    let w = this.watches.get(workerId);
    if (!w) {
      w = { clients: new Set(), polling: false };
      this.watches.set(workerId, w);
    }
    if (w.busy) return `Hold on — still ${w.busy.toLowerCase().replace(/…$/, '')}`;
    w.busy = label;
    if (w.last) this.push(w, { ...w.last, busy: label });
    let error: string | undefined;
    try {
      error = await fn(t, w);
    } catch (err) {
      error = err instanceof GitError ? err.message : String((err as Error).message ?? err);
    }
    w.busy = undefined;
    w.lastKey = undefined; // the next poll always reaches the watchers, to clear the busy state
    await this.poll(workerId, true);
    if (!w.clients.size) this.drop(workerId);
    return error;
  }

  private async poll(workerId: string, now = false) {
    const w = this.watches.get(workerId);
    if (!w || w.polling || (!now && !w.clients.size)) return;
    w.polling = true;
    try {
      const t = this.target(workerId);
      const state = t ? await this.compute(workerId, t) : errorState(workerId, '', 'No such worker');
      if (w.busy) state.busy = w.busy;
      const key = JSON.stringify({ ...state, at: 0 });
      if (key !== w.lastKey) {
        w.lastKey = key;
        this.push(w, state);
      }
      w.last = state;
    } finally {
      w.polling = false;
    }
  }

  private push(w: Watch, state: ChangesState) {
    w.last = state;
    if (w.clients.size) this.events.state(state, [...w.clients]);
  }

  /** The commit the diff is taken from, and what to call it. */
  private async baseCommit(t: ChangesTarget): Promise<{ commit: string; label: string; branch?: string; prBase?: string }> {
    const head = await git(['rev-parse', '--verify', '--quiet', 'HEAD'], t.cwd).catch(() => {
      throw new GitError('No commits yet');
    });
    const branch = (await gitMaybe(['rev-parse', '--abbrev-ref', 'HEAD'], t.cwd)) || 'HEAD';
    const onBranch = branch !== 'HEAD';
    let ref: string | undefined;
    let label = 'HEAD';
    if (this.baseBranch && branch !== this.baseBranch && (await gitMaybe(['rev-parse', '--verify', '--quiet', `refs/heads/${this.baseBranch}`], t.cwd))) {
      ref = this.baseBranch;
      label = this.baseBranch;
    } else if (t.worktreeBase && branch !== this.baseBranch) {
      ref = t.worktreeBase;
      label = t.worktreeBase.slice(0, 7);
    } else {
      // On the base branch itself: what isn't pushed yet, when it tracks a remote.
      const up = await gitMaybe(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], t.cwd);
      if (up) {
        ref = up;
        label = up;
      }
    }
    const commit = (ref && (await gitMaybe(['merge-base', ref, 'HEAD'], t.cwd))) || head;
    const prBase = onBranch && this.baseBranch && branch !== this.baseBranch ? this.baseBranch : undefined;
    return { commit, label, branch: onBranch ? branch : undefined, prBase };
  }

  private async compute(workerId: string, t: ChangesTarget): Promise<ChangesState> {
    try {
      const base = await this.baseCommit(t);
      const [numstat, names, status] = await Promise.all([
        git(['diff', '--numstat', '-M', '-z', base.commit], t.cwd),
        git(['diff', '--name-status', '-M', '-z', base.commit], t.cwd),
        git(['status', '--porcelain=v1', '-z', '-uall'], t.cwd),
      ]);
      const files = new Map<string, ChangedFile>();
      // `--name-status -z`: "M\0path\0", renames "R100\0old\0new\0".
      const ns = fields(names);
      for (let i = 0; i < ns.length; ) {
        const kind = ns[i++][0];
        const renamed = kind === 'R' || kind === 'C';
        const from = renamed ? ns[i++] : undefined;
        const p = ns[i++];
        if (p === undefined) break;
        const status: ChangeStatus = renamed ? 'R' : kind === 'A' || kind === 'D' || kind === 'T' ? kind : 'M';
        files.set(p, { path: p, from, status, additions: 0, deletions: 0, binary: false, uncommitted: false, sig: '' });
      }
      // `--numstat -z`: "add\tdel\tpath\0", renames "add\tdel\t\0old\0new\0"; binaries count as "-".
      const st = fields(numstat);
      for (let i = 0; i < st.length; ) {
        const [a, d, p0] = st[i++].split('\t');
        const p = p0 === '' ? st[(i += 2) - 1] : p0;
        const f = p === undefined ? undefined : files.get(p);
        if (!f) continue;
        if (a === '-') f.binary = true;
        else {
          f.additions = Number(a) || 0;
          f.deletions = Number(d) || 0;
        }
      }
      // `status --porcelain -z`: "XY path\0", renames "XY new\0old\0", untracked "?? path\0".
      const untracked: string[] = [];
      const sf = fields(status);
      for (let i = 0; i < sf.length; ) {
        const rec = sf[i++];
        const xy = rec.slice(0, 2);
        const p = rec.slice(3);
        if (xy === '??') {
          untracked.push(p);
          continue;
        }
        const f = files.get(p);
        if (f) f.uncommitted = true;
        if (/[RC]/.test(xy)) {
          const old = sf[i++];
          const g = old === undefined ? undefined : files.get(old);
          if (g) g.uncommitted = true;
        }
      }
      for (const p of untracked) if (!files.has(p)) files.set(p, { path: p, status: '?', additions: 0, deletions: 0, binary: false, uncommitted: true, sig: '' });
      const all = [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
      const list = all.slice(0, MAX_FILES);
      await Promise.all(
        list.map(async (f) => {
          const abs = path.join(t.cwd, f.path);
          if (f.status === '?') {
            const { lines, binary } = await countLines(abs);
            f.additions = lines;
            f.binary = binary;
          }
          f.sig = f.status === 'D' ? '' : await signature(abs);
        }),
      );
      const ahead = Number(await gitMaybe(['rev-list', '--count', `${base.commit}..HEAD`], t.cwd)) || 0;
      const subject = ahead ? await gitMaybe(['log', '-1', '--format=%s'], t.cwd) : undefined;
      const pr = base.branch ? this.opened.get(base.branch) ?? this.openPull(base.branch) : undefined;
      return { workerId, dir: t.rel, branch: base.branch ?? 'HEAD', base: base.label, ahead, subject, files: list, more: all.length - list.length, prBase: base.prBase, pr, at: Date.now() };
    } catch (err) {
      return errorState(workerId, t.rel, err instanceof GitError ? err.message : String((err as Error).message ?? err));
    }
  }
}

function errorState(workerId: string, dir: string, error: string): ChangesState {
  return { workerId, dir, base: 'HEAD', ahead: 0, files: [], more: 0, error, at: Date.now() };
}
