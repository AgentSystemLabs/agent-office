import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { activateWorld, applyGraphicsPerformance, type GraphicsTarget } from '../src/client/core/graphics';
import { PERFORMANCE_PRESETS } from '../src/client/shared/performance';

function graphics(scene: THREE.Scene): GraphicsTarget {
  return {
    renderer: { setPixelRatio: () => {}, shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false, type: THREE.PCFShadowMap, render: () => {} } },
    effect: { enabled: true }, scene,
  };
}

test('live graphics quality releases old shadow targets and disabling shadows leaves no allocation', (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 2 } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'window', previous) : Reflect.deleteProperty(globalThis, 'window'));
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight();
  scene.add(sun);
  const target = graphics(scene);
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.map = new THREE.WebGLRenderTarget(2048, 2048);
  sun.shadow.mapPass = new THREE.WebGLRenderTarget(2048, 2048);
  let released = 0;
  sun.shadow.map.addEventListener('dispose', () => released++);
  sun.shadow.mapPass.addEventListener('dispose', () => released++);
  applyGraphicsPerformance(target, PERFORMANCE_PRESETS.economy);
  assert.equal(released, 2);
  assert.equal(sun.shadow.map, null);
  assert.equal(sun.shadow.mapPass, null);
  assert.equal(sun.shadow.mapSize.x, 512);
  assert.equal(target.effect.enabled, false);
  assert.equal(target.renderer.shadowMap.enabled, true);
  sun.shadow.map = new THREE.WebGLRenderTarget(512, 512);
  sun.shadow.map.addEventListener('dispose', () => released++);
  applyGraphicsPerformance(target, { ...PERFORMANCE_PRESETS.economy, shadowSize: 0 });
  assert.equal(released, 3);
  assert.equal(sun.shadow.map, null);
  assert.equal(target.renderer.shadowMap.enabled, false);
});

test('cached worlds leave active traversal and rejoin with their own resources intact', () => {
  const scene = new THREE.Scene();
  const office = new THREE.Group();
  const castle = new THREE.Group();
  const cached = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  castle.add(cached);
  scene.add(office);
  activateWorld(scene, office, castle);
  assert.equal(office.parent, null);
  activateWorld(scene, castle, office);
  const traversed: THREE.Object3D[] = [];
  scene.traverse((object) => traversed.push(object));
  assert.equal(traversed.includes(cached), false);
  activateWorld(scene, office, castle);
  assert.equal(castle.children[0], cached);
  assert.equal(castle.parent, scene);
  cached.geometry.dispose();
  cached.material.dispose();
});
