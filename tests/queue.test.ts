import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskQueue, type QueueWorkers } from '../src/server/queue.js';
import type { AgentProvider, WorkerInfo } from '../src/shared/protocol.js';

function fixture(defaultProvider: AgentProvider = 'claude') {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-queue-'));
  const workers: WorkerInfo[] = [];
  const manager: QueueWorkers = {
    defaultProvider,
    list: () => workers,
    deskOccupied: (desk) => workers.some((w) => w.deskId === desk),
    spawn(deskId, by, prompt, _worktree, kind, provider, model) {
      const worker: WorkerInfo = {
        id: `worker-${workers.length}`, deskId, kind, provider, model, prompt, name: 'Test',
        color: '#ffffff', status: 'working', acked: false, createdBy: by,
        createdAt: Date.now(), cols: 80, rows: 24, viewers: [],
      };
      workers.push(worker);
      return worker;
    },
    kill: async () => ({}),
  };
  const queues: TaskQueue[] = [];
  const open = () => {
    const queue = new TaskQueue(dir, manager, false, {
      update() {}, toast() {}, claimIssue: async () => undefined,
      refreshGitHub() {}, hiringPaused: () => undefined,
    });
    queues.push(queue);
    return queue;
  };
  return { dir, workers, open, close() { queues.forEach((q) => q.shutdown()); rmSync(dir, { recursive: true, force: true }); } };
}

test('queue seats the selected provider and preserves it through completion and retry', (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open();
  assert.equal(q.add('Fix login', 'Tester', undefined, undefined, 'opencode'), undefined);
  assert.equal(f.workers[0].provider, 'opencode');
  f.workers[0].status = 'needs_input'; q.onWorker(f.workers[0]);
  assert.equal(q.state().tasks[0].status, 'running');
  f.workers[0].status = 'done'; q.onWorker(f.workers[0]);
  assert.equal(q.state().tasks[0].outcome, 'done');
  q.retry(q.state().tasks[0].id);
  assert.equal(f.workers[1].provider, 'opencode');
});

test('queued provider survives restart even when the configured default differs', (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open(); q.setLimit(0);
  q.add('Fix login', 'Tester', undefined, undefined, 'opencode'); q.shutdown();
  const restored = f.open(); restored.setLimit(1);
  assert.equal(f.workers[0].provider, 'opencode');
});

test('new and legacy tasks without a provider use the configured agent', (t) => {
  const f = fixture('custom'); t.after(() => f.close());
  writeFileSync(path.join(f.dir, 'queue.json'), JSON.stringify({ maxWorkers: 0, tasks: [
    { id: 'legacy', title: 'Legacy', prompt: 'Legacy task', status: 'queued' },
  ] }));
  const q = f.open();
  q.add('New task', 'Tester'); q.setLimit(2);
  assert.deepEqual(f.workers.map((w) => w.provider), ['custom', 'custom']);
});

test('invalid or unavailable providers are rejected before a task is queued', (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open();
  assert.match(q.add('Task', 'Tester', undefined, undefined, 'bad' as AgentProvider) ?? '', /provider/i);
  assert.match(q.add('Task', 'Tester', undefined, undefined, 'custom') ?? '', /provider/i);
  assert.equal(q.state().tasks.length, 0);
});

test('queue preserves the selected OpenCode model through seating, retry, and restart', (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open();
  assert.equal(q.add('Fix login', 'Tester', undefined, undefined, 'opencode', 'openai/gpt-5/nested'), undefined);
  assert.equal(f.workers[0].model, 'openai/gpt-5/nested');
  assert.equal(q.state().tasks[0].model, 'openai/gpt-5/nested');
  f.workers[0].status = 'done'; q.onWorker(f.workers[0]);
  q.retry(q.state().tasks[0].id);
  assert.equal(f.workers[1].model, 'openai/gpt-5/nested');

  q.setLimit(0);
  q.add('Queued', 'Tester', undefined, undefined, 'opencode', 'anthropic/claude-sonnet-4');
  q.shutdown();
  const restored = f.open();
  restored.setLimit(2);
  assert.equal(f.workers[2].model, 'anthropic/claude-sonnet-4');
});

test('queue rejects models unless they are valid OpenCode model ids', (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open();
  assert.match(q.add('Task', 'Tester', undefined, undefined, 'claude', 'openai/gpt-5') ?? '', /model|OpenCode/i);
  assert.match(q.add('Task', 'Tester', undefined, undefined, 'opencode', 'gpt-5') ?? '', /model|format|provider/i);
  assert.match(q.add('Task', 'Tester', undefined, undefined, 'opencode', 'openai/gpt 5') ?? '', /model|format|whitespace/i);
  assert.equal(q.state().tasks.length, 0);
});
