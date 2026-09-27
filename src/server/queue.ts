import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isAgentEffort, isAgentProvider, isClaudeModel, type AgentEffort, type AgentProvider, type GhPull, type QueueState, type QueueTask, type WorkerInfo, type WorkerStatus } from '../shared/protocol.js';
import { DESK_BY_ID, SEATS, nextFreeSeat } from '../shared/layout.js';
import { isValidOpenCodeModel, validateWorkerEffort, validateWorkerModel } from './agents.js';

/** What the queue needs from the worker manager. Narrow on purpose, so a smoke test can fake it. */
export interface QueueWorkers {
  readonly defaultProvider: AgentProvider;
  list(): WorkerInfo[];
  deskOccupied(deskId: string): boolean;
  spawn(deskId: string, by: string, prompt: string, worktree: boolean, kind: 'agent', provider: AgentProvider, model?: string, effort?: AgentEffort): WorkerInfo | string;
  /** Resolves with a line about what became of the worker's worktree. */
  kill(id: string): Promise<{ note?: string; error?: string }>;
}

export interface QueueEvents {
  update(state: QueueState): void;
  toast(text: string, level: 'info' | 'warn' | 'error'): void;
  /** Mark the issue as taken on GitHub, so the board moves it to In progress. Resolves to an error message when it can't. */
  claimIssue(issue: number): Promise<string | undefined>;
  /** Ask GitHub for fresh pull requests, to pick up the one a worker just opened. */
  refreshGitHub(): void;
  /** Why no workers may be hired right now (today's budget is spent), if that's so. */
  hiringPaused(): string | undefined;
  /** How many more workers the office has room for under its worker limit (Infinity without one). */
  room?(): number;
  /** The last task on the queue just finished, done: nothing is left queued or running. */
  emptied(): void;
}

export const DEFAULT_MAX_WORKERS = 3;
const MAX_TASKS = 100;
const PUMP_MS = 10_000;
/** A worker in one of these states holds a slot under the worker limit. */
const BUSY = new Set<WorkerStatus>(['starting', 'idle', 'working', 'needs_input']);
/** A worker in one of these states is finished with its task (and can make room for the next one). */
const FINISHED = new Set<WorkerStatus>(['done', 'exited', 'offline']);

const WORKTREE_NOTE = "\n\nYou're in your own git worktree, on a fresh branch made for this task. Commit there, push it, and open the pull request from it.";

/**
 * The 📋 task queue. Tasks (GitHub issues or free text) wait in order; whenever a desk is free and
 * fewer than `maxWorkers` workers are busy, the next one is seated as a worktree worker. A running
 * task finishes when its worker ends its turn, stops, or is sent home. Finished workers stay at
 * their desks to be looked at, until the queue needs the desk for the next task.
 */
export class TaskQueue {
  private tasks: QueueTask[] = [];
  private maxWorkers = DEFAULT_MAX_WORKERS;
  private statePath: string;
  private timer: NodeJS.Timeout;
  private pumping = false;
  private again = false;
  /** Set on shutdown: the workers' exit events must not seat anyone into a dying office. */
  private stopped = false;
  private lastStatus = new Map<string, WorkerStatus>();

  constructor(
    dataDir: string,
    private workers: QueueWorkers,
    /** Seat workers in their own git worktree (only when the project is a git repo). */
    private useWorktree: boolean,
    private events: QueueEvents,
  ) {
    this.statePath = path.join(dataDir, 'queue.json');
    this.restore();
    this.timer = setInterval(() => this.pump(), PUMP_MS);
  }

  state(): QueueState {
    return { tasks: this.tasks.map((t) => ({ ...t })), maxWorkers: this.maxWorkers };
  }

  get limit(): number {
    return this.maxWorkers;
  }

  add(prompt: string, by: string, title?: string, issue?: number, provider: AgentProvider = this.workers.defaultProvider, model?: string, effort?: AgentEffort): string | undefined {
    if (!isAgentProvider(provider) || (provider === 'custom' && this.workers.defaultProvider !== 'custom')) return 'Unknown agent provider';
    const modelError = validateWorkerModel('agent', provider, model);
    if (modelError) return modelError;
    const effortError = validateWorkerEffort('agent', provider, effort);
    if (effortError) return effortError;
    const clean = prompt.replace(/\r\n?/g, '\n').trim();
    if (!clean) return 'Empty task';
    if (issue !== undefined && this.tasks.some((t) => t.issue === issue && t.status !== 'done')) return `Issue #${issue} is already on the queue`;
    if (this.tasks.filter((t) => t.status !== 'done').length >= MAX_TASKS) return `The queue is full (${MAX_TASKS} tasks)`;
    const task: QueueTask = {
      id: randomBytes(6).toString('hex'),
      provider,
      model: provider === 'opencode' || provider === 'claude' ? model : undefined,
      effort: provider === 'claude' ? effort : undefined,
      issue,
      title: (title?.trim() || firstLine(clean)).slice(0, 120),
      prompt: clean,
      addedBy: by,
      addedAt: Date.now(),
      status: 'queued',
    };
    this.tasks.push(task);
    this.changed();
    this.pump();
    return undefined;
  }

  remove(taskId: string): string | undefined {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) return 'No such task';
    if (t.status === 'running') return `${t.workerName ?? 'Its worker'} is on it — send the worker home to stop it`;
    this.tasks.splice(this.tasks.indexOf(t), 1);
    this.changed();
    this.pump();
    return undefined;
  }

  /** Takes a closed issue's waiting task off the queue (a running one carries on). Returns whether there was one. */
  dropIssue(issue: number): boolean {
    const i = this.tasks.findIndex((t) => t.issue === issue && t.status === 'queued');
    if (i < 0) return false;
    this.tasks.splice(i, 1);
    this.changed();
    return true;
  }

  /** Moves a queued task one place up (-1) or down (+1) among the queued tasks. */
  move(taskId: string, delta: -1 | 1) {
    const queued = this.tasks.filter((t) => t.status === 'queued');
    const i = queued.findIndex((t) => t.id === taskId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= queued.length) return;
    const a = this.tasks.indexOf(queued[i]);
    const b = this.tasks.indexOf(queued[j]);
    [this.tasks[a], this.tasks[b]] = [this.tasks[b], this.tasks[a]];
    this.changed();
    this.pump();
  }

  /** Puts a finished task back at the end of the queue. */
  retry(taskId: string): string | undefined {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) return 'No such task';
    if (t.status !== 'done') return 'That task is still on the queue';
    if (t.issue !== undefined && this.tasks.some((x) => x !== t && x.issue === t.issue && x.status !== 'done')) return `Issue #${t.issue} is already on the queue`;
    this.tasks.splice(this.tasks.indexOf(t), 1);
    const fresh: QueueTask = { id: t.id, provider: t.provider, model: t.model, effort: t.effort, issue: t.issue, title: t.title, prompt: t.prompt, addedBy: t.addedBy, addedAt: Date.now(), status: 'queued' };
    this.tasks.push(fresh);
    this.changed();
    this.pump();
    return undefined;
  }

  /** Forgets the finished tasks. */
  clear() {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => t.status !== 'done');
    if (this.tasks.length !== before) this.changed();
  }

  setLimit(n: number) {
    const v = Math.max(0, Math.min(SEATS.length, Math.floor(n)));
    if (!Number.isFinite(v) || v === this.maxWorkers) return;
    this.maxWorkers = v;
    this.changed();
    this.pump();
  }

  /** A worker changed. Cheap unless its status moved, which can free a slot or finish a task. */
  onWorker(info: WorkerInfo) {
    if (this.lastStatus.get(info.id) === info.status) return;
    this.lastStatus.set(info.id, info.status);
    this.pump();
  }

  onWorkerGone(workerId: string) {
    this.lastStatus.delete(workerId);
    this.pump();
  }

  /** Fresh pull requests from GitHub: link each task to the PR that closes its issue (or came from its branch). */
  onPulls(pulls: GhPull[]) {
    let changed = false;
    for (const t of this.tasks) {
      if (t.status === 'queued') continue;
      const since = (t.startedAt ?? t.addedAt) - 60_000;
      const match = pulls
        .filter((p) => (t.branch && p.headRefName === t.branch) || (t.issue !== undefined && p.closes.includes(t.issue) && Date.parse(p.createdAt) >= since))
        .sort((a, b) => Number(b.headRefName === t.branch) - Number(a.headRefName === t.branch) || b.createdAt.localeCompare(a.createdAt))[0];
      if (!match) continue;
      const pr = { number: match.number, url: match.url, state: match.isDraft ? 'DRAFT' : match.state, title: match.title };
      if (t.pr && t.pr.number === pr.number && t.pr.state === pr.state && t.pr.title === pr.title) continue;
      t.pr = pr;
      changed = true;
    }
    if (changed) this.changed();
  }

  /** Finishes tasks whose worker stopped, then seats queued tasks while there's room. */
  pump() {
    if (this.stopped) return;
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.again = false;
        this.reconcile();
        this.seat();
      } while (this.again);
    } finally {
      this.pumping = false;
    }
  }

  shutdown() {
    this.stopped = true;
    clearInterval(this.timer);
  }

  // ---------------------------------------------------------------------------

  private reconcile() {
    const byId = new Map(this.workers.list().map((w) => [w.id, w]));
    let changed = false;
    let done = false;
    for (const t of this.tasks) {
      if (t.status !== 'running' || !t.workerId) continue;
      const w = byId.get(t.workerId);
      if (!w) this.finish(t, 'killed');
      else if (FINISHED.has(w.status)) done = this.finish(t, w.status === 'done' ? 'done' : 'exited') || done;
      else continue;
      changed = true;
    }
    if (!changed) return;
    this.changed();
    // A task finishing is what empties the queue; removing or clearing tasks doesn't count.
    if (done && this.tasks.every((t) => t.status === 'done')) this.events.emptied();
  }

  /** Returns whether the task got done (rather than stopping short). */
  private finish(t: QueueTask, outcome: NonNullable<QueueTask['outcome']>): boolean {
    t.status = 'done';
    t.outcome = outcome;
    t.finishedAt = Date.now();
    const who = t.workerName ?? 'Its worker';
    if (outcome === 'done') {
      this.events.toast(`📋 ${who} finished ${label(t)}`, 'info');
      // The worker most likely just opened the PR; go and link it.
      this.events.refreshGitHub();
    } else if (outcome === 'exited') this.events.toast(`📋 ${who} stopped before finishing ${label(t)} — requeue it from the queue board`, 'warn');
    return outcome === 'done';
  }

  /** Agents holding a slot. The board agents don't (they stand by their boards), nor do meetings (they have their own limits). */
  private busy(): number {
    return this.workers.list().filter((w) => w.kind === 'agent' && BUSY.has(w.status) && !DESK_BY_ID.get(w.deskId)?.station && !DESK_BY_ID.get(w.deskId)?.room).length;
  }

  /** A free desk, else a free bean bag. */
  private freeDesk(): string | undefined {
    return nextFreeSeat((id) => this.workers.deskOccupied(id))?.id;
  }

  /**
   * No desk or bean bag is free: send home a worker the queue hired whose task is finished (nobody
   * is looking at its terminal), and return its seat. Workers with a linked PR go first — their work
   * is delivered.
   */
  private recycleDesk(): string | undefined {
    const byId = new Map(this.workers.list().map((w) => [w.id, w]));
    const candidates = this.tasks
      .filter((t) => t.status === 'done' && t.workerId && byId.has(t.workerId))
      .map((t) => ({ t, w: byId.get(t.workerId!)! }))
      .filter(({ w }) => FINISHED.has(w.status) && w.viewers.length === 0)
      .sort((a, b) => Number(!!b.t.pr) - Number(!!a.t.pr) || (a.t.finishedAt ?? 0) - (b.t.finishedAt ?? 0));
    const pick = candidates[0];
    if (!pick) return undefined;
    const done = this.workers.kill(pick.w.id);
    this.events.toast(`📋 ${pick.w.name} went home after ${label(pick.t)} to make room for the next task`, 'info');
    void done.then(({ note, error }) => {
      if (note) this.events.toast(note, 'info');
      if (error) this.events.toast(error, 'warn');
    });
    return pick.w.deskId;
  }

  private seat() {
    let changed = false;
    for (const t of this.tasks) {
      if (t.status !== 'queued') continue;
      if (this.busy() >= this.maxWorkers) break;
      // A spent budget holds the queue instead of failing every task; the pump seats them once hiring resumes.
      if (this.events.hiringPaused()) break;
      // So does an office at its worker limit (--max-workers), unless one of the queue's own finished
      // workers going home makes room. Over the limit (it was just lowered), it waits for people to send some home.
      const room = this.events.room?.() ?? Infinity;
      if (room < 0) break;
      const desk = (room > 0 ? this.freeDesk() : undefined) ?? this.recycleDesk();
      if (!desk) break;
      const r = this.workers.spawn(desk, `${t.addedBy} (queue)`, t.prompt + (this.useWorktree ? WORKTREE_NOTE : ''), this.useWorktree, 'agent', t.provider ?? this.workers.defaultProvider, t.model, t.effort);
      changed = true;
      if (typeof r === 'string') {
        t.status = 'done';
        t.outcome = 'failed';
        t.error = r;
        t.finishedAt = Date.now();
        this.events.toast(`📋 Couldn't start ${label(t)}: ${r}`, 'error');
        continue;
      }
      t.status = 'running';
      t.workerId = r.id;
      t.workerName = r.name;
      t.branch = r.worktree?.branch;
      t.startedAt = Date.now();
      t.error = undefined;
      this.lastStatus.set(r.id, r.status);
      this.events.toast(`📋 ${r.name} sat down at ${DESK_BY_ID.get(desk)?.label ?? 'a desk'} to work on ${label(t)}`, 'info');
      if (t.issue !== undefined) {
        const issue = t.issue;
        void this.events.claimIssue(issue).then((err) => {
          if (err) this.events.toast(`Couldn't assign issue #${issue} on GitHub: ${err}`, 'warn');
        });
      }
    }
    if (changed) this.changed();
  }

  private changed() {
    this.persist();
    this.events.update(this.state());
  }

  private persist() {
    try {
      writeFileSync(this.statePath, JSON.stringify({ maxWorkers: this.maxWorkers, tasks: this.tasks }, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }

  private restore() {
    if (!existsSync(this.statePath)) return;
    try {
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8')) as { maxWorkers?: number; tasks?: Partial<QueueTask>[] };
      if (typeof saved.maxWorkers === 'number' && Number.isFinite(saved.maxWorkers)) this.maxWorkers = Math.max(0, Math.min(SEATS.length, Math.floor(saved.maxWorkers)));
      for (const s of saved.tasks ?? []) {
        if (typeof s.id !== 'string' || typeof s.prompt !== 'string' || typeof s.title !== 'string') continue;
        const provider = isAgentProvider(s.provider) ? s.provider : this.workers.defaultProvider;
        const t: QueueTask = {
          id: s.id,
          provider,
          model: provider === 'opencode' && isValidOpenCodeModel(s.model) ? s.model : provider === 'claude' && isClaudeModel(s.model) ? s.model : undefined,
          effort: provider === 'claude' && isAgentEffort(s.effort) ? s.effort : undefined,
          issue: typeof s.issue === 'number' ? s.issue : undefined,
          title: s.title,
          prompt: s.prompt,
          addedBy: s.addedBy ?? '?',
          addedAt: s.addedAt ?? Date.now(),
          status: s.status === 'running' || s.status === 'done' ? s.status : 'queued',
          workerId: s.workerId,
          workerName: s.workerName,
          branch: s.branch,
          startedAt: s.startedAt,
          finishedAt: s.finishedAt,
          outcome: s.outcome,
          error: s.error,
          pr: s.pr,
        };
        // Whatever was running died with the old office process; its worker comes back asleep at best.
        if (t.status === 'running') {
          t.status = 'done';
          t.outcome = 'exited';
          t.finishedAt = Date.now();
          t.error = 'The office restarted while it was running';
        }
        this.tasks.push(t);
      }
    } catch {
      // corrupt state file: start with an empty queue
    }
  }
}

function label(t: QueueTask): string {
  return t.issue !== undefined ? `#${t.issue}` : `“${t.title.length > 40 ? `${t.title.slice(0, 39)}…` : t.title}”`;
}

function firstLine(s: string): string {
  return s.split('\n')[0].trim();
}
