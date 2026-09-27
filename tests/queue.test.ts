import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TaskQueue, type QueueWorkers } from '../src/server/queue.js';
import type { AgentProvider, WorkerInfo } from '../src/shared/protocol.js';

function fixture(defaultProvider: AgentProvider = 'claude') {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-queue-'));
  let currentRepository: string | undefined;
  const workers: WorkerInfo[] = [];
  const manager: QueueWorkers = {
    defaultProvider,
    list: () => workers,
    deskOccupied: (desk) => workers.some((w) => w.deskId === desk),
    spawn(deskId, by, prompt, _worktree, kind, provider, model, project) {
      const worker: WorkerInfo = {
        id: `worker-${workers.length}`, deskId, kind, provider, model, project, prompt, name: 'Test',
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
      refreshGitHub() {}, hiringPaused: () => undefined, currentRepository: () => currentRepository,
    });
    queues.push(queue);
    return queue;
  };
  return { dir, workers, open, setCurrentRepository(value: string | undefined) { currentRepository = value; }, close() { queues.forEach((q) => q.shutdown()); rmSync(dir, { recursive: true, force: true }); } };
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

test('allows the same issue number in different repositories but rejects a duplicate repository issue', (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open();
  assert.equal(q.add('Main issue', 'Tester', undefined, 7), undefined);
  assert.equal(q.add('Foreign issue', 'Tester', undefined, 7, 'claude', undefined, 'other/project', { repository: 'other/project', dir: '/tmp/other-project' }), undefined);
  assert.match(q.add('Unverified foreign issue', 'Tester', undefined, 8, 'claude', undefined, 'third/project') ?? '', /verified worker project/i);
  assert.match(q.add('Duplicate main issue', 'Tester', undefined, 7) ?? '', /already on the queue/i);
});

test('persists foreign issue project context through retry and always requests a worktree', (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open(); q.setLimit(0);
  const project = { repository: 'other/project', dir: '/tmp/other-project' };
  assert.equal(q.add('Foreign issue', 'Tester', undefined, 7, 'claude', undefined, 'other/project', project), undefined);
  q.setLimit(1);
  assert.deepEqual(f.workers[0].project, project);
  f.workers[0].status = 'done'; q.onWorker(f.workers[0]);
  q.retry(q.state().tasks[0].id);
  assert.deepEqual(f.workers[1].project, project);
});

test('drops a saved task with malformed foreign project context instead of using the current checkout', (t) => {
  const f = fixture(); t.after(() => f.close());
  writeFileSync(path.join(f.dir, 'queue.json'), JSON.stringify({ maxWorkers: 0, tasks: [
    { id: 'bad-project', title: 'Bad', prompt: 'Bad', status: 'queued', project: { repository: 'other/project' } },
    { id: 'wrong-project', title: 'Mismatch', prompt: 'Bad', status: 'queued', issue: 7, issueRepository: 'acme/main', project: { repository: 'other/project', dir: '/tmp/other-project' } },
  ] }));
  const q = f.open();
  assert.equal(q.state().tasks.length, 0);
});

test('does not link a current-repository PR to a foreign issue with the same number', (t) => {
  const f = fixture(); t.after(() => f.close());
  const q = f.open();
  assert.equal(q.add('Foreign issue', 'Tester', undefined, 7, 'claude', undefined, 'other/project', { repository: 'other/project', dir: '/tmp/other-project' }), undefined);
  q.onPulls([{
    number: 22, title: 'Current PR', state: 'OPEN', isDraft: false, url: 'https://github.com/acme/main/pull/22', author: 'tester', labels: [],
    reviewDecision: '', headRefName: 'feature', baseRefName: 'main', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    additions: 1, deletions: 1, checks: 'none', body: '', closes: [7],
  }]);
  assert.equal(q.state().tasks[0].pr, undefined);
});

test('holds a restored current-repository task until repository identity is available', (t) => {
  const f = fixture(); t.after(() => f.close());
  writeFileSync(path.join(f.dir, 'queue.json'), JSON.stringify({ maxWorkers: 1, tasks: [
    { id: 'current', title: 'Current', prompt: 'Current', status: 'queued', issue: 7, issueRepository: 'acme/main' },
  ] }));
  const q = f.open();
  assert.equal(f.workers.length, 0);
  f.setCurrentRepository('acme/main');
  q.pump();
  assert.equal(f.workers.length, 1);
});

test('resolves legacy issue identity against the current repository for duplicate detection', (t) => {
  const f = fixture(); f.setCurrentRepository('acme/main'); t.after(() => f.close());
  const q = f.open();
  assert.equal(q.add('Legacy', 'Tester', undefined, 7), undefined);
  assert.match(q.add('Qualified', 'Tester', undefined, 7, 'claude', undefined, 'acme/main') ?? '', /already on the queue/i);
});

test('refreshes current task PR state from GitHub after a worker supplied an older PR snapshot', (t) => {
  const f = fixture(); f.setCurrentRepository('acme/main'); t.after(() => f.close());
  const q = f.open();
  assert.equal(q.add('Current', 'Tester', undefined, 7, 'claude', undefined, 'acme/main'), undefined);
  f.workers[0].pr = { number: 22, url: 'https://github.com/acme/main/pull/22' };
  q.onPulls([{
    number: 22, title: 'Merged PR', state: 'MERGED', isDraft: false, url: 'https://github.com/acme/main/pull/22', author: 'tester', labels: [],
    reviewDecision: '', headRefName: 'feature', baseRefName: 'main', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    additions: 1, deletions: 1, checks: 'pass', body: '', closes: [7],
  }]);
  assert.equal(q.state().tasks[0].pr?.state, 'MERGED');
});
