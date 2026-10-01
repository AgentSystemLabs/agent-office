// The Maintenance agent's stack of changes. He works in a worktree of his own, on the branch
// maintenance/stack, off the office's source (see officeSourceDir), and makes one commit for each thing
// he's asked. Nothing is built or restarted as he goes: the commits pile up, and the big button in the
// closet ships the whole stack at once. Shipping never touches the running office until it's sure:
//
//   commit what's left → rebase onto the live checkout → typecheck, test and build in his worktree →
//   fast-forward the live checkout → push it → swap the new build in → restart the office
//
// A step that fails stops there, with the live checkout, its build and the office as they were.

import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import type { MaintenanceStack } from '../shared/protocol.js';
import { officeSourceDir } from './maintenance.js';

/** His branch, and where his worktree lives under the office's data folder. */
export const STACK_BRANCH = 'maintenance/stack';
const WORKTREE = path.join('maintenance', 'worktree');
const SHIP_TIMEOUT_MS = 15 * 60_000;

/** One checked step of a shipment: what it's called in the closet, and the command. */
export interface ShipCheck {
  step: string;
  cmd: string;
  args: string[];
}

export const DEFAULT_CHECKS: ShipCheck[] = [
  { step: 'Typechecking', cmd: 'npm', args: ['run', 'typecheck'] },
  { step: 'Running the tests', cmd: 'npm', args: ['test'] },
  { step: 'Building', cmd: 'npm', args: ['run', 'build'] },
];

const tail = (s: string, lines = 30) => s.trim().split('\n').slice(-lines).join('\n');

function run(cmd: string, args: string[], cwd: string, timeout = 60_000, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { cwd, timeout, env: env ?? process.env, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', windowsHide: true }, (err, out, errOut) => {
      if (err) reject(new Error(tail(`${out}\n${errOut}`) || err.message));
      else resolve(out.trim());
    });
    child.stdin?.end();
  });
}

/** Whether a supervisor (systemd) will start the office again after it exits: only then is it restarted. */
export function supervised(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENT_OFFICE_SELF_UPDATE === '1' || !!env.INVOCATION_ID;
}

/** His worktree under the office's data folder. */
export function stackTree(dataDir: string): string {
  return path.join(dataDir, WORKTREE);
}

export interface StackOptions {
  /** The office's data folder: his worktree is kept under it. */
  dataDir: string;
  /** Tells everyone the stack moved. */
  emit: (state: MaintenanceStack) => void;
  /** Whether he's at work now, in which case there's nothing to ship yet. */
  busy: () => boolean;
  /** Called once a shipment is in place, to restart the office (after telling workers to keep running). */
  restart: (by: string, state: MaintenanceStack) => Promise<void>;
  /** The office's source; the folder the server runs from unless given. */
  source?: string;
  checks?: ShipCheck[];
  /** Whether the office is restarted by something when it exits. */
  supervised?: boolean;
}

export class MaintenanceStackKeeper {
  private current: MaintenanceStack = { changes: [], dirty: 0, phase: 'idle' };
  private ready?: Promise<string | undefined>;
  private timer?: NodeJS.Timeout;
  private readonly source: string | undefined;
  private readonly tree: string;
  private readonly checks: ShipCheck[];

  constructor(private opts: StackOptions) {
    this.source = opts.source ?? officeSourceDir();
    this.tree = stackTree(opts.dataDir);
    this.checks = opts.checks ?? DEFAULT_CHECKS;
  }

  get state(): MaintenanceStack {
    return this.current;
  }

  /** Where he works, once he has a worktree (see prepare). */
  get dir(): string | undefined {
    return existsSync(path.join(this.tree, '.git')) ? this.tree : undefined;
  }

  /** Looks at the stack every few seconds while `watching()`: it moves as he commits. */
  start(watching: () => boolean) {
    this.timer = setInterval(() => watching() && this.current.phase !== 'shipping' && void this.refresh(), 5000);
    this.timer.unref();
    void this.refresh();
  }

  stop() {
    clearInterval(this.timer);
  }

  private set(patch: Partial<MaintenanceStack>) {
    const next = { ...this.current, ...patch };
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    this.opts.emit(next);
  }

  /**
   * Makes sure he has a worktree on his branch to work in, brought up to the live checkout's commit when
   * nothing's stacked (so each stretch of work starts from what's running). Resolves with why he can't
   * work, if he can't.
   */
  prepare(): Promise<string | undefined> {
    this.ready ??= this.setup().finally(() => (this.ready = undefined));
    return this.ready;
  }

  private async setup(): Promise<string | undefined> {
    const src = this.source;
    if (!src) return "Can't find the office's own source to work on (set AGENT_OFFICE_SOURCE)";
    try {
      const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], src);
      if (branch === 'HEAD') return "The office's source is on a detached HEAD, so there's no branch to stack changes onto";
      if (!existsSync(path.join(this.tree, '.git'))) {
        mkdirSync(path.dirname(this.tree), { recursive: true });
        await run('git', ['worktree', 'prune'], src);
        await run('git', ['worktree', 'add', '-B', STACK_BRANCH, this.tree, 'HEAD'], src);
      }
      // The same dependencies as the running office, so checks run without an install.
      if (existsSync(path.join(src, 'node_modules')) && !existsSync(path.join(this.tree, 'node_modules'))) symlinkSync(path.join(src, 'node_modules'), path.join(this.tree, 'node_modules'), 'dir');
      const [head, stacked, dirty] = await Promise.all([run('git', ['rev-parse', 'HEAD'], src), this.count(src), this.dirty()]);
      if (stacked === 0 && dirty === 0 && (await run('git', ['rev-parse', 'HEAD'], this.tree)) !== head) await run('git', ['reset', '--hard', head], this.tree);
      await this.refresh();
      return undefined;
    } catch (err) {
      return `Couldn't set up the Maintenance agent's worktree: ${(err as Error).message}`;
    }
  }

  private async count(src: string): Promise<number> {
    const head = await run('git', ['rev-parse', 'HEAD'], src);
    return Number(await run('git', ['rev-list', '--count', `${head}..${STACK_BRANCH}`], src)) || 0;
  }

  private async dirty(): Promise<number> {
    return (await run('git', ['status', '--porcelain'], this.tree)).split('\n').filter(Boolean).length;
  }

  /** Reads the stack off git and tells everyone if it moved. */
  async refresh(): Promise<void> {
    const src = this.source;
    if (!src) return this.set({ unavailable: "The office's own source wasn't found" });
    if (!this.dir) {
      try {
        const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], src);
        return this.set({ branch, unavailable: undefined, changes: [], dirty: 0 });
      } catch {
        return this.set({ unavailable: "The office's source isn't a git checkout, so there's nothing to stack changes onto" });
      }
    }
    try {
      const [branch, head] = await Promise.all([run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], src), run('git', ['rev-parse', 'HEAD'], src)]);
      const log = await run('git', ['log', '--reverse', '--format=%h%x00%s', `${head}..HEAD`], this.tree);
      const changes = log
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [sha, subject] = l.split('\0');
          return { sha, subject };
        });
      this.set({ branch, unavailable: undefined, changes, dirty: await this.dirty() });
    } catch (err) {
      this.set({ unavailable: `Couldn't read the stack: ${(err as Error).message}` });
    }
  }

  /** Starts shipping the stack. Returns why it can't, if it can't. */
  async ship(by: string): Promise<string | undefined> {
    if (this.current.phase === 'shipping') return 'The stack is already being shipped';
    if (this.opts.busy()) return "The Maintenance agent is still working: wait until he's done, so his change goes out whole";
    // What he has committed since anyone last looked.
    await this.refresh();
    if ((this.current as MaintenanceStack).phase === 'shipping') return 'The stack is already being shipped';
    if (this.current.unavailable) return this.current.unavailable;
    if (!this.current.changes.length && !this.current.dirty) return 'Nothing is stacked yet';
    this.set({ phase: 'shipping', by, step: 'Starting', error: undefined, note: undefined });
    void this.runShipment(by);
    return undefined;
  }

  private async runShipment(by: string) {
    const src = this.source!;
    const step = (s: string) => this.set({ step: s });
    let live: string | undefined;
    let moved = false;
    try {
      step('Checking the live checkout');
      const messy = await run('git', ['status', '--porcelain'], src);
      if (messy) throw new Error(`The office's own checkout has changes that aren't committed, so it can't take the stack:\n${tail(messy, 8)}`);
      const err = await this.prepare();
      if (err) throw new Error(err);
      live = await run('git', ['rev-parse', 'HEAD'], src);
      const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], src);

      step('Committing what he was in the middle of');
      if (await this.dirty()) {
        await run('git', ['add', '-A'], this.tree);
        await run('git', [...(await this.identity()), 'commit', '-m', 'Maintenance agent: changes in progress when the stack was shipped'], this.tree);
      }
      if ((await run('git', ['rev-list', '--count', `${live}..HEAD`], this.tree)) === '0') throw new Error('Nothing is stacked yet');

      step('Rebasing onto the live checkout');
      const base = await run('git', ['merge-base', 'HEAD', live], this.tree);
      if (base !== live) {
        try {
          await run('git', [...(await this.identity()), 'rebase', live], this.tree);
        } catch (e) {
          await run('git', ['rebase', '--abort'], this.tree).catch(() => {});
          throw new Error(`The stack no longer sits on top of what's running, and rebasing it hit conflicts. Ask the Maintenance agent to rebase onto ${branch} and sort them out.\n\n${(e as Error).message}`);
        }
      }

      for (const c of this.checks) {
        step(c.step);
        try {
          await run(c.cmd, c.args, this.tree, SHIP_TIMEOUT_MS);
        } catch (e) {
          throw new Error(`${c.step} failed, so nothing was shipped:\n\n${(e as Error).message}`);
        }
      }

      step('Updating the live checkout');
      await run('git', ['merge', '--ff-only', STACK_BRANCH], src);
      moved = true;
      step('Pushing');
      if ((await run('git', ['remote'], src)).split('\n').includes('origin')) {
        try {
          await run('git', ['push', 'origin', branch], src, 120_000);
        } catch (e) {
          throw new Error(`The push to origin/${branch} was refused, so nothing was shipped:\n\n${(e as Error).message}`);
        }
      }

      step('Swapping in the new build');
      swapBuild(this.tree, src);
      await this.refresh();
      if (!(this.opts.supervised ?? supervised())) {
        this.set({ phase: 'idle', step: undefined, note: 'Committed, pushed and built. Nothing restarts this office by itself: restart it to run the new version.' });
        return;
      }
      step('Restarting the office');
      await this.opts.restart(by, this.current);
    } catch (e) {
      // Put the live checkout back where it was: the commits stay on his branch, still stacked.
      if (moved && live) await run('git', ['reset', '--hard', live], src).catch(() => {});
      await this.refresh().catch(() => {});
      this.set({ phase: 'failed', step: undefined, error: (e as Error).message });
    }
  }

  /** `-c user.name/email` for a commit made on a machine with no git identity set. */
  private async identity(): Promise<string[]> {
    const has = await run('git', ['config', 'user.email'], this.tree).catch(() => '');
    return has ? [] : ['-c', 'user.name=Maintenance agent', '-c', 'user.email=maintenance@agent-office.local'];
  }

  /** Forgets a failed shipment, so the closet goes back to showing the stack. */
  dismiss() {
    if (this.current.phase === 'failed') this.set({ phase: 'idle', error: undefined, by: undefined });
  }
}

/** Puts the build made in `from` in place of the running one in `to`, keeping the old one beside it until the next time. */
export function swapBuild(from: string, to: string) {
  const fresh = path.join(from, 'dist');
  const live = path.join(to, 'dist');
  if (!existsSync(path.join(fresh, 'server')) || !existsSync(path.join(fresh, 'public'))) throw new Error("The build didn't produce dist/server and dist/public");
  const prev = path.join(to, 'dist.prev');
  rmSync(prev, { recursive: true, force: true });
  if (existsSync(live)) renameSync(live, prev);
  try {
    renameSync(fresh, live);
  } catch {
    // Not on the same disk: copy it over instead.
    cpSync(fresh, live, { recursive: true });
    rmSync(fresh, { recursive: true, force: true });
  }
}
