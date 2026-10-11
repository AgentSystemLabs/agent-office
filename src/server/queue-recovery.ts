import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { QueueTask, WorkerInfo } from '../shared/protocol.js';
import { delivered } from './queue-completion.js';
import { testResources, type TestResources } from './workers/test-resources.js';
import { recoveryBlocked, testingStopped } from './workers/testing.js';

export const RECOVERY_DELAY = 60_000;
export const RECOVERY_NOTE = 'Inspect existing background test processes and their results first; never launch a duplicate run. Retry missing automated tests through the project build lock only when resources are free. Inspect failures and finish delivery. Do not select new issues or approve permissions. Manual headset/playtests stay separate and unchecked, not a completion gate.';
const MAX_UNCHANGED = 3;
type Attempt = { key: string; due: number; attempts: number; submitted?: number; signature?: string };
export interface RecoveryPorts {
  tasks(): QueueTask[];
  workers(): WorkerInfo[];
  hold(id: string, reason?: string): boolean;
  continue(id: string): string | undefined;
  prompt(id: string, message: string): string | undefined;
  paused(): boolean;
  changed(): void;
}

/** Continue existing assignments only. Resource polling is cheap; agent retries are bounded. */
export class QueueRecovery {
  private records: Record<string, Attempt> = {};
  private busy = false;
  private closed = false;
  private file: string;
  constructor(dir: string, private port: RecoveryPorts, private probe = testResources, private now = Date.now) {
    this.file = path.join(dir, 'worker-recovery.json');
    try { this.records = JSON.parse(readFileSync(this.file, 'utf8')); } catch { /* first run */ }
  }
  shutdown() { this.closed = true; }
  async tick() {
    if (this.closed || this.busy || this.port.paused()) return;
    this.busy = true;
    try {
      let resources: TestResources | undefined;
      const seen = new Set<string>();
      for (const w of this.port.workers()) {
        if (w.kind !== 'agent' || w.meeting || w.lost || w.viewers.length || recoveryBlocked(w) || !['done', 'idle', 'waiting', 'testing'].includes(w.status)) continue;
        const assigned = this.port.tasks().filter(t => t.workerId === w.id && t.status !== 'done' && t.status !== 'queued');
        if (assigned.length > 1) continue; // An ambiguous owner needs reconciliation, not duplicate prompts.
        const task = assigned[0];
        const taskStatus = task?.status;
        const session = w.sessionId;
        const stoppedTest = testingStopped(w);
        if (!task && !stoppedTest) {
          if (this.records[w.id]) this.port.hold(w.id);
          delete this.records[w.id];
          continue;
        }
        if (task?.outcome || (task && delivered(task))) { this.port.hold(w.id); continue; }
        if (!stoppedTest && task?.status !== 'waiting' && !this.records[w.id]?.submitted) continue;
        const key = `${w.sessionId ?? w.id}:${task?.id ?? 'test'}`;
        seen.add(w.id);
        let r = this.records[w.id];
        if (!r || r.key !== key) r = this.records[w.id] = { key, due: this.now() + RECOVERY_DELAY, attempts: 0 };
        // A submitted prompt gets an acknowledgement grace period, never another automatic paste.
        if (r.submitted) {
          if (this.now() - r.submitted >= RECOVERY_DELAY * 2) {
            this.port.hold(w.id, 'Waiting: continuation was sent but not acknowledged; open the terminal');
            if (task) { task.waitingReason = 'Automatic continuation was not acknowledged. Open the terminal.'; this.port.changed(); }
          }
          continue;
        }
        const signature = JSON.stringify(task?.pr ?? null);
        if (r.signature && signature !== r.signature) r.attempts = 0;
        if (r.attempts >= MAX_UNCHANGED) {
          this.port.hold(w.id, 'Waiting: no verified progress after 3 continuations; review the blocker');
          continue;
        }
        if (this.now() < r.due) {
          if (w.status === 'done' || w.status === 'idle') this.port.hold(w.id, 'Waiting: automatic continuation in 1 minute');
          continue;
        }
        r.due = this.now() + RECOVERY_DELAY;
        resources ??= await this.probe();
        if (this.closed || this.port.paused()) break;
        // Revalidate after the async hardware check: the user or a hook may have moved this task.
        const current = this.port.workers().find(x => x.id === w.id);
        if (!current || current.sessionId !== session || current.viewers.length || current.meeting ||
          !['done', 'idle', 'waiting', 'testing'].includes(current.status)) continue;
        if (task && !this.port.tasks().some(t => t.id === task.id && t.workerId === w.id && t.status === taskStatus && !t.outcome && !delivered(t))) continue;
        if (!resources.free) {
          // A known running test remains TESTING. A queued test or incomplete turn is WAITING.
          if (current.status !== 'testing') this.port.hold(w.id, `Waiting: ${resources.reason}; checking again in 1 minute`);
          continue;
        }
        if (!this.port.hold(w.id)) continue;
        const error = task?.status === 'waiting' ? this.port.continue(task.id) : this.port.prompt(w.id,
          `Continue your already assigned task. ${RECOVERY_NOTE}`);
        if (!error) {
          r.attempts++; r.signature = signature; r.submitted = this.now();
          this.port.hold(w.id, 'Waiting: continuation sent; awaiting worker acknowledgement');
        }
      }
      // A real new working turn acknowledges submission. Keep its attempt count across short turns.
      for (const [id, r] of Object.entries(this.records)) {
        const w = this.port.workers().find(x => x.id === id);
        if (w && ['working', 'testing', 'needs_input'].includes(w.status) && !testingStopped(w)) delete r.submitted;
        if (!w || (!seen.has(id) && !this.port.tasks().some(t => t.workerId === id && ['running', 'waiting'].includes(t.status)))) delete this.records[id];
      }
      writeFileSync(this.file, JSON.stringify(this.records), { mode: 0o600 });
    } finally { this.busy = false; }
  }
}
