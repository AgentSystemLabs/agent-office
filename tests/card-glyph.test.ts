import test from 'node:test';
import assert from 'node:assert/strict';
import { withGlyph, withoutGlyph } from '../src/client/world/glyph.js';

test('task card text swaps DroidProxy and its colon for the pinwheel', () => {
  assert.equal(withGlyph('DroidProxy: Opus 5.5 · High · Deploy'), '\uE000 Opus 5.5 · High · Deploy');
  assert.equal(withGlyph('via droidproxy and DROIDPROXY'), 'via \uE000 and \uE000');
});

test('task card text without DroidProxy is unchanged', () => {
  assert.equal(withGlyph('Opus · High · Fix the login page'), 'Opus · High · Fix the login page');
});

test('plain-text labels drop DroidProxy and its colon', () => {
  assert.equal(withoutGlyph('DroidProxy: Opus 5.5'), 'Opus 5.5');
  assert.equal(withoutGlyph('Default (DroidProxy: GPT 6 Sol)'), 'Default (GPT 6 Sol)');
  assert.equal(withoutGlyph('Opus 5.5'), 'Opus 5.5');
});

test('a Droid model id keeps DroidProxy for the pinwheel before the catalogue loads', async () => {
  const { droidDisplayName, modelBadge } = await import('../src/client/ui/provider.js');
  assert.equal(droidDisplayName('custom:droidproxy:opus-5-5'), 'DroidProxy: Opus 5.5');
  assert.equal(droidDisplayName('custom:droidproxy:gpt-6-sol'), 'DroidProxy: Gpt 6 Sol');
  assert.equal(droidDisplayName('glm-5.3-flash'), 'Glm 5.3 Flash');
  assert.equal(withGlyph(modelBadge('droid', 'custom:droidproxy:opus-5-5', 'high')!), '\uE000 Opus 5.5 · High');
});
