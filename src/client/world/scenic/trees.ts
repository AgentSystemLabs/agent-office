import { FARM, LAKE, LOOP_PAVED, MOUNTAINS, shoreX } from '../../../shared/scenic';
import { neighbourBoxes } from '../outside';
import { AUTUMN, LEAVES, PINES, boulder, leafy, palm, pine } from './flora';
import { G, beside, inBox, indexAt, insideLoop, nearest, stretch, type ScenicKit } from './kit';

/** Trees all round the loop, by what's near them, and boulders by the road through the mountains. They go in last, round everything else. */
export function plantTrees(kit: ScenicKit) {
  const { rand, parts, colliders, trunk, taken, free } = kit;
  const neighbours = neighbourBoxes();
  const town = (x: number, z: number) => (Math.abs(x) < 64 && z > -64 && z < 40) || (x > -24 && x < 14 && z > 30 && z < 72) || neighbours.some((b) => inBox(b, x, z, 5));
  const ok = (x: number, z: number, r: number) => free(x, z, r) && !town(x, z) && x > shoreX(z) + 26 && !MOUNTAINS.some(([mx, mz, mr]) => Math.hypot(mx - x, mz - z) < mr * 0.95);
  // The pines: thick right up to the road, thinning out further off, with a leafy tree here and there.
  for (let x = 110; x < 320; x += 5.5) {
    for (let z = 50; z < 340; z += 5.5) {
      const px = x + (rand() - 0.5) * 4.4;
      const pz = z + (rand() - 0.5) * 4.4;
      const n = nearest(px, pz);
      if (n.place !== 'forest' || n.off > 100 || rand() > (n.off < 40 ? 0.8 : 0.8 - ((n.off - 40) / 60) * 0.6) || !ok(px, pz, 1.4)) continue;
      const s = 0.85 + rand() * 0.7;
      if (rand() < 0.82) pine(parts.forest, px, pz, s, PINES[Math.floor(rand() * PINES.length)], rand() * 6);
      else leafy(parts.forest, px, pz, s * 0.9, rand() < 0.35 ? AUTUMN[Math.floor(rand() * AUTUMN.length)] : LEAVES[Math.floor(rand() * LEAVES.length)], rand() * 6);
      if (n.off < 35) trunk(px, pz, 0.26 * s, 2.2 * s);
      taken.push({ x: px, z: pz, r: 1.2 });
    }
  }
  // Pines scattered up to the mountains and round the lake.
  for (let x = -260; x < 300; x += 9) {
    for (let z = 250; z < 440; z += 9) {
      const px = x + (rand() - 0.5) * 7;
      const pz = z + (rand() - 0.5) * 7;
      const n = nearest(px, pz);
      if ((n.place !== 'mountains' && n.place !== 'tunnel') || n.off > 80 || rand() > 0.38 || !ok(px, pz, 1.6)) continue;
      const s = 0.9 + rand() * 0.8;
      pine(parts.mountains, px, pz, s, PINES[Math.floor(rand() * PINES.length)], rand() * 6);
      if (n.off < 30) trunk(px, pz, 0.26 * s, 2.2 * s);
      taken.push({ x: px, z: pz, r: 1.5 });
    }
  }
  // Palms along the coast road, and on the sand.
  for (const s of [...stretch('beach'), ...stretch('coast')]) {
    for (let d = s.from; d < s.to; d += 7 + rand() * 9) {
      const i = indexAt(d);
      for (const side of [1, -1]) {
        if (rand() < 0.35) continue;
        const at = beside(i, side * (LOOP_PAVED + 3 + rand() * (side > 0 ? 16 : 8)));
        if (!free(at.x, at.z, 1.2) || at.x < shoreX(at.z) + 6) continue;
        const sc = 0.9 + rand() * 0.45;
        palm(parts.beach, at.x, at.z, sc, rand() * 6);
        trunk(at.x, at.z, 0.2 * sc, 6 * sc);
        taken.push({ x: at.x, z: at.z, r: 2 });
      }
    }
  }
  // Leafy trees out in the fields and the meadows, inside the loop and out, well off the road.
  for (let x = -250; x < 320; x += 15) {
    for (let z = -260; z < 330; z += 15) {
      const px = x + (rand() - 0.5) * 12;
      const pz = z + (rand() - 0.5) * 12;
      const n = nearest(px, pz);
      if (n.place === 'forest' && n.off < 100) continue;
      if (rand() > (insideLoop(px, pz) ? 0.3 : 0.18) || !ok(px, pz, 3) || FARM.fields.some((f) => inBox(f, px, pz, 3)) || inBox(FARM.pasture, px, pz, 3)) continue;
      if (Math.hypot(px - LAKE.x, (pz - LAKE.z) * 2) < LAKE.rx + 8) continue;
      const s = 0.8 + rand() * 0.6;
      const into = n.place === 'beach' || n.place === 'coast' ? parts.coast : n.place === 'farm' ? parts.farm : parts.meadow;
      leafy(into, px, pz, s, rand() < 0.12 ? AUTUMN[Math.floor(rand() * AUTUMN.length)] : LEAVES[Math.floor(rand() * LEAVES.length)], rand() * 6);
      trunk(px, pz, 0.28 * s, 2.1 * s);
      taken.push({ x: px, z: pz, r: 3 });
    }
  }
  // Boulders by the road through the mountains.
  for (const s of stretch('mountains')) {
    for (let d = s.from; d < s.to; d += 14 + rand() * 20) {
      const at = beside(indexAt(d), (rand() < 0.6 ? 1 : -1) * (LOOP_PAVED + 4 + rand() * 12));
      if (!free(at.x, at.z, 1.5)) continue;
      const r = 0.8 + rand() * 1.6;
      boulder(parts.mountains, at.x, at.z, r, rand() * 6);
      colliders.push({ minX: at.x - r * 0.7, maxX: at.x + r * 0.7, minZ: at.z - r * 0.7, maxZ: at.z + r * 0.7, bottom: G, top: G + r * 0.9 });
      taken.push({ x: at.x, z: at.z, r: r + 1 });
    }
  }
}
