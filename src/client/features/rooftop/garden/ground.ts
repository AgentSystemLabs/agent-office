import type { Grow } from './plants';
import { rock } from './voxscene';

// The garden's ground: boulders, moss, stepping stones and the pond. Blocks, like the rest.

const TAU = Math.PI * 2;
const GREYS = [['#7d807b', '#72766f', '#888b85'], ['#8c908c', '#7d827e', '#9a9a92']];
const pickOf = <T,>(list: T[], v: number) => list[Math.floor(v * list.length) % list.length];

/** A rock: a rough lump of blocks, half sunk in the ground, grey with moss on top. */
export function boulder(g: Grow, x: number, z: number, r: number, h: number, hex = '#7d807b', collide = true) {
  const greys = hex === '#7d807b' ? GREYS[0] : [hex, hex];
  g.b.blob(x, h * 0.32, z, r, h * 0.9, r * (0.85 + 0.2 * g.r()), g.r() * TAU, rock(greys, 0.55), 0.45, 0, 0.1);
  if (collide) g.colliders.push({ minX: x - r * 0.85, maxX: x + r * 0.85, minZ: z - r * 0.85, maxZ: z + r * 0.85, top: h * 0.8 });
}

/** A low cushion of moss on the ground (or on a soil bed, at height `y`). */
export function moss(g: Grow, x: number, z: number, r: number, y = 0) {
  const greens = ['#4e8a3a', '#5a9640', '#3f7a38', '#69a24a'];
  g.fine.blob(x, y, z, r, 0.03 + 0.05 * g.r(), r * (0.7 + 0.3 * g.r()), g.r() * TAU, (_ny, n) => pickOf(greens, n), 0.5, y, 0.12);
}

/** Flat stepping stones along a winding line through `pts`. */
export function steppingStones(g: Grow, pts: [number, number][]) {
  const at = (t: number): [number, number] => {
    const f = Math.min(pts.length - 1.0001, t * (pts.length - 1));
    const i = Math.floor(f);
    const [a, b, c, d] = [pts[Math.max(0, i - 1)], pts[i], pts[i + 1], pts[Math.min(pts.length - 1, i + 2)]];
    const u = f - i;
    const cr = (p0: number, p1: number, p2: number, p3: number) => 0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (3 * p1 - p0 - 3 * p2 + p3) * u * u * u);
    return [cr(a[0], b[0], c[0], d[0]), cr(a[1], b[1], c[1], d[1])];
  };
  let len = 0;
  for (let i = 1; i <= 40; i++) len += Math.hypot(at(i / 40)[0] - at((i - 1) / 40)[0], at(i / 40)[1] - at((i - 1) / 40)[1]);
  const n = Math.round(len / 0.62);
  for (let i = 0; i <= n; i++) {
    const [cx, cz] = at(i / n);
    const r = 0.17 + 0.07 * g.r();
    const greys = GREYS[1];
    g.b.disc(cx + (g.r() - 0.5) * 0.12, 0, cz + (g.r() - 0.5) * 0.12, r * 1.15, r * (0.8 + 0.2 * g.r()), 0.05, g.r() * TAU, (n2) => pickOf(greys, n2), 0.3, 0.1);
    if (g.r() < 0.4) moss(g, cx + (g.r() - 0.5) * 0.5, cz + (g.r() - 0.5) * 0.5, 0.1 + 0.08 * g.r());
  }
}

/** A tiny pond: a ring of stones round dark water with lily pads and a pink lotus. Returns the water's plane's place in the scene (see garden.ts). */
export function pond(g: Grow, x: number, z: number, r: number): { x: number; z: number; r: number } {
  g.b.disc(x, 0, z, r + 0.05, r + 0.05, 0.06, 0, (n) => pickOf(['#232a26', '#1d2420', '#2a312c'], n), 0.1, 0.05);
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = 0.17 + 0.07 * g.r();
    g.b.blob(x + Math.cos(a) * (r + 0.1), 0.07, z + Math.sin(a) * (r + 0.1), rr * 1.0, rr * 0.9, rr * 0.85, g.r() * TAU, rock(['#8c908c', '#7a7f7a', '#9d9b92'], 0.4), 0.4, 0, 0.1);
  }
  for (const [dx, dz, s] of [
    [-0.25, 0.1, 0.14],
    [0.2, -0.22, 0.12],
    [0.12, 0.28, 0.1],
    [-0.1, -0.3, 0.09],
  ]) g.fine.disc(x + dx * (r / 0.72), 0.095, z + dz * (r / 0.72), s * 0.9, s * 0.9, 0.025, g.r() * TAU, (n2) => pickOf(['#3f7d3c', '#4a8a40', '#357235'], n2), 0.3, 0.08);
  return { x, z, r };
}


