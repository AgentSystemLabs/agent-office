import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ChangesState, FloorInfo, PeerInfo, ProjectInfo, ServerMsg, WorkerInfo } from '../shared/protocol.js';
import { isBusy } from '../shared/status.js';
import { DESK_BY_ID } from '../shared/layout.js';
import type { FloorDef } from './building.js';
import { excludeFromGit } from './config.js';
import { agentProviders, configuredProvider } from './agents.js';
import { WorkerManager, type HookEnv } from './workers.js';
import { GitHub, MergeWatch } from './github.js';
import { TaskQueue } from './queue.js';
import { Changes } from './changes.js';
import { Decor } from './decor.js';
import { Docs } from './docs.js';
import { Dog } from './dog.js';
import { Court } from './court.js';
import { Jukebox } from './jukebox.js';
import { Whiteboard } from './whiteboard.js';
import { MeetingRoom } from './meetings.js';
import { Worktrees } from './worktrees.js';
import type { Ledger } from './usage.js';
import type { Capacity } from './machine.js';
import { officePrompt, type PromptSource } from './prompts.js';

type ToastLevel = 'info' | 'warn' | 'error';

/** What a floor needs from the building around it. */
export interface FloorContext {
  agentCmd: string;
  agentArgs: string[];
  hook: HookEnv;
  /** Spend, across every floor. */
  ledger: Ledger;
  /** The office's worker limit, across every floor. */
  capacity: Capacity;
  /** The office's prompts and the worker everyone starts on, as set in ⚙️ Settings. */
  prompts: PromptSource;
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
}

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
 * boards, task queue, pictures and jukebox, all kept in that checkout's .agent-office folder.
 */
export class Floor {
  readonly id: string;
  readonly dir: string;
  readonly project: ProjectInfo;
  readonly workers: WorkerManager;
  readonly github: GitHub;
  readonly queue: TaskQueue;
  readonly changes: Changes;
  readonly decor: Decor;
  readonly jukebox: Jukebox;
  /** The whiteboard everyone on the floor draws on together. */
  readonly whiteboard: Whiteboard;
  /** The meeting room, where workers work through a question together (see meetings.ts). */
  readonly meetings: MeetingRoom;
  /** The bookshelf: the project's Markdown files (see docs.ts). */
  readonly docs: Docs;
  /** Settles once the workers whose terminals outlived the last office are picked back up, and the rest woken. */
  readonly ready: Promise<void>;
  readonly dog: Dog;
  /** The basketball by the hoop: who has it, or how it was last thrown. */
  readonly court = new Court();
  private timer: NodeJS.Timeout;
  /** Pull requests merging, to ring the gong for. */
  private merges = new MergeWatch();

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

    // Before the workers, so it hears about the ones who wake up needing input.
    this.dog = new Dog(def.id, dataDir, {
      workers: () => this.workers?.list() ?? [],
      people: () => ctx.peers(this),
      send: (dog) => ctx.emit(this, { t: 'dog', dog }),
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
          ctx.workerChanged(this, worker);
        },
        remove: (workerId) => {
          this.changes?.forget(workerId);
          ctx.emit(this, { t: 'worker.remove', workerId });
          this.queue?.onWorkerGone(workerId);
          this.meetings?.onWorkerGone(workerId);
          this.dog.onWorkerGone(workerId);
          ctx.workerChanged(this, workerId);
        },
        data: (workerId, data, viewers) => ctx.termData(workerId, data, viewers),
        screen: (workerId, frame) => ctx.emit(this, { t: 'screen', workerId, ...frame }, true),
        toast: (text, level) => ctx.toast(this, text, level),
      },
      ctx.ledger,
      ctx.capacity,
      ctx.prompts,
    );

    this.github = new GitHub(
      def.dir,
      (state) => ctx.emit(this, { t: 'gh.issues', state }),
      (state) => {
        ctx.emit(this, { t: 'gh.pulls', state });
        this.queue?.onPulls(state.items);
        if (state.loading || state.error) return;
        for (const p of this.merges.look(state.items)) {
          ctx.toast(this, `🎉 PR #${p.number} merged: ${p.title}`);
          this.merged(p.number);
        }
      },
    );
    // The 📋 task queue seats workers by itself: it watches the workers and links PRs from GitHub.
    this.queue = new TaskQueue(dataDir, this.workers, !!this.project.branch, {
      update: (state) => ctx.emit(this, { t: 'queue', state }),
      toast: (text, level) => ctx.toast(this, text, level),
      claimIssue: (issue) => this.github.claim(issue),
      refreshGitHub: () => void this.github.refresh(),
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
        seat: (deskId, by, prompt, provider, model, effort, meeting) => this.workers.spawn(deskId, by, prompt, false, 'agent', provider, model, effort, meeting),
        prompt: (id, text, by) => this.workers.prompt(id, text, by),
        write: (id, data, by) => this.workers.write(id, data, by),
        kill: (id) => this.workers.kill(id),
      },
      this.project.branch ? new Worktrees(def.dir) : undefined,
      {
        update: (state) => ctx.emit(this, { t: 'meeting', state }),
        toast: (text, level) => ctx.toast(this, text, level),
        hiringPaused: () => ctx.ledger.hiringPaused,
        postReview: (pr, file) => this.github.review(pr, file),
        prompt: (id) => ctx.prompts.text(id),
      },
    );

    // What each worker changed, for the Changes window at its desk (see changes.ts).
    this.changes = new Changes(
      def.dir,
      this.project.branch,
      (workerId) => {
        const w = this.workers.get(workerId);
        if (!w) return undefined;
        return { name: w.name, cwd: w.worktree ? path.join(def.dir, w.worktree.path) : def.dir, rel: w.worktree?.path ?? '', worktreeBase: w.worktree?.base };
      },
      (branch) => {
        const pr = this.github.pulls.items.find((p) => p.state === 'OPEN' && p.headRefName === branch);
        return pr ? { number: pr.number, url: pr.url } : undefined;
      },
      {
        state: (state, ids) => ctx.changes(state, ids),
        toast: (text, level) => ctx.toast(this, text, level),
        refreshGitHub: () => void this.github.refresh(),
      },
    );

    this.decor = new Decor(dataDir);
    this.jukebox = new Jukebox(dataDir);
    this.whiteboard = new Whiteboard(dataDir);
    this.ready = this.workers.start();

    void this.github.refresh();
    // A floor with people on it, or work under way, keeps its boards fresh; the others check in now and then.
    this.timer = setInterval(() => {
      if (this.active() || Date.now() - this.github.issues.fetchedAt > IDLE_REFRESH_MS) void this.github.refresh();
    }, REFRESH_MS);
  }

  /** Pull request `n` merged (`by` someone, from the PR window): the gong rings, once per PR. */
  merged(n: number, by?: string) {
    if (this.merges.ring(n)) this.ctx.emit(this, { t: 'gong', why: 'merged', pr: n, by });
  }

  /** Someone just walked in: boards that haven't been looked at in a while get fetched again. */
  arrived() {
    if (Date.now() - Math.max(this.github.issues.fetchedAt, this.github.pulls.fetchedAt) > REFRESH_MS) void this.github.refresh();
  }

  private active(): boolean {
    return this.ctx.people(this) > 0 || this.workers.list().some((w) => isBusy(w.status)) || this.queue.state().tasks.some((t) => t.status !== 'done') || this.meetings.state().current?.status === 'running';
  }

  info(): FloorInfo {
    const ws = this.workers.list();
    return {
      id: this.id,
      name: this.def.name,
      repo: this.def.repo,
      dir: this.dir,
      palette: this.def.palette,
      addedBy: this.def.addedBy,
      addedAt: this.def.addedAt,
      workers: ws.filter((w) => !DESK_BY_ID.get(w.deskId)?.station).length,
      busy: ws.filter((w) => w.status === 'working').length,
      waiting: ws.filter((w) => w.kind === 'agent' && (w.status === 'needs_input' || (w.status === 'done' && !w.acked))).length,
      people: this.ctx.people(this),
    };
  }

  /** With `keep` (a restart), the workers' terminals keep running for the next office to pick up. */
  shutdown(keep = false) {
    clearInterval(this.timer);
    this.dog.stop();
    this.github.stop();
    this.queue.shutdown();
    this.meetings.shutdown();
    this.changes.stop();
    this.whiteboard.flush();
    this.workers.shutdown(keep);
  }
}
