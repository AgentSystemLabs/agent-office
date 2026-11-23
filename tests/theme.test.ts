import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_PICKS, activeTheme, decorTheme, isThemePick } from '../src/shared/theme.js';

test('neon is a pick, never a calendar theme', () => {
  assert.deepEqual(THEME_PICKS, ['auto', 'halloween', 'christmas', 'neon', 'off']);
  assert.ok(isThemePick('neon'));
  assert.equal(activeTheme('neon', Date.UTC(2026, 9, 5), 0), 'neon');
  assert.equal(activeTheme('auto', Date.UTC(2026, 9, 5), 0), 'halloween');
  assert.equal(activeTheme('auto', Date.UTC(2026, 10, 5), 0), null);
});

test('neon dresses no holiday costume', () => {
  assert.equal(decorTheme('neon'), null);
  assert.equal(decorTheme('halloween'), 'halloween');
  assert.equal(decorTheme('christmas'), 'christmas');
  assert.equal(decorTheme(null), null);
});
