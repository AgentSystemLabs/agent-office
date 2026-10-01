import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { AgentEffort, AgentProvider, ChangesState, FloorInfo, ForgeKind, GhIssue, GhPull, GhState, PeerInfo, ProjectInfo, ServerMsg, WorkerInfo } from '../shared/protocol.js';
import { isBusy } from '../shared/status.js';
import { DESK_BY_ID } from '../shared/layout.js';
import { caption } from '../shared/chairs.js';
import type { FloorDef } from './building.js';
import type { FloorActions } from './floor-actions.js';
import { excludeFromGit } from './config.js';
import { agentProviders, configuredProvider } from './agents.js';
import { WorkerManager, workedMs, type HookEnv, type RunAs } from './workers.js';
import { Bitbucket } from './bitbucket.js';
import { Helpers } from './helpers.js';
import { forgeOf, MergeWatch, type Forge } from './forge.js';
import { GitHub } from './github.js';
import type { ForgeAs } from './signins.js';
import { TaskQueue } from './queue.js';
import { Changes } from './changes.js';
import { Decor } from './decor.js';
import { FloorPlanStore } from './floorplan.js';
import { Docs } from './docs.js';
import { Dog } from './dog.js';
import { Court } from './court.js';
import { Jail } from './jail.js';
import { Garage } from './garage.js';
import { Jukebox } from './jukebox.js';
import { MusicalChairs } from './chairs.js';
import { Tv } from './tv.js';
import { Whiteboard } from './whiteboard.js';
import { MeetingRoom } from './meetings.js';
import { Worktrees, type WorktreeCleanup } from './worktrees.js';
import { landedWork, landedWorkers, type Landed } from './leave-on-merge.js';
import type { Ledger } from './usage.js';
import type { Capacity } from './machine.js';
import { officePrompt, type PromptSource } from './prompts.js';

type ToastLevel = 'info' | 'warn' | 'error';

/** What a floor needs from the building around it. */
export interface FloorContext {
  agentCmd: string;
  agentArgs: string[];
  /** The DSH profile DeepSeek Harness workers boot (see server/dsh.ts). */
  dshProfile: string;
  hook: HookEnv;
  /** Spend, across every floor. */
  ledger: Ledger;
  /** The office's worker limit, across every floor. */
  capacity: Capacity;
  /** The office's prompts and the worker everyone starts on, as set in ⚙️ Settings. */
  prompts: PromptSource;
  /** Workers hired by an account run on its own sign-ins (see signins.ts). */
  runAs?: RunAs;
  /** How to run a forge's CLI as an account: its own sign-in, the office's (undefined), or why it can't. */
  forgeAs(owner: string | undefined, kind: ForgeKind): ForgeAs | undefined | string;
  /** To everyone on this floor. */
  emit(floor: Floor, msg: ServerMsg, droppable?: boolean): void;
  toast(floor: Floor, text: string, level?: ToastLevel): void;
  /** A worker's terminal output, for whoever has that terminal open. */
  termData(workerId: string, data: string, viewers: string[]): void;
  /** What a worker changed, for whoever has its Changes window open. */
  changes(state: ChangesState, clients: string[]): void;
  /** A worker on this floor changed, or left (then just its id). */
  workerChanged(floor: Floor, w: WorkerInfo | string): void;
  /** How many people are on this floor right now. */
  people(floor: Floor): number;
  /** Who's on this floor, and where they stand. */
  peers(floor: Floor): PeerInfo[];
  /** ⚙️ Settings: a worker whose pull request merged goes home by itself. */
  leaveOnMerge(): boolean;
  /** Another floor of the building: a worker across repositories works in its project too (see WorkerInfo.repos). */
  floor(id: string): Floor | undefined;
  /** This floor's pull requests came back: a worker on another floor with a repository here may have landed. */
  pullsChanged(floor: Floor): void;
  /** Whether a worker on another floor works in this floor's project too. */
  lent(floor: Floor): boolean;
  /** Whether the building's map locks up workers sent home (see MapPlan.sendHome), instead of letting them go. */
  locksUp(): boolean;
}

/** The open pull request on a floor's board whose head is `branch`. */
function openPull(floor: Floor, branch: string): { number: number; url: string } | undefined {
  const pr = floor.forge.pulls.items.find((p) => p.state === 'OPEN' && p.headRefName === branch);
  return pr ? { number: pr.number, url: pr.url } : undefined;
}

/** How long after a PR list or a worker's change the office looks for workers whose PR merged. */
const LANDED_DELAY_MS = 1500;
/** Boards on a floor nobody is on, with nothing running, are asked GitHub about this seldom. */
const IDLE_REFRESH_MS = 10 * 60_000;
const REFRESH_MS = 90_000;

/** What `git` says about a checkout: its name, branch and origin for the top bar. */
export function projectInfo(dir: string, name: string, agentCmd: string, agentArgs: string[]): ProjectInfo {
  const git = (args: string[]) => {
    try {
      return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return undefined;
    }
  };
  return {
    name,
    dir,
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    remote: git(['remote', 'get-url', 'origin']),
    agentCmd: [agentCmd, ...agentArgs].join(' '),
    defaultProvider: configuredProvider(agentCmd),
    agentProviders: agentProviders(configuredProvider(agentCmd)),
  };
}

/**
 * One floor of the building: a project's checkout with its own desks and workers, issues and PR
 * boards, task queue, pictures, jukebox and TV, all kept in that checkout's .agent-office folder.
 */
export class Floor {
  readonly id: string;
  readonly dir: string;
  readonly project: ProjectInfo;
  readonly workers: WorkerManager;
  /** Where this floor's code is hosted: its issues and pull requests, read with that forge's CLI. */
  readonly forge: Forge;
  readonly queue: TaskQueue;
  readonly changes: Changes;
  readonly decor: Decor;
  /** The signs over its desks, and how far its back office is built out. */
  readonly plan: FloorPlanStore;
  readonly jukebox: Jukebox;
  /** The big TV: the link on it, and where everyone is in it. */
  readonly tv: Tv;
  /** The whiteboard everyone on the floor draws on together. */
  readonly whiteboard: Whiteboard;
  /** The meeting room, where workers work through a question together (see meetings.ts). */
  readonly meetings: MeetingRoom;
  /** The helpers standing at workers' desks, and which way each is walking (see helpers.ts). */
  readonly helpers: Helpers;
  /** The bookshelf: the project's Markdown files (see docs.ts). */
  readonly docs: Docs;
  /** Settles once the workers whose terminals outlived the last office are picked back up, and the rest woken. */
  readonly ready: Promise<void>;
  readonly dog: Dog;
  /** The basketball by the hoop: who has it, or how it was last thrown. */
  readonly court = new Court();
  /** The cars in the garage: who's in which, and where their drivers have left them. */
  readonly garage = new Garage();
  /** Workers sent home on a map that locks them up (see MapPlan.sendHome). */
  readonly jail: Jail;
  /** Musical chairs for its workers, one round at a time (see shared/chairs.ts). */
  readonly chairs: MusicalChairs;
  private timer: NodeJS.Timeout;
  /** Pull requests merging, to ring the gong for. */
  private merges = new MergeWatch();
  /** A look for workers whose pull request merged, due shortly (see sendLandedHome). */
  private landedTimer?: NodeJS.Timeout;
  /** Workers across repositories whose worktrees are being checked before they go home. */
  private landing = new Set<string>();

  constructor(
    readonly def: FloorDef,
    private ctx: FloorContext,
  ) {
    this.id = def.id;
    this.dir = def.dir;
    const dataDir = path.join(def.dir, '.agent-office');
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    excludeFromGit(def.dir);
    this.project = projectInfo(def.dir, def.name, ctx.agentCmd, ctx.agentArgs);
    this.docs = new Docs(def.dir);
    // Before the workers and the dog: the back office's desks are only there once it's built.
    this.plan = new FloorPlanStore(dataDir);
    this.jail = new Jail(dataDir);

    // Before the workers, so it hears about the ones who wake up needing input.
    this.dog = new Dog(def.id, dataDir, {
      workers: () => this.workers?.list() ?? [],
      people: () => ctx.peers(this),
      send: (dog) => ctx.emit(this, { t: 'dog', dog }),
      wing: () => this.plan.wing,
    });

    // Before the workers too, so it hears a helper's first updates as it reads.
    this.helpers = new Helpers({
      workers: () => this.workers?.list() ?? [],
      send: (helpers) => ctx.emit(this, { t: 'helper', helpers }),
      wing: () => this.plan.wing,
      sendHome: (workerId) => void this.sendHome(workerId),
    });

    this.workers = new WorkerManager(
      def.dir,
      dataDir,
      ctx.agentCmd,
      ctx.agentArgs,
      ctx.hook,
      {
        update: (worker) => {
          ctx.emit(this, { t: 'worker.update', worker });
          // Still being built: the first updates come from waking the workers already at their desks.
          this.queue?.onWorker(worker);
          this.meetings?.onWorker(worker);
          this.dog.onWorker(worker);
          this.onHelperUpdate(worker);
          ctx.workerChanged(this, worker);
          // Its turn ended, or whoever had its terminal open closed it: it may be free to go now.
          this.sendLandedHome();
        },
        remove: (workerId, info) => {
          this.changes?.forget(workerId);
          // Sent home on a map that locks workers up: into the dungeon with it, for good (a meeting's
          // workers aren't sent home when it's over, just let go).
          const jail = info && !info.meeting && !info.helper && ctx.locksUp() ? this.jail.add({ ...info, workedMs: workedMs(info) }) : undefined;
          ctx.emit(this, { t: 'worker.remove', workerId, ...(jail ? { jail } : {}) });
          this.queue?.onWorkerGone(workerId);
          this.meetings?.onWorkerGone(workerId);
          this.dog.onWorkerGone(workerId);
          this.helpers?.forget(workerId);
          ctx.workerChanged(this, workerId);
        },
        data: (workerId, data, viewers) => ctx.termData(workerId, data, viewers),
        screen: (workerId, frame) => ctx.emit(this, { t: 'screen', workerId, ...frame }, true),
        toast: (text, level) => ctx.toast(this, text, level),
      },
      ctx.ledger,
      ctx.capacity,
      ctx.prompts,
      ctx.runAs,
      ctx.dshProfile,
    );
    this.workers.wing = () => this.plan.wing;
    // Which forge this floor is on, so PRs open on the right one and board agents are told the right CLI.
    this.workers.forge = forgeOf(this.project.remote);

    // Whichever forge the checkout's origin points at: GitHub through gh, Bitbucket through bb.
    const kind = forgeOf(this.project.remote);
    const boards = {
      issues: (state: GhState<GhIssue>) => ctx.emit(this, { t: 'gh.issues', state }),
      pulls: (state: GhState<GhPull>) => {
        ctx.emit(this, { t: 'gh.pulls', state });
        this.queue?.onPulls(state.items);
        if (state.loading || state.error) return;
        // A worker may have opened one from a branch it made itself, mid-turn or from a shell.
        void this.workers.syncBranches();
        for (const p of this.merges.look(state.items)) {
          ctx.toast(this, `🎉 PR #${p.number} merged: ${p.title}`);
          this.merged(p.number);
        }
        this.sendLandedHome();
        ctx.pullsChanged(this);
      },
    };
    this.forge = kind === 'bitbucket' ? new Bitbucket(def.dir, boards.issues, boards.pulls) : new GitHub(def.dir, boards.issues, boards.pulls);
    // The 📋 task queue seats workers by itself: it watches the workers and links PRs from GitHub.
    this.queue = new TaskQueue(dataDir, this.workers, !!this.project.branch, {
      update: (state) => {
        ctx.emit(this, { t: 'queue', state });
        // A task's pull request may just have been linked (or merged).
        this.sendLandedHome();
      },
      toast: (text, level) => ctx.toast(this, text, level),
      claimIssue: (issue, owner) => {
        const as = ctx.forgeAs(owner, kind);
        return typeof as === 'string' ? Promise.resolve(as) : this.forge.claim(issue, as);
      },
      refreshGitHub: () => void this.forge.refresh(),
      hiringPaused: () => ctx.ledger.hiringPaused,
      room: () => ctx.capacity.room(),
      emptied: () => {
        ctx.toast(this, '📋 The queue is empty: every task is done 🎉');
        ctx.emit(this, { t: 'gong', why: 'queue' });
      },
      worktreeNote: () => officePrompt(ctx.prompts, 'queue.worktree'),
    });

    // Meetings seat their own workers round the meeting room's table and run them round by round.
    const workers = this.workers;
    this.meetings = new MeetingRoom(
      def.dir,
      dataDir,
      {
        defaultProvider: this.workers.defaultProvider,
        get officeDefault() {
          return workers.officeDefault;
        },
        list: () => this.workers.list(),
        activeSince: (id, at) => this.workers.activeSince(id, at),
        seat: (deskId, by, prompt, provider, model, effort, meeting, owner) => this.workers.spawn(deskId, by, prompt, false, 'agent', provider, model, effort, meeting, owner),
        prompt: (id, text, by) => this.workers.prompt(id, text, by),
        write: (id, data, by) => this.workers.write(id, data, by),
        kill: (id) => this.workers.kill(id),
      },
      this.project.branch ? new Worktrees(def.dir) : undefined,
      {
        update: (state) => ctx.emit(this, { t: 'meeting', state }),
        toast: (text, level) => ctx.toast(this, text, level),
        hiringPaused: () => ctx.ledger.hiringPaused,
        postReview: (pr, file, owner) => {
          const as = ctx.forgeAs(owner, kind);
          return typeof as === 'string' ? Promise.reject(new Error(as)) : this.forge.review(pr, file, as);
        },
        prompt: (id) => ctx.prompts.text(id),
      },
    );

    // What each worker changed, for the Changes window at its desk (see changes.ts).
    this.changes = new Changes(
      def.dir,
      this.project.branch,
      (workerId, repo) => {
        const w = this.workers.get(workerId);
        if (!w) return undefined;
        if (!repo) return { name: w.name, cwd: w.worktree ? path.join(def.dir, w.worktree.path) : def.dir, rel: w.worktree?.path ?? '', worktreeBase: w.worktree?.base };
        // One of the other floors' repositories it works in: diffed against, and PRs opened against, that floor's branch.
        const r = w.repos?.find((x) => x.floor === repo);
        if (!r) return undefined;
        const other = ctx.floor(r.floor);
        return {
          name: w.name,
          cwd: path.join(def.dir, r.path),
          rel: r.path,
          worktreeBase: r.base,
          baseBranch: r.from ?? null,
          openPull: (branch) => (other ? openPull(other, branch) : undefined),
          refreshGitHub: () => void other?.forge.refresh(),
        };
      },
      (branch) => openPull(this, branch),
      {
        state: (state, ids) => ctx.changes(state, ids),
        toast: (text, level) => ctx.toast(this, text, level),
        refreshGitHub: () => void this.forge.refresh(),
      },
    );

    this.decor = new Decor(dataDir);
    this.jukebox = new Jukebox(dataDir);
    // Musical chairs is for the workers at their desks: a board agent stays by its board, and a
    // worker called to a meeting is busy with the meeting.
    this.chairs = new MusicalChairs(
      () =>
        this.workers
          .list()
          .filter((w) => !w.meeting && !DESK_BY_ID.get(w.deskId)?.station)
          .map((w) => ({ id: w.id, name: w.name, color: w.color })),
      (state) => {
        ctx.emit(this, { t: 'chairs', state });
        // What's said over the PA goes up in the corner of everyone's screen too: the announcement to
        // start, whoever's just been left out, and the winner at the end.
        if (state.phase === 'gathering' || state.phase === 'react' || state.phase === 'over') ctx.toast(this, `🪑 ${caption(state)}`);
      },
    );
    this.tv = new Tv(dataDir);
    this.whiteboard = new Whiteboard(dataDir);
    this.ready = this.workers.start();

    void this.forge.refresh();
    // A floor with people on it, or work under way, keeps its boards fresh; the others check in now and then.
    this.timer = setInterval(() => {
      if (this.active() || Date.now() - this.forge.issues.fetchedAt > IDLE_REFRESH_MS) void this.forge.refresh();
    }, REFRESH_MS);
  }

  /** Pull request `n` merged (`by` someone, from the PR window): the gong rings, once per PR. */
  merged(n: number, by?: string) {
    if (this.merges.ring(n)) this.ctx.emit(this, { t: 'gong', why: 'merged', pr: n, by });
  }

  /**
   * With ⚙️ Settings' *go home once merged* on, sends home every worker whose pull request merged,
   * once it's at rest and nobody has its terminal open, deleting its worktree and branch unless they
   * hold work that isn't on GitHub. Called whenever that might have changed; it looks a moment later,
   * once for a burst of calls, and not from inside the event that prompted it.
   */
  sendLandedHome() {
    if (this.landedTimer || !this.ctx.leaveOnMerge()) return;
    this.landedTimer = setTimeout(() => {
      this.landedTimer = undefined;
      if (!this.ctx.leaveOnMerge()) return;
      const pullsOf = (id: string) => this.ctx.floor(id)?.forge.pulls.items;
      for (const landed of landedWorkers(this.workers.list(), this.forge.pulls.items, this.queue.state().tasks, pullsOf)) {
        const { worker, head, heads } = landed;
        if (!worker.repos?.length) {
          this.goHome(worker, `PR #${landed.pr} merged`, head);
          continue;
        }
        // Across repositories, one PR can merge before another repository's work even has one:
        // it goes once nothing is left that its merged PRs didn't deliver.
        if (this.landing.has(worker.id)) continue;
        this.landing.add(worker.id);
        void this.workers.holdsWork(worker.id, head, heads).catch(() => true).then((held) => {
          this.landing.delete(worker.id);
          if (!held && this.workers.get(worker.id) === worker) this.goHome(worker, `its pull requests merged (${landed.prs?.join(', ')})`, head, heads);
        });
      }
    }, LANDED_DELAY_MS);
  }

  /**
   * Whether a worker's work landed: a pull request of its merged and none is open, on this floor
   * and, for a worker across repositories, on the others too (see landedWork).
   */
  landed(worker: WorkerInfo): Landed | undefined {
    return landedWork(worker, this.forge.pulls.items, this.queue.state().tasks, (id) => this.ctx.floor(id)?.forge.pulls.items);
  }

  /**
   * Sends a worker home as someone asked (not by itself, see sendLandedHome): with no `cleanup`, its
   * worktree and branch go unless they hold work, where what its merged pull requests delivered
   * doesn't count. Resolves with the line about its worktree.
   *
   * A helper's worktree is its host's, so it is never touched however it is sent home: the host is
   * working in it, and the helper only ever read from it.
   */
  sendHome(workerId: string, cleanup?: WorktreeCleanup): Promise<{ note?: string; error?: string }> {
    const info = this.workers.get(workerId);
    if (info?.helper) return this.workers.kill(workerId);
    const landed = info && this.landed(info);
    return this.workers.kill(workerId, cleanup, landed?.head, landed?.heads);
  }

  /**
   * A helper's own life, from the office's point of view: it walks to its host's desk, reads, tells
   * the host what it found, and its visit is then over. The finding goes to the worker rather than to
   * whoever sent the helper, because the worker is the one who owns the work and has to decide what
   * to do about it (see docs/helper-plan.md).
   */
  private onHelperUpdate(worker: WorkerInfo): void {
    if (!worker.helper || worker.status === 'exited') return;
    // Reading: it's got to its desk and is working through the problem.
    if (worker.status === 'working') this.helpers.reading(worker.id);
    // Done and nothing asked of it is how a helper reports. Once only, whichever way it got there:
    // a helper's own acked flag is not the office's to read, since opening its terminal shouldn't
    // count as being answered (see Helpers.reported, which ignores a second call).
    if (worker.status !== 'done' || this.reportedHelpers.has(worker.id)) return;
    this.reportedHelpers.add(worker.id);
    this.helpers.reporting(worker.id);
    const host = this.workers.get(worker.helper.hostId);
    if (!host) {
      this.helpers.reported(worker.id);
      return;
    }
    // What it found is what it said in its last answer, which is the tail of its own terminal.
    const finding = this.workers.finding(worker.id);
    const report = officePrompt(this.ctx.prompts, 'helper.report', { helper: worker.name, finding });
    const err = this.workers.prompt(host.id, report || finding, worker.name);
    if (err) this.ctx.toast(this, `🆘 ${worker.name} couldn't reach ${host.name}: ${err}`, 'warn');
    this.helpers.reported(worker.id);
  }

  /** The helpers that have already reported, so a finding is sent to a host once and once only. */
  private readonly reportedHelpers = new Set<string>();

  /**
   * Walks a helper over to `hostId`'s desk. It works in that worker's checkout, so it needs a prompt
   * of its own brief and then nothing: no worktree, no queue task, and no say over the work. One per
   * host at a time, because a second helper at a desk that one hasn't unstuck is a sign the task is
   * wrong rather than that the help was thin.
   */
  sendHelper(hostId: string, by: string, provider?: AgentProvider, model?: string, effort?: AgentEffort, owner?: string): WorkerInfo | string {
    const host = this.workers.get(hostId);
    if (!host) return 'No such worker';
    // One at a time, because a second helper at a desk the first hasn't unstuck is a sign the task is
    // wrong rather than that the help was thin. Not a technical limit, so it says so.
    if (this.helpers.has(hostId)) return `${host.name} already has a helper at its desk`;
    const r = this.workers.sendHelper(hostId, by, provider, model, effort, owner);
    if (typeof r === 'string') return r;
    // It's hired; now walk it over. The office owns the route and every browser follows the same one.
    this.helpers.send(host, r);
    return r;
  }

  private goHome(worker: WorkerInfo, why: string, head?: string, heads?: Record<string, string | undefined>) {
    const done = this.workers.kill(worker.id, undefined, head, heads);
    this.ctx.toast(this, `🏠 ${worker.name} went home: ${why}`);
    void done.then(({ note, error }) => {
      if (note) this.ctx.toast(this, note);
      if (error) this.ctx.toast(this, error, 'warn');
    });
  }

  /** Someone just walked in: boards that haven't been looked at in a while get fetched again. */
  arrived() {
    if (Date.now() - Math.max(this.forge.issues.fetchedAt, this.forge.pulls.fetchedAt) > REFRESH_MS) void this.forge.refresh();
  }

  /**
   * A floor on this disk can do all three of the things a hosted floor cannot: the whiteboard, the
   * dog and the docs are all files in `dataDir`, right here. So there is nothing to refuse, and saying
   * so is what lets the office ask any floor the same question without knowing which it has.
   */
  refuses(_feature: 'the whiteboard' | 'the dog' | 'the docs'): undefined {
    return undefined;
  }

  private active(): boolean {
    return this.ctx.people(this) > 0 || this.ctx.lent(this) || this.workers.list().some((w) => isBusy(w.status)) || this.queue.state().tasks.some((t) => t.status !== 'done') || this.meetings.state().current?.status === 'running';
  }

  info(): FloorInfo {
    const ws = this.workers.list();
    return {
      id: this.id,
      name: this.def.name,
      repo: this.def.repo,
      dir: this.dir,
      branch: this.project.branch,
      palette: this.def.palette,
      addedBy: this.def.addedBy,
      addedAt: this.def.addedAt,
      workers: ws.filter((w) => !DESK_BY_ID.get(w.deskId)?.station).length,
      busy: ws.filter((w) => w.status === 'working').length,
      waiting: ws.filter((w) => w.kind === 'agent' && (w.status === 'needs_input' || (w.status === 'done' && !w.acked))).length,
      people: this.ctx.people(this),
      wing: this.plan.wing,
    };
  }

  /** With `keep` (a restart), the workers' terminals keep running for the next office to pick up. */
  shutdown(keep = false) {
    clearInterval(this.timer);
    clearTimeout(this.landedTimer);
    this.dog.stop();
    // Nobody left to hear the rounds, and the workers are going back to their desks.
    this.chairs.stop();
    this.queue.shutdown();
    this.meetings.shutdown();
    this.changes.stop();
    this.whiteboard.flush();
    this.workers.shutdown(keep);
  }
}

/**
 * The office asks floors for things through `FloorActions`, and a floor hosted on a member's machine
 * answers the same surface by shipping frames rather than calling methods (see
 * src/server/floor-actions.ts). `Floor` is the local implementation.
 *
 * This assignment is the whole contract and it is checked, not documented: `Floor` structurally
 * satisfies the interface, so a floor-scoped case that needs a method the interface does not have
 * fails the build here rather than at the point someone writes the proxy. Nothing about the class
 * changes to satisfy it.
 */
const _floorIsActions = (f: Floor): FloorActions => f;
void _floorIsActions;
