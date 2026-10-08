import { Blocks, rock } from './voxscene';
import * as THREE from 'three';
import type { Kind } from './leaves';
import { ivyStrand, type Grow } from './plants';
import { blockCylinder } from '../../../world/blocky';

// What the garden is built with: timber planter beds, the pergola over the seats, lanterns, and the
// sound stone. All of it blocks (see voxscene.ts).

const TIMBER = ['#8a5a36', '#9a6a42', '#7a4d2e', '#936240'];

/** A box of `w` x `h` x `d` centred at (x, y, z), turned about y and then tipped about x, laid into `b`. (Cloth and soil get no grain.) */
export function box(b: Blocks, kind: Kind, color: string, w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0, rotX = 0, noise = 0.08, grain = 0.12) {
  b.box(w, h, d, x, y, z, rotY, rotX, color, kind === 'wood' || kind === 'iron' ? grain : 0, noise);
}

/** How high a planter bed's soil is. */
export const SOIL = 0.42;

/** A raised planter bed of timber boards filled with dark soil. */
export function planterBed(g: Grow, x0: number, x1: number, z0: number, z1: number) {
  const [w, d, cx, cz] = [x1 - x0, z1 - z0, (x0 + x1) / 2, (z0 + z1) / 2];
  const wood = () => TIMBER[Math.floor(g.r() * TIMBER.length)];
  for (const row of [0, 1]) {
    const y = 0.12 + row * 0.23;
    for (const sz of [-1, 1]) box(g.b, 'wood', wood(), w, 0.21, 0.05, cx, y, cz + sz * (d / 2 - 0.025));
    for (const sx of [-1, 1]) box(g.b, 'wood', wood(), 0.05, 0.21, d - 0.1, cx + sx * (w / 2 - 0.025), y, cz);
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) box(g.b, 'wood', '#6e4528', 0.08, 0.5, 0.08, cx + sx * (w / 2 - 0.04), 0.25, cz + sz * (d / 2 - 0.04));
  // The cap along the top, a little proud of the boards.
  for (const sz of [-1, 1]) box(g.b, 'wood', '#a06f48', w + 0.04, 0.035, 0.1, cx, 0.475, cz + sz * (d / 2 - 0.04));
  for (const sx of [-1, 1]) box(g.b, 'wood', '#a06f48', 0.1, 0.035, d - 0.06, cx + sx * (w / 2 - 0.04), 0.475, cz);
  // Soil in clods: every block a slightly different dark brown.
  box(g.b, 'soil', '#3a281c', w - 0.1, 0.05, d - 0.1, cx, SOIL - 0.03, cz, 0, 0, 0.3, 0);
  g.colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: 0.48 });
}

/** A lantern: iron frame round a glowing glass, standing on the ground, or hung from `hangFrom` on a short chain. */
export function lantern(g: Grow, x: number, z: number, hangFrom?: number) {
  const y = hangFrom === undefined ? 0 : hangFrom - 0.62;
  const iron = '#2a2623';
  const f = g.fine;
  box(f, 'iron', iron, 0.17, 0.03, 0.17, x, y + 0.015, z, 0, 0, 0.04);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(f, 'iron', iron, 0.025, 0.22, 0.025, x + sx * 0.075, y + 0.14, z + sz * 0.075, 0, 0, 0.04, 0);
  for (const [w, dy] of [[0.2, 0.26], [0.14, 0.29], [0.08, 0.32]] as const) box(f, 'iron', iron, w, 0.03, w, x, y + dy, z, 0, 0, 0.04, 0);
  box(f, 'iron', iron, 0.04, 0.04, 0.04, x, y + 0.36, z, 0, 0, 0.04, 0);
  if (hangFrom !== undefined) box(f, 'iron', iron, 0.025, hangFrom - y - 0.36, 0.025, x, (hangFrom + y + 0.36) / 2, z, 0, 0, 0.04, 0);
  g.glowB.box(0.1, 0.18, 0.1, x, y + 0.14, z, 0, 0, '#ffe2b0', 0, 0);
}

/** The pergola over the seats: timber posts, two beams, a lattice of rafters and slats, and ivy hanging from it. */
export function pergola(g: Grow, x0: number, x1: number, z0: number, z1: number, top: number) {
  for (const x of [x0, (x0 + x1) / 2, x1])
    for (const z of [z0, z1]) {
      box(g.b, 'wood', '#7a4d2e', 0.13, top, 0.13, x, top / 2, z);
      box(g.b, 'wood', '#5e3a22', 0.2, 0.06, 0.2, x, 0.03, z);
      g.colliders.push({ minX: x - 0.1, maxX: x + 0.1, minZ: z - 0.1, maxZ: z + 0.1, top: 99 });
    }
  for (const z of [z0, z1]) box(g.b, 'wood', '#8a5a36', x1 - x0 + 0.5, 0.2, 0.12, (x0 + x1) / 2, top + 0.1, z);
  for (let x = x0 - 0.15; x <= x1 + 0.2; x += 0.55) box(g.b, 'wood', '#9a6a42', 0.08, 0.12, z1 - z0 + 0.5, x, top + 0.26, (z0 + z1) / 2);
  for (let z = z0; z <= z1 + 0.01; z += 0.4) box(g.b, 'wood', '#a06f48', x1 - x0 + 0.7, 0.04, 0.04, (x0 + x1) / 2, top + 0.34, z);
  // Ivy hanging from the beams and rafters.
  for (let i = 0; i < 26; i++) {
    const onBeam = i % 2 === 0;
    const x = x0 + g.r() * (x1 - x0);
    const z = onBeam ? (g.r() < 0.5 ? z0 : z1) + (g.r() - 0.5) * 0.1 : z0 + g.r() * (z1 - z0);
    ivyStrand(g, x, top + (onBeam ? 0 : 0.2), z, 0.55 + g.r() * 1.0);
  }
}

/**
 * The sound stone: a standing stone with a wooden cap and two faint glowing rings round it. The blocks go
 * into the garden's; the group returned is what you aim at (a hit volume, nothing visible).
 */
export function soundStone(g: Grow, x: number, z: number): THREE.Group {
  g.b.blob(x, 0.36, z, 0.34, 0.4, 0.32, 0.6, rock(['#7b7f7a', '#6f746f', '#868a84'], 0.45), 0.2);
  box(g.b, 'wood', '#8a5a36', 0.34, 0.05, 0.34, x, 0.78, z, 0.6);
  box(g.b, 'wood', '#5e3a22', 0.14, 0.05, 0.14, x, 0.83, z, 0.6);
  g.glowB.ring(x, 0.5, z, 0.37, '#ffffff');
  g.glowB.ring(x, 0.34, z, 0.4, '#ffffff');
  g.colliders.push({ minX: x - 0.36, maxX: x + 0.36, minZ: z - 0.36, maxZ: z + 0.36, top: 0.85 });
  const target = new THREE.Group();
  const hit = new THREE.Mesh(blockCylinder(0.42, 0.45, 0.85, 10), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(x, 0.42, z);
  target.add(hit);
  return target;
}


