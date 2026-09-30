import * as THREE from 'three';
import { GONG } from '../../../shared/layout';
import { mesh, roundedBox, textPlane, toon, toonUnique } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { boxFootprint } from '../../../shared/maps/props';

// The gong: a brass disc hung in a red lacquered frame, next to the PR board. It rings when a pull
// request merges, and anyone can walk up and hit it.

const BRASS = '#e9b949';
const LACQUER = '#b23a48';
const INK = '#2b2d42';

export interface Gong {
  group: THREE.Group;
  colliders: Collider[];
  /** Walk up and press E. */
  interactable: Interactable;
  /** Swings the disc and flashes it; `strength` 1 is a good whack. */
  strike(strength?: number): void;
  /** Where confetti bursts from when there's no desk to burst over: just above the frame. */
  readonly top: THREE.Vector3;
  update(dt: number): void;
}

/** The gong, where the office has it, or at (x, z) facing `rotY` (0 is +z, the office's way), on a floor `y` up. */
export function buildGong(at: { x: number; y?: number; z: number; rotY?: number } = GONG): Gong {
  const { width, height } = GONG;
  const { x, z } = at;
  const y = at.y ?? 0;
  const rotY = at.rotY ?? 0;
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rotY;
  const lacquer = toon(LACQUER);
  const ink = toon(INK);
  const half = width / 2;

  // The frame: two posts on feet, a beam across the top with its ends turned up, a rail below it.
  for (const sx of [-half, half]) {
    group.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, height, 10), lacquer, sx, height / 2, 0));
    group.add(mesh(roundedBox(0.2, 0.12, 0.6, 0.04), ink, sx, 0.06, 0));
    group.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), toon(BRASS), sx, height + 0.08, 0, false));
  }
  group.add(mesh(roundedBox(width + 0.5, 0.16, 0.18, 0.05), lacquer, 0, height - 0.08, 0));
  for (const sx of [-1, 1]) {
    const tip = mesh(roundedBox(0.3, 0.1, 0.18, 0.04), lacquer, sx * (half + 0.33), height + 0.02, 0, false);
    tip.rotation.z = sx * 0.45;
    group.add(tip);
  }
  group.add(mesh(new THREE.BoxGeometry(width, 0.07, 0.08), ink, 0, height - 0.32, 0, false));
  const plaque = textPlane('🎉 Merge gong', { bg: '#fffaf3', size: 48 });
  plaque.scale.multiplyScalar(0.5);
  plaque.position.set(0, height - 0.08, 0.1);
  group.add(plaque);

  // The disc hangs on two cords from a pivot under the beam, so it can swing when it's hit.
  const pivot = new THREE.Group();
  pivot.position.y = height - 0.34;
  group.add(pivot);
  const R = 0.62;
  const drop = 1.02;
  const brass = toonUnique(BRASS);
  brass.emissive = new THREE.Color('#ffb703');
  brass.emissiveIntensity = 0;
  const disc = new THREE.Group();
  disc.position.y = -drop;
  pivot.add(disc);
  disc.add(mesh(new THREE.CylinderGeometry(R, R, 0.05, 40).rotateX(Math.PI / 2), brass, 0, 0, 0));
  disc.add(mesh(new THREE.TorusGeometry(R, 0.04, 8, 40), brass, 0, 0, 0, false));
  disc.add(mesh(new THREE.TorusGeometry(R * 0.55, 0.018, 6, 32), toon('#c9952c'), 0, 0, 0.03, false));
  const boss = mesh(new THREE.SphereGeometry(0.16, 16, 12), brass, 0, 0, 0.02, false);
  boss.scale.z = 0.45;
  disc.add(boss);
  for (const sx of [-1, 1]) {
    const cord = mesh(new THREE.CylinderGeometry(0.012, 0.012, drop - R + 0.08, 5), ink, sx * 0.22, -(drop - R) / 2, 0, false);
    cord.rotation.z = sx * 0.2;
    pivot.add(cord);
  }

  // The mallet leans against the right post.
  const mallet = new THREE.Group();
  mallet.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6), toon('#8a5a3b'), 0, 0.45, 0, false));
  mallet.add(mesh(new THREE.SphereGeometry(0.1, 12, 10), toon('#ef476f'), 0, 0.92, 0, false));
  mallet.position.set(half + 0.18, 0, 0.12);
  mallet.rotation.z = 0.22;
  group.add(mallet);

  // A ring of sound spreading out from the disc when it's struck.
  const waveMat = new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const wave = new THREE.Mesh(new THREE.RingGeometry(R * 0.95, R * 1.08, 40), waveMat);
  wave.position.set(0, pivot.position.y - drop, 0.08);
  wave.visible = false;
  group.add(wave);

  const [minX, maxX, minZ, maxZ] = rotY ? boxFootprint(x, z, width + 0.42, 0.6, rotY) : [x - half - 0.12, x + half + 0.3, z - 0.3, z + 0.3];
  const colliders: Collider[] = [{ minX, maxX, minZ, maxZ, top: y + height + 0.1, ...(y ? { bottom: y } : {}) }];
  const ahead = { x: Math.sin(rotY), z: Math.cos(rotY) };
  const interactable: Interactable = { kind: 'gong', x: x + ahead.x * 1.3, ...(y ? { y } : {}), z: z + ahead.z * 1.3, radius: 1.5 };
  group.userData.interact = interactable;

  let swing = 0;
  let phase = 0;
  let glow = 0;
  let waveT = Infinity;
  let waveSize = 1;

  return {
    group,
    colliders,
    interactable,
    top: new THREE.Vector3(x + ahead.x * 0.3, y + height + 0.4, z + ahead.z * 0.3),
    strike(strength = 1) {
      // Hit from the front, it swings back towards the wall first.
      swing = Math.min(0.3, swing * 0.5 + 0.16 * strength);
      phase = 0;
      glow = Math.min(1, 0.6 + 0.3 * strength);
      waveT = 0;
      waveSize = 1 + strength;
    },
    update(dt) {
      if (swing > 0.001) {
        phase += dt * Math.PI * 2 * 0.85;
        swing *= Math.exp(-dt * 0.9);
        pivot.rotation.x = swing * Math.sin(phase);
        disc.rotation.z = swing * 0.35 * Math.sin(phase * 1.6);
        // The metal shivers while it rings.
        disc.position.z = Math.sin(phase * 40) * 0.012 * glow;
      } else if (swing) {
        swing = 0;
        pivot.rotation.x = 0;
        disc.rotation.z = 0;
        disc.position.z = 0;
      }
      glow *= Math.exp(-dt * 2.5);
      brass.emissiveIntensity = glow * 0.55;
      waveT += dt;
      wave.visible = waveT < 0.9;
      if (wave.visible) {
        wave.scale.setScalar(1 + waveT * 2.2 * waveSize);
        waveMat.opacity = 0.55 * (1 - waveT / 0.9);
      }
    },
  };
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The merge gong by the PR board. */
    gong: Gong;
  }
}

/** The gong, just past the elevator from the PR board. */
export const gong: Fixture<'gong'> = (site) => {
  const built = buildGong();
  site.wall('north', GONG.x, (GONG.height + 0.3) / 2, GONG.width + 1.2, GONG.height + 0.3);
  return { group: built.group, colliders: built.colliders, interactables: [built.interactable], update: (_t, dt) => built.update(dt), handle: { gong: built } };
};
