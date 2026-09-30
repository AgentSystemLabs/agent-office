import * as THREE from 'three';
import type { MapPlan } from '../../../shared/maps';
import type { Pt } from '../../../shared/nav';
import { holedPlane } from '../dungeon';
import { canvasTexture } from '../texture';
import { mesh, toon } from '../toon';
import { DOORWAY, WALL, type Kit, type Mats } from './kit';
import { archFill, archPath, archRise, box } from './shapes';
import { ashlar, boards, flagstones, toonMap } from './textures';

/**
 * The shell of the hall: the floor, the four walls (a doorway in the one nearest the map's door,
 * with its great doors), and the timber roof. Returns where the doorway is, which way is out through
 * it, and how to swing the doors (0 shut, 1 open).
 */
export function buildShell(kit: Kit, plan: MapPlan, pal: Mats & { floorColor: string; stoneColor: string }): { doorAt: THREE.Vector3; out: Pt; swing(open: number): void } {
  const b = plan.bounds;
  const H = plan.height;
  const W = b.maxX - b.minX;
  const L = b.maxZ - b.minZ;
  const { group, still, mats } = kit;
  const hole = plan.dungeon?.opening;
  if (hole) {
    // A hole in the floor over the dungeon stairs, and the floor round it is the dungeon's ceiling.
    const tex = canvasTexture(512, 512, flagstones(pal.floorColor), [0.25, 0.25]);
    group.add(holedPlane([b.minX, b.maxX, b.minZ, b.maxZ], hole, 0, toonMap(tex)));
    const [h0, h1, k0, k1] = hole;
    const bottom = plan.dungeon!.ceiling;
    for (const [x0, x1, z0, z1] of [
      [b.minX - 1, h0, b.minZ - 1, b.maxZ + 1],
      [h1, b.maxX + 1, b.minZ - 1, b.maxZ + 1],
      [h0, h1, b.minZ - 1, k0],
      [h0, h1, k1, b.maxZ + 1],
    ]) {
      kit.colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: 0, bottom });
    }
  } else {
    const floor = mesh(new THREE.PlaneGeometry(W, L), toonMap(canvasTexture(512, 512, flagstones(pal.floorColor), [W / 4, L / 4])), 0, 0, 0, false);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    group.add(floor);
    kit.colliders.push({ minX: b.minX - 1, maxX: b.maxX + 1, minZ: b.minZ - 1, maxZ: b.maxZ + 1, top: 0 });
  }

  // Which wall the doors are in: the one nearest the door.
  const door = plan.door;
  const gaps = { west: door.x - b.minX, east: b.maxX - door.x, north: door.z - b.minZ, south: b.maxZ - door.z };
  const doorWall = (Object.keys(gaps) as (keyof typeof gaps)[]).reduce((a, k) => (gaps[k] < gaps[a] ? k : a), 'south');
  const out: Pt = doorWall === 'west' ? [-1, 0] : doorWall === 'east' ? [1, 0] : doorWall === 'north' ? [0, -1] : [0, 1];
  const T = WALL;
  const stoneTex = canvasTexture(512, 256, ashlar(pal.stoneColor, 5), [W / 4, H / 2]);
  const wallMat = (along: number) => {
    const t = stoneTex.clone();
    t.repeat.set(along / 4, H / 2);
    t.needsUpdate = true;
    return toonMap(t);
  };
  const walls: [keyof typeof gaps, number, number, number, number][] = [
    ['west', b.minX - T / 2, (b.minZ + b.maxZ) / 2, T, L + 2 * T],
    ['east', b.maxX + T / 2, (b.minZ + b.maxZ) / 2, T, L + 2 * T],
    ['north', (b.minX + b.maxX) / 2, b.minZ - T / 2, W, T],
    ['south', (b.minX + b.maxX) / 2, b.maxZ + T / 2, W, T],
  ];
  for (const [side, x, z, w, d] of walls) {
    const alongX = side === 'north' || side === 'south';
    const mat = wallMat(alongX ? w : d);
    if (side !== doorWall) {
      group.add(mesh(box(w, H, d), mat, x, H / 2, z));
      kit.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: 99 });
      continue;
    }
    // A doorway through this one: the wall either side of it, and over it.
    const u = alongX ? door.x : door.z;
    const lo = alongX ? x - w / 2 : z - d / 2;
    const hi = alongX ? x + w / 2 : z + d / 2;
    const d0 = u - DOORWAY.width / 2;
    const d1 = u + DOORWAY.width / 2;
    for (const [a, bb] of [
      [lo, d0],
      [d1, hi],
    ]) {
      const m = (a + bb) / 2;
      const span = bb - a;
      if (span <= 0) continue;
      group.add(alongX ? mesh(box(span, H, d), mat, m, H / 2, z) : mesh(box(w, H, span), mat, x, H / 2, m));
      kit.colliders.push(alongX ? { minX: a, maxX: bb, minZ: z - d / 2, maxZ: z + d / 2, top: 99 } : { minX: x - w / 2, maxX: x + w / 2, minZ: a, maxZ: bb, top: 99 });
    }
    group.add(alongX ? mesh(box(DOORWAY.width, H - DOORWAY.height, d), mat, u, (H + DOORWAY.height) / 2, z) : mesh(box(w, H - DOORWAY.height, DOORWAY.width), mat, x, (H + DOORWAY.height) / 2, u));
    // The workers come and go through it; you stay in the hall.
    kit.colliders.push(alongX ? { minX: d0, maxX: d1, minZ: z - d / 2, maxZ: z + d / 2, top: 99, fence: true } : { minX: x - w / 2, maxX: x + w / 2, minZ: d0, maxZ: d1, top: 99, fence: true });
  }
  // Skirting and a cornice round the room.
  for (const [side, x, z, w, d] of walls) {
    const alongX = side === 'north' || side === 'south';
    const inset = alongX ? [0, (side === 'north' ? 1 : -1) * (T / 2 + 0.06)] : [(side === 'west' ? 1 : -1) * (T / 2 + 0.06), 0];
    const len = alongX ? w : d;
    still.add(mesh(alongX ? box(len, 0.5, 0.14) : box(0.14, 0.5, len), mats.stoneDark, x + inset[0], 0.25, z + inset[1], false));
    still.add(mesh(alongX ? box(len, 0.35, 0.24) : box(0.24, 0.35, len), mats.stoneDark, x + inset[0], H - 0.2, z + inset[1], false));
  }
  // Outside the doors: a landing, so workers have somewhere to walk off to, and the grass beyond.
  const lx = doorWall === 'west' ? b.minX - 3 : doorWall === 'east' ? b.maxX + 3 : door.x;
  const lz = doorWall === 'north' ? b.minZ - 3 : doorWall === 'south' ? b.maxZ + 3 : door.z;
  group.add(mesh(box(Math.abs(out[0]) ? 6 : 7, 0.2, Math.abs(out[0]) ? 7 : 6), mats.stoneDark, lx, -0.1, lz));
  kit.colliders.push({ minX: lx - 3.5, maxX: lx + 3.5, minZ: lz - 3.5, maxZ: lz + 3.5, top: 0 });
  // Round the hall, not under it, where it'd show through the hole down to the dungeon.
  const [cx, cz] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];
  group.add(holedPlane([cx - 120, cx + 120, cz - 120, cz + 120], hole ? [b.minX - T, b.maxX + T, b.minZ - T, b.maxZ + T] : null, -0.25, toon('#5d7a3a')));

  // The great doors, swinging in when someone comes up to them.
  const leaves: THREE.Group[] = [];
  const doorAt = new THREE.Vector3(doorWall === 'west' ? b.minX : doorWall === 'east' ? b.maxX : door.x, 0, doorWall === 'north' ? b.minZ : doorWall === 'south' ? b.maxZ : door.z);
  const frame = new THREE.Group();
  frame.position.copy(doorAt);
  frame.rotation.y = Math.atan2(out[0], out[1]);
  const r = DOORWAY.width * 0.7;
  const feet = DOORWAY.height - archRise(DOORWAY.width, r);
  // Each leaf is half the arch: square up to where the arch springs, then following its curve up to the point.
  const half = new THREE.Shape();
  half.moveTo(0, 0);
  half.lineTo(DOORWAY.width / 2, 0);
  const arc = new THREE.Shape();
  arc.moveTo(-DOORWAY.width / 2, 0);
  archPath(arc, DOORWAY.width, r, 0);
  const curve = arc.getPoints(12).filter((v) => v.x <= 0.001);
  for (const v of [...curve].reverse()) half.lineTo(v.x + DOORWAY.width / 2, v.y + feet);
  half.lineTo(0, 0);
  const leafGeo = new THREE.ExtrudeGeometry(half, { depth: 0.16, bevelEnabled: false, curveSegments: 12 });
  leafGeo.translate(0, 0, -0.08);
  const oak = toon('#4a2d18');
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * (DOORWAY.width / 2), 0, 0.1);
    const leaf = new THREE.Group();
    leaf.add(mesh(leafGeo, oak, 0, 0, 0));
    for (const y of [1.1, 2.6]) leaf.add(mesh(box(DOORWAY.width / 2 - 0.1, 0.12, 0.2), mats.iron, DOORWAY.width / 4, y, 0, false));
    leaf.add(mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 14), mats.iron, DOORWAY.width / 2 - 0.35, 2.0, -0.12, false));
    // The right one is the left one turned over.
    leaf.scale.x = -side;
    hinge.add(leaf);
    frame.add(hinge);
    leaves.push(hinge);
  }
  // A pointed arch of stone over the doorway, filling it in above the arch, and the jambs under it.
  frame.add(mesh(archFill(DOORWAY.width + 1, DOORWAY.height - feet + 0.4, DOORWAY.width, T + 0.24, r), mats.stoneDark, 0, feet, T / 2));
  for (const sx of [-1, 1]) frame.add(mesh(box(0.5, feet, T + 0.24), mats.stoneDark, sx * (DOORWAY.width / 2 + 0.25), feet / 2, T / 2));
  group.add(frame);

  // The roof: a truss across the hall over each pair of pillars, and boarding over them up to the ridge.
  const rise = W * 0.3;
  const pitch = Math.atan2(rise, W / 2);
  const roofWood = toonMap(canvasTexture(256, 256, boards('#3b2618'), [L / 4, W / 4]));
  for (const side of [-1, 1]) {
    const slope = mesh(box(Math.hypot(W / 2, rise) + 0.8, 0.25, L + 2 * T), roofWood, (side * W) / 4, H + rise / 2, (b.minZ + b.maxZ) / 2, false);
    slope.rotation.z = -side * pitch;
    group.add(slope);
  }
  // The gables at either end.
  for (const z of [b.minZ - T / 2, b.maxZ + T / 2]) {
    const tri = new THREE.Shape();
    tri.moveTo(-W / 2 - T, 0);
    tri.lineTo(W / 2 + T, 0);
    tri.lineTo(0, rise + 0.2);
    tri.closePath();
    group.add(mesh(new THREE.ExtrudeGeometry(tri, { depth: T, bevelEnabled: false }), mats.stone, (b.minX + b.maxX) / 2, H, z - T / 2, false));
  }
  // Over the pillars, where there are pillars, else every 6 m.
  const pillarZs = [...new Set((plan.config?.props ?? []).filter((q) => q.kind === 'pillar').map((q) => Math.round(q.z * 10) / 10))].sort((a, z) => a - z);
  const trussZs: number[] = pillarZs.length >= 2 ? pillarZs : [];
  if (!trussZs.length) for (let z = b.minZ + 3; z < b.maxZ - 1; z += 6) trussZs.push(z);
  for (const z of trussZs) {
    const t = new THREE.Group();
    t.add(mesh(box(W, 0.45, 0.4), mats.woodDark, 0, H - 0.1, 0, false));
    t.add(mesh(box(0.35, rise, 0.35), mats.woodDark, 0, H + rise / 2, 0, false));
    for (const side of [-1, 1]) {
      const rafter = mesh(box(Math.hypot(W / 2, rise), 0.35, 0.35), mats.woodDark, (side * W) / 4, H + rise / 2 - 0.15, 0, false);
      rafter.rotation.z = -side * pitch;
      t.add(rafter);
      const strut = mesh(box(Math.hypot(W / 4, rise / 2), 0.25, 0.3), mats.woodDark, (side * W) / 8, H + rise / 4, 0, false);
      strut.rotation.z = side * Math.atan2(rise / 2, W / 4);
      t.add(strut);
    }
    t.position.set((b.minX + b.maxX) / 2, 0, z);
    still.add(t);
  }
  still.add(mesh(box(0.4, 0.4, L), mats.woodDark, (b.minX + b.maxX) / 2, H + rise - 0.3, (b.minZ + b.maxZ) / 2, false));

  return {
    doorAt,
    out,
    swing(open) {
      const e = open * open * (3 - 2 * open);
      leaves.forEach((h, i) => (h.rotation.y = (i ? -1 : 1) * e * 1.4));
    },
  };
}
