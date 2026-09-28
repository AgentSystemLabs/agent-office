import test from 'node:test';
import assert from 'node:assert/strict';
import { withGlyph } from '../src/client/world/toon.js';

test('task card text swaps DroidProxy and its colon for the pinwheel', () => {
  assert.equal(withGlyph('DroidProxy: Opus 5.5 · High · Deploy'), '\uE000 Opus 5.5 · High · Deploy');
  assert.equal(withGlyph('via droidproxy and DROIDPROXY'), 'via \uE000 and \uE000');
});

test('task card text without DroidProxy is unchanged', () => {
  assert.equal(withGlyph('Opus · High · Fix the login page'), 'Opus · High · Fix the login page');
});
