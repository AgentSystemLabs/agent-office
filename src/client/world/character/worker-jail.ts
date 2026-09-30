import * as THREE from 'three';
import { mesh, toon } from '../toon';
import type { WorkerRig } from './rig';

// A worker locked up in a dungeon's cell (see Worker.setJailed): starving, then dead, then its bones.

/** What a worker's skin goes toward as it starves in a cell, and once it's dead. */
export const STARVED = new THREE.Color('#cfc7b2');
export const DEAD = new THREE.Color('#7d8a6a');
const BONE = toon('#e9e1c9');
const SOCKET = toon('#241c16');

/**
 * What's left of a worker that has rotted away in a cell: a skull, a spine and ribs, a pelvis, and
 * the bones of its arms and feet, the size of the bean it was, in its body's space (forward is +z).
 */
export function bones(): THREE.Group {
  const g = new THREE.Group();
  const bone = (a: [number, number, number], b: [number, number, number], r = 0.022) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const along = vb.clone().sub(va);
    const m = mesh(new THREE.CapsuleGeometry(r, along.length(), 3, 6), BONE, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize());
    g.add(m);
    for (const end of [va, vb]) g.add(mesh(new THREE.SphereGeometry(r * 1.7, 6, 5), BONE, end.x, end.y, end.z, false));
  };
  // The skull, its sockets and its grin.
  const skull = mesh(new THREE.SphereGeometry(0.15, 14, 12), BONE, 0, 0.74, 0.02);
  skull.scale.set(1, 1.05, 0.95);
  g.add(skull);
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.042, 8, 6), SOCKET, sx * 0.06, 0.76, 0.14, false));
  g.add(mesh(new THREE.ConeGeometry(0.018, 0.04, 3), SOCKET, 0, 0.7, 0.155, false));
  const jaw = mesh(new THREE.BoxGeometry(0.16, 0.05, 0.12), BONE, 0, 0.6, 0.05);
  g.add(jaw);
  for (let i = 0; i < 5; i++) g.add(mesh(new THREE.BoxGeometry(0.018, 0.03, 0.01), SOCKET, -0.05 + i * 0.025, 0.635, 0.113, false));
  // The spine, the ribs round it, and the pelvis at the bottom.
  bone([0, 0.2, -0.06], [0, 0.6, -0.04], 0.022);
  for (let i = 0; i < 4; i++) {
    const rib = mesh(new THREE.TorusGeometry(0.12 - i * 0.012, 0.014, 5, 14, Math.PI * 1.35), BONE, 0, 0.52 - i * 0.065, 0.0);
    rib.rotation.set(Math.PI / 2, 0, -Math.PI * 0.175 + Math.PI / 2);
    g.add(rib);
  }
  const pelvis = mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 12), BONE, 0, 0.2, 0);
  pelvis.rotation.x = Math.PI / 2.4;
  g.add(pelvis);
  // Arms hanging, and the feet stuck out in front.
  for (const sx of [-1, 1]) {
    bone([sx * 0.16, 0.55, 0], [sx * 0.26, 0.4, 0.06]);
    bone([sx * 0.26, 0.4, 0.06], [sx * 0.24, 0.26, 0.16]);
    bone([sx * 0.07, 0.18, 0.02], [sx * 0.12, 0.12, 0.24], 0.026);
  }
  g.visible = false;
  return g;
}

/** How far gone a worker locked in a cell is (see Worker.setJailed). */
export interface Jailed {
  thin: number;
  dead: boolean;
  rot: number;
}

/**
 * Sat slumped against the wall of its cell, breathing slow, or keeled over the way it `fell` and
 * rotting, with its `skeleton` showing through. `phase` keeps a cell full of them out of step.
 */
export function slump(rig: WorkerRig, k: Jailed, skeleton: THREE.Group | null, fell: number, phase: number, t: number) {
  const { thin, dead, rot } = k;
  const girth = 1 - 0.48 * thin;
  // What's left of its flesh as it rots, shrinking away off its bones.
  const flesh = dead ? Math.max(0.02, 1 - 0.95 * rot) : 1;
  rig.body.visible = flesh > 0.08;
  const breath = dead ? 0 : Math.sin(t * 1.1 + phase) * 0.025 * (1 - 0.5 * thin);
  rig.body.scale.set(girth * flesh, (1 + breath) * (dead ? 0.35 + 0.65 * flesh : 1), girth * flesh);
  rig.feet.forEach((f, i) => f.position.set(i ? 0.13 : -0.13, 0.12, 0.2));
  if (dead) {
    // On its side on the straw, where it fell.
    const lie = fell * 1.4;
    rig.body.rotation.set(0.1, 0, lie);
    rig.body.position.set(fell * -0.04, 0.3 * girth * flesh - 0.06, 0);
    rig.armL.rotation.set(-0.4, 0, -0.3);
    rig.armR.rotation.set(-0.2, 0, 0.5);
  } else {
    // Sat against the wall, head hung, arms limp in its lap, swaying a little now and then.
    rig.body.rotation.set(0.18 + 0.32 * thin + Math.sin(t * 0.37 + phase) * 0.03, 0, Math.sin(t * 0.23 + phase) * 0.05);
    rig.body.position.set(0, -0.08, 0);
    rig.armL.rotation.set(-0.35, 0, -0.12);
    rig.armR.rotation.set(-0.35, 0, 0.12);
    for (const p of rig.pupils) p.position.y = 0.66 - 0.02 * thin;
  }
  if (skeleton) {
    skeleton.visible = dead && rot > 0.2;
    skeleton.position.copy(rig.body.position);
    skeleton.rotation.copy(rig.body.rotation);
  }
}

/** X for eyes, once it's dead: a cross over each, on its `body`. */
export function crossedEyes(body: THREE.Object3D): THREE.Mesh[] {
  const crosses: THREE.Mesh[] = [];
  const ink = toon('#1d1d1d');
  for (const sx of [-1, 1]) {
    for (const r of [-1, 1]) {
      const bar = mesh(new THREE.CapsuleGeometry(0.014, 0.1, 4, 6), ink, sx * 0.11, 0.7, 0.25, false);
      bar.rotation.z = r * 0.8;
      body.add(bar);
      crosses.push(bar);
    }
  }
  return crosses;
}
