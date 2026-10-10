import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Floor } from './floor.js';
import type { WorkerInfo } from '../shared/protocol.js';

export interface DirectHandoff {
  issue: number;
  workerId: string;
  worker: string;
  by: string;
  at: number;
  status: 'pending' | 'active' | 'done' | 'stopped' | 'superseded';
}

/** Direct assignments are durable evidence, never waiting tasks that the queue may seat. */
export class IssueHandoffs {
  private records: DirectHandoff[] = [];
  constructor(private file: string) {
    if (existsSync(file)) {
      const saved: unknown = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(saved)) throw new Error('Invalid direct issue handoffs');
      this.records = saved.filter((r): r is DirectHandoff => r && Number.isSafeInteger(r.issue) && r.issue > 0 && typeof r.workerId === 'string' && typeof r.worker === 'string' && ['pending', 'active', 'done', 'stopped', 'superseded'].includes(r.status));
    }
  }
  take(issue: number, worker: WorkerInfo, by: string) {
    for (const r of this.records) if (r.workerId === worker.id && ['pending', 'active'].includes(r.status)) r.status = 'superseded';
    this.records.push({ issue, workerId: worker.id, worker: worker.name, by, at: Date.now(), status: ['starting', 'working', 'needs_input'].includes(worker.status) ? 'active' : 'pending' });
    this.save();
  }
  changed(worker: WorkerInfo | string) {
    const id = typeof worker === 'string' ? worker : worker.id;
    let changed = false;
    for (const r of this.records) {
      if (r.workerId !== id || !['pending', 'active'].includes(r.status)) continue;
      const status = typeof worker === 'string' || worker.status === 'exited' ? 'stopped'
        : worker.status === 'done' && r.status === 'active' ? 'done'
        : ['starting', 'working', 'needs_input'].includes(worker.status) ? 'active' : undefined;
      if (status && status !== r.status) { r.status = status; changed = true; }
    }
    if (changed) this.save();
  }
  list(workers: WorkerInfo[]) {
    for (const r of this.records.filter((r) => ['pending', 'active'].includes(r.status))) this.changed(workers.find((w) => w.id === r.workerId) ?? r.workerId);
    return this.records.map((r) => ({ ...r, workerStatus: workers.find((w) => w.id === r.workerId)?.status ?? 'gone' }));
  }
  private save() { writeFileSync(this.file, JSON.stringify(this.records, null, 2) + '\n'); }
}

const stores = new WeakMap<Floor, IssueHandoffs>();
export function issueHandoffs(floor: Floor): IssueHandoffs {
  let store = stores.get(floor);
  if (!store) { store = new IssueHandoffs(path.join(floor.dir, '.agent-office', 'issue-handoffs.json')); stores.set(floor, store); }
  return store;
}
