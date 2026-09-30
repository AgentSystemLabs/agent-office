import * as THREE from 'three';
import { DUNGEON_PILLAR } from '../../shared/maps/dungeon';
import type { DungeonPlan } from '../../shared/maps';
import { boxFootprint } from '../../shared/maps/props';
import { NavGrid, type Rect } from '../../shared/nav';
import type { Collider } from './types';
import { mesh, toon } from './toon';

/*
 * A dungeon under a hall (see shared/maps/dungeon.ts): the vault dug out below the hall's floor, the
 * stairs down into it through a hole in that floor with a stone rail round it, and the cells along
 * its walls, iron bars across their fronts and a barred door in the middle of each. Whoever's locked
 * up in them is the jail's to show (features/workers/jail.ts); the torches, and the Kingsguard who brings them
 * down, are the castle's (world/castle/).
 */

/** What the dungeon's built with, from the hall it's under. */
export interface DungeonKit {
  group: THREE.Group;
  /** Merged into a few draw calls: whatever never moves. */
  still: THREE.Group;
  colliders: Collider[];
  mats: { stone: THREE.Material; stoneDark: THREE.Material; iron: THREE.Material; wood: THREE.Material; woodDark: THREE.Material };
  /** Dressed stone for a wall `along` meters long and `high` high, and flagstones for a floor `w` by `l`. */
  wall(along: number, high: number): THREE.Material;
  flags(w: number, l: number): THREE.Material;
}

export interface DungeonView {
  plan: DungeonPlan;
  /** Walking about down there. */
  nav: NavGrid;
  /** What's only worth drawing while someone might see it: down there, or looking down the stairs. Whoever's locked up goes in here. */
  inside: THREE.Group;
  /** Swings cell `i`'s door: 0 shut, 1 wide open. */
  swing(i: number, open: number): void;
  /** Where cell `i`'s lock is, to hear it. */
  lock(i: number): THREE.Vector3;
  /** Where the fire is down there: the torches' flames. */
  lamps: THREE.Vector3[];
}

/** How high the cells' bars go; there's stone over them up to the ceiling. */
const BARS = 2.5;
const BAR_GAP = 0.2;
/** A cell door, across. */
const DOOR = 1.1;
/** The stone rail round the hole in the hall's floor. */
const RAIL = { height: 0.95, thick: 0.2 } as const;
/** The low wall down the open side of the stairs. */
const PARAPET = { height: 0.9, thick: 0.15 } as const;
const WALL = 0.5;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** A box the size of `r`, from `y0` up to `y1`. */
function slab(r: Rect, y0: number, y1: number, mat: THREE.Material, shadow = true): THREE.Mesh {
  const [x0, x1, z0, z1] = r;
  return mesh(box(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, shadow);
}

/** A flat rectangle at height `y` with a rectangular hole in it (or none), facing up (or down). */
export function holedPlane(outer: Rect, hole: Rect | null, y: number, mat: THREE.Material, down = false): THREE.Mesh {
  // The shape's y is the world's z, flipped for facing up (a quarter turn one way) and not for down.
  const s = down ? 1 : -1;
  const shape = new THREE.Shape();
  const [x0, x1, z0, z1] = outer;
  shape.moveTo(x0, s * z0);
  shape.lineTo(x1, s * z0);
  shape.lineTo(x1, s * z1);
  shape.lineTo(x0, s * z1);
  shape.closePath();
  if (hole) {
    const [h0, h1, k0, k1] = hole;
    const path = new THREE.Path();
    path.moveTo(h0, s * k0);
    path.lineTo(h0, s * k1);
    path.lineTo(h1, s * k1);
    path.lineTo(h1, s * k0);
    path.closePath();
    shape.holes.push(path);
  }
  const m = mesh(new THREE.ShapeGeometry(shape), mat, 0, y, 0, false);
  m.rotation.x = down ? Math.PI / 2 : -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

/** Straw strewn on a cell's floor. */
const STRAW = toon('#8f7c48');
const STRAW_DARK = toon('#6d5e36');

export function buildDungeon(kit: DungeonKit, d: DungeonPlan): DungeonView {
  const { still, colliders, mats } = kit;
  const b = d.bounds;
  const vault: Rect = [b.minX, b.maxX, b.minZ, b.maxZ];
  const H = d.ceiling - d.floor;
  const inside = new THREE.Group();
  kit.group.add(inside);

  // The floor, and the ceiling: the underside of the hall's floor, with the hole the stairs come down through.
  const floor = holedPlane(vault, null, d.floor, kit.flags(b.maxX - b.minX, b.maxZ - b.minZ));
  kit.group.add(floor);
  colliders.push({ minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, top: d.floor, bottom: d.floor - 0.3 });
  kit.group.add(holedPlane(vault, d.opening, d.ceiling, mats.stoneDark, true));
  // Beams across under it, clear of the stairs.
  const [o0, o1, p0, p1] = d.opening;
  for (let z = b.minZ + 1.6; z < b.maxZ - 0.5; z += 2.6) {
    for (const [a, c] of z > p0 - 0.2 && z < p1 + 0.2 ? [[b.minX, o0], [o1, b.maxX]] : [[b.minX, b.maxX]]) {
      if (c - a > 0.3) still.add(slab([a, c, z - 0.16, z + 0.16], d.ceiling - 0.32, d.ceiling, mats.woodDark, false));
    }
  }

  // The walls round the vault, from its floor up to the hall's.
  const walls: [Rect, number][] = [
    [[b.minX - WALL, b.minX, b.minZ - WALL, b.maxZ + WALL], b.maxZ - b.minZ],
    [[b.maxX, b.maxX + WALL, b.minZ - WALL, b.maxZ + WALL], b.maxZ - b.minZ],
    [[b.minX, b.maxX, b.minZ - WALL, b.minZ], b.maxX - b.minX],
    [[b.minX, b.maxX, b.maxZ, b.maxZ + WALL], b.maxX - b.minX],
  ];
  for (const [r, along] of walls) {
    kit.group.add(slab(r, d.floor, 0, kit.wall(along, H)));
    colliders.push({ minX: r[0], maxX: r[1], minZ: r[2], maxZ: r[3], top: d.ceiling, bottom: d.floor });
  }
  // The rim of the hole in the hall's floor, so you can't see into it.
  const rims: Rect[] = [
    [o0 - 0.05, o0, p0, p1],
    [o1, o1 + 0.05, p0, p1],
    [o0, o1, p0 - 0.05, p0],
    [o0, o1, p1, p1 + 0.05],
  ];
  for (const r of rims) still.add(slab(r, d.ceiling, 0, mats.stoneDark, false));

  // The stone rail round the hole, on every side but the one the stairs start from.
  const along: [number, number] = [Math.round(Math.sin(d.stairs.rotY)), Math.round(Math.cos(d.stairs.rotY))];
  const [r0, r1, q0, q1] = d.rails;
  const sides: { rect: Rect; start: boolean }[] = [
    { rect: [r0, o0, q0, q1], start: along[0] > 0 },
    { rect: [o1, r1, q0, q1], start: along[0] < 0 },
    { rect: [r0, r1, q0, p0], start: along[1] > 0 },
    { rect: [r0, r1, p1, q1], start: along[1] < 0 },
  ];
  for (const { rect, start } of sides) {
    if (start) continue;
    still.add(slab(rect, 0, RAIL.height - 0.1, mats.stone));
    still.add(slab([rect[0] - 0.04, rect[1] + 0.04, rect[2] - 0.04, rect[3] + 0.04], RAIL.height - 0.1, RAIL.height, mats.stoneDark));
    colliders.push({ minX: rect[0], maxX: rect[1], minZ: rect[2], maxZ: rect[3], top: RAIL.height, fence: true });
  }

  // The stairs: each step a block of stone from the vault's floor up, and a low wall down whichever
  // side of them is open to the vault.
  const openSides = ([-1, 1] as const).filter((s) => {
    // The side's edge, across the stairs from their middle.
    const across = [Math.cos(d.stairs.rotY), -Math.sin(d.stairs.rotY)];
    const ex = d.stairs.start[0] + across[0] * s * (d.stairs.width / 2);
    const ez = d.stairs.start[1] + across[1] * s * (d.stairs.width / 2);
    const onWall = Math.abs(across[0]) > 0.5 ? Math.abs(ex - b.minX) < 0.05 || Math.abs(ex - b.maxX) < 0.05 : Math.abs(ez - b.minZ) < 0.05 || Math.abs(ez - b.maxZ) < 0.05;
    return !onWall;
  });
  const across = [Math.cos(d.stairs.rotY), -Math.sin(d.stairs.rotY)];
  // How deep a step is: along the way down.
  const [s0x, s1x, s0z, s1z] = d.steps[0].rect;
  const tread = Math.abs(along[0]) ? s1x - s0x : s1z - s0z;
  d.steps.forEach((s, i) => {
    still.add(slab(s.rect, d.floor, s.top, i % 2 ? mats.stone : mats.stoneDark));
    colliders.push({ minX: s.rect[0], maxX: s.rect[1], minZ: s.rect[2], maxZ: s.rect[3], top: s.top, bottom: d.floor });
    const cx = (s.rect[0] + s.rect[1]) / 2;
    const cz = (s.rect[2] + s.rect[3]) / 2;
    // (The last step is the vault's floor: nothing to fall off there.)
    for (const side of i < d.steps.length - 1 ? openSides : []) {
      const px = cx + across[0] * side * (d.stairs.width / 2 - PARAPET.thick / 2);
      const pz = cz + across[1] * side * (d.stairs.width / 2 - PARAPET.thick / 2);
      const r = boxFootprint(px, pz, PARAPET.thick, tread + 0.01, d.stairs.rotY);
      still.add(slab(r, s.top, s.top + PARAPET.height, mats.stoneDark));
      colliders.push({ minX: r[0], maxX: r[1], minZ: r[2], maxZ: r[3], top: s.top + PARAPET.height, bottom: d.floor, fence: true });
    }
  });

  // The cells: bars across the front with a door in the middle, stone over the bars, walls between.
  const built: Rect[] = [];
  // A wall along the vault's own (a cell's back, or the side of the one at the end of a row) is there already.
  const onVaultWall = ([x0, x1, z0, z1]: Rect) => {
    const [cx, cz] = [(x0 + x1) / 2, (z0 + z1) / 2];
    return x1 - x0 < z1 - z0 ? Math.min(Math.abs(cx - b.minX), Math.abs(cx - b.maxX)) < 0.2 : Math.min(Math.abs(cz - b.minZ), Math.abs(cz - b.maxZ)) < 0.2;
  };
  const stoneWall = (r: Rect) => {
    // Two cells side by side share the wall between them.
    if (onVaultWall(r) || built.some((o) => o.every((v, k) => Math.abs(v - r[k]) < 0.05))) return;
    built.push(r);
    const along = Math.max(r[1] - r[0], r[3] - r[2]);
    kit.group.add(slab(r, d.floor, d.ceiling, kit.wall(along, H)));
    colliders.push({ minX: r[0], maxX: r[1], minZ: r[2], maxZ: r[3], top: d.ceiling, bottom: d.floor });
  };
  const doors: { hinge: THREE.Group; leaf: THREE.Group; lock: THREE.Vector3 }[] = [];
  const bars = new THREE.CylinderGeometry(0.025, 0.025, BARS - 0.05, 6);
  d.cells.forEach((c, i) => {
    const out = [Math.sin(c.rotY), Math.cos(c.rotY)];
    const acr = [Math.cos(c.rotY), -Math.sin(c.rotY)];
    const at = (u: number, v: number): [number, number] => [c.x + acr[0] * u - out[0] * v, c.z + acr[1] * u - out[1] * v];
    // Its side walls, and its back wall if it isn't the vault's.
    for (const s of [-1, 1]) {
      const [mx, mz] = at((s * c.width) / 2, c.depth / 2);
      stoneWall(boxFootprint(mx, mz, 0.3, c.depth, c.rotY));
    }
    const [bx, bz] = at(0, c.depth);
    stoneWall(boxFootprint(bx, bz, c.width + 0.3, 0.3, c.rotY));
    // The front: stone over the bars, the bars either side of the door, and bands across them.
    const front = new THREE.Group();
    front.position.set(c.x, d.floor, c.z);
    front.rotation.y = c.rotY;
    front.add(mesh(box(c.width + 0.3, H - BARS, 0.3), kit.wall(c.width, H - BARS), 0, BARS + (H - BARS) / 2, 0));
    const half = c.width / 2;
    for (const [a, z] of [
      [-half, -DOOR / 2],
      [DOOR / 2, half],
    ]) {
      for (let u = a + BAR_GAP / 2; u < z - 0.02; u += BAR_GAP) front.add(mesh(bars, mats.iron, u, BARS / 2, 0, false));
      for (const y of [0.12, 1.25, BARS - 0.06]) front.add(mesh(box(z - a, 0.07, 0.07), mats.iron, (a + z) / 2, y, 0, false));
    }
    // Posts either side of the door.
    for (const s of [-1, 1]) front.add(mesh(box(0.12, BARS, 0.12), mats.iron, (s * (DOOR + 0.12)) / 2, BARS / 2, 0, false));
    still.add(front);
    // The door, hung on its left post, swinging out into the vault.
    const hinge = new THREE.Group();
    hinge.position.set(c.x - acr[0] * (DOOR / 2), d.floor, c.z - acr[1] * (DOOR / 2));
    hinge.rotation.y = c.rotY;
    const leaf = new THREE.Group();
    for (let u = BAR_GAP / 2 + 0.03; u < DOOR - 0.03; u += BAR_GAP) leaf.add(mesh(bars, mats.iron, u, BARS / 2 - 0.05, 0, false));
    for (const y of [0.15, 1.25, BARS - 0.12]) leaf.add(mesh(box(DOOR, 0.08, 0.08), mats.iron, DOOR / 2, y, 0, false));
    // The lock, and a ring to pull it by.
    leaf.add(mesh(box(0.18, 0.24, 0.12), mats.iron, DOOR - 0.12, 1.1, 0.02, false));
    const ring = mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 12), mats.iron, DOOR - 0.12, 0.95, 0.1, false);
    leaf.add(ring);
    hinge.add(leaf);
    kit.group.add(hinge);
    const [lx, lz] = at(DOOR / 2 - 0.12, 0);
    doors.push({ hinge, leaf, lock: new THREE.Vector3(lx, d.floor + 1.1, lz) });
    const fr = boxFootprint(c.x, c.z, c.width, 0.24, c.rotY);
    colliders.push({ minX: fr[0], maxX: fr[1], minZ: fr[2], maxZ: fr[3], top: d.ceiling, bottom: d.floor });

    // Straw on the floor, and shackles on the back wall.
    for (let k = 0; k < 3; k++) {
      const [sx, sz] = at((k - 1) * c.width * 0.28, c.depth * (0.45 + 0.18 * (k % 2)));
      const straw = mesh(new THREE.CircleGeometry(0.55 + 0.2 * (k % 2), 9), k % 2 ? STRAW_DARK : STRAW, sx, d.floor + 0.012 + k * 0.002, sz, false);
      straw.rotation.set(-Math.PI / 2, 0, k * 1.3);
      straw.scale.set(1.3, 0.8, 1);
      inside.add(straw);
    }
    for (const s of [-1, 1]) {
      const [kx, kz] = at(s * Math.min(1.1, c.width / 4), c.depth - 0.18);
      const shackle = new THREE.Group();
      shackle.position.set(kx, d.floor + 1.55, kz);
      shackle.rotation.y = c.rotY;
      shackle.add(mesh(box(0.14, 0.14, 0.05), mats.iron, 0, 0, 0, false));
      for (let l = 0; l < 4; l++) {
        const link = mesh(new THREE.TorusGeometry(0.045, 0.012, 5, 10), mats.iron, 0, -0.08 - l * 0.075, 0.05, false);
        link.rotation.y = l % 2 ? Math.PI / 2 : 0;
        shackle.add(link);
      }
      shackle.add(mesh(new THREE.TorusGeometry(0.08, 0.02, 6, 12), mats.iron, 0, -0.42, 0.06, false));
      inside.add(shackle);
    }
  });

  // Pillars holding the vault up.
  for (const [px, pz] of d.pillars) {
    const w = DUNGEON_PILLAR;
    still.add(mesh(box(w + 0.16, 0.4, w + 0.16), mats.stoneDark, px, d.floor + 0.2, pz));
    still.add(mesh(box(w, H - 0.8, w), kit.wall(w, H), px, d.floor + 0.4 + (H - 0.8) / 2, pz));
    still.add(mesh(box(w + 0.2, 0.4, w + 0.2), mats.stoneDark, px, d.ceiling - 0.2, pz));
    colliders.push({ minX: px - w / 2, maxX: px + w / 2, minZ: pz - w / 2, maxZ: pz + w / 2, top: d.ceiling, bottom: d.floor });
  }

  const lamps = d.torches.map((t) => new THREE.Vector3(t.x + Math.sin(t.rotY) * 0.5, d.floor + 2.3 + 0.9, t.z + Math.cos(t.rotY) * 0.5));
  return {
    plan: d,
    nav: new NavGrid(d.bounds, d.obstacles),
    inside,
    swing(i, open) {
      const door = doors[i];
      if (!door) return;
      const e = open * open * (3 - 2 * open);
      door.leaf.rotation.y = -e * 1.75;
    },
    lock: (i) => doors[i]?.lock.clone() ?? new THREE.Vector3(),
    lamps,
  };
}
