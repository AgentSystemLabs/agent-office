import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameCadence } from '../src/client/core/frame-cadence';

function observe(hz: number, fps: number | 'display', idleFps?: number) {
  const simulation = new FrameCadence();
  const drawing = new FrameCadence();
  let elapsed = 0;
  let updates = 0;
  let draws = 0;
  for (let i = 0; i <= hz * 10; i++) {
    const now = i * 1000 / hz;
    const delta = simulation.admit(now, fps);
    if (delta === null) continue;
    elapsed += delta;
    updates++;
    if (drawing.admit(now, idleFps ?? fps) !== null) draws++;
  }
  return { elapsed, updates, draws };
}

test('frame limits preserve elapsed simulation time on 60, 120 and 144 Hz displays', () => {
  for (const hz of [60, 120, 144]) {
    for (const fps of [30, 60, 120, 'display'] as const) {
      const result = observe(hz, fps);
      assert.ok(Math.abs(result.elapsed - 10) < 0.035, `${hz}Hz/${fps}: ${result.elapsed}s`);
      const expected = Math.min(hz, fps === 'display' ? hz : fps) * 10;
      assert.ok(Math.abs(result.updates - expected) <= 2, `${hz}Hz/${fps}: ${result.updates} frames`);
    }
  }
});

test('idle drawing at 5 or 15 FPS preserves 60 FPS simulation on a 120 Hz display', () => {
  for (const idleFps of [5, 15]) {
    const { elapsed, updates, draws } = observe(120, 60, idleFps);
    assert.ok(Math.abs(elapsed - 10) < 0.001);
    assert.ok(Math.abs(updates - 600) <= 2);
    assert.ok(Math.abs(draws - idleFps * 10) <= 2);
  }
});

test('hidden frames do no work and resuming resets elapsed time', () => {
  const cadence = new FrameCadence();
  assert.equal(cadence.admit(0, 60), 0);
  assert.equal(cadence.admit(20, 60), 0.02);
  for (let now = 100; now < 30100; now += 100) assert.equal(cadence.admit(now, 60, false), null);
  assert.equal(cadence.admit(30100, 60), 0);
  assert.equal(cadence.admit(30120, 60), 0.02);
});

test('live FPS increases discard a stale slow deadline without losing elapsed time', () => {
  const cadence = new FrameCadence();
  cadence.admit(0, 5);
  cadence.admit(200, 5);
  assert.equal(cadence.admit(220, 60), 0.02);
  assert.equal(cadence.admit(224, 60), null);
});
