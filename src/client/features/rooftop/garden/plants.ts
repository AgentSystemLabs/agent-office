import type { Collider } from '../../../world/types';
import { VoxBatch } from './voxkit';
import type { Blocks } from './voxscene';
import { bambooGeo, bananaGeo, broadGeo, cloverGeo, flowerGeo, groundFernGeo, grassGeo, ivyGeo, monsteraGeo, palmGeo, treeFernGeo } from './voxplants';

// The garden's plants, one function each. Each stamps a plant made of small blocks (see voxplants.ts) into
// the batch and leaves a collider behind for what you can't walk through. (x, y, z) is where each stands,
// y being the soil it grows from. `face`, here and below: the way its leaves fan when it stands at an edge
// (0 is +z); without it they ring all the way round.

export interface Grow {
  v: VoxBatch;
  /** The blocks everything else is built of (0.05 m), the finer ones (0.025 m) for small things, and the ones that glow. */
  b: Blocks;
  fine: Blocks;
  glowB: Blocks;
  r: () => number;
  colliders: Collider[];
}

const fixed = (x: number, z: number, r: number): Collider => ({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top: 99 });
/** The nearest of a few sizes, so plants of about the same size share one model; the stamp's scale makes up the rest. */
const near = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);

export function treeFern(g: Grow, x: number, y: number, z: number, h: number, face?: number) {
  const hb = near(h, 0.5);
  const v = Math.floor(g.r() * 2);
  g.v.add(`fern|${hb}|${face === undefined ? 0 : 1}|${v}`, () => treeFernGeo(hb, face !== undefined, v), x, y, z, face ?? g.r() * 6.28, h / hb);
  g.colliders.push(fixed(x, z, 0.18));
}

export function palm(g: Grow, x: number, y: number, z: number, h: number, face?: number) {
  const hb = near(h, 0.5);
  const v = Math.floor(g.r() * 2);
  g.v.add(`palm|${hb}|${face === undefined ? 0 : 1}|${v}`, () => palmGeo(hb, face !== undefined, v), x, y, z, face ?? g.r() * 6.28, h / hb);
  g.colliders.push(fixed(x, z, 0.15));
}

/** A banana plant; `bud` hangs a purple flower from it. */
export function banana(g: Grow, x: number, y: number, z: number, h: number, face?: number, bud = false) {
  const hb = near(h, 0.5);
  const v = Math.floor(g.r() * 2);
  g.v.add(`banana|${hb}|${face === undefined ? 0 : 1}|${bud ? 1 : 0}|${v}`, () => bananaGeo(hb, face !== undefined, bud, v), x, y, z, face ?? g.r() * 6.28, h / hb);
  g.colliders.push(fixed(x, z, 0.2));
}

export function monstera(g: Grow, x: number, y: number, z: number, scale: number, face?: number) {
  const sb = near(scale, 0.25);
  const v = Math.floor(g.r() * 2);
  g.v.add(`monstera|${sb}|${face === undefined ? 0 : 1}|${v}`, () => monsteraGeo(sb, face !== undefined, v), x, y, z, face ?? g.r() * 6.28, scale / sb);
}

/** A clump of bamboo: slim ringed culms leaning a little apart, leafy only near the top. */
export function bamboo(g: Grow, x: number, y: number, z: number, culms: number, h: number) {
  const hb = near(h, 0.5);
  const v = Math.floor(g.r() * 2);
  g.v.add(`bamboo|${culms}|${hb}|${v}`, () => bambooGeo(culms, hb, v), x, y, z, g.r() * 6.28, h / hb);
  g.colliders.push(fixed(x, z, 0.28 + culms * 0.012));
}

/** A tuft of tall grass: blades fanning up and arching over. `golds` mixes in some dry, straw-coloured ones. */
export function grass(g: Grow, x: number, y: number, z: number, n: number, h: number, golds = 0.15) {
  const hb = near(h, 0.25);
  const v = Math.floor(g.r() * 3);
  g.v.add(`grass|${n}|${hb}|${golds}|${v}`, () => grassGeo(n, hb, golds, v), x, y, z, g.r() * 6.28, h / hb);
}

/** A mound of broad leaves, a hosta or an aspidistra. */
export function broadleaf(g: Grow, x: number, y: number, z: number, n: number, s: number, hex = '#3f8a3e') {
  const v = Math.floor(g.r() * 3);
  g.v.add(`broad|${n}|${s}|${hex}|${v}`, () => broadGeo(n, s, hex, v), x, y, z, g.r() * 6.28);
}

/** A small fern for the ground: a rosette of low fronds. */
export function groundFern(g: Grow, x: number, y: number, z: number, s: number) {
  const v = Math.floor(g.r() * 3);
  g.v.add(`gfern|${s}|${v}`, () => groundFernGeo(s, v), x, y, z, g.r() * 6.28);
}

/** A patch of clover or sorrel: little leaves lying on the ground. */
export function clover(g: Grow, x: number, y: number, z: number, radius: number, n: number) {
  for (let i = 0; i < n; i++) {
    const a = g.r() * 6.28;
    const d = Math.sqrt(g.r()) * radius;
    const v = Math.floor(g.r() * 3);
    g.v.add(`clover|${v}`, () => cloverGeo(v), x + Math.cos(a) * d, y + 0.01 + g.r() * 0.03, z + Math.sin(a) * d, g.r() * 6.28, 0.9 + g.r() * 0.5);
  }
}

export const PETALS = { red: '#9d1128', orange: '#e86a1b', purple: '#6d3a9c', white: '#f4efe4', pink: '#d94f7a', gold: '#f0b429' } as const;

/** A flower on a stalk: a ring of petals round a gold eye (`head`), or a spike of small blooms up the top of the stem (`spike`). */
export function flower(g: Grow, x: number, y: number, z: number, h: number, color: string, kind: 'head' | 'spike' = 'head') {
  const hb = near(h, 0.05);
  const v = Math.floor(g.r() * 3);
  g.v.add(`flower|${kind}|${color}|${hb}|${v}`, () => flowerGeo(hb, color, kind, v), x, y, z, g.r() * 6.28);
}

/** A hanging strand of ivy: a thin vine with heart-shaped leaves along it. */
export function ivyStrand(g: Grow, x: number, y: number, z: number, len: number) {
  const lb = near(len, 0.3);
  const v = Math.floor(g.r() * 3);
  g.v.add(`ivy|${lb}|${v}`, () => ivyGeo(lb, v), x, y, z, g.r() * 6.28);
}

