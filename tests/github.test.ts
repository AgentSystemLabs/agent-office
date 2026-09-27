import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MergeWatch } from '../src/server/github.js';
import type { GhPull } from '../src/shared/protocol.js';

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
