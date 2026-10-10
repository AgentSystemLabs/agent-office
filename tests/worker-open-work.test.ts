import test from 'node:test';
import assert from 'node:assert/strict';
import { workerOpenWork } from '../src/shared/worker-open-work.js';
import type { GhIssue, GhPull, QueueTask, WorkerInfo } from '../src/shared/protocol.js';

const worker = { id: 'pixel', kind: 'agent', status: 'done', name: 'Pixel' } as WorkerInfo;
const task = { id: 't1', workerId: 'pixel', title: 'Fix knockback', issue: 285, status: 'running' } as QueueTask;
const issue = { number: 285, title: 'Thrown corpses', state: 'OPEN' } as GhIssue;
const keys = (w = worker, tasks: QueueTask[] = [], issues: GhIssue[] = [], pulls: GhPull[] = []) => workerOpenWork(w, tasks, issues, pulls).map((x) => x.key);

test('running tasks and their open issues warn even when the worker finished its turn', () => {
  assert.deepEqual(keys(worker, [task], [issue]), ['task:t1', 'issue:285']);
});
test('finished turn and merged PR do not hide an issue that remains open', () => {
  const done = { ...task, status: 'done', outcome: 'done', pr: { number: 296, state: 'MERGED' } } as QueueTask;
  assert.deepEqual(keys(worker, [done], [issue]), ['issue:285']);
  assert.deepEqual(keys(worker, [done], [{ ...issue, state: 'CLOSED' }]), []);
  assert.deepEqual(keys(worker, [done], []), []);
});
test('failed and stopped tasks still warn, completed free-text tasks do not', () => {
  for (const outcome of ['failed', 'exited', 'killed'] as const) {
    assert.ok(keys(worker, [{ ...task, status: 'done', outcome }]).includes('task:t1'));
  }
  assert.deepEqual(keys(worker, [{ ...task, issue: undefined, status: 'done', outcome: 'done' }]), []);
});
test('missing GitHub data does not silently treat an unfinished issue as closed', () => {
  assert.deepEqual(keys(worker, [task]), ['task:t1', 'issue:285']);
});
test('issues handed directly to a worker warn, incidental references do not', () => {
  assert.deepEqual(keys({ ...worker, prompt: 'Work on GitHub issue #285: "Fix"' }, [], [issue]), ['issue:285']);
  assert.deepEqual(keys({ ...worker, prompt: 'See issue #285 for background' }, [], [issue]), []);
});
test('other workers and unrelated human-assigned issues are excluded', () => {
  assert.deepEqual(keys(worker, [{ ...task, workerId: 'byte' }], [issue]), []);
});
test('own open PRs warn, merged PRs do not, and duplicate issues are deduplicated', () => {
  const pull = { number: 296, title: 'Fix', state: 'OPEN', closes: [285] } as GhPull;
  const w = { ...worker, pastPrs: [296] };
  assert.deepEqual(keys(w, [task, { ...task, id: 't2' }], [issue], [pull]), ['task:t1', 'issue:285', 'task:t2', 'pr:296']);
  assert.deepEqual(keys(w, [], [], [{ ...pull, state: 'MERGED' }]), []);
});
test('active unqueued work warns while idle workers retain the normal send-home flow', () => {
  assert.deepEqual(keys({ ...worker, status: 'working' }), ['active']);
  assert.deepEqual(keys({ ...worker, status: 'idle' }), []);
  assert.deepEqual(keys({ ...worker, kind: 'shell', status: 'working' }), []);
});
