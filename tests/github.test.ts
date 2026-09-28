import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Relabels } from '../src/server/forge.js';
import { MergeWatch } from '../src/server/github.js';
import type { GhPull } from '../src/shared/protocol.js';

const pull = (number: number, state: string): GhPull => ({
  number,
  title: `PR ${number}`,
  state,
  isDraft: false,
  url: '',
  author: '',
  labels: [],
  reviewDecision: '',
  headRefName: `b${number}`,
  baseRefName: 'main',
  createdAt: '',
  updatedAt: '',
  additions: 0,
  deletions: 0,
  checks: 'none',
  body: '',
  closes: [],
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

test('labels saved from the office outlast a list asked for before the save, not one asked for after', () => {
  const r = new Relabels();
  const bug = [{ name: 'bug', color: '#d73a4a' }];
  r.set('pull', 5, bug, 1000);
  const stale = r.apply('pull', [pull(5, 'OPEN'), pull(6, 'OPEN')], 900);
  assert.deepEqual(stale[0].labels, bug, 'a list asked for before the save keeps the new labels');
  assert.deepEqual(stale[1].labels, [], 'other items are left alone');
  assert.deepEqual(r.apply('issue', [pull(5, 'OPEN')], 900)[0].labels, [], 'an issue and a PR with the same number are kept apart');
  assert.deepEqual(r.apply('pull', [pull(5, 'OPEN')], 1100)[0].labels, [], 'a list asked for after the save is believed');
  assert.deepEqual(r.apply('pull', [pull(5, 'OPEN')], 900)[0].labels, [], 'and the save is forgotten');
});
