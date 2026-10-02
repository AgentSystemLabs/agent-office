import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Claims, MergeWatch } from '../src/server/github.js';
import type { GhIssue, GhPull } from '../src/shared/protocol.js';

const pull = (number: number, state: string): GhPull => ({
  number, title: `PR ${number}`, state, isDraft: false, url: '', author: '', labels: [], reviewDecision: '',
  headRefName: `b${number}`, baseRefName: 'main', createdAt: '', updatedAt: '', additions: 0, deletions: 0,
  checks: 'none', body: '', closes: [],
});
const numbers = (ps: GhPull[]) => ps.map((p) => p.number);

test('a pull request that was open at the last look and is merged now rings once', () => {
  const w = new MergeWatch();
  assert.deepEqual(numbers(w.look([pull(1, 'OPEN'), pull(2, 'MERGED'), pull(3, 'OPEN')])), [], 'nothing rings on the first look');
  assert.deepEqual(numbers(w.look([pull(1, 'MERGED'), pull(2, 'MERGED'), pull(3, 'CLOSED')])), [1]);
  assert.deepEqual(numbers(w.look([pull(1, 'MERGED'), pull(2, 'MERGED')])), []);
});

test('a merge from the PR window rings right away, and not again when GitHub catches up', () => {
  const w = new MergeWatch();
  w.look([pull(5, 'OPEN'), pull(6, 'OPEN')]);
  assert.equal(w.ring(5), true);
  assert.equal(w.ring(5), false);
  // A look that started before the merge still says open; the next one says merged.
  assert.deepEqual(numbers(w.look([pull(5, 'OPEN'), pull(6, 'OPEN')])), []);
  assert.deepEqual(numbers(w.look([pull(5, 'MERGED'), pull(6, 'MERGED')])), [6]);
});

const issue = (number: number, assignees: string[] = []): GhIssue => ({
  number, title: `Issue ${number}`, state: 'OPEN', url: '', author: '', labels: [], assignees, createdAt: '', updatedAt: '', body: '', comments: 0,
});
const taken = (is: GhIssue[]) => is.filter((i) => i.taken).map((i) => i.number);

test('an issue a worker took is marked at once, before GitHub has answered', () => {
  const c = new Claims();
  c.take(7);
  assert.deepEqual(taken(c.mark([issue(6), issue(7)])), [7]);
  // A list that comes back while GitHub is still assigning it doesn't have its assignee yet.
  assert.deepEqual(taken(c.mark([issue(6), issue(7)], 1000)), [7]);
});

test('it stays marked over a list asked for before it was assigned, until one asked for after', () => {
  const c = new Claims();
  const answered = c.take(7);
  answered(true, 2000);
  assert.deepEqual(taken(c.mark([issue(7)], 1500)), [7], 'asked before GitHub had it assigned');
  assert.equal(c.has(7), true);
  const fresh = c.mark([issue(7, ['octocat'])], 2500);
  assert.deepEqual(taken(fresh), [], 'GitHub lists its assignee now, which is what keeps it In progress');
  assert.deepEqual(fresh[0].assignees, ['octocat']);
  assert.equal(c.has(7), false);
});

test("an issue GitHub wouldn't assign goes back to where it was", () => {
  const c = new Claims();
  const answered = c.take(7);
  const shown = c.mark([issue(7)]);
  assert.deepEqual(taken(shown), [7]);
  answered(false);
  const back = c.mark(shown);
  assert.deepEqual(taken(back), []);
  assert.equal('taken' in back[0], false);
});

test('handed over twice, the first answer failing leaves the second one standing', () => {
  const c = new Claims();
  const first = c.take(7);
  const second = c.take(7);
  first(false);
  assert.deepEqual(taken(c.mark([issue(7)])), [7]);
  second(true, 3000);
  assert.deepEqual(taken(c.mark([issue(7, ['octocat'])], 3500)), []);
});
