import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isAgentProvider, type AgentProvider, type GhPull, type QueueState, type QueueTask, type WorkerInfo, type WorkerProject, type WorkerStatus } from '../shared/protocol.js';
import { DESKS, DESK_BY_ID } from '../shared/layout.js';
import { isValidOpenCodeModel, validateWorkerModel } from './agents.js';
import { normalizeIssueRepository, sameRepository } from '../shared/issue-repositories.js';

/** What the queue needs from the worker manager. Narrow on purpose, so a smoke test can fake it. */
export interface QueueWorkers {
  readonly defaultProvider: AgentProvider;
  list(): WorkerInfo[];
  deskOccupied(deskId: string): boolean;
  spawn(deskId: string, by: string, prompt: string, worktree: boolean, kind: 'agent', provider: AgentProvider, model?: string, project?: WorkerProject): WorkerInfo | string;
  /** Resolves with a line about what became of the worker's worktree. */
  kill(id: string): Promise<{ note?: string; error?: string }>;
}

export interface QueueEvents {
  update(state: QueueState): void;
  toast(text: string, level: 'info' | 'warn' | 'error'): void;
  /** Mark the issue as taken on GitHub, so the board moves it to In progress. Resolves to an error message when it can't. */
  claimIssue(issue: number, repository?: string): Promise<string | undefined>;
  /** Ask GitHub for fresh pull requests, to pick up the one a worker just opened. */
  refreshGitHub(): void;
  /** Why no workers may be hired right now (today's budget is spent), if that's so. */
  hiringPaused(): string | undefined;
  currentRepository?(): string | undefined;
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

  add(prompt: string, by: string, title?: string, issue?: number, provider: AgentProvider = this.workers.defaultProvider, model?: string, issueRepository?: string, project?: WorkerProject): string | undefined {
    if (!isAgentProvider(provider) || (provider === 'custom' && this.workers.defaultProvider !== 'custom')) return 'Unknown agent provider';
    const modelError = validateWorkerModel('agent', provider, model);
    if (modelError) return modelError;
    const clean = prompt.replace(/\r\n?/g, '\n').trim();
    if (!clean) return 'Empty task';
    const repository = issueRepository ?? (issue !== undefined ? this.workersRepository() : undefined);
    if (issue !== undefined && issueRepository !== undefined && !normalizeIssueRepository(issueRepository)) return 'Invalid issue repository';
    if (project !== undefined && !validProject(project)) return 'Invalid worker project';
    if (issue !== undefined && issueRepository !== undefined && !project && (!this.workersRepository() || !sameRepository(repository, this.workersRepository()))) return 'A foreign issue needs a verified worker project';
    if (issueRepository !== undefined && project && !sameRepository(repository, project.repository)) return 'Issue repository and worker project do not match';
    if (issue !== undefined && this.tasks.some((t) => issueKey(t, this.workersRepository()) === issueKey({ issue, issueRepository: repository }, this.workersRepository()) && t.status !== 'done')) return `Issue #${issue} is already on the queue`;
    if (this.tasks.filter((t) => t.status !== 'done').length >= MAX_TASKS) return `The queue is full (${MAX_TASKS} tasks)`;
    const task: QueueTask = {
      id: randomBytes(6).toString('hex'),
      provider,
      model: provider === 'opencode' ? model : undefined,
      issue,
      issueRepository: repository,
      project,
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
    if (t.issue !== undefined && this.tasks.some((x) => x !== t && issueKey(x, this.workersRepository()) === issueKey(t, this.workersRepository()) && x.status !== 'done')) return `Issue #${t.issue} is already on the queue`;
    this.tasks.splice(this.tasks.indexOf(t), 1);
    const fresh: QueueTask = { id: t.id, provider: t.provider, model: t.model, issue: t.issue, issueRepository: t.issueRepository, project: t.project, title: t.title, prompt: t.prompt, addedBy: t.addedBy, addedAt: Date.now(), status: 'queued' };
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
    const v = Math.max(0, Math.min(DESKS.length, Math.floor(n)));
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
    const current = this.workersRepository();
    const byWorker = new Map(this.workers.list().map((w) => [w.id, w]));
    for (const t of this.tasks) {
      if (t.status === 'queued') continue;
      const target = t.issueRepository ?? t.project?.repository;
      const workerPr = t.workerId ? byWorker.get(t.workerId)?.pr : undefined;
      const workerProject = t.workerId ? byWorker.get(t.workerId)?.project : undefined;
      const foreignWorker = !!target && !!workerProject && sameRepository(target, workerProject.repository) && (!current || !sameRepository(target, current));
      if (workerPr && foreignWorker) {
        const pr = { number: workerPr.number, url: workerPr.url, state: 'OPEN', title: '' };
        if (!t.pr || t.pr.number !== pr.number || t.pr.url !== pr.url) { t.pr = pr; changed = true; }
        continue;
      }
      if (target && (!current || !sameRepository(target, current))) continue;
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
    for (const t of this.tasks) {
      if (t.status !== 'running' || !t.workerId) continue;
      const w = byId.get(t.workerId);
      if (!w) this.finish(t, 'killed');
      else if (FINISHED.has(w.status)) this.finish(t, w.status === 'done' ? 'done' : 'exited');
      else continue;
      changed = true;
    }
    if (changed) this.changed();
  }

  private finish(t: QueueTask, outcome: NonNullable<QueueTask['outcome']>) {
    t.status = 'done';
    t.outcome = outcome;
    t.finishedAt = Date.now();
    const who = t.workerName ?? 'Its worker';
    if (outcome === 'done') {
      this.events.toast(`📋 ${who} finished ${label(t)}`, 'info');
      // The worker most likely just opened the PR; go and link it.
      this.events.refreshGitHub();
    } else if (outcome === 'exited') this.events.toast(`📋 ${who} stopped before finishing ${label(t)} — requeue it from the queue board`, 'warn');
  }

  private busy(): number {
    return this.workers.list().filter((w) => w.kind === 'agent' && BUSY.has(w.status)).length;
  }

  private freeDesk(): string | undefined {
    return DESKS.find((d) => !this.workers.deskOccupied(d.id))?.id;
  }

  /**
   * No desk is free: send home a worker the queue hired whose task is finished (nobody is looking at
   * its terminal), and return its desk. Workers with a linked PR go first — their work is delivered.
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
      if (t.issueRepository && !t.project) {
        const current = this.workersRepository();
        if (!current) break;
        if (!sameRepository(t.issueRepository, current)) {
          t.status = 'done';
          t.outcome = 'failed';
          t.error = 'A foreign issue has no verified worker project';
          t.finishedAt = Date.now();
          changed = true;
          continue;
        }
      }
      // A spent budget holds the queue instead of failing every task; the pump seats them once hiring resumes.
      if (this.events.hiringPaused()) break;
      const desk = this.freeDesk() ?? this.recycleDesk();
      if (!desk) break;
      const worktree = this.useWorktree || !!t.project;
      const r = this.workers.spawn(desk, `${t.addedBy} (queue)`, t.prompt + (worktree ? WORKTREE_NOTE : ''), worktree, 'agent', t.provider ?? this.workers.defaultProvider, t.model, t.project);
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
        void this.events.claimIssue(issue, t.issueRepository ?? t.project?.repository).then((err) => {
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

  private workersRepository(): string | undefined {
    return this.events.currentRepository?.();
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
      if (typeof saved.maxWorkers === 'number' && Number.isFinite(saved.maxWorkers)) this.maxWorkers = Math.max(0, Math.min(DESKS.length, Math.floor(saved.maxWorkers)));
      for (const s of saved.tasks ?? []) {
        if (typeof s.id !== 'string' || typeof s.prompt !== 'string' || typeof s.title !== 'string') continue;
        if (s.project !== undefined && !validProject(s.project)) continue;
        if (s.issueRepository !== undefined && !normalizeIssueRepository(s.issueRepository)) continue;
        if (s.project && s.issueRepository && !sameRepository(s.project.repository, s.issueRepository)) continue;
        const provider = isAgentProvider(s.provider) ? s.provider : this.workers.defaultProvider;
        const t: QueueTask = {
          id: s.id,
          provider,
          model: provider === 'opencode' && isValidOpenCodeModel(s.model) ? s.model : undefined,
          issue: typeof s.issue === 'number' ? s.issue : undefined,
          issueRepository: typeof s.issueRepository === 'string' ? normalizeIssueRepository(s.issueRepository) : undefined,
          project: s.project,
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
  return t.issue !== undefined ? `${t.issueRepository ? `${t.issueRepository}#` : '#'}${t.issue}` : `“${t.title.length > 40 ? `${t.title.slice(0, 39)}…` : t.title}”`;
}

function issueKey(task: Pick<QueueTask, 'issue' | 'issueRepository'>, current?: string): string | undefined {
  if (task.issue === undefined) return undefined;
  return `${(task.issueRepository ?? current ?? '').toLowerCase()}#${task.issue}`;
}

function validProject(value: unknown): value is WorkerProject {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<WorkerProject>;
  return typeof p.repository === 'string' && !!normalizeIssueRepository(p.repository) && typeof p.dir === 'string' && path.isAbsolute(p.dir) && p.dir.length > 1;
}

function firstLine(s: string): string {
  return s.split('\n')[0].trim();
}
