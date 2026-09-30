import * as THREE from 'three';
import { LAKE, LOOP_PAVED, PIER, shoreX } from '../../../shared/scenic';
import { mulberry32 } from '../../../shared/rng';
import { tilingCanvasTexture } from '../texture';
import { mesh, toon } from '../toon';
import { boulder } from './flora';
import { G, beside, box, flat, flatMesh, indexAt, strip, withTangents, type Along, type ScenicKit } from './kit';
import type { Road } from './road';

/** The creek under the bridge, the lake under the mountains and the sea past the beach. Returns the water's ripples and the surf, to move. */
export function buildWater(kit: ScenicKit, road: Road): { waters: THREE.Texture[]; surf: THREE.MeshToonMaterial[] } {
  const { root, rand, parts, colliders, cullable, taken } = kit;
  const { creekLine, bridge } = road;
  const ripples = (base: string, light: string) =>
    tilingCanvasTexture(128, 128, (g) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = light;
      g.lineWidth = 2.5;
      const r = mulberry32(7);
      for (let k = 0; k < 10; k++) {
        const x = r() * 128;
        const y = r() * 128;
        const w = 14 + r() * 26;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + w / 2, y - 4, x + w, y);
        g.stroke();
      }
    });
  const waters: THREE.Texture[] = [];
  // The creek: a ribbon of water between muddy banks, under the bridge.
  {
    const line = withTangents(creekLine);
    const t = ripples('#4ea8de', '#9bd4f5');
    waters.push(t);
    let run = 0;
    const along = line.map((p, i) => (i ? (run += Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z)) : 0));
    const xs = creekLine.map((q) => q.x);
    const zs = creekLine.map((q) => q.z);
    for (const m of [flatMesh(strip(line, -4.5, 4.5, G - 0.022, () => 0), flat('#a68a64', 1)), flatMesh(strip(line, -2.8, 2.8, G - 0.018, (i) => along[i] / 10), flat('#ffffff', 2, t))]) {
      root.add(m);
      cullable(m, Math.min(...xs) - 5, Math.max(...xs) + 5, Math.min(...zs) - 5, Math.max(...zs) + 5);
    }
    for (const p of creekLine) taken.push({ x: p.x, z: p.z, r: 5 });
    // The bridge's wooden railings, either side of the road over it.
    const wood = toon('#8b5e34');
    for (const side of [-1, 1]) {
      const i0 = indexAt(bridge - 9);
      const i1 = indexAt(bridge + 9);
      for (let i = i0; i <= i1; i += 1) {
        const a = beside(i, side * (LOOP_PAVED + 0.35));
        parts.forest.add(mesh(box(0.25, 1.1, 0.25), wood, a.x, G + 0.55, a.z));
        if (i < i1) {
          const b = beside(i + 1, side * (LOOP_PAVED + 0.35));
          const r = mesh(box(0.14, 0.18, Math.hypot(b.x - a.x, b.z - a.z) + 0.1), wood, (a.x + b.x) / 2, G + 1.0, (a.z + b.z) / 2);
          r.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
          parts.forest.add(r);
        }
      }
    }
  }
  // The lake under the mountains, a shore of sand round it and a little dock.
  {
    const t = ripples('#3a86c8', '#76b7e0');
    t.repeat.set(6, 3);
    waters.push(t);
    const shore = flatMesh(new THREE.CircleGeometry(1, 48), flat('#e9d8a6', 1));
    shore.scale.set(LAKE.rx + 3.5, LAKE.rz + 3.5, 1);
    shore.rotation.x = -Math.PI / 2;
    shore.position.set(LAKE.x, G - 0.022, LAKE.z);
    const water = flatMesh(new THREE.CircleGeometry(1, 48), flat('#ffffff', 2, t));
    water.scale.set(LAKE.rx, LAKE.rz, 1);
    water.rotation.x = -Math.PI / 2;
    water.position.set(LAKE.x, G - 0.018, LAKE.z);
    root.add(shore, water);
    for (const m of [shore, water]) cullable(m, LAKE.x - LAKE.rx - 4, LAKE.x + LAKE.rx + 4, LAKE.z - LAKE.rz - 4, LAKE.z + LAKE.rz + 4);
    taken.push({ x: LAKE.x, z: LAKE.z, r: LAKE.rx + 6 });
    const wood = toon('#9c6644');
    const dock = { x: LAKE.x - 6, z: LAKE.z - LAKE.rz - 1 };
    parts.mountains.add(mesh(box(2.4, 0.2, 9), wood, dock.x, G + 0.25, dock.z + 3.5));
    for (const [dx, dz] of [
      [-1.1, 0],
      [1.1, 0],
      [-1.1, 7.8],
      [1.1, 7.8],
    ])
      parts.mountains.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 6), wood, dock.x + dx, G + 0.2, dock.z + dz));
    parts.mountains.add(mesh(box(1.1, 0.5, 2.6), toon('#e63946'), dock.x + 2.6, G - 0.02, dock.z + 6.5));
    for (let k = 0; k < 9; k++) {
      const a = rand() * Math.PI * 2;
      boulder(parts.mountains, LAKE.x + Math.cos(a) * (LAKE.rx + 2), LAKE.z + Math.sin(a) * (LAKE.rz + 2), 0.8 + rand() * 1.4, rand() * 6);
    }
  }
  // The sea, west past the beach as far as you can see, the sand sloping down into it, and surf.
  const surf: THREE.MeshToonMaterial[] = [];
  {
    const t = ripples('#2a9bd4', '#62c2e8');
    t.repeat.set(90, 125);
    waters.push(t);
    const sea = flatMesh(new THREE.PlaneGeometry(1300, 1800), flat('#ffffff', 0, t));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(-240 - 650, G - 0.15, 0);
    root.add(sea);
    const coast: Along[] = [];
    for (let z = -900; z <= 900; z += z > -300 && z < 600 ? 4 : 30) coast.push({ x: shoreX(z), z, tx: 0, tz: 0 });
    const line = withTangents(coast);
    // Going south (+z) along it, the land's on the left (+): flat sand up from the water's edge, and
    // under the water it slopes away, so the sea's surface meets it right at the edge.
    const sand = flat('#f2dfae', 1);
    root.add(flatMesh(strip(line, 4, 28, G - 0.015, () => 0), sand));
    root.add(flatMesh(strip(line, -10, 4, (_i, side) => (side === 'l' ? G - 0.015 : G - 0.5), () => 0), sand));
    const foam = flat('#ffffff', 1, null, { transparent: true, opacity: 0.7 });
    foam.depthWrite = false;
    surf.push(foam);
    root.add(flatMesh(strip(line, -2.6, 0.2, G - 0.135, () => 0), foam));
    // Walk into the shallows, or out along the pier, but not out to sea.
    const bands: [number, number][] = [
      [-400, PIER.z - PIER.width / 2],
      [PIER.z + PIER.width / 2, 640],
    ];
    for (const [z0, z1] of bands) {
      for (let z = z0; z < z1; z += 40) {
        const zEnd = Math.min(z1, z + 40);
        let x = Infinity;
        for (let k = z; k <= zEnd; k += 2) x = Math.min(x, shoreX(k));
        colliders.push({ minX: -1600, maxX: x - 6, minZ: z, maxZ: zEnd, bottom: G - 1, top: G + 2, fence: true });
      }
    }
    colliders.push({ minX: -1600, maxX: shoreX(PIER.z) - PIER.length - 0.2, minZ: PIER.z - PIER.width / 2, maxZ: PIER.z + PIER.width / 2, bottom: G - 1, top: G + 2, fence: true });
  }

  return { waters, surf };
}
