import * as THREE from 'three';
import { STREET_Y } from '../../../shared/layout';
import { mulberry32 } from '../../../shared/rng';
import { LOOP, LOOP_LENGTH, STREET_Z, type Place } from '../../../shared/scenic';
import type { Collider } from '../types';
import type { NightParts } from '../outside';
import { toon } from '../toon';

// What every part of the scenic loop builds with: lines and strips laid along the road, where things
// are round it, and the kit each part builds into (see makeKit).

export const G = STREET_Y;
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/**
 * For something lying flat on the ground: drawn over whatever's under it (the higher `over`, the more
 * it wins), and never outlined, which would ink a flat strip's edges up off the ground.
 */
export function flat(color: string, over: number, map: THREE.Texture | null = null, opts: { transparent?: boolean; opacity?: number } = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color, map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap, polygonOffset: true, polygonOffsetFactor: -over, polygonOffsetUnits: -over * 2, ...opts });
  m.userData.outlineParameters = { visible: false };
  return m;
}

export interface Along {
  x: number;
  z: number;
  tx: number;
  tz: number;
}

/** A line's points with the way it goes at each (see RoadPoint). */
export function withTangents(pts: { x: number; z: number }[]): Along[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: p.x, z: p.z, tx: (b.x - a.x) / len, tz: (b.z - a.z) / len };
  });
}

/** A smooth line through `knots`, `per` points between each two. */
export function smooth(knots: [number, number][], per: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const n = knots.length;
  for (let i = 0; i < n - 1; i++) {
    const [p0, p1, p2, p3] = [i - 1, i, i + 1, i + 2].map((k) => knots[Math.max(0, Math.min(n - 1, k))]);
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0[0], p1[0], p2[0], p3[0]), z: f(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  out.push({ x: knots[n - 1][0], z: knots[n - 1][1] });
  return out;
}

/**
 * A strip along `pts`, from `right` to `left` meters off its middle (+ is its left, going along), at
 * height `y` (a number, or one for each side), with u running along it and v across (1 on the left).
 */
export function strip(pts: Along[], right: number, left: number, y: number | ((i: number, side: 'l' | 'r') => number), u: (i: number) => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const at = (i: number, side: 'l' | 'r') => (typeof y === 'number' ? y : y(i, side));
  pts.forEach((p, i) => {
    // Left of the way along is (tz, -tx).
    pos.push(p.x + p.tz * left, at(i, 'l'), p.z - p.tx * left, p.x + p.tz * right, at(i, 'r'), p.z - p.tx * right);
    uv.push(u(i), 1, u(i), 0);
    if (i) {
      const l0 = (i - 1) * 2;
      idx.push(l0, l0 + 1, l0 + 2, l0 + 1, l0 + 3, l0 + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function flatMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** A point `off` meters to the left of the loop's middle at LOOP[i] (right, if negative). */
export function beside(i: number, off: number): { x: number; z: number } {
  const p = LOOP[Math.max(0, Math.min(LOOP.length - 1, i))];
  return { x: p.x + p.tz * off, z: p.z - p.tx * off };
}

/** The loop's point nearest `d` meters round it. */
export const indexAt = (d: number) => Math.max(0, Math.min(LOOP.length - 1, Math.round((d / LOOP_LENGTH) * (LOOP.length - 1))));

/** Where each bit of the loop starts and ends, meters round it. */
export function stretch(place: Place): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const p of LOOP) {
    if (p.place !== place) continue;
    const last = out[out.length - 1];
    if (last && p.d - last.to < 3) last.to = p.d;
    else out.push({ from: p.d, to: p.d });
  }
  return out;
}

/** The loop's middle, a point every 4 m, to find the nearest bit of it to anywhere (further than nearLoop reaches). */
const COARSE = LOOP.filter((_, i) => i % 2 === 0);
export function nearest(x: number, z: number): { off: number; place: Place; d: number } {
  let best = COARSE[0];
  let bestSq = Infinity;
  for (const p of COARSE) {
    const sq = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (sq < bestSq) {
      bestSq = sq;
      best = p;
    }
  }
  return { off: Math.sqrt(bestSq), place: best.place, d: best.d };
}

/** The loop and the street between its ends, as one closed outline. */
const RING = [...LOOP.map((p) => ({ x: p.x, z: p.z })), { x: 0, z: STREET_Z }];
export function insideLoop(x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = RING.length - 1; i < RING.length; j = i++) {
    const a = RING[i];
    const b = RING[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to a line through `pts`. */
export function distToLine(pts: { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const k = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(x - a.x - ex * k, z - a.z - ez * k));
  }
  return best;
}

export const inBox = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number, pad = 0) => x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;

/** The stretches things are built along, each merged a square of the map at a time (see buildScenic). */
export type Stretch = 'road' | 'farm' | 'forest' | 'mountains' | 'beach' | 'meadow' | 'coast';

/** Something drawn only when it's near enough to see through the haze (see Scenic.cull). */
export interface Seen {
  obj: THREE.Object3D;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** How high it stands over the street: the taller, the further off it shows over the haze. */
  above: number;
}

/** What each part of the loop builds into (see makeKit), in place of what used to be one long builder's locals. */
export interface ScenicKit {
  /** What's added as it is: the road, the fields, the water, the tunnel, whatever moves. */
  root: THREE.Group;
  /** The text on the signs, which is never merged. */
  labels: THREE.Group;
  /**
   * The one random sequence the whole loop is laid out from. Each part takes its numbers in turn, so
   * the parts are built in the same order every time (see buildScenic), or every tree would move.
   */
  rand: () => number;
  /** What's built along each stretch, before it's sorted into squares of the map and merged. */
  parts: Record<Stretch, THREE.Group>;
  /** Landmarks that show over the haze from further off than the rest: the silo, the windmill, the lighthouse. */
  silo: THREE.Group;
  mill: THREE.Group;
  light: THREE.Group;
  colliders: Collider[];
  night: NightParts;
  /** Draws `obj` only when it's near enough to see: its footprint, and how high it stands (see Seen). */
  cullable(obj: THREE.Object3D, minX: number, maxX: number, minZ: number, maxZ: number, above?: number): void;
  /** The same, for something `r` round (x, z). */
  around(obj: THREE.Object3D, x: number, z: number, r: number, above?: number): void;
  /** Something round and `h` tall at (x, z) that you can't walk through: a trunk, a hay bale. */
  trunk(x: number, z: number, r: number, h: number): void;
  /** Where trees shouldn't go: taken by something else, or the road. */
  taken: { x: number; z: number; r: number }[];
  /** Whether nothing's taken within `r` of (x, z). */
  free(x: number, z: number, r: number): boolean;
}

/**
 * The scenic loop's kit, its root in `group` (the office's `ground` group), with what's to be culled
 * in `seen`.
 */
export function makeKit(group: THREE.Group, colliders: Collider[], night: NightParts): { kit: ScenicKit; seen: Seen[] } {
  const root = new THREE.Group();
  group.add(root);
  const labels = new THREE.Group();
  root.add(labels);
  // The same numbers every time, so everyone drives past the same trees.
  const rand = mulberry32(20260929);
  const parts: Record<Stretch, THREE.Group> = {
    road: new THREE.Group(),
    farm: new THREE.Group(),
    forest: new THREE.Group(),
    mountains: new THREE.Group(),
    beach: new THREE.Group(),
    meadow: new THREE.Group(),
    coast: new THREE.Group(),
  };
  const seen: Seen[] = [];
  const cullable = (obj: THREE.Object3D, minX: number, maxX: number, minZ: number, maxZ: number, above = 10) => seen.push({ obj, minX, maxX, minZ, maxZ, above });
  const around = (obj: THREE.Object3D, x: number, z: number, r: number, above = 10) => cullable(obj, x - r, x + r, z - r, z + r, above);
  const silo = new THREE.Group();
  const mill = new THREE.Group();
  const light = new THREE.Group();
  const trunk = (x: number, z: number, r: number, h: number) => colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, bottom: G, top: G + h });
  const taken: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);
  return { kit: { root, labels, rand, parts, silo, mill, light, colliders, night, cullable, around, trunk, taken, free }, seen };
}
