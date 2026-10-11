import test from 'node:test';
import assert from 'node:assert/strict';
import { readXrContext, readXrRequirements, selectXrPlaytests, type XrContext } from '../src/shared/xr-playtests.js';
import type { Playtest } from '../src/shared/playtests.js';
const c: XrContext = { mode: 'RIFT', style: 'solo', phase: 'playing', build: 'new', connected: true, focused: true, sampledAt: 10000 };
const item = (id: string, extra: Partial<Playtest> = {}): Playtest => ({ id, revision: 3, title: 'Test', category: 'Weapons', steps: 'Play', expected: 'Works', source: '', createdAt: '', createdBy: '', done: false, notes: '', modes: ['RIFT'], playStyles: [], ...extra });
test('whole-session selection follows mode and solo/coop changes without prose inference', () => {
  const items = [item('rift'), item('general', { modes: ['Allgemein'] }), item('rb', { modes: ['RB'], expected: 'bei RIFT nicht' }), item('coop', { playStyles: ['local-coop'] })];
  const select = (context: XrContext) => selectXrPlaytests(items, context, {}, 10000).active.map(t => t.id);
  assert.deepEqual(select(c), ['rift', 'general']);
  assert.deepEqual(select({ ...c, style: 'local-coop' }), ['rift', 'general', 'coop']);
  assert.deepEqual(select({ ...c, mode: 'RB' }), ['general', 'rb']);
});
test('missing classification is explicit; lobby tests wait for lobby', () => {
  const items = [item('legacy', { modes: undefined }), item('unknown', { playStyles: undefined }), item('menu')];
  const rules = readXrRequirements({ menu: { phases: ['lobby'] } });
  assert.deepEqual(selectXrPlaytests(items, c, rules, 10000).excluded.map(x => x.reason), ['classification-required', 'classification-required', 'phase']);
  assert.deepEqual(selectXrPlaytests(items, { ...c, phase: 'lobby' }, rules, 10000).active, [{ id: 'menu', revision: 3 }]);
});
test('stale, future, disconnected and unfocused contexts cannot activate tests', () => {
  for (const context of [undefined, { ...c, sampledAt: 4999 }, { ...c, sampledAt: 10001 }, { ...c, connected: false }, { ...c, focused: false }]) {
    assert.deepEqual(selectXrPlaytests([item('t')], context, {}, 10000), { active: [], excluded: [{ id: 't', reason: 'context-unavailable' }] });
  }
});
test('old-build passes remain candidates and human results are never modified', () => {
  const old = item('old', { done: true, outcome: 'passed', build: 'old', notes: 'keep' });
  const before = JSON.stringify(old);
  assert.equal(selectXrPlaytests([old], c, {}, 10000).active.length, 1);
  assert.equal(JSON.stringify(old), before);
});
test('invalid context and phase definitions are rejected', () => {
  assert.deepEqual(readXrContext(c), c);
  for (const bad of [null, {}, { ...c, mode: 'Allgemein' }, { ...c, build: '' }, { ...c, sampledAt: NaN }, { ...c, connected: 'yes' }]) assert.throws(() => readXrContext(bad));
  assert.throws(() => readXrRequirements({ test: { phases: ['unknown'] } }));
});
