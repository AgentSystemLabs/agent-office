import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskQueue, type QueueWorkers } from '../src/server/queue.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

// The queue's part in triage: priority order and one task per area at a time.

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-triage-queue-'));
  const workers: WorkerInfo[] = [];
  let hired = 0;
  const manager: QueueWorkers = {
    defaultProvider: 'claude',
    list: () => workers,
    deskOccupied: (desk) => workers.some((w) => w.deskId === desk),
    spawn(deskId, by, prompt, worktree, kind, provider, model, effort) {
      const id = `worker-${hired++}`;
      const worker: WorkerInfo = {
        id, deskId, kind, provider, model, effort, prompt, name: id,
        color: '#ffffff', status: 'working', acked: false, createdBy: by,
        createdAt: Date.now(), cols: 80, rows: 24, viewers: [], viewerIds: [],
      };
      workers.push(worker);
      return worker;
    },
    kill(id) {
      const i = workers.findIndex((w) => w.id === id);
      if (i >= 0) workers.splice(i, 1);
      return Promise.resolve({});
    },
  };
  const queues: TaskQueue[] = [];
  const open = () => {
    const q = new TaskQueue(dir, manager, false, { update() {}, toast() {}, claimIssue: async () => undefined, refreshGitHub() {}, hiringPaused: () => undefined, emptied() {} });
    queues.push(q);
    return q;
  };
  return { workers, open, close: () => (queues.forEach((q) => q.shutdown()), rmSync(dir, { recursive: true, force: true })) };
}

const titles = (q: TaskQueue) => q.state().tasks.filter((t) => t.status === 'queued').map((t) => t.title);

test('tasks with a priority wait ahead of lower ones, oldest first within each; plain tasks count as p2', (t) => {
  const f = fixture();
  t.after(f.close);
  const q = f.open();
  q.setLimit(0);
  q.add('a', 'me', 'plain');
  q.add('b', 'Triage', 'p3', 3, undefined, undefined, undefined, undefined, { priority: 3 });
  q.add('c', 'Triage', 'p1 first', 4, undefined, undefined, undefined, undefined, { priority: 1 });
  q.add('d', 'Triage', 'p0', 5, undefined, undefined, undefined, undefined, { priority: 0 });
  q.add('e', 'Triage', 'p1 second', 6, undefined, undefined, undefined, undefined, { priority: 1 });
  q.add('f', 'me', 'plain later');
  assert.deepEqual(titles(q), ['p0', 'p1 first', 'p1 second', 'plain', 'p3', 'plain later']);
});

test('priority, area and why survive a restart', (t) => {
  const f = fixture();
  t.after(f.close);
  const q = f.open();
  q.setLimit(0);
  q.add('a', 'Triage', 'x', 1, undefined, undefined, undefined, undefined, { priority: 1, area: 'api', triage: { reason: 'agent-ready (90%), s', size: 's' } });
  q.shutdown();
  const task = f.open().state().tasks[0];
  assert.equal(task.priority, 1);
  assert.equal(task.area, 'api');
  assert.equal(task.triage?.reason, 'agent-ready (90%), s');
});

test('two tasks in one area do not run at once; a task in another area goes past', (t) => {
  const f = fixture();
  t.after(f.close);
  const q = f.open();
  q.setLimit(0);
  q.add('a', 'Triage', 'api one', 1, undefined, undefined, undefined, undefined, { area: 'api' });
  q.add('b', 'Triage', 'api two', 2, undefined, undefined, undefined, undefined, { area: 'api' });
  q.add('c', 'Triage', 'ui one', 3, undefined, undefined, undefined, undefined, { area: 'ui' });
  q.setLimit(3);
  assert.deepEqual(f.workers.map((w) => w.prompt), ['a', 'c']);
  assert.deepEqual(titles(q), ['api two']);
  // The first api task finishing lets the second one in.
  f.workers[0].status = 'done';
  q.onWorker(f.workers[0]);
  q.setLimit(3);
  assert.ok(f.workers.some((w) => w.prompt === 'b'));
});
