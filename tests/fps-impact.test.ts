import test from 'node:test';
import assert from 'node:assert/strict';
import { FpsImpacts, impactKind } from '../src/client/features/fps/impact.js';
import type { FpsShot } from '../src/shared/fps.js';

const shot = (to: FpsShot['to'], hit: string | null = null, headshot = false): FpsShot => ({
  shooter: 'a', from: { x: -14, y: 1, z: 9 }, to, hit, headshot,
});

test('feedback separates authoritative hits, cover materials and open-air misses', () => {
  assert.equal(impactKind(shot({ x: -14, y: 1, z: -9 }, 'b')), 'body');
  assert.equal(impactKind(shot({ x: -14, y: 1.57, z: -9 }, 'b', true)), 'head');
  assert.equal(impactKind(shot({ x: -4, y: 1, z: -3 })), 'metal');
  assert.equal(impactKind(shot({ x: -11, y: 1, z: 4.5 })), 'wood');
  assert.equal(impactKind(shot({ x: -15.5, y: 1, z: 9 })), 'stone');
  assert.equal(impactKind(shot({ x: -14, y: 8, z: -70 })), null);
});

test('contact particles expire, release resources and never mutate shot or player state', () => {
  const effects = new FpsImpacts(), hit = shot({ x: -14, y: 1, z: -9 }, 'b');
  const before = structuredClone(hit); effects.emit(hit, 'body');
  const points = effects.root.children[0] as import('three').Points;
  assert.equal(points.geometry.getAttribute('position').count, 8);
  assert.equal((points.material as import('three').PointsMaterial).depthTest, true);
  let geometryDisposed = false, materialDisposed = false;
  points.geometry.addEventListener('dispose', () => { geometryDisposed = true; });
  (points.material as import('three').PointsMaterial).addEventListener('dispose', () => { materialDisposed = true; });
  effects.update(.1); assert.equal(effects.root.children.length, 1);
  effects.update(.2); assert.equal(effects.root.children.length, 0);
  assert.ok(geometryDisposed && materialDisposed); assert.deepEqual(hit, before);
});

test('sustained fire has bounded particle resources and round/leave cleanup is immediate', () => {
  const effects = new FpsImpacts();
  for (let i = 0; i < 100; i++) effects.emit(shot({ x: -4, y: 1, z: -3 }), 'metal');
  assert.equal(effects.root.children.length, 12);
  effects.clear(); assert.equal(effects.root.children.length, 0);
  effects.emit(shot({ x: -14, y: 1.57, z: -9 }, 'b', true), 'head');
  assert.equal((effects.root.children[0] as import('three').Points).geometry.getAttribute('position').count, 12);
  effects.update(.3); assert.equal(effects.root.children.length, 0);
});
