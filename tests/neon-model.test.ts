import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Neon, neonLight } from '../src/client/world/neon.js';

/** Lights and a fog set the way world/sky.ts sets them each frame. */
function parts() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#bfe3ff', 20, 160);
  scene.background = new THREE.Color('#bfe3ff');
  const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
  const hemi = new THREE.HemisphereLight('#fff5e6', '#c9a27a', 1.5);
  const ambient = new THREE.AmbientLight('#ffffff', 0.5);
  return { scene, sun, hemi, ambient };
}

test('fade 0 leaves the sky’s work exactly as it was', () => {
  const p = parts();
  neonLight(0, p);
  assert.equal(p.hemi.color.getHexString(), new THREE.Color('#fff5e6').getHexString());
  assert.equal(p.sun.intensity, 2.2);
  assert.equal((p.scene.fog as THREE.Fog).color.getHexString(), new THREE.Color('#bfe3ff').getHexString());
});

test('fade 1 makes a neon dusk: violet light, dimmed sun, magenta haze', () => {
  const p = parts();
  neonLight(1, p);
  assert.notEqual(p.hemi.color.getHexString(), new THREE.Color('#fff5e6').getHexString());
  assert.ok(p.sun.intensity < 1.5, `sun dimmed, got ${p.sun.intensity}`);
  assert.notEqual((p.scene.fog as THREE.Fog).color.getHexString(), new THREE.Color('#bfe3ff').getHexString());
});

test('the group is built once, and set() never forces it visible', () => {
  const neon = new Neon(false); // no canvas in node: no signs
  assert.equal(neon.group.visible, false);
  assert.ok(neon.group.children.length > 0);
  neon.set('neon');
  assert.equal(neon.group.visible, false, 'visibility belongs to the place wiring (roof/castle stay clean)');
  neon.set('halloween');
  neon.set(null);
});
