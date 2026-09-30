import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GhPull, LeaveOnMergeState, QueueTask, WorkerInfo } from '../shared/protocol.js';
import { DESK_BY_ID } from '../shared/layout.js';
import { isBusy, workerPr, type WorkerPr } from '../shared/status.js';

/**
 * Whether a worker whose pull request merged goes home by itself, picked in ⚙️ Settings by anyone
 * and kept in .agent-office/leave-on-merge.json. The same on every floor; off until someone turns it on.
 */
export class LeaveOnMerge {
  private saved?: Required<LeaveOnMergeState>;
  private path: string;

  constructor(
    dataDir: string,
    private onState: (state: LeaveOnMergeState) => void,
  ) {
    this.path = path.join(dataDir, 'leave-on-merge.json');
    this.restore();
  }

  get on(): boolean {
    return this.saved?.on ?? false;
  }

  state(): LeaveOnMergeState {
    return this.saved ? { ...this.saved } : { on: false };
  }

  set(on: boolean, by: string) {
    this.saved = { on, by, at: Date.now() };
    this.persist();
    this.onState(this.state());
  }

  private restore() {
    try {
      const s = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<LeaveOnMergeState>;
      if (typeof s.on === 'boolean') this.saved = { on: s.on, by: typeof s.by === 'string' ? s.by : 'someone', at: typeof s.at === 'number' ? s.at : 0 };
    } catch {
      // never set: workers wait to be sent home
    }
  }

  private persist() {
    try {
      writeFileSync(this.path, JSON.stringify(this.saved ?? {}, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}

/** A worker whose work has landed, with the pull request that merged. */
export interface Landed {
  worker: WorkerInfo;
  /** Its own floor's merged PR; for a worker across repositories, the first of them that merged. */
  pr: number;
  /** The merged PR's head commit, when GitHub said: everything up to it is delivered. */
  head?: string;
  /** A worker across repositories: the head of each other repository's merged PR, by floor. */
  heads?: Record<string, string | undefined>;
  /** …and every PR of its that merged, as "api #7". */
  prs?: string[];
}

/**
 * The workers free to go home because their work landed: a pull request of theirs merged and none
 * is still open (the same call as the purple bubble, see workerPr), they're at rest, and nobody has
 * their terminal open. Board agents, shells and the meeting table don't come and go by pull request.
 * A worker across repositories has pull requests on other floors too (`pullsOf` has their lists):
 * none of them may be open, or opened from its desk but missing from its floor's list.
 */
export function landedWorkers(workers: WorkerInfo[], pulls: GhPull[], tasks: QueueTask[], pullsOf?: (floor: string) => GhPull[] | undefined): Landed[] {
  const out: Landed[] = [];
  for (const w of workers) {
    if (notLeaving(w)) continue;
    const landed = landedWork(w, pulls, tasks, pullsOf);
    if (landed) out.push(landed);
  }
  return out;
}

/**
 * Why a worker whose work landed doesn't go home by itself yet (see landedWorkers), in a few words;
 * undefined when nothing keeps it.
 */
export function notLeaving(w: WorkerInfo): string | undefined {
  if (w.kind !== 'agent') return 'a shell';
  if (w.meeting) return 'at the meeting table';
  if (DESK_BY_ID.get(w.deskId)?.station) return 'a board agent';
  if (isBusy(w.status)) return w.status === 'needs_input' ? 'waiting on someone' : 'still working';
  if (w.prOpening) return 'opening a pull request';
  if (w.viewers.length) return `${w.viewers.join(', ')} ${w.viewers.length === 1 ? 'has' : 'have'} its terminal open`;
  return undefined;
}

/**
 * A worker's work, landed: a pull request of its merged and none is open (see workerPr), with the
 * heads of what merged, whatever the worker is doing now. Undefined when that isn't so.
 */
export function landedWork(w: WorkerInfo, pulls: GhPull[], tasks: QueueTask[], pullsOf?: (floor: string) => GhPull[] | undefined): Landed | undefined {
  const pr = workerPr(w, pulls, tasks);
  if (w.repos?.length) return landedAcross(w, pr, pulls, pullsOf);
  if (pr?.state !== 'merged') return undefined;
  return { worker: w, pr: pr.number, head: pulls.find((p) => p.number === pr.number)?.headRefOid };
}

/** landedWorkers for a worker across repositories, whose own floor's PR, if any, is `own`. */
function landedAcross(w: WorkerInfo, own: WorkerPr | undefined, pulls: GhPull[], pullsOf?: (floor: string) => GhPull[] | undefined): Landed | undefined {
  if (own?.state === 'open') return undefined;
  const heads: Record<string, string | undefined> = {};
  const prs: string[] = [];
  const numbers: number[] = [];
  if (own) {
    prs.push(`${w.worktree ? w.worktree.path.split(/[\\/]/).pop() : 'its own'} #${own.number}`);
    numbers.push(own.number);
  }
  for (const r of w.repos ?? []) {
    const theirs = (pullsOf?.(r.floor) ?? []).filter((p) => p.number === r.pr?.number || p.headRefName === r.branch);
    // Opened from its desk, but its floor doesn't list it (yet, or any more): can't tell.
    if (r.pr && !theirs.some((p) => p.number === r.pr!.number)) return undefined;
    if (theirs.some((p) => p.state === 'OPEN' || p.state === 'DRAFT')) return undefined;
    const merged = theirs.find((p) => p.state === 'MERGED');
    if (!merged) continue;
    heads[r.floor] = merged.headRefOid;
    prs.push(`${r.name} #${merged.number}`);
    numbers.push(merged.number);
  }
  if (!numbers.length) return undefined;
  return { worker: w, pr: numbers[0], head: own && pulls.find((p) => p.number === own.number)?.headRefOid, heads, prs };
}
