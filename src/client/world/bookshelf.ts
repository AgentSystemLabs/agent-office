import * as THREE from 'three';
import { BOOKSHELF, FLOOR } from '../../shared/layout';
import { mergeByMaterial, mesh, textPlane, toon } from './toon';
import type { Collider, Interactable } from './office';

// The bookshelf against the south wall: a tall wooden case, five shelves packed with books of every
// size and color (a few leaning over, a stack lying flat, a plant and a globe among them), and a
// "Docs" sign along its top. E at it opens the project's Markdown to read (ui/bookshelf.ts).

export interface BookshelfModel {
  group: THREE.Group;
  collider: Collider;
  interactable: Interactable;
}

const SPINES = ['#b5413b', '#2a6f97', '#2d6a4f', '#e9c46a', '#6a4c93', '#f4a261', '#264653', '#ef476f', '#8ecae6', '#fffaf3'];
const SHELVES = 5;
/** The case's boards, how far the shelves sit off the floor, and how thick they are. */
const SIDE = 0.05;
const BASE = 0.1;
const BOARD = 0.03;

export function buildBookshelf(): BookshelfModel {
  const { width: W, depth: D, height: H } = BOOKSHELF;
  // Seeded, so the shelf looks the same in every browser.
  let seed = 20250928;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

  // Built facing +z, back against z = -D/2.
  const parts = new THREE.Group();
  const wood = toon('#9c6644');
  const woodDark = toon('#7f5539');
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => parts.add(mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z));
  box(W, H, 0.03, woodDark, 0, H / 2, -D / 2 + 0.015);
  for (const sx of [-1, 1]) box(SIDE, H, D, wood, sx * (W / 2 - SIDE / 2), H / 2, 0);
  // A crown over the top and a kick board at the foot.
  box(W + 0.08, 0.07, D + 0.05, wood, 0, H + 0.035, 0.01);
  box(W - 2 * SIDE, BASE, D - 0.03, woodDark, 0, BASE / 2, -0.015);

  const inner = W - 2 * SIDE;
  const bay = (H - BASE - BOARD) / SHELVES;
  const front = D / 2 - 0.02;
  for (let s = 0; s < SHELVES; s++) {
    const floor = BASE + s * bay + BOARD;
    box(inner, BOARD, D - 0.03, wood, 0, floor - BOARD / 2, -0.015);
    const room = bay - BOARD - 0.04;
    let x = -inner / 2 + 0.02;
    const end = inner / 2 - 0.02;
    // Now and then something that isn't a book: a globe on one shelf, a little plant on another.
    let ornament = s === 1 ? 'globe' : s === 3 ? 'plant' : null;
    const ornamentAt = -inner / 2 + inner * (0.5 + rand() * 0.2);
    while (x < end - 0.03) {
      if (ornament && x >= ornamentAt) {
        if (ornament === 'globe') {
          parts.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.03, 12), woodDark, x + 0.13, floor + 0.015, 0));
          parts.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.07, 6), woodDark, x + 0.13, floor + 0.06, 0));
          parts.add(mesh(new THREE.SphereGeometry(0.11, 14, 10), toon('#4cc9f0'), x + 0.13, floor + 0.18, 0));
          parts.add(mesh(new THREE.SphereGeometry(0.075, 10, 8), toon('#80b918'), x + 0.16, floor + 0.21, 0.05));
        } else {
          parts.add(mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.12, 10), toon('#e76f51'), x + 0.11, floor + 0.06, 0.02));
          parts.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), toon('#52b788'), x + 0.11, floor + 0.19, 0.02));
        }
        ornament = null;
        x += 0.28;
        continue;
      }
      // A stack lying flat, once in a while.
      if (rand() < 0.07 && end - x > 0.32) {
        let y = floor;
        const n = 2 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) {
          const t = 0.04 + rand() * 0.03;
          const w = 0.22 + rand() * 0.08;
          box(w, t, 0.18 + rand() * 0.06, toon(pick(SPINES)), x + 0.15 + (rand() - 0.5) * 0.03, y + t / 2, front - 0.13);
          y += t;
        }
        x += 0.32;
        continue;
      }
      const t = 0.035 + rand() * 0.04;
      const h = Math.min(room, room * (0.62 + rand() * 0.38));
      const d = 0.19 + rand() * 0.08;
      if (x + t > end) break;
      // The last one or two in a row lean over on their neighbour when there's room.
      const lean = end - x < 0.24 && end - x > 0.14 && rand() < 0.6;
      const mat = toon(pick(SPINES));
      if (lean) {
        const g = new THREE.Group();
        const a = 0.32;
        g.add(mesh(new THREE.BoxGeometry(t, h, d), mat, t / 2, h / 2, 0));
        g.rotation.z = -a;
        g.position.set(x + 0.01, floor, front - d / 2);
        parts.add(g);
        x = end;
        break;
      }
      box(t, h, d, mat, x + t / 2, floor + h / 2, front - d / 2);
      // A band across some spines, near the top.
      if (rand() < 0.35) box(t + 0.004, 0.018, d + 0.004, toon('#e9c46a'), x + t / 2, floor + h * 0.82, front - d / 2);
      x += t + (rand() < 0.1 ? 0.012 : 0.002);
    }
  }
  const group = new THREE.Group();
  group.add(mergeByMaterial(parts));

  // A sign along the crown.
  const sign = textPlane('📚 Docs', { size: 40, bg: '#fffaf3' });
  sign.position.set(0, H + 0.3, 0.02);
  group.add(sign);

  // Built facing +z; it stands against the south wall facing into the room (-z).
  group.position.set(BOOKSHELF.x, 0, BOOKSHELF.z);
  group.rotation.y = Math.PI;
  const collider: Collider = { minX: BOOKSHELF.x - W / 2 - 0.04, maxX: BOOKSHELF.x + W / 2 + 0.04, minZ: BOOKSHELF.z - D / 2 - 0.03, maxZ: FLOOR.maxZ, top: H + 0.07 };
  const interactable: Interactable = { kind: 'bookshelf', x: BOOKSHELF.x, z: BOOKSHELF.z - 1.2, radius: 1.6 };
  group.userData.interact = interactable;
  return { group, collider, interactable };
}
