import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GhPull, LeaveOnMergeState, QueueTask, WorkerInfo } from '../shared/protocol.js';
import { DESK_BY_ID } from '../shared/layout.js';
import { isBusy, workerPr } from '../shared/status.js';

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
  pr: number;
  /** The merged PR's head commit, when GitHub said: everything up to it is delivered. */
  head?: string;
}

/**
 * The workers free to go home because their work landed: a pull request of theirs merged and none
 * is still open (the same call as the purple bubble, see workerPr), they're at rest, and nobody has
 * their terminal open. Board agents, shells and the meeting table don't come and go by pull request.
 */
export function landedWorkers(workers: WorkerInfo[], pulls: GhPull[], tasks: QueueTask[]): Landed[] {
  const out: Landed[] = [];
  for (const w of workers) {
    if (w.kind !== 'agent' || w.meeting || DESK_BY_ID.get(w.deskId)?.station) continue;
    if (isBusy(w.status) || w.prOpening || w.viewers.length) continue;
    const pr = workerPr(w, pulls, tasks);
    if (pr?.state !== 'merged') continue;
    out.push({ worker: w, pr: pr.number, head: pulls.find((p) => p.number === pr.number)?.headRefOid });
  }
  return out;
}
