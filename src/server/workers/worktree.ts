// A worker's own worktree, or its workspace across repositories: their folder names, what's kept
// of them in workers.json, making them, keeping each worker's branch up to date, noticing one deleted
// from under a worker and putting it back, and what becomes of them when the worker goes home.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkerInfo, WorkerRepo } from '../../shared/protocol.js';
import { normalizeRepo } from '../../shared/floors.js';
import { officePrompt } from '../prompts.js';
import { WORKSPACE_FILES, WORKTREES_DIR, Worktrees, describeWork, workspaceOf, type WorktreeCleanup, type WorktreeRef, type WorktreeState } from '../worktrees.js';
import { midTurn } from './lifecycle.js';
import type { RepoSource, Worker, WorkerContext, Worktree } from './types.js';

/**
 * The folder each checkout gets in a workspace: its folder's name, made safe, with -2, -3… when two
 * checkouts share one (owner-a/api and owner-b/api).
 */
export function workspaceNames(dirs: string[]): string[] {
  const used = new Set<string>();
  return dirs.map((dir) => {
    let base = path.basename(path.resolve(dir)).replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '') || 'project';
    if (WORKSPACE_FILES.has(base)) base = `${base}-repo`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Takes a workspace folder away once its worktrees are gone: only the brief the office wrote, never anything else left in it. */
export function clearWorkspace(abs: string) {
  try {
    for (const name of readdirSync(abs)) if (WORKSPACE_FILES.has(name)) unlinkSync(path.join(abs, name));
    rmdirSync(abs);
  } catch {
    // already gone, or something else is in it: it stays
  }
}

/** The other repositories of a worker across repositories, as workers.json kept them. */
export function validRepos(raw: unknown): WorkerRepo[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const repos = raw.flatMap((r): WorkerRepo[] => {
    const floor = str(r?.floor), name = str(r?.name), dir = str(r?.dir), rel = str(r?.path), branch = str(r?.branch), base = str(r?.base);
    if (!floor || !name || !dir || !rel || !branch || !base) return [];
    const pr = r.pr && typeof r.pr.number === 'number' && typeof r.pr.url === 'string' ? { number: r.pr.number, url: r.pr.url } : undefined;
    return [{ floor, name, repo: str(r.repo), dir, path: rel, branch, base, from: str(r.from), pr }];
  });
  return repos.length ? repos : undefined;
}

/** owner/name of a checkout's origin on GitHub, when it has one. */
export function originRepo(dir: string): string | undefined {
  try {
    return normalizeRepo(execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim());
  } catch {
    return undefined;
  }
}

/** What starting a worker whose worktree was deleted (see WorkerInfo.lost) says instead. */
export function lostMessage(info: WorkerInfo): string {
  return `${info.name}'s worktree ${workspaceOf(info)} was deleted outside agent-office — rebuild it or send ${info.name} home from its desk`;
}

/** The worktrees of one floor's workers (see WorkerContext). */
export class WorkerTrees {
  constructor(private ctx: WorkerContext) {}

  /**
   * The workspace of a worker across repositories: `.agent-office/worktrees/<slug>`, with a worktree of
   * this floor's project and of each of `repos` in it, all on office/<slug>, and a brief for the agent
   * (the 'worker.repos' prompt, as CLAUDE.md and AGENTS.md). All or nothing: when one repository
   * can't have its worktree, the ones already made are taken out again.
   */
  makeWorkspace(slug: string, repos: RepoSource[]): { worktree: NonNullable<WorkerInfo['worktree']>; repos: WorkerRepo[]; notes: string[] } | string {
    // A branch can only be checked out once per repository, and two floors can be checkouts of the same one.
    const seen = new Map<string, string>();
    const own = this.ctx.trees.commonDir();
    if (!own) return "This floor's project isn't a git checkout";
    seen.set(own, "this floor's project");
    for (const r of repos) {
      const common = new Worktrees(r.dir).commonDir();
      if (!common) return `${r.name} isn't a git checkout`;
      const twin = seen.get(common);
      if (twin) return `${r.name} is the same repository as ${twin}`;
      seen.set(common, r.name);
    }
    const names = workspaceNames([this.ctx.dir, ...repos.map((r) => r.dir)]);
    const made: { trees: Worktrees; ref: WorktreeRef }[] = [];
    const fail = (why: string) => {
      // Fresh branches with nothing on them: nothing is lost taking them out again.
      void (async () => {
        for (const m of made.reverse()) await m.trees.remove(m.ref, 'all');
        clearWorkspace(path.join(this.ctx.dir, WORKTREES_DIR, slug));
      })();
      return why;
    };
    const first = this.ctx.trees.create(slug, names[0]);
    if (typeof first === 'string') return fail(first);
    const { note, ...primary } = first;
    const notes = note ? [`${names[0]} ${note}`] : [];
    made.push({ trees: this.ctx.trees, ref: primary });
    const others: WorkerRepo[] = [];
    for (const [i, r] of repos.entries()) {
      const trees = new Worktrees(r.dir);
      const wt = trees.create(slug, names[i + 1], this.ctx.dir);
      if (typeof wt === 'string') return fail(`${r.name}: ${wt}`);
      if (wt.note) notes.push(`${names[i + 1]} ${wt.note}`);
      made.push({ trees, ref: { ...wt, path: path.relative(r.dir, path.join(this.ctx.dir, wt.path)) } });
      others.push({ floor: r.floor, name: names[i + 1], repo: r.repo, dir: r.dir, path: wt.path, branch: wt.branch, base: wt.base, from: wt.from });
    }
    try {
      this.writeBrief(primary, repos.map((r, i) => ({ name: names[i + 1], project: r.repo ?? r.name, from: others[i].from })));
    } catch (err) {
      return fail(`Could not write the workspace's brief: ${(err as Error).message}`);
    }
    return { worktree: primary, repos: others, notes };
  }

  /**
   * The brief in the workspace of a worker across repositories, which folder is which project (the
   * 'worker.repos' prompt), as CLAUDE.md and AGENTS.md. `primary` is its own floor's worktree, in the
   * workspace like `others`. Throws when it can't be written.
   */
  private writeBrief(primary: { path: string; branch: string; from?: string }, others: { name: string; project: string; from?: string }[]) {
    const home = originRepo(this.ctx.dir) ?? path.basename(this.ctx.dir);
    const line = (name: string, project: string, from?: string, note = '') => `- \`${name}/\`: ${project}${from ? `, cut from ${from}` : ''}${note}`;
    const brief = officePrompt(this.ctx.prompts, 'worker.repos', {
      branch: primary.branch,
      home,
      repos: [line(path.basename(primary.path), home, primary.from, " (this floor's project)"), ...others.map((o) => line(o.name, o.project, o.from))].join('\n'),
    });
    for (const file of WORKSPACE_FILES) writeFileSync(path.join(this.ctx.dir, path.dirname(primary.path), file), `${brief.trim()}\n`);
  }

  /** Sending home a worker across repositories: what `kill` does with a worktree, for each of its worktrees, and then its workspace. */
  private async clearRepos(info: WorkerInfo, cleanup: WorktreeCleanup | undefined, landed?: string, landedRepos?: Record<string, string | undefined>): Promise<{ note?: string; error?: string }> {
    const trees = this.treesOf(info, landed, landedRepos);
    const { name } = info;
    const branch = info.worktree!.branch;
    const where = trees.map((t) => t.name).join(', ');
    if (!cleanup) {
      const held = (await Promise.all(trees.map(async (t) => ({ name: t.name, work: describeWork(await t.trees.inspect(t.ref, t.landed)) })))).filter((t) => t.work);
      if (held.length) return { note: `Kept ${name}'s worktrees and branch ${branch} in ${where} — ${held.map((t) => `${t.name} has ${t.work}`).join('; ')}` };
      cleanup = 'all';
    }
    if (cleanup === 'keep') return { note: `Kept ${name}'s worktrees and branch ${branch} in ${where}` };
    const how = cleanup;
    const errors = (await Promise.all(trees.map(async (t) => {
      const error = await t.trees.remove(t.ref, how);
      return error && `${t.name}: ${error}`;
    }))).filter(Boolean);
    if (errors.length) return { error: `Couldn't delete all of ${name}'s worktrees: ${errors.join('; ')}` };
    clearWorkspace(path.join(this.ctx.dir, workspaceOf(info)!));
    return { note: how === 'all' ? `Deleted ${name}'s worktrees and branch ${branch} in ${where}` : `Deleted ${name}'s worktrees in ${where} and kept branch ${branch}` };
  }

  /**
   * Each worktree a worker across repositories has, its own floor's first: its folder in the
   * workspace, git plumbing for its repository, its worktree in that repository's terms, and the
   * commit its merged pull request delivered, when known.
   */
  private treesOf(info: WorkerInfo, landed?: string, landedRepos?: Record<string, string | undefined>): { name: string; dir: string; trees: Worktrees; ref: WorktreeRef; landed?: string }[] {
    const wt = info.worktree!;
    return [
      { name: path.basename(wt.path), dir: this.ctx.dir, trees: this.ctx.trees, ref: wt, landed },
      ...(info.repos ?? []).map((r) => ({
        name: r.name,
        dir: r.dir,
        trees: new Worktrees(r.dir),
        ref: { path: path.relative(r.dir, path.join(this.ctx.dir, r.path)), branch: r.branch, base: r.base },
        landed: landedRepos?.[r.floor],
      })),
    ];
  }

  /**
   * Whether any worktree of a worker across repositories holds work its merged pull requests didn't
   * deliver (`landed` and `landedRepos`, as for kill): then it doesn't go home by itself yet.
   */
  async holdsWork(id: string, landed?: string, landedRepos?: Record<string, string | undefined>): Promise<boolean> {
    const info = this.ctx.workers.get(id)?.info;
    if (!info?.worktree) return false;
    const states = await Promise.all(this.treesOf(info, landed, landedRepos).map(async (t) => describeWork(await t.trees.inspect(t.ref, t.landed))));
    return states.some(Boolean);
  }

  /** What a worker's worktree holds, so whoever sends it home knows what deleting it would lose. */
  async inspect(id: string): Promise<WorktreeState | undefined> {
    const w = this.ctx.workers.get(id);
    const info = w?.info;
    if (!w || !info?.worktree) return undefined;
    if (!info.repos?.length) {
      await this.syncBranch(w);
      return this.ctx.trees.inspect(w.info.worktree!);
    }
    const repos = await Promise.all(this.treesOf(info).map(async (t) => ({ name: t.name, state: await t.trees.inspect(t.ref) })));
    const sum = (k: 'dirty' | 'ahead' | 'unpushed') => repos.reduce((n, r) => n + r.state[k], 0);
    const errors = repos.filter((r) => r.state.error).map((r) => `${r.name}: ${r.state.error}`);
    return { exists: repos.every((r) => r.state.exists), dirty: sum('dirty'), ahead: sum('ahead'), unpushed: sum('unpushed'), error: errors.length ? errors.join('; ') : undefined, repos };
  }

  /** Every worker's worktree branch, looked at again (see syncBranch): for when new pull requests may have come in. */
  async syncAll(): Promise<void> {
    await Promise.all([...this.ctx.workers.values()].map((w) => this.syncBranch(w)));
  }

  /**
   * Keeps `worktree.branch` on the branch the worktree is actually on. Agents often make their own
   * (`git checkout -b fix-x`, because the task or the repo's CLAUDE.md says to) and open the pull
   * request from there with gh, and the PR badge, O at the desk and sending it home go by it. A
   * meeting's worktree stays the meeting's, and a worker across repositories keeps the branch it was
   * given in each (see openPrs).
   */
  async syncBranch(w: Worker): Promise<void> {
    const wt = w.info.worktree;
    if (!wt || w.info.meeting || w.info.repos?.length) return;
    const now = await this.current(wt);
    // Sent home meanwhile, or another look got there first.
    if (now === wt || this.ctx.workers.get(w.info.id) !== w || w.info.worktree !== wt) return;
    w.info.worktree = now;
    this.ctx.emit(w);
    this.ctx.persist();
  }

  /** A worktree on the branch it's on now, with the office's own branch kept in `made`; the same one when nothing moved. */
  private async current(wt: Worktree): Promise<Worktree> {
    const live = await this.ctx.trees.branchOf(wt);
    if (!live) return wt;
    let made = wt.made ?? (live === wt.branch ? undefined : wt.branch);
    // Back on it, or renamed it (`git branch -m fix-x`): the branch it's on is the office's own.
    if (made === live || (made && (await this.ctx.trees.renamedTo(made, live)))) made = undefined;
    return live === wt.branch && made === wt.made ? wt : { ...wt, branch: live, made };
  }

  /**
   * Whether the folder a worker works in (its worktree, or its workspace across repositories) is gone:
   * deleted outside the office. It's then marked lost (WorkerInfo.lost) for whoever comes to its desk,
   * instead of failing to start over and over; once the folder is back, it isn't any more.
   */
  checkLost(w: Worker, recheck = false): boolean {
    const { info } = w;
    if (!info.worktree || existsSync(this.ctx.cwd(info))) {
      if (info.lost) {
        info.lost = undefined;
        this.ctx.emit(w);
      }
      return false;
    }
    // Where its branch is only changes by hand: looked at again when someone tries to start it.
    if (info.lost && !recheck) return true;
    const branch = this.ctx.trees.branchState(info.worktree.branch);
    if (branch !== info.lost?.branch) {
      info.lost = { branch };
      this.ctx.emit(w);
    }
    return true;
  }

  /**
   * Every so often: a worktree deleted under a worker marks it lost, and one put back by hand
   * (`git worktree add` at the same place) sets an asleep worker back to work.
   */
  watchFolder(w: Worker) {
    if (!w.info.worktree || w.rebuilding) return;
    const was = !!w.info.lost;
    if (!this.checkLost(w) && was && !w.pty && !w.dsh) this.ctx.resume(w.info.id);
  }

  /**
   * Puts a lost worker's worktree back where it was (see Worktrees.restore) and starts it again,
   * carrying on its conversation; across repositories, each worktree that's gone and the workspace's
   * brief. Everyone else who worked there (the rest of a meeting's table) gets back to work with it.
   * Resolves to whether it `rebuilt` anything, with a note on where a branch came back from (or why
   * there was nothing to do), or to what went wrong.
   */
  async rebuild(id: string): Promise<{ rebuilt?: boolean; note?: string; error?: string }> {
    const w = this.ctx.workers.get(id);
    if (!w) return { error: 'No such worker' };
    const { info } = w;
    if (!info.worktree) return { error: `${info.name} works in the main checkout` };
    if (w.rebuilding) return {};
    const folder = this.ctx.cwd(info);
    // Whoever the folder was deleted from under: this worker, and the rest of its meeting's table.
    const stranded = [...this.ctx.workers.values()].filter((o) => o.info.worktree && this.ctx.cwd(o.info) === folder && (o.info.lost || this.checkLost(o)));
    const froms: string[] = [];
    if (!existsSync(folder)) {
      const across = !!info.repos?.length;
      w.rebuilding = true;
      try {
        for (const t of this.treesOf(info)) {
          if (t.ref.path && existsSync(path.resolve(t.dir, t.ref.path))) continue;
          const r = await t.trees.restore(t.ref);
          const which = across ? `${t.name}'s ` : '';
          if ('error' in r) return { error: `Couldn't rebuild ${info.name}'s worktree${across ? ` of ${t.name}` : ''}: ${r.error}` };
          if (r.from === 'origin') froms.push(`${which}${t.ref.branch} came back from origin`);
          if (r.from === 'gone') froms.push(`${which}${t.ref.branch} was deleted too, so it starts again from where it began`);
        }
        if (across) {
          try {
            this.writeBrief(info.worktree, info.repos!.map((r) => ({ name: r.name, project: r.repo ?? r.name, from: r.from })));
          } catch {
            // The worktrees are what it needs; the brief only says which folder is which.
          }
        }
      } finally {
        w.rebuilding = false;
      }
    }
    for (const o of stranded) if (!this.checkLost(o)) this.restartIn(o);
    if (!stranded.length) {
      if (!w.pty && !w.dsh) this.ctx.resume(id);
      return { note: `${info.name}'s worktree is already there` };
    }
    return { rebuilt: true, note: froms.join('; ') || undefined };
  }

  /**
   * Starts a worker in its folder again: an asleep one wakes up, and one whose process was left running
   * in the folder deleted from under it starts over in the new one, carrying on its conversation.
   */
  private restartIn(w: Worker) {
    const proc = w.pty;
    const session = w.dsh;
    if (proc || session) {
      if (midTurn(w)) w.interrupted = true;
      // Gone before it exits, so the exit handler knows it was the office and stays quiet.
      w.pty = undefined;
      w.dsh = undefined;
      try {
        session?.close();
        proc?.kill();
      } catch {
        // already gone
      }
    }
    this.ctx.resume(w.info.id);
  }

  /**
   * What becomes of the worktree of a worker just sent home (see WorkerManager.kill): `cleanup`, or
   * with no choice given, the worktree and branch go only when they hold no work, where `landed` (its
   * merged pull request's head commit) is work delivered. Resolves with a line for the team about it.
   */
  async sendHome(info: WorkerInfo, cleanup?: WorktreeCleanup, landed?: string, landedRepos?: Record<string, string | undefined>): Promise<{ note?: string; error?: string }> {
    // A meeting's worktree is everyone at the table's: the meeting tidies it away once they've all gone.
    if (!info.worktree || info.meeting) return {};
    // On the branch its work is on, should it have switched since it last came to rest.
    const wt = await this.current(info.worktree);
    const name = info.name;
    if (info.repos?.length) return this.clearRepos(info, cleanup, landed, landedRepos);
    if (!cleanup) {
      const work = describeWork(await this.ctx.trees.inspect(wt, landed));
      if (work) return { note: `Kept ${name}'s worktree and branch ${wt.branch} — it has ${work}` };
      cleanup = 'all';
    }
    if (cleanup === 'keep') return { note: `Kept ${name}'s worktree and branch ${wt.branch}` };
    let gone = wt;
    let kept = '';
    if (cleanup === 'all' && wt.made) {
      if (!(await this.ctx.trees.hasBranch(wt.made))) {
        // The agent deleted the office's branch (a rename is followed, see current), so git can't say
        // whether the one it's on is its own or was there before it: that one stays.
        cleanup = 'worktree';
      } else {
        // The office's own branch stays while it has commits that no remote, the project's checkout
        // or the branch it's on has.
        const work = await this.ctx.trees.wouldLose(wt.made, [wt.branch]);
        if (work) kept = ` and kept branch ${wt.made} — it has ${work}`;
        // A branch it made itself goes with it; one that was there before it (main, say) isn't the office's to delete.
        if (await this.ctx.trees.madeSince(wt.branch, wt.made)) gone = work ? { ...wt, made: undefined } : wt;
        else if (work) cleanup = 'worktree';
        else gone = { ...wt, branch: wt.made, made: undefined };
      }
    }
    const error = await this.ctx.trees.remove(gone, cleanup);
    if (error) return { error: `Couldn't delete ${name}'s worktree: ${error}` };
    if (cleanup === 'worktree') return { note: `Deleted ${name}'s worktree${kept || ` and kept branch ${wt.branch}`}` };
    return { note: `Deleted ${name}'s worktree and branch ${gone.branch}${kept && `,${kept}`}` };
  }
}
