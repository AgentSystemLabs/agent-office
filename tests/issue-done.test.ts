import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IssueDone } from '../src/server/issue-done.js';
import type { GhIssue, GhPull, QueueTask } from '../src/shared/protocol.js';

const pull = (number: number, state: string, closes: number[] = []): GhPull => ({
  number, title: `PR ${number}`, state, isDraft: false, url: '', author: '', labels: [], reviewDecision: '',
  headRefName: `b${number}`, baseRefName: 'main', createdAt: '', updatedAt: '', additions: 0, deletions: 0,
  checks: 'none', body: '', closes,
});
const issue = (number: number, state = 'OPEN'): GhIssue => ({
  number, title: `Issue ${number}`, state, url: '', author: '', labels: [], assignees: [], createdAt: '', updatedAt: '', body: '', comments: 0,
});
const task = (issueN: number, pr: number, owner?: string): QueueTask => ({
  id: `t${issueN}`, issue: issueN, title: '', prompt: '', addedBy: 'me', addedAt: 0, status: 'done', owner,
  pr: { number: pr, url: '', state: 'OPEN', title: '' },
});

test("a queue task's issue is done once its pull request merges", () => {
  const d = new IssueDone();
  const tasks = [task(7, 1, 'alice'), task(8, 2)];
  assert.deepEqual(d.look([pull(1, 'OPEN'), pull(2, 'OPEN')], tasks, [issue(7), issue(8)]), [], 'nothing on the first look');
  assert.deepEqual(d.look([pull(1, 'MERGED'), pull(2, 'OPEN')], tasks, [issue(7), issue(8)]), [{ issue: 7, pr: 1, owner: 'alice' }]);
  assert.deepEqual(d.look([pull(1, 'MERGED'), pull(2, 'OPEN')], tasks, [issue(7), issue(8)]), [], 'and only once');
});

test('issues GitHub closes itself, closed ones and merges seen at start-up are left alone', () => {
  const d = new IssueDone();
  d.look([pull(1, 'OPEN', [7]), pull(2, 'OPEN'), pull(3, 'MERGED')], [], []);
  const tasks = [task(7, 1), task(8, 2), task(9, 3)];
  assert.deepEqual(d.look([pull(1, 'MERGED', [7]), pull(2, 'MERGED'), pull(3, 'MERGED')], tasks, [issue(7), issue(8, 'CLOSED'), issue(9)]), []);
});
