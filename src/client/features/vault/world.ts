import * as THREE from 'three';
import { FLOOR, SAFE } from '../../../shared/layout';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

// The safe against the east wall: a squat steel strongbox on little feet, its door with a combination
// dial, a three-spoke handle and two big hinges, and a brass ".env" plate. While someone has it open
// the door swings ajar and the dial spins.

const STEEL = '#3d5a80';
const STEEL_DARK = '#293f5e';
const BRASS = '#e9b949';
const INK = '#2b2d42';

export interface Safe {
  group: THREE.Group;
  collider: Collider;
  interactable: Interactable;
  /** Swings the door ajar (and spins the dial on the way) or shut again. */
  open(on: boolean): void;
  update(dt: number): void;
}

export function buildSafe(): Safe {
  const { width: W, depth: D, height: H } = SAFE;
  const steel = toon(STEEL);
  const dark = toon(STEEL_DARK);
  const brass = toon(BRASS);
  const ink = toon(INK);
  const FEET = 0.08;

  // Built facing +z, back against z = -D/2.
  const group = new THREE.Group();
  // A hollow steel box: walls all round, a dark inside, and a shelf with gold bars and a key on it.
  const T = 0.07;
  const bodyH = H - FEET;
  const mid = FEET + bodyH / 2;
  group.add(mesh(roundedBox(W, bodyH, T, 0.03), steel, 0, mid, -D / 2 + T / 2));
  for (const sx of [-1, 1]) group.add(mesh(roundedBox(T, bodyH, D, 0.03), steel, sx * (W / 2 - T / 2), mid, 0));
  for (const y of [FEET + T / 2, H - T / 2]) group.add(mesh(roundedBox(W, T, D, 0.03), steel, 0, y, 0));
  const inside = toon('#1b2638');
  group.add(mesh(new THREE.PlaneGeometry(W - 2 * T, bodyH - 2 * T), inside, 0, mid, -D / 2 + T + 0.002, false));
  const shelfY = FEET + T + (bodyH - 2 * T) * 0.45;
  group.add(mesh(new THREE.BoxGeometry(W - 2 * T, 0.025, D - T - 0.08), dark, 0, shelfY, -0.04, false));
  for (const [x, y] of [[-0.14, 0], [0, 0], [-0.07, 1]] as const) {
    group.add(mesh(new THREE.BoxGeometry(0.13, 0.05, 0.2).translate(0, 0.025, 0), brass, x, shelfY + 0.0125 + y * 0.05, -0.08, false));
  }
  const key = new THREE.Group();
  key.add(mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 14), brass, 0, 0, 0, false));
  key.add(mesh(new THREE.BoxGeometry(0.11, 0.016, 0.016), brass, 0.09, 0, 0, false));
  key.add(mesh(new THREE.BoxGeometry(0.016, 0.035, 0.016), brass, 0.13, -0.02, 0, false));
  key.rotation.x = -Math.PI / 2;
  key.position.set(0.12, FEET + T + 0.01, 0.02);
  group.add(key);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) group.add(mesh(new THREE.BoxGeometry(0.09, FEET, 0.09), ink, sx * (W / 2 - 0.1), FEET / 2, sz * (D / 2 - 0.1)));

  // The door hangs on hinges at its left edge (as you face it), so it swings open from there.
  const front = D / 2;
  const doorW = W - 0.14;
  const doorH = H - FEET - 0.14;
  const hinge = new THREE.Group();
  hinge.position.set(-doorW / 2, FEET + 0.07 + doorH / 2, front);
  group.add(hinge);
  const door = new THREE.Group();
  door.position.x = doorW / 2;
  hinge.add(door);
  door.add(mesh(roundedBox(doorW, doorH, 0.06, 0.04), dark, 0, 0, 0.02));
  door.add(mesh(roundedBox(doorW - 0.1, doorH - 0.1, 0.02, 0.02), steel, 0, 0, 0.06, false));
  // The dial: a brass ring round a dark face, with a notch to read the number by.
  const dial = new THREE.Group();
  dial.position.set(-0.08, 0.1, 0.07);
  door.add(dial);
  dial.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 28).rotateX(Math.PI / 2), brass, 0, 0, 0, false));
  dial.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 24).rotateX(Math.PI / 2), ink, 0, 0, 0.005, false));
  dial.add(mesh(new THREE.BoxGeometry(0.018, 0.06, 0.02), brass, 0, 0.065, 0.03, false));
  dial.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12).rotateX(Math.PI / 2), brass, 0, 0, 0.03, false));
  // The handle: three spokes round a hub, beside the dial.
  const handle = new THREE.Group();
  handle.position.set(0.17, -0.12, 0.08);
  door.add(handle);
  handle.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12).rotateX(Math.PI / 2), brass, 0, 0, 0, false));
  for (let i = 0; i < 3; i++) {
    const spoke = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 6), brass, 0, 0, 0.02, false);
    spoke.geometry.translate(0, 0.065, 0);
    spoke.rotation.z = (i * Math.PI * 2) / 3;
    handle.add(spoke);
    const knob = mesh(new THREE.SphereGeometry(0.022, 8, 6), brass, -Math.sin(spoke.rotation.z) * 0.13, Math.cos(spoke.rotation.z) * 0.13, 0.02, false);
    handle.add(knob);
  }
  for (const sy of [-1, 1]) hinge.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 10), ink, -0.01, sy * doorH * 0.32, 0.04, false));
  // The brass plate across the top of the door.
  const plate = textPlane('🔐 .env', { bg: '#f6d06b', size: 40 });
  plate.scale.multiplyScalar(0.42);
  plate.position.set(0, doorH / 2 - 0.12, 0.075);
  door.add(plate);

  // Against the east wall, facing into the room (-x).
  const placed = new THREE.Group();
  placed.add(group);
  placed.position.set(SAFE.x, 0, SAFE.z);
  placed.rotation.y = -Math.PI / 2;
  const collider: Collider = { minX: SAFE.x - D / 2 - 0.03, maxX: FLOOR.maxX, minZ: SAFE.z - W / 2 - 0.03, maxZ: SAFE.z + W / 2 + 0.03, top: H };
  const interactable: Interactable = { kind: 'vault', x: SAFE.x - 1.2, z: SAFE.z, radius: 1.5 };
  placed.userData.interact = interactable;

  let ajar = 0;
  let want = 0;
  let spin = 0;
  return {
    group: placed,
    collider,
    interactable,
    open(on) {
      want = on ? 1 : 0;
      if (on) spin = Math.PI * 3;
    },
    update(dt) {
      // The dial turns first, then the door swings; shutting, it just swings to.
      if (spin > 0) {
        const step = Math.min(spin, dt * Math.PI * 4);
        spin -= step;
        dial.rotation.z += step;
        handle.rotation.z = spin > 0 ? handle.rotation.z : Math.min(handle.rotation.z + dt * 4, Math.PI / 3);
      }
      const target = spin > 0 ? 0 : want;
      ajar += (target - ajar) * Math.min(1, dt * 5);
      if (!want && ajar < 0.01) handle.rotation.z = 0;
      hinge.rotation.y = -ajar * 1.1;
    },
  };
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The safe the floor's .env is kept in. */
    safe: Safe;
  }
}

/** The safe, on the floor against the east wall between the Services board and the TV. */
export const safe: Fixture<'safe'> = (site) => {
  const built = buildSafe();
  site.wall('east', SAFE.z, SAFE.height / 2, SAFE.width + 0.1, SAFE.height);
  return { group: built.group, colliders: [built.collider], interactables: [built.interactable], update: (_t, dt) => built.update(dt), handle: { safe: built } };
};
