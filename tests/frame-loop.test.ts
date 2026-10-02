import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { frameLoop } from '../src/client/core/frame-loop';
import type { Ctx } from '../src/client/core/context';
import { Ticks } from '../src/client/core/registry';
import { PlayerController } from '../src/client/player';
import { PERFORMANCE_PRESETS } from '../src/client/shared/performance';

// A real movement controller and tick registry with only the browser event/RAF boundary replaced.
test('actual loop preserves walking at 30/60/120 FPS, reduces idle draws, and resumes without a time jump', (t) => {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  let nextFrame: FrameRequestCallback = () => {};
  let now = 0;
  for (const [key, value] of [['window', win], ['document', doc], ['requestAnimationFrame', (callback: FrameRequestCallback) => { nextFrame = callback; return 1; }]] as const) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  t.mock.method(performance, 'now', () => now);
  t.after(() => { for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key); });
  for (const fps of [30, 60, 120] as const) {
    now = 0;
    const camera = new THREE.PerspectiveCamera();
    const player = new PlayerController(camera, new EventTarget() as unknown as HTMLElement, [{ minX: -100, maxX: 100, minZ: -100, maxZ: 100, top: 0 }]);
    player.pos.set(0, 0, 0);
    player.camYaw = 0;
    const ticks = new Ticks();
    let elapsed = 0;
    let draws = 0;
    ticks.add('move', (frame) => { player.update(frame.dt); elapsed += frame.dt; });
    ticks.add('render', () => { draws++; });
    const ctx = { camera, player, ticks, settings: { performance: { ...PERFORMANCE_PRESETS.balanced, fps, idleFps: 5 } }, activities: { busy: () => false }, trip: () => null } as unknown as Ctx;
    const start = frameLoop(ctx, { drew: () => {} });
    const key = new Event('keydown');
    Object.defineProperty(key, 'code', { value: 'KeyW' });
    win.dispatchEvent(key);
    start(now);
    for (let i = 1; i <= 240; i++) { now = i * 1000 / 120; nextFrame(now); }
    assert.ok(Math.abs(player.pos.z + 9.2) < 0.04, `${fps} FPS walked ${-player.pos.z}`);
    assert.ok(Math.abs(elapsed - 2) < 0.01);
    player.clearKeys();
    // Let input's short wake window expire, then observe a complete idle second.
    for (let i = 241; i <= 480; i++) { now = i * 1000 / 120; nextFrame(now); }
    const before = draws;
    for (let i = 481; i <= 600; i++) { now = i * 1000 / 120; nextFrame(now); }
    assert.ok(draws - before <= 6, `${fps} FPS idle drew ${draws - before}`);
    // A held key with no keyup while hidden must not restart walking on resume.
    win.dispatchEvent(key);
    const hiddenPosition = player.pos.clone();
    const hiddenElapsed = elapsed;
    const hiddenDraws = draws;
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    now += 30_000;
    nextFrame(now);
    assert.equal(elapsed, hiddenElapsed);
    assert.equal(draws, hiddenDraws);
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    nextFrame(now);
    assert.equal(elapsed, hiddenElapsed);
    for (let i = 1; i <= 12; i++) { now += 1000 / 120; nextFrame(now); }
    assert.ok(player.pos.distanceTo(hiddenPosition) < 0.001);
    win.dispatchEvent(key);
    for (let i = 1; i <= 12; i++) { now += 1000 / 120; nextFrame(now); }
    assert.ok(player.pos.z < hiddenPosition.z - 0.3);
  }
});
