import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings } from '../src/client/state.js';

/** A localStorage the test can look at, since settings live in the browser's. */
function fakeStorage(saved: unknown) {
  const store = new Map<string, string>();
  if (saved !== undefined) store.set('agent-office.settings', JSON.stringify(saved));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  return store;
}

test('the TV’s volume comes back from settings, as something it could be', () => {
  fakeStorage(undefined);
  const fresh = loadSettings();
  assert.equal(fresh.tv, 0.7, 'the level it comes at');
  assert.equal(fresh.tvMuted, false, 'and it isn’t muted');

  fakeStorage({ tv: 0.25, tvMuted: true });
  const saved = loadSettings();
  assert.equal(saved.tv, 0.25);
  assert.equal(saved.tvMuted, true);

  // Anything a hand-edited (or older) settings file could say: kept to a level, or left alone.
  fakeStorage({ tv: 4 });
  assert.equal(loadSettings().tv, 1, 'nothing is louder than all the way up');
  fakeStorage({ tv: -3 });
  assert.equal(loadSettings().tv, 0, 'and nothing is quieter than off');
  fakeStorage({ tv: 'loud' });
  assert.equal(loadSettings().tv, 0.7, 'a level that isn’t a number is left at the default');
  fakeStorage({ tv: null, tvMuted: 'yes' });
  assert.equal(loadSettings().tvMuted, false, 'a mute that isn’t a boolean is left alone');

  // And the pair survives a round trip through storage.
  const store = fakeStorage(undefined);
  const mine = { ...loadSettings(), tv: 0.35, tvMuted: true };
  saveSettings(mine);
  assert.ok(store.has('agent-office.settings'));
  const back = loadSettings();
  assert.equal(back.tv, 0.35);
  assert.equal(back.tvMuted, true);
  assert.equal(back.music, mine.music, 'the settings beside it are untouched');
});

test('the dance floor by the TV is on to begin with, and remembered', () => {
  fakeStorage(undefined);
  assert.equal(loadSettings().danceFloor, true, 'it comes out by default');

  fakeStorage({ danceFloor: false });
  assert.equal(loadSettings().danceFloor, false, 'turning it off sticks');

  // Anything a hand-edited (or older) settings file could say: left at the default.
  fakeStorage({ danceFloor: 'yes' });
  assert.equal(loadSettings().danceFloor, true);
  fakeStorage({ danceFloor: 0 });
  assert.equal(loadSettings().danceFloor, true);

  const store = fakeStorage(undefined);
  saveSettings({ ...loadSettings(), danceFloor: false });
  assert.ok(store.has('agent-office.settings'));
  assert.equal(loadSettings().danceFloor, false);
});
