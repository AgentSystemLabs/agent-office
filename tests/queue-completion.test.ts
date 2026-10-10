import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskQueue, type QueueWorkers } from '../src/server/queue.js';
import type { GhPull, WorkerInfo } from '../src/shared/protocol.js';

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'queue-delivery-'));
  const workers: WorkerInfo[] = [];
  const prompts: string[] = [];
  let celebrations = 0;
  const manager: QueueWorkers = {
    defaultProvider: 'claude', list: () => workers, deskOccupied: () => false,
    spawn(deskId) {
      const worker = { id: 'pixel', name: 'Pixel', kind: 'agent', deskId, status: 'working', viewers: [], worktree: { path: 'shared', branch: 'shared', base: 'abc' } } as unknown as WorkerInfo;
      workers.push(worker); return worker;
    },
    prompt(_id, text) { prompts.push(text); }, kill: async () => ({}),
  };
  const queues: TaskQueue[] = [];
  const open = () => {
    const q = new TaskQueue(dir, manager, true, { update() {}, toast() {}, claimIssue: async () => undefined, refreshGitHub() {}, hiringPaused: () => undefined, emptied: () => celebrations++ });
    queues.push(q); return q;
  };
  t.after(() => { queues.forEach((q) => q.shutdown()); rmSync(dir, { recursive: true, force: true }); });
  return { dir, workers, prompts, open, celebrations: () => celebrations };
}
const pull = (overrides: Partial<GhPull> = {}): GhPull => ({ number: 300, title: 'Fix #286', url: 'https://github.com/o/r/pull/300', state: 'OPEN', isDraft: false, author: 'Pixel', labels: [], reviewDecision: '', headRefName: 'shared', baseRefName: 'main', createdAt: new Date().toISOString(), updatedAt: '', additions: 1, deletions: 0, checks: 'pass', body: 'Closes #286', closes: [286], ...overrides });

test('a finished turn without a result stays visible and cannot be cleared as finished', (t) => {
  const f = fixture(t); const q = f.open(); q.add('Fix guest pistol', 'Kajo', undefined, 286);
  f.workers[0].status = 'done'; q.onWorker(f.workers[0]);
  const task = q.state().tasks[0];
  assert.equal(task.status, 'waiting'); assert.equal(task.finishedAt, undefined);
  assert.equal(task.outcome, undefined); assert.equal(f.celebrations(), 0);
  q.clear(); assert.equal(q.state().tasks.length, 1);
  assert.match(task.waitingReason!, /without a delivered result/);
});

test('only complete task-specific PR delivery finishes: not old, partial, unrelated, draft or red CI', (t) => {
  const f = fixture(t); const q = f.open(); q.add('Fix guest pistol', 'Kajo', undefined, 286);
  f.workers[0].status = 'done'; q.onWorker(f.workers[0]);
  for (const pr of [
    pull({ createdAt: '2020-01-01T00:00:00Z' }),
    pull({ closes: [287], body: 'Closes #287' }),
    pull({ closes: [], body: 'Refs #286' }),
    pull({ isDraft: true }), pull({ checks: 'pending' }), pull({ checks: 'fail' }), pull({ state: 'CLOSED' }),
  ]) { q.onPulls([pr]); assert.equal(q.state().tasks[0].status, 'waiting'); }
  q.onPulls([pull()]);
  assert.equal(q.state().tasks[0].status, 'done'); assert.equal(q.state().tasks[0].outcome, 'done');
  assert.equal(f.celebrations(), 1);
  q.onPulls([pull({ isDraft: true })]); assert.equal(q.state().tasks[0].status, 'waiting');
});

test('existing PR delivery cannot finish a worker that is still working or needs input', (t) => {
  const f = fixture(t); const q = f.open(); q.add('Fix guest pistol', 'Kajo', undefined, 286);
  q.onPulls([pull()]); assert.equal(q.state().tasks[0].status, 'running');
  f.workers[0].status = 'needs_input'; q.onWorker(f.workers[0]);
  assert.equal(q.state().tasks[0].status, 'running');
  f.workers[0].status = 'done'; q.onWorker(f.workers[0]);
  assert.equal(q.state().tasks[0].status, 'done');
});

test('continue requires the person, preserves the task and waits for the new worker turn', (t) => {
  const f = fixture(t); const q = f.open(); q.add('Fix guest pistol', 'Kajo', undefined, 286);
  const w = f.workers[0]; w.status = 'done'; q.onWorker(w);
  const id = q.state().tasks[0].id;
  w.status = 'working'; assert.match(q.continue(id, 'Kajo')!, /busy/); assert.equal(f.prompts.length, 0);
  w.status = 'done'; assert.equal(q.continue(id, 'Kajo'), undefined); q.pump();
  assert.equal(q.state().tasks[0].status, 'running'); assert.equal(f.prompts.length, 1);
  assert.match(f.prompts[0], /Fix guest pistol/);
  w.status = 'working'; q.onWorker(w); w.status = 'done'; q.onWorker(w);
  assert.equal(q.state().tasks[0].status, 'waiting'); assert.equal(q.state().tasks.length, 1);
});

test('only explicit human confirmation completes a result without a PR and survives restart', (t) => {
  const f = fixture(t); const q = f.open(); q.add('Explain the diagnosis', 'Kajo');
  f.workers[0].status = 'done'; q.onWorker(f.workers[0]);
  const id = q.state().tasks[0].id;
  assert.equal(q.confirm(id, 'Kajo'), undefined);
  assert.equal(q.state().tasks[0].confirmedBy?.name, 'Kajo');
  q.shutdown(); assert.equal(f.open().state().tasks[0].status, 'done');
});

test('legacy false-finished and interrupted tasks migrate to attention, never to the waiting queue', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.dir, 'queue.json'), JSON.stringify({ maxWorkers: 0, tasks: [
    { id: '286', prompt: 'Fix guest pistol', title: '#286', issue: 286, status: 'done', outcome: 'done', finishedAt: 1 },
    { id: '285', prompt: 'Fix corpse throw', title: '#285', issue: 285, status: 'running' },
  ] }));
  const q = f.open(); assert.deepEqual(q.state().tasks.map((task) => task.status), ['waiting', 'waiting']);
  assert.ok(q.state().tasks.every((task) => task.finishedAt === undefined));
  q.clear(); assert.equal(q.state().tasks.length, 2);
});
