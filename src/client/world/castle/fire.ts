import * as THREE from 'three';
import { glowTexture } from '../costumes';
import { MAX_LIGHTS, type Kit } from './kit';

// Fire: the flames on every torch, brazier, candle and hearth (they flicker in buildCastle's update),
// and the few real lights among them.

/** Every flame's cones: the same two shapes, scaled. */
const FLAME_OUTER = new THREE.ConeGeometry(0.45, 1, 8).translate(0, 0.5, 0);
const FLAME_INNER = new THREE.ConeGeometry(0.25, 0.7, 8).translate(0, 0.35, 0);
const FLAME_OUT = new THREE.MeshBasicMaterial({ color: '#ff8c2a', toneMapped: false });
const FLAME_IN = new THREE.MeshBasicMaterial({ color: '#ffe38a', toneMapped: false });
FLAME_OUT.userData.outlineParameters = { visible: false };
FLAME_IN.userData.outlineParameters = { visible: false };

/** A licking flame `size` tall at (x, y, z) in `parent`, with a warm glow round it. */
export function flame(kit: Kit, parent: THREE.Object3D, x: number, y: number, z: number, size: number): void {
  const f = new THREE.Group();
  f.position.set(x, y, z);
  const outer = new THREE.Mesh(FLAME_OUTER, FLAME_OUT);
  const inner = new THREE.Mesh(FLAME_INNER, FLAME_IN);
  inner.position.y = 0.02;
  f.add(outer, inner);
  f.scale.setScalar(size);
  parent.add(f);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb45a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(x, y + size * 0.45, z);
  glow.scale.setScalar(size * 5);
  parent.add(glow);
  kit.flames.push({ mesh: f, glow, size, phase: Math.random() * 10 });
}

/** A real light at (x, y, z) (in `parent`), while there are few enough of them. */
export function fireLight(kit: Kit, parent: THREE.Object3D, x: number, y: number, z: number, power: number) {
  if (kit.lights.length >= MAX_LIGHTS) return;
  const light = new THREE.PointLight('#ffae5c', power, 22, 1.6);
  light.position.set(x, y, z);
  parent.add(light);
  kit.lights.push({ light, base: power, phase: Math.random() * 10 });
}
