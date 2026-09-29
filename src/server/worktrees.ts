import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { WorktreeState } from '../shared/protocol.js';

export type { WorktreeCleanup, WorktreeState } from '../shared/protocol.js';

const execFileP = promisify(execFile);

/** Where the office keeps its workers' worktrees, relative to the project. */
export const WORKTREES_DIR = path.join('.agent-office', 'worktrees');
/** Their branches are office/<worker>-<id>. */
export const BRANCH_PREFIX = 'office/';

export interface WorktreeRef {
  /** Folder relative to the project dir; missing for a branch whose worktree is already gone. */
  path?: string;
  branch: string;
  /** The commit it was branched from, when known. */
  base?: string;
}

export interface ListedWorktree {
  /** Relative to the project dir. */
  path: string;
  branch?: string;
  head: string;
}

/** Git plumbing for the worktrees the office makes for its workers: hiring, sending home and pruning. */
export class Worktrees {
  /** The project dir with symlinks resolved, so it compares with the paths git prints. */
  private readonly root: string;

  constructor(private dir: string) {
    this.root = real(dir);
  }

  /**
   * A new branch and worktree at the project's current HEAD. `from` is the branch the project was
   * on, which the worker's pull request targets. Returns what went wrong as a string.
   */
  create(slug: string): (Required<WorktreeRef> & { from?: string }) | string {
    try {
      const base = this.gitSync(['rev-parse', 'HEAD']);
      const from = this.currentBranch();
      const rel = path.join(WORKTREES_DIR, slug);
      const branch = `${BRANCH_PREFIX}${slug}`;
      this.gitSync(['worktree', 'add', '-b', branch, rel, base]);
      return { path: rel, branch, base, from };
    } catch (err) {
      return `Could not create a git worktree: ${gitError(err)}`;
    }
  }

  /** The branch the project is on, or undefined when HEAD is detached. */
  currentBranch(): string | undefined {
    try {
      const b = this.gitSync(['rev-parse', '--abbrev-ref', 'HEAD']);
      return b === 'HEAD' ? undefined : b;
    } catch {
      return undefined;
    }
  }

  /**
   * What a worktree holds: uncommitted changes, commits since it was made, and the commits only it has.
   * `landed` is a commit already delivered (the head of its merged pull request): it and the commits
   * before it don't count as unpushed, even once GitHub has deleted the branch.
   */
  async inspect(wt: WorktreeRef, landed?: string): Promise<WorktreeState> {
    const abs = wt.path ? path.join(this.dir, wt.path) : undefined;
    const exists = !!abs && existsSync(abs);
    const state: WorktreeState = { exists, dirty: 0, ahead: 0, unpushed: 0 };
    try {
      if (exists) state.dirty = (await this.git(['status', '--porcelain'], abs)).split('\n').filter(Boolean).length;
      // A commit this checkout never fetched (GitHub updated the branch itself) can't be left out.
      const known = landed && /^[0-9a-f]{40,64}$/.test(landed) && (await this.git(['cat-file', '-e', `${landed}^{commit}`]).then(() => true, () => false));
      // On no remote and not in the project's own checkout either: what deleting the branch would lose.
      state.unpushed = Number(await this.git(['rev-list', '--count', wt.branch, '--not', 'HEAD', '--remotes', ...(known ? [landed] : [])]));
      state.ahead = Number(await this.git(['rev-list', '--count', wt.branch, '--not', wt.base ?? 'HEAD']).catch(() => state.unpushed));
    } catch (err) {
      state.error = gitError(err);
    }
    return state;
  }

  /** Deletes the worktree folder, and the branch too for 'all'. Returns what went wrong, if anything. */
  async remove(wt: WorktreeRef, cleanup: 'worktree' | 'all'): Promise<string | undefined> {
    try {
      if (wt.path) {
        const abs = path.join(this.dir, wt.path);
        if (existsSync(abs)) {
          try {
            await this.git(['worktree', 'remove', '--force', '--force', abs]);
          } catch (err) {
            // Git won't (a lock, a submodule), but it is the office's own folder: take it out ourselves.
            if (!this.owns(abs)) throw err;
            await rm(abs, { recursive: true, force: true });
          }
        }
      }
      // Forget worktrees whose folders are gone: this one, and any someone rm -rf'd by hand.
      await this.git(['worktree', 'prune']);
      if (cleanup === 'all') await this.git(['branch', '-D', wt.branch]);
      return undefined;
    } catch (err) {
      return gitError(err);
    }
  }

  /** The worktrees git has under .agent-office/worktrees, every office/* branch, and folders there git doesn't know. */
  async list(): Promise<{ worktrees: ListedWorktree[]; branches: string[]; strays: string[] }> {
    const home = path.join(this.root, WORKTREES_DIR);
    const worktrees: ListedWorktree[] = [];
    let cur: ListedWorktree | undefined;
    for (const line of (await this.git(['worktree', 'list', '--porcelain'])).split('\n')) {
      if (line.startsWith('worktree ')) {
        const abs = real(line.slice('worktree '.length));
        cur = within(home, abs) ? { path: path.relative(this.root, abs), head: '' } : undefined;
        if (cur) worktrees.push(cur);
      } else if (cur && line.startsWith('HEAD ')) cur.head = line.slice('HEAD '.length);
      else if (cur && line.startsWith('branch ')) cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    }
    const branches = (await this.git(['for-each-ref', '--format=%(refname:short)', `refs/heads/${BRANCH_PREFIX}`])).split('\n').filter(Boolean);
    const known = new Set(worktrees.map((w) => path.join(this.root, w.path)));
    const strays = existsSync(home)
      ? readdirSync(home)
          .map((n) => path.join(home, n))
          .filter((p) => !known.has(p) && isDir(p))
          .map((p) => path.relative(this.root, p))
      : [];
    return { worktrees, branches, strays };
  }

  /** True for a folder inside .agent-office/worktrees, the only place this class deletes on its own. */
  owns(abs: string): boolean {
    return within(path.join(this.root, WORKTREES_DIR), real(abs));
  }

  private gitSync(args: string[], cwd = this.dir): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 }).trim();
  }

  private async git(args: string[], cwd = this.dir): Promise<string> {
    const { stdout } = await execFileP('git', args, { cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim();
  }
}

/** Why deleting this would lose something ("2 uncommitted changes, 1 unpushed commit"), or '' when it wouldn't. */
export function describeWork(s: WorktreeState): string {
  if (s.error) return `could not check it (${s.error})`;
  const parts: string[] = [];
  if (s.dirty) parts.push(`${s.dirty} uncommitted change${s.dirty === 1 ? '' : 's'}`);
  if (s.unpushed) parts.push(`${s.unpushed} unpushed commit${s.unpushed === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/** The last line git printed, which is the one that says what's wrong. */
export function gitError(err: unknown): string {
  const e = err as { stderr?: string; message?: string };
  return String(e.stderr || e.message || err).trim().split('\n').filter(Boolean).pop() ?? 'git failed';
}

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function within(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
