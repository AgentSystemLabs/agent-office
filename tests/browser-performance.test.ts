import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings } from '../src/client/state/persist';

function storage(value: unknown) {
  let saved = JSON.stringify(value);
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } } });
  return () => old ? Object.defineProperty(globalThis, 'localStorage', old) : Reflect.deleteProperty(globalThis, 'localStorage');
}

const balanced = { fps: 60, idleFps: 15, pixelRatio: 1.25, outlines: true, shadowSize: 1024, previewFps: 30, laptopWidth: 512, laptopRefreshMs: 500 };

test('legacy browser settings acquire balanced performance defaults without losing existing choices', () => {
  const restore = storage({ view: 'third', volume: 0.2, hud: { workers: true }, pins: ['settings'] });
  try {
    const settings = loadSettings();
    assert.deepEqual(settings.performance, balanced);
    assert.equal(settings.view, 'third');
    assert.equal(settings.hud.workers, true);
    assert.deepEqual(settings.pins, ['settings']);
  } finally { restore(); }
});

test('invalid saved performance fields fall back independently and valid changes survive reload', () => {
  const restore = storage({ performance: { ...balanced, fps: 0, pixelRatio: null, shadowSize: -1, laptopWidth: 256, outlines: false } });
  try {
    const settings = loadSettings();
    assert.deepEqual(settings.performance, { ...balanced, laptopWidth: 256, outlines: false });
    saveSettings(settings);
    assert.deepEqual(loadSettings().performance, settings.performance);
  } finally { restore(); }
});

test('all presets survive storage parsing and individual changes derive Custom', async () => {
  const { PERFORMANCE_PRESETS, parseBrowserPerformance, performancePreset } = await import('../src/client/shared/performance');
  for (const name of ['economy', 'balanced', 'quality'] as const) {
    assert.equal(performancePreset(parseBrowserPerformance(JSON.parse(JSON.stringify(PERFORMANCE_PRESETS[name])))), name);
  }
  assert.equal(performancePreset({ ...PERFORMANCE_PRESETS.balanced, previewFps: 60 }), 'custom');
  assert.deepEqual(parseBrowserPerformance(['bad']), balanced);
  const first = parseBrowserPerformance(null);
  first.fps = 30;
  assert.deepEqual(parseBrowserPerformance(null), balanced);
});
