import * as THREE from 'three';
import { THRONE_SIZE, type MapPlan } from '../../../shared/maps';
import type { Interactable } from '../types';
import { mergeByMaterial, mesh, roundedBox, toon } from '../toon';
import { collide, type Kit, type Mats } from './kit';
import { box } from './shapes';
import { seeded } from './textures';

// The throne of iron blades, and the dais it stands on.

/** A sword, point up, `len` long from its guard to its tip, its hilt below the guard. */
const BLADE = toon('#7f8791');
const RUST = toon('#6f5a4e');

function sword(g: THREE.Group, len: number, mats: Mats, rust: boolean) {
  const steel = rust ? RUST : BLADE;
  g.add(mesh(box(0.075, len, 0.016), steel, 0, len / 2, 0, false));
  g.add(mesh(new THREE.ConeGeometry(0.053, 0.13, 4).rotateY(Math.PI / 4).scale(1, 1, 0.25), steel, 0, len + 0.065, 0, false));
  g.add(mesh(box(0.3, 0.04, 0.045), mats.iron, 0, 0, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.18, 5), mats.iron, 0, -0.1, 0, false));
  g.add(mesh(new THREE.SphereGeometry(0.035, 6, 5), mats.iron, 0, -0.2, 0, false));
}

/**
 * The throne of iron blades: an iron seat and back, and hundreds of swords (well, a couple of
 * hundred) welded round it, fanning out behind in a jagged crown, bristling from the arms and
 * spilling off the base. Faces +z; its seat is `seatY` up.
 */
function ironThrone(mats: Mats): THREE.Group {
  const g = new THREE.Group();
  const rand = seeded(1234);
  const { iron, velvet } = mats;
  g.add(mesh(box(1.9, 0.36, 1.7), iron, 0, 0.18, -0.1));
  g.add(mesh(box(1.3, 0.32, 1.1), iron, 0, 0.52, 0));
  g.add(mesh(roundedBox(1.08, 0.1, 0.92, 0.05), velvet, 0, 0.71, 0.05));
  g.add(mesh(box(1.4, 1.9, 0.3), iron, 0, 1.6, -0.55));
  g.add(mesh(roundedBox(0.95, 1.1, 0.08, 0.05), velvet, 0, 1.3, -0.38));
  for (const sx of [-1, 1]) {
    g.add(mesh(box(0.2, 0.42, 1.1), iron, sx * 0.72, 0.9, 0));
    // Blades bristling forward off the ends of the arms, and up and out along them.
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Group();
      sword(s, 0.45 + rand() * 0.35, mats, rand() < 0.2);
      s.position.set(sx * (0.72 + (rand() - 0.5) * 0.12), 0.95 + rand() * 0.15, 0.45 - i * 0.2);
      s.rotation.set(Math.PI / 2 - 0.5 - rand() * 0.4, 0, sx * (0.5 + rand() * 0.6));
      g.add(s);
    }
  }
  // The crown of blades behind the back: fanning out from behind the seat, longest in the middle.
  for (let layer = 0; layer < 4; layer++) {
    const n = 30 - layer * 5;
    for (let i = 0; i < n; i++) {
      const a = -1.45 + (2.9 * (i + rand() * 0.6)) / n;
      const len = 1.1 + 2.7 * Math.cos(a) ** 2 - layer * 0.35 + rand() * 0.55;
      const s = new THREE.Group();
      sword(s, len, mats, rand() < 0.15);
      s.position.set(Math.sin(a) * 0.35, 1.25 + Math.cos(a) * 0.45, -0.72 - layer * 0.1);
      s.rotation.set(-0.12 - layer * 0.08 + (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.4, -a);
      g.add(s);
    }
  }
  // Swords spilling off the base in every direction but the front, points out and down.
  for (let i = 0; i < 30; i++) {
    const a = Math.PI * 0.35 + rand() * Math.PI * 1.3;
    const s = new THREE.Group();
    sword(s, 0.5 + rand() * 0.5, mats, rand() < 0.3);
    s.position.set(Math.sin(a) * 0.85, 0.2 + rand() * 0.2, -0.1 + Math.cos(a) * 0.75);
    s.rotation.set(0, a, Math.PI / 2 - 0.2 - rand() * 0.5);
    s.rotateY(Math.PI / 2);
    g.add(s);
  }
  // And a few down the front of the seat.
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Group();
    sword(s, 0.35 + rand() * 0.2, mats, false);
    s.position.set(-0.5 + i * 0.2, 0.45, 0.56);
    s.rotation.set(Math.PI / 2 + 0.9, 0, (rand() - 0.5) * 0.4);
    g.add(s);
  }
  return mergeByMaterial(g);
}

/** The dais at the throne's end of the hall, its steps and runner, and the throne of blades on it. Returns somewhere to sit. */
export function buildDais(kit: Kit, plan: MapPlan): Interactable | undefined {
  const t = plan.throne;
  const dais = plan.dais;
  if (!t || !dais) return undefined;
  const { mats } = kit;
  const g = new THREE.Group();
  g.position.set(t.x, 0, t.z);
  g.rotation.y = t.rotY;
  // It runs 2.4 m in front of the throne (the rest behind), with its steps down from there.
  const front = 2.4;
  const stepD = 0.7;
  const top = dais.height;
  const at = (lx: number, lz: number) => [t.x + Math.cos(t.rotY) * lx + Math.sin(t.rotY) * lz, t.z - Math.sin(t.rotY) * lx + Math.cos(t.rotY) * lz] as const;
  g.add(mesh(box(dais.width, top, dais.depth), mats.stoneDark, 0, top / 2, front - dais.depth / 2));
  g.add(mesh(box(dais.width + 0.06, 0.1, 0.12), mats.gold, 0, top - 0.04, front, false));
  const [cx, cz] = at(0, front - dais.depth / 2);
  collide(kit, cx, cz, dais.width, dais.depth, t.rotY, top);
  for (let k = 1; k <= dais.steps; k++) {
    const y = (top * (dais.steps + 1 - k)) / (dais.steps + 1);
    const lz = front + (k - 0.5) * stepD;
    g.add(mesh(box(dais.width - k * 0.4, y, stepD), mats.stoneDark, 0, y / 2, lz));
    const [sx, sz] = at(0, lz);
    collide(kit, sx, sz, dais.width - k * 0.4, stepD, t.rotY, y);
    g.add(mesh(box(2.6, 0.03, stepD), mats.carpet, 0, y + 0.012, lz, false));
  }
  // A runner up the dais to the throne.
  g.add(mesh(box(2.6, 0.03, front + 0.2), mats.carpet, 0, top + 0.012, front / 2 - 0.1, false));
  for (const sx of [-1, 1]) g.add(mesh(box(0.12, 0.035, front + dais.steps * stepD), mats.gold, sx * 1.2, top + 0.014, (front + dais.steps * stepD) / 2 - 0.2, false));
  const iron = ironThrone(mats);
  iron.position.set(0, top, 0);
  g.add(iron);
  kit.group.add(g);
  collide(kit, t.x - Math.sin(t.rotY) * 0.2, t.z - Math.cos(t.rotY) * 0.2, THRONE_SIZE.width, THRONE_SIZE.depth, t.rotY, 99);
  const seat: Interactable = { kind: 'seat', seatId: t.id, x: t.x, y: t.y, z: t.z, radius: 1.7 };
  iron.userData.interact = seat;
  kit.interactables.push(seat);
  return seat;
}
