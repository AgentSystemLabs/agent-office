import * as THREE from 'three';
import { SAFE } from '../../../shared/layout';
import { boxFootprint } from '../../../shared/maps/props';
import { mesh, roundedBox, textPlane, toon, toonUnique } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

// The vault's safe: a squat green strongbox with a brass dial and a spoked handle. E at it opens the
// vault (ui/vault.ts): the dial spins, the door swings open on a glow of gold bars and a big brass
// key, and it shuts again when the window closes.

const BODY = '#2f5d50';
const BRASS = '#e9b949';
const INK = '#2b2d42';

/** How long the dial spins before the door moves, in seconds. */
const DIAL_S = 0.45;
/** How far the door swings open: a little past square. */
const OPEN_ANGLE = 1.85;

export interface Safe {
  group: THREE.Group;
  colliders: Collider[];
  /** Walk up and press E. */
  interactable: Interactable;
  /** Where its door is, for the clunk. */
  readonly at: { x: number; y: number; z: number };
  /** Starts it opening or shutting. */
  open(on: boolean): void;
  /** Moves it on; false once it's come to rest. */
  update(dt: number): boolean;
}

/** Each safe by what you use it as, so pressing E at one can open that one (see features/vault). */
const byInteractable = new WeakMap<Interactable, Safe>();
export const safeOf = (it: Interactable): Safe | undefined => byInteractable.get(it);

/** The safe, where the office has it, or at (x, z) facing `rotY` (0 is +z), on a floor `y` up. */
export function buildSafe(at: { x: number; y?: number; z: number; rotY?: number } = { ...SAFE, rotY: Math.PI }): Safe {
  const { width: w, depth: d, height: h } = SAFE;
  const { x, z } = at;
  const y = at.y ?? 0;
  const rotY = at.rotY ?? 0;
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rotY;
  const body = toon(BODY);
  const brass = toon(BRASS);
  const ink = toon(INK);
  const foot = 0.06;
  const wall = 0.07;
  const top = foot + h - 0.04;

  // Four stubby feet, and a box open at the front: back, sides, top and bottom.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) group.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, foot, 8), ink, (sx * (w - 0.16)) / 2, foot / 2, (sz * (d - 0.16)) / 2));
  group.add(mesh(roundedBox(w, h - 0.04, wall, 0.03), body, 0, foot + (h - 0.04) / 2, -d / 2 + wall / 2));
  for (const sx of [-1, 1]) group.add(mesh(roundedBox(wall, h - 0.04, d, 0.03), body, (sx * (w - wall)) / 2, foot + (h - 0.04) / 2, 0));
  group.add(mesh(roundedBox(w, wall, d, 0.03), body, 0, top - wall / 2, 0));
  group.add(mesh(roundedBox(w, wall, d, 0.03), body, 0, foot + wall / 2, 0));
  // A brass band round the top.
  group.add(mesh(new THREE.BoxGeometry(w + 0.01, 0.035, d + 0.01), brass, 0, top - 0.09, 0, false));

  // Inside: dark, a shelf, gold bars below it and a big brass key on it, lit while it's open.
  const inW = w - 2 * wall;
  const inH = h - 0.04 - 2 * wall;
  const midY = foot + wall + inH / 2;
  // Its back wall warms up while it's open, as if the gold lit it (a light of its own would cost every floor a shader).
  const back = toonUnique('#1d2a26');
  back.emissive = new THREE.Color('#ffb347');
  back.emissiveIntensity = 0;
  group.add(mesh(new THREE.BoxGeometry(inW, inH, 0.01), back, 0, midY, -d / 2 + wall + 0.005, false));
  group.add(mesh(new THREE.BoxGeometry(inW, 0.025, d - wall - 0.08), body, 0, midY + 0.02, 0.0, false));
  const gold = toonUnique('#ffcf4a');
  gold.emissive = new THREE.Color('#ffb703');
  gold.emissiveIntensity = 0;
  const bar = new THREE.CylinderGeometry(0.06, 0.08, 0.2, 4, 1).rotateY(Math.PI / 4).rotateZ(Math.PI / 2);
  for (const [bx, by] of [[-0.13, 0], [0.09, 0], [-0.02, 0.07]] as const) {
    const b = mesh(bar, gold, bx, foot + wall + 0.05 + by, 0.02, false);
    b.scale.set(1, 0.55, 1);
    group.add(b);
  }
  const key = new THREE.Group();
  key.add(mesh(new THREE.TorusGeometry(0.05, 0.016, 8, 18), gold, -0.1, 0, 0, false));
  key.add(mesh(new THREE.BoxGeometry(0.2, 0.025, 0.025), gold, 0.03, 0, 0, false));
  for (const kx of [0.08, 0.12]) key.add(mesh(new THREE.BoxGeometry(0.02, 0.05, 0.025), gold, kx, -0.03, 0, false));
  key.position.set(0, midY + 0.08, 0.02);
  key.rotation.x = -0.35;
  group.add(key);

  // The door, hung on its left (as you face it), with the dial, the handle, hinges and a plate.
  const hinge = new THREE.Group();
  hinge.position.set(-w / 2 + 0.02, 0, d / 2 + 0.005);
  group.add(hinge);
  const doorW = w - 0.04;
  const doorH = h - 0.08;
  const door = new THREE.Group();
  door.position.set(doorW / 2, foot + (h - 0.04) / 2, 0.03);
  hinge.add(door);
  door.add(mesh(roundedBox(doorW, doorH, 0.06, 0.03), body, 0, 0, 0));
  door.add(mesh(new THREE.BoxGeometry(doorW - 0.14, doorH - 0.14, 0.01), toon('#386b5d'), 0, 0, 0.032, false));
  for (const hy of [-0.28, 0.28]) door.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8), brass, -doorW / 2, hy, 0.02, false));
  const dial = new THREE.Group();
  dial.position.set(-0.08, 0.06, 0.04);
  door.add(dial);
  dial.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.025, 28).rotateX(Math.PI / 2), brass, 0, 0, 0, false));
  dial.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 24).rotateX(Math.PI / 2), ink, 0, 0, 0.004, false));
  for (let i = 0; i < 12; i++) {
    const tick = mesh(new THREE.BoxGeometry(0.008, i % 3 ? 0.014 : 0.026, 0.006), brass, 0, 0, 0.021, false);
    tick.position.x = Math.sin((i / 12) * Math.PI * 2) * 0.058;
    tick.position.y = Math.cos((i / 12) * Math.PI * 2) * 0.058;
    tick.rotation.z = -(i / 12) * Math.PI * 2;
    dial.add(tick);
  }
  dial.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.04, 10).rotateX(Math.PI / 2), brass, 0, 0, 0.02, false));
  const handle = new THREE.Group();
  handle.position.set(0.22, 0.06, 0.04);
  door.add(handle);
  handle.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 10).rotateX(Math.PI / 2), brass, 0, 0, 0.01, false));
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Group();
    spoke.rotation.z = (i / 3) * Math.PI * 2;
    spoke.add(mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.11, 6), brass, 0, 0.065, 0.03, false));
    spoke.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), brass, 0, 0.12, 0.03, false));
    handle.add(spoke);
  }
  const plate = textPlane('🗝️ Vault', { bg: '#fffaf3', size: 44 });
  plate.scale.multiplyScalar(0.32);
  plate.position.set(0, doorH / 2 - 0.13, 0.04);
  door.add(plate);

  const [minX, maxX, minZ, maxZ] = boxFootprint(x, z, w + 0.04, d + 0.04, rotY);
  const colliders: Collider[] = [{ minX, maxX, minZ, maxZ, top: y + foot + h, ...(y ? { bottom: y } : {}) }];
  const ahead = { x: Math.sin(rotY), z: Math.cos(rotY) };
  const interactable: Interactable = { kind: 'safe', x: x + ahead.x * 1.1, ...(y ? { y } : {}), z: z + ahead.z * 1.1, radius: 1.3 };
  group.userData.interact = interactable;

  let want = 0;
  let swing = 0;
  /** Seconds of dial spinning left before the door moves. */
  let spin = 0;
  const safe: Safe = {
    group,
    colliders,
    interactable,
    at: { x: x + ahead.x * (d / 2), y: y + foot + h / 2, z: z + ahead.z * (d / 2) },
    open(on) {
      want = on ? 1 : 0;
      // Opening, the combination goes in first; shutting, the bolts are thrown after.
      if (on && swing === 0) spin = DIAL_S;
    },
    update(dt) {
      if (spin > 0) {
        spin = Math.max(0, spin - dt);
        dial.rotation.z += dt * (spin > DIAL_S / 2 ? 9 : -7);
        handle.rotation.z = 0;
        return true;
      }
      if (swing !== want) {
        swing = want > swing ? Math.min(1, swing + dt * 1.6) : Math.max(0, swing - dt * 2.2);
        // Eased, so it heaves open and thuds shut.
        const e = swing * swing * (3 - 2 * swing);
        hinge.rotation.y = -e * OPEN_ANGLE;
        handle.rotation.z = Math.min(1, swing * 4) * -0.9;
        gold.emissiveIntensity = e * 0.45;
        back.emissiveIntensity = e * 0.25;
        if (swing === want && !want) dial.rotation.z = 0;
        return true;
      }
      return false;
    },
  };
  byInteractable.set(interactable, safe);
  return safe;
}

/** The safe, under the window between the balcony doors and the stairs. */
export const safe: Fixture = (site) => {
  const built = buildSafe();
  site.wall('south', SAFE.x, (SAFE.height + 0.1) / 2, SAFE.width + 0.2, SAFE.height + 0.1);
  return { group: built.group, colliders: built.colliders, interactables: [built.interactable] };
};
