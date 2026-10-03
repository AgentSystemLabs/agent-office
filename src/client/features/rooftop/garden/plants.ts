import { blockCylinder, blockBall } from '../../../world/blocky';
import * as THREE from 'three';
import type { Collider } from '../../../world/types';
import { FoliageBatch, Solids, frondGeometry, lance, leafGeometry, place } from './leaves';

// The garden's plants, one function each. They add leaves to the foliage batch and trunks and stems to
// the solids, and leave a collider behind for what you can't walk through. (x, y, z) is where each
// stands, y being the soil it grows from.

/** The shaped leaves, each made once and stamped wherever a plant wants one. */
export function templates() {
  const notched = (t: number, row: number) => lance(0.62, 0.7)(t) * (row >= 3 && row <= 9 && row % 2 === 1 ? 0.42 : 1);
  const ragged = (t: number, row: number) => lance(0.55, 0.5)(t) * (row >= 2 && row % 2 === 1 ? 0.84 : 1);
  return {
    fern: frondGeometry({ length: 1, pairs: 15, leaflet: 0.2, ratio: 0.2, arch: 1.15, spread: 1.15, droop: 0.7 }),
    smallFern: frondGeometry({ length: 1, pairs: 9, leaflet: 0.22, ratio: 0.22, arch: 0.9, spread: 1.1, droop: 0.6 }),
    palm: frondGeometry({ length: 1, pairs: 20, leaflet: 0.3, ratio: 0.07, arch: 1.05, spread: 0.85, droop: 0.9, spine: 0.025 }),
    banana: leafGeometry({ rows: 8, cols: 5, length: 1, width: 0.36, profile: ragged, arch: 1.2, fold: 0.35 }),
    monstera: leafGeometry({ rows: 12, cols: 5, length: 1, width: 0.95, profile: notched, arch: 0.55, fold: 0.3, heart: 0.14 }),
    broad: leafGeometry({ rows: 5, cols: 3, length: 1, width: 0.5, profile: lance(0.6, 0.8), arch: 0.8, fold: 0.3 }),
    bamboo: leafGeometry({ rows: 3, cols: 3, length: 1, width: 0.14, profile: lance(0.8, 0.8), arch: 0.3, fold: 0.5 }),
    blade: leafGeometry({ rows: 6, cols: 3, length: 1, width: 0.03, profile: (t) => Math.pow(1 - t, 0.7), arch: 1.0, fold: 0.5 }),
    ivy: leafGeometry({ rows: 3, cols: 3, length: 1, width: 0.95, profile: lance(0.6, 0.7), arch: 0.4, fold: 0.3, heart: 0.18 }),
    petal: leafGeometry({ rows: 3, cols: 3, length: 1, width: 0.55, profile: lance(0.5, 0.7), arch: -0.6, fold: -0.3 }),
    clover: leafGeometry({ rows: 4, cols: 3, length: 1, width: 1, profile: lance(0.5, 0.45), arch: 0.2, fold: 0.3 }),
  };
}

export interface Grow {
  f: FoliageBatch;
  s: Solids;
  r: () => number;
  t: ReturnType<typeof templates>;
  colliders: Collider[];
  /** Lantern glass: the geometry that glows. */
  glow: THREE.BufferGeometry[];
}

const lerp = THREE.MathUtils.lerp;

/** A colour a little different from `hex` each time: no two leaves quite alike. */
export function tint(g: Grow, hex: string | THREE.Color, amt = 0.07): THREE.Color {
  return new THREE.Color(hex).offsetHSL((g.r() - 0.5) * 0.035, (g.r() - 0.5) * 0.12, (g.r() - 0.5) * amt);
}

const pick = <T>(g: Grow, list: readonly T[]): T => list[Math.floor(g.r() * list.length)];

const fixed = (x: number, z: number, r: number): Collider => ({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top: 99 });

/** A thin curved stem, a petiole or a vine, as a tube through `pts`. */
export function stem(g: Grow, pts: THREE.Vector3[], radius: number, color: string, kind: 'moss' | 'wood' = 'moss') {
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, radius, 4);
  g.s.add(kind, geo, color, undefined, 0.12);
}

interface TrunkOpts {
  color: string;
  grain?: number;
  /** A ring (a node, a leaf scar) every `seg` meters, standing out by `bump`. */
  seg?: number;
  bump?: number;
  /** How far the top leans off the foot, as a fraction of the height. */
  lean?: THREE.Vector2;
}

/** A tapered, ringed trunk bending as it rises. Returns its top. */
function trunk(g: Grow, x: number, y: number, z: number, h: number, r0: number, r1: number, o: TrunkOpts): THREE.Vector3 {
  const pts: THREE.Vector2[] = [new THREE.Vector2(r0 * 1.1, 0)];
  const seg = o.seg ?? h;
  const n = Math.max(1, Math.round(h / seg));
  for (let k = 0; k < n; k++) {
    for (const [a, b] of [
      [0.04, 1],
      [0.94, 1],
      [1, 1 + (o.bump ?? 0)],
    ]) {
      const t = Math.min(1, (k + a) / n);
      pts.push(new THREE.Vector2(lerp(r0, r1, t) * (b as number), t * h));
    }
  }
  const geo = new THREE.LatheGeometry(pts, 4);
  const lean = o.lean ?? new THREE.Vector2();
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h;
    p.setX(i, p.getX(i) + lean.x * h * t * t);
    p.setZ(i, p.getZ(i) + lean.y * h * t * t);
  }
  geo.computeVertexNormals();
  g.s.add('wood', geo, o.color, new THREE.Matrix4().makeTranslation(x, y, z), 0.1, o.grain ?? 0.15);
  return new THREE.Vector3(x + lean.x * h, y + h, z + lean.y * h);
}

/** A ring of fronds or big leaves round `top`: the young ones steep in the middle, the old ones low and long. */
function rosette(g: Grow, tpl: THREE.BufferGeometry, top: THREE.Vector3, n: number, len: [number, number], pitch: [number, number], hex: string, sway: number, face?: number) {
  const phase = g.r() * 6.28;
  for (let i = 0; i < n; i++) {
    const k = i / Math.max(1, n - 1);
    const yaw = face === undefined ? i * 2.39996 + g.r() * 0.3 : face + (((i * 0.618034 + g.r() * 0.08) % 1) - 0.5) * 3.8;
    const s = lerp(len[0], len[1], 0.35 + 0.65 * k) * (0.9 + 0.2 * g.r());
    g.f.add(tpl, place(top.x, top.y, top.z, yaw, lerp(pitch[0], pitch[1], k) + (g.r() - 0.5) * 0.15, s, (g.r() - 0.5) * 0.3), tint(g, hex), sway, phase + g.r() * 0.6);
  }
}

/** A tree fern: a fibrous trunk under a crown of arching fronds, with a fiddlehead or two unfurling. (`face`, here and below: the way its leaves fan, when it stands at an edge; 0 is +z.) */
export function treeFern(g: Grow, x: number, y: number, z: number, h: number, face?: number) {
  const lean = new THREE.Vector2((g.r() - 0.5) * 0.08, (g.r() - 0.5) * 0.08);
  const top = trunk(g, x, y, z, h, 0.14, 0.09, { color: '#4d3626', grain: 0.3, seg: 0.16, bump: 0.1, lean });
  rosette(g, g.t.fern, top, 15, [1.0, 1.55], [1.2, 0.35], '#3f8236', 0.075, face);
  for (let i = 0; i < 2; i++) {
    const a = g.r() * 6.28;
    const dx = Math.cos(a) * 0.1;
    const dz = Math.sin(a) * 0.1;
    stem(g, [new THREE.Vector3(top.x, top.y, top.z), new THREE.Vector3(top.x + dx, top.y + 0.22, top.z + dz), new THREE.Vector3(top.x + dx * 2.2, top.y + 0.36, top.z + dz * 2.2), new THREE.Vector3(top.x + dx * 2.6, top.y + 0.3, top.z + dz * 2.6), new THREE.Vector3(top.x + dx * 2.2, top.y + 0.27, top.z + dz * 2.2)], 0.014, '#8aa84a');
  }
  g.colliders.push(fixed(top.x * 0.5 + x * 0.5, top.z * 0.5 + z * 0.5, 0.18));
}

/** A palm: a ringed grey-brown trunk, a green crownshaft, and feathery fronds arching out and down. */
export function palm(g: Grow, x: number, y: number, z: number, h: number, face?: number) {
  const lean = new THREE.Vector2((g.r() - 0.5) * 0.14, (g.r() - 0.5) * 0.14);
  const top = trunk(g, x, y, z, h, 0.1, 0.07, { color: '#7a6a55', grain: 0.2, seg: 0.1, bump: 0.12, lean });
  g.s.add('wood', blockCylinder(0.065, 0.07, 0.34, 8), '#8bb04e', new THREE.Matrix4().makeTranslation(top.x, top.y - 0.03, top.z), 0.08);
  rosette(g, g.t.palm, top.clone().setY(top.y + 0.1), 11, [1.45, 1.85], [1.1, -0.1], '#3f8a3a', 0.09, face);
  g.colliders.push(fixed(x + lean.x * h * 0.4, z + lean.y * h * 0.4, 0.15));
}

/** A banana plant: a thick pseudostem under a few huge, ragged, arching leaves; `bud` hangs a purple flower from it. */
export function banana(g: Grow, x: number, y: number, z: number, h: number, face?: number, bud = false) {
  const top = trunk(g, x, y, z, h * 0.72, 0.15, 0.09, { color: '#8aa45a', grain: 0.22, lean: new THREE.Vector2((g.r() - 0.5) * 0.06, (g.r() - 0.5) * 0.06) });
  rosette(g, g.t.banana, top, 8, [1.5, 2.05], [1.15, 0.4], '#5f9e36', 0.11, face);
  if (bud) {
    const a = g.r() * 6.28;
    const p = (r: number, dy: number) => new THREE.Vector3(top.x + Math.cos(a) * r, top.y + dy, top.z + Math.sin(a) * r);
    stem(g, [p(0, -0.1), p(0.2, 0), p(0.4, -0.15), p(0.42, -0.4)], 0.022, '#7a8f4a');
    g.s.add('cloth', blockBall(1, 10, 8), '#5a1d4c', new THREE.Matrix4().compose(p(0.42, -0.58), new THREE.Quaternion(), new THREE.Vector3(0.07, 0.17, 0.07)), 0.12);
  }
  g.colliders.push(fixed(x, z, 0.2));
}

/** A monstera: big glossy split leaves on long arching stalks. */
export function monstera(g: Grow, x: number, y: number, z: number, scale: number, face?: number) {
  const phase = g.r() * 6.28;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const yaw = face === undefined ? i * 2.39996 + g.r() * 0.4 : face + (((i * 0.618034 + g.r() * 0.08) % 1) - 0.5) * 3.4;
    const reach = (0.35 + 0.5 * g.r()) * scale;
    const rise = (0.45 + 0.5 * g.r()) * scale;
    const [dx, dz] = [Math.sin(yaw), Math.cos(yaw)];
    stem(g, [new THREE.Vector3(x, y, z), new THREE.Vector3(x + dx * reach * 0.2, y + rise * 0.7, z + dz * reach * 0.2), new THREE.Vector3(x + dx * reach, y + rise, z + dz * reach)], 0.011 * scale, '#5b8f3d');
    const s = (0.42 + 0.2 * g.r()) * scale;
    g.f.add(g.t.monstera, place(x + dx * reach, y + rise, z + dz * reach, yaw + (g.r() - 0.5) * 0.5, 0.1 + g.r() * 0.35, s, (g.r() - 0.5) * 0.25), tint(g, '#2a6a3a', 0.08), 0.03, phase + g.r() * 0.5, new THREE.Color('#b6cf86'));
  }
}

/** A clump of bamboo: slim ringed culms leaning a little apart, leafy only near the top. */
export function bamboo(g: Grow, x: number, y: number, z: number, culms: number, h: number) {
  const phase = g.r() * 6.28;
  for (let i = 0; i < culms; i++) {
    const a = g.r() * 6.28;
    const off = 0.05 + g.r() * 0.3;
    const ch = h * (0.75 + 0.25 * g.r());
    const lean = new THREE.Vector2(Math.cos(a) * (0.03 + 0.07 * g.r()), Math.sin(a) * (0.03 + 0.07 * g.r()));
    const bx = x + Math.cos(a) * off;
    const bz = z + Math.sin(a) * off;
    const top = trunk(g, bx, y, bz, ch, 0.026, 0.014, { color: pick(g, ['#8aa84a', '#a3b45a', '#6f9440']), grain: 0.1, seg: 0.32, bump: 0.45, lean });
    const phase2 = phase + g.r() * 0.5;
    for (let h2 = ch * 0.55; h2 < ch; h2 += 0.3) {
      const t = h2 / ch;
      const px = bx + lean.x * h2 * t;
      const pz = bz + lean.y * h2 * t;
      for (let k = 0; k < 3; k++) {
        const yaw = g.r() * 6.28;
        const pitch = -0.3 + g.r() * 0.7;
        const s = (0.2 + 0.1 * g.r()) * (1.2 - 0.5 * t + 0.3);
        g.f.add(g.t.bamboo, place(px, y + h2, pz, yaw, pitch, s, 0, 1.2), tint(g, pick(g, ['#5f9a3a', '#78a843', '#4f8a38']), 0.1), 0.05, phase2 + g.r() * 0.7);
      }
    }
    g.f.add(g.t.bamboo, place(top.x, top.y, top.z, g.r() * 6.28, 1.2, 0.26, 0, 1.2), tint(g, '#78a843'), 0.06, phase2);
  }
  g.colliders.push(fixed(x, z, 0.28 + culms * 0.012));
}

/** A tuft of tall grass: blades fanning up and arching over. `golds` mixes in some dry, straw-coloured ones. */
export function grass(g: Grow, x: number, y: number, z: number, n: number, h: number, golds = 0.15) {
  const phase = g.r() * 6.28;
  for (let i = 0; i < n; i++) {
    const a = g.r() * 6.28;
    const off = g.r() * 0.12;
    const hex = g.r() < golds ? pick(g, ['#c3b560', '#b5a552']) : pick(g, ['#86a64a', '#6f9a44', '#9ab455']);
    g.f.add(g.t.blade, place(x + Math.cos(a) * off, y, z + Math.sin(a) * off, a, 1.0 + g.r() * 0.45, h * (0.6 + 0.5 * g.r()), (g.r() - 0.5) * 0.4, 0.8 + g.r() * 0.9), tint(g, hex, 0.1), 0.16, phase + g.r() * 0.9, new THREE.Color('#d9e3a2'));
  }
}

/** A mound of broad leaves, a hosta or an aspidistra. */
export function broadleaf(g: Grow, x: number, y: number, z: number, n: number, s: number, hex = '#3f8a3e') {
  const phase = g.r() * 6.28;
  for (let i = 0; i < n; i++) {
    const k = i / n;
    g.f.add(g.t.broad, place(x + (g.r() - 0.5) * 0.12, y, z + (g.r() - 0.5) * 0.12, i * 2.39996, lerp(1.25, 0.55, k), s * (0.7 + 0.5 * g.r()), (g.r() - 0.5) * 0.4), tint(g, hex), 0.04, phase + g.r() * 0.5);
  }
}

/** A small fern for the ground: a rosette of low fronds. */
export function groundFern(g: Grow, x: number, y: number, z: number, s: number) {
  rosette(g, g.t.smallFern, new THREE.Vector3(x, y, z), 9, [0.5 * s, 0.8 * s], [0.95, 0.3], '#4a8f3c', 0.045);
}

/** A patch of clover or sorrel: little round leaves lying on the ground. */
export function clover(g: Grow, x: number, y: number, z: number, radius: number, n: number) {
  for (let i = 0; i < n; i++) {
    const a = g.r() * 6.28;
    const d = Math.sqrt(g.r()) * radius;
    g.f.add(g.t.clover, place(x + Math.cos(a) * d, y + 0.02 + g.r() * 0.04, z + Math.sin(a) * d, g.r() * 6.28, 0.05 + g.r() * 0.2, 0.08 + g.r() * 0.06, g.r() * 6.28), tint(g, pick(g, ['#5e9e44', '#6aa94c', '#4e8f3e']), 0.1), 0.01, g.r() * 6.28, new THREE.Color('#a8cf7e'));
  }
}

export const PETALS = { red: '#9d1128', orange: '#e86a1b', purple: '#6d3a9c', white: '#f4efe4', pink: '#d94f7a', gold: '#f0b429' } as const;

/** A flower on a stalk: a ring of petals round a gold eye (`head`), or a spike of small blooms up the top of the stem (`spike`). */
export function flower(g: Grow, x: number, y: number, z: number, h: number, color: string, kind: 'head' | 'spike' = 'head') {
  const sx = (g.r() - 0.5) * 0.12;
  const sz = (g.r() - 0.5) * 0.12;
  stem(g, [new THREE.Vector3(x, y, z), new THREE.Vector3(x + sx * 0.4, y + h * 0.5, z + sz * 0.4), new THREE.Vector3(x + sx, y + h, z + sz)], 0.006, '#4f7f35');
  const [tx, tz] = [x + sx, z + sz];
  const phase = g.r() * 6.28;
  if (kind === 'head') {
    const s = 0.06 + g.r() * 0.04;
    const n = 8;
    for (let i = 0; i < n; i++) g.f.add(g.t.petal, place(tx, y + h, tz, (i / n) * 6.28 + g.r() * 0.2, 0.55 + g.r() * 0.2, s), tint(g, color, 0.12), 0.012, phase, new THREE.Color(color).multiplyScalar(0.8));
    for (let i = 0; i < 3; i++) g.f.add(g.t.petal, place(tx, y + h + 0.004, tz, (i / 3) * 6.28, 1.35, s * 0.35), new THREE.Color('#e8b92f'), 0.01, phase);
  } else {
    for (let k = 0; k < 14; k++) {
      const t = 0.5 + 0.5 * (k / 14);
      const a = k * 2.4;
      g.f.add(g.t.petal, place(x + sx * t * t + Math.cos(a) * 0.012, y + h * t, z + sz * t * t + Math.sin(a) * 0.012, a, 0.9 - 0.9 * (k / 14), 0.05 * (1.2 - k / 20), 0), tint(g, color, 0.12), 0.012, phase);
    }
  }
}

/** A hanging strand of ivy: a thin vine with heart-shaped leaves along it. */
export function ivyStrand(g: Grow, x: number, y: number, z: number, len: number) {
  const sway = (g.r() - 0.5) * 0.15;
  const pt = (t: number) => new THREE.Vector3(x + sway * t * t + Math.sin(t * 5 + x) * 0.025, y - len * t, z + Math.cos(t * 4 + z) * 0.025);
  stem(g, [pt(0), pt(0.33), pt(0.66), pt(1)], 0.006, '#4a6b32');
  const phase = g.r() * 6.28;
  for (let d = 0.05; d < len; d += 0.09 + g.r() * 0.05) {
    const p = pt(d / len);
    g.f.add(g.t.ivy, place(p.x, p.y, p.z, g.r() * 6.28, -0.5 - g.r() * 0.6, 0.07 + 0.04 * g.r(), g.r() - 0.5), tint(g, pick(g, ['#2f6b34', '#3d7d3a', '#4a8a40']), 0.1), 0.025, phase + g.r() * 0.4, new THREE.Color('#9cc47a'));
  }
}
