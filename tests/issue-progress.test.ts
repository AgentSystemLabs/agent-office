import test from 'node:test';
import assert from 'node:assert/strict';
import { inProgress } from '../src/client/ui/github/progress.js';
import type { GhIssue, QueueTask } from '../src/shared/protocol.js';

const issue = (extra: Partial<GhIssue> = {}): GhIssue => ({ number: 7, title: 'Fix the door', state: 'OPEN', url: '', author: 'ada', labels: [], assignees: [], createdAt: '', updatedAt: '', body: '', comments: 0, ...extra });
const task = (status: QueueTask['status']) => ({ id: 't1', title: '#7 Fix the door', issue: 7, status }) as QueueTask;

test('an issue nobody has taken is not in progress', () => {
  assert.equal(inProgress(issue(), undefined), false);
  assert.equal(inProgress(issue({ labels: [{ name: 'bug', color: '#d73a4a' }] }), undefined), false);
});

test('an assigned issue is in progress', () => {
  assert.equal(inProgress(issue({ assignees: ['ada'] }), undefined), true);
});

test('an issue a worker just took is in progress before GitHub lists its assignee', () => {
  assert.equal(inProgress(issue({ taken: true }), undefined), true);
});

test('an in-progress label puts an issue in progress, however it is spelled', () => {
  for (const name of ['in progress', 'In-Progress', 'doing', 'WIP', 'started']) assert.equal(inProgress(issue({ labels: [{ name, color: '#fff' }] }), undefined), true, name);
});

test('only a running queue task puts its issue in progress', () => {
  assert.equal(inProgress(issue(), task('running')), true);
  assert.equal(inProgress(issue(), task('queued')), false);
  assert.equal(inProgress(issue(), task('done')), false);
});
