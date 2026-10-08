import { blockCylinder, blockBall, blockRing } from '../../world/blocky';
import * as THREE from 'three';
import { CAFE_TABLES, ROOF_TABLES, SEATING_BY_ID } from '../../../shared/layout';
import { bulb } from '../../world/outside';
import { mesh, roundedBox, toon } from '../../world/toon';
import { TIMBER, TIMBER_DARK, seatable, type RoofSite } from './kit';

// The café's tables: round ones with a chair either side to sit at (the chairs are SEATING's
// roof-chair-N), tall ones to stand at, and the stools along the counter.

const CUSHION = '#a8c3a0';

/** A little wooden chair, seat at y 0.45, its back to -z (turned to face whoever sits there). */
function chair(): THREE.Group {
  const g = new THREE.Group();
  const wood = toon(TIMBER);
  g.add(mesh(roundedBox(0.42, 0.04, 0.42, 0.05), wood, 0, 0.45, 0));
  g.add(mesh(roundedBox(0.36, 0.03, 0.36, 0.05), toon(CUSHION), 0, 0.48, 0.01));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(mesh(blockCylinder(0.018, 0.014, 0.45, 6), wood, sx * 0.17, 0.225, sz * 0.17, false));
    g.add(mesh(blockCylinder(0.016, 0.016, 0.4, 6), wood, sx * 0.17, 0.68, -0.19, false));
  }
  g.add(mesh(new THREE.BoxGeometry(0.4, 0.05, 0.03), wood, 0, 0.84, -0.19, false));
  g.add(mesh(new THREE.BoxGeometry(0.4, 0.05, 0.03), wood, 0, 0.7, -0.19, false));
  return g;
}

export function buildCafeSeating({ group, statics, colliders, interactables, night }: RoofSite) {
  const top = toon('#f6f1e7');
  const wood = toon(TIMBER);
  const iron = toon('#3a3f47');
  const jar = bulb(night, '#ffd9a0', 0.5);
  const stem = toon('#5fb760');

  // Round tables, each with a flower in a bud vase or a candle in a jar, and a chair either side.
  CAFE_TABLES.forEach(({ x, z }, i) => {
    statics.add(mesh(blockCylinder(0.22, 0.26, 0.03, 16), iron, x, 0.015, z, false));
    statics.add(mesh(blockCylinder(0.035, 0.035, 0.7, 8), iron, x, 0.37, z, false));
    statics.add(mesh(blockCylinder(0.46, 0.46, 0.04, 24), top, x, 0.74, z));
    statics.add(mesh(blockRing(0.46, 0.014), wood, x, 0.74, z, false));
    if (i % 2) {
      statics.add(mesh(blockCylinder(0.04, 0.04, 0.07, 10), jar, x, 0.8, z, false));
    } else {
      statics.add(mesh(blockCylinder(0.022, 0.028, 0.09, 8), toon('#dfe8ee'), x, 0.805, z, false));
      statics.add(mesh(blockCylinder(0.004, 0.004, 0.1, 4), stem, x, 0.89, z, false));
      statics.add(mesh(blockBall(0.028, 8, 6), toon(['#f4a6b8', '#ffd166', '#fff3b0'][i % 3]), x, 0.95, z, false));
    }
    colliders.push({ minX: x - 0.46, maxX: x + 0.46, minZ: z - 0.46, maxZ: z + 0.46, top: 0.76 });
    [0, 1].forEach((j) => {
      const id = `roof-chair-${i * 2 + j + 1}`;
      const s = SEATING_BY_ID.get(id)!;
      const c = chair();
      c.position.set(s.x, 0, s.z);
      c.rotation.y = s.rotY;
      seatable(c, id, 0.9, interactables);
      group.add(c);
    });
  });

  // Tall tables to stand at, with a candle each.
  const candle = bulb(night, '#ffbf69', 0.5);
  for (const { x, z } of ROOF_TABLES) {
    statics.add(mesh(blockCylinder(0.28, 0.32, 0.04, 16), iron, x, 0.02, z, false));
    statics.add(mesh(blockCylinder(0.04, 0.04, 1.05, 8), iron, x, 0.55, z, false));
    statics.add(mesh(blockCylinder(0.42, 0.42, 0.05, 20), top, x, 1.08, z));
    statics.add(mesh(blockCylinder(0.035, 0.035, 0.1, 8), candle, x, 1.16, z, false));
    colliders.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3, top: 1.1 });
  }

  // Stools along the counter, a sage cushion on a timber seat.
  for (let i = 1; i <= 6; i++) {
    const s = SEATING_BY_ID.get(`roof-stool-${i}`)!;
    const stool = new THREE.Group();
    stool.add(mesh(blockCylinder(0.2, 0.25, 0.03, 16), iron, 0, 0.015, 0, false));
    stool.add(mesh(blockCylinder(0.035, 0.035, 0.66, 8), iron, 0, 0.36, 0, false));
    stool.add(mesh(blockRing(0.16, 0.015), iron, 0, 0.32, 0, false));
    stool.add(mesh(blockCylinder(0.22, 0.2, 0.05, 16), toon(TIMBER_DARK), 0, 0.7, 0));
    stool.add(mesh(blockCylinder(0.2, 0.2, 0.05, 16), toon(CUSHION), 0, 0.75, 0));
    stool.position.set(s.x, 0, s.z);
    seatable(stool, s.id, 0.75, interactables);
    group.add(stool);
  }
}
