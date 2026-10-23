import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pocketHudActions, pocketHudPanel } from '../src/client/shared/pocket/controls';
import { openPocketSettings } from '../src/client/shared/pocket/settings';
import { loadSettings } from '../src/client/state/persist';

const read = (path: string) => readFileSync(new URL(`../src/client/${path}`, import.meta.url), 'utf8');

test('Pocket HUD allows only workspace, settings, and controls actions', () => {
  const actions = ['signins', 'lite', 'meeting', 'shell', 'repos', 'queue', 'voice', 'share', 'roof', 'whiteboard', 'elevator', 'settings', 'help'].map((id) => ({ id }));
  assert.deepEqual(pocketHudActions(actions, true).map((a) => a.id), ['elevator', 'settings', 'help']);
  assert.equal(pocketHudActions(actions, false), actions);
  assert.deepEqual(actions.slice(-3), pocketHudActions(actions, true));
});

test('Pocket HUD retains supported panel toggles but excludes CLI usage panels', () => {
  for (const id of ['workers', 'people', 'chat', 'floor']) assert.equal(pocketHudPanel(id, true), true);
  for (const id of ['spend', 'limits', 'unknown']) {
    assert.equal(pocketHudPanel(id, true), false);
    assert.equal(pocketHudPanel(id, false), true);
  }
});

test('Pocket local settings do not intercept standalone or call a runtime on open', () => {
  let changed = false;
  assert.equal(openPocketSettings(loadSettings(), () => { changed = true; }, () => { changed = true; }), false);
  assert.equal(changed, false);
  const settings = read('ui/settings.ts');
  const guard = settings.indexOf('if (openPocketSettings(settings, onChange, onCharacter)) return;');
  assert.ok(guard > 0);
  assert.ok(guard < settings.indexOf("net.send({ t: 'map.set' })"));
  assert.ok(guard < settings.indexOf("const seg = h("));
  const pocket = read('shared/pocket/settings.ts');
  assert.doesNotMatch(pocket, /\b(?:net|fetch|XMLHttpRequest|send|request)\s*\(/);
  assert.doesNotMatch(pocket, /from ['"].*(?:transport|net)['"]/);
  assert.match(pocket, /const modal = openModal\(el\)/);
  assert.match(pocket, /workspace.addEventListener\('click', .*openPocketElevator\(\)/);
  assert.match(pocket, /character.addEventListener\('click', .*onCharacter\(\)/);
  assert.match(read('ui/menu.ts'), /actions = pocketHudActions\(actions\)/);
});
