import { Vox } from './vox';

// The pieces the Vancouver landmarks are built from, in whole-meter blocks: towers with banded windows
// (some of them lit at night, see Build.lit), round decks, stepped tops and sails.

export interface Theme {
  wall: string;
  glass: string;
  band: string;
}

/** A model in two parts: what's there by day, and the windows that glow at night. */
export class Build {
  v = new Vox(1, 0.05);
  lit = new Vox(1, 0.05);
  rnd: () => number;
  constructor(rnd: () => number) {
    this.rnd = rnd;
  }

  /** A tower from y0 up `h`, its walls banded with windows. */
  tower(cx: number, cz: number, w: number, d: number, y0: number, h: number, t: Theme, litPct = 30, roof = '#8d8f92') {
    const x0 = Math.round(cx - w / 2), x1 = x0 + w, z0 = Math.round(cz - d / 2), z1 = z0 + d;
    for (let j = y0; j < y0 + h; j++) {
      const top = j === y0 + h - 1;
      const row = (j - y0) % 4;
      for (let i = x0; i < x1; i++)
        for (let k = z0; k < z1; k++) {
          const ex = i === x0 || i === x1 - 1, ez = k === z0 || k === z1 - 1;
          if (!ex && !ez && !top) continue;
          if (top) { this.v.put(i, j, k, roof); continue; }
          const u = ex ? k : i;
          const corner = ex && ez;
          const win = !corner && row >= 1 && row <= 2 && u % 3 !== 0;
          if (!win) { this.v.put(i, j, k, row === 0 ? t.band : (i + k) % 6 < 1 ? t.band : t.wall); continue; }
          const h2 = Math.imul(Math.floor(u / 3) * 73856093 ^ Math.floor((j - y0) / 4) * 19349663 ^ (ex ? (i === x0 ? 1 : 2) : k === z0 ? 3 : 4) * 83492791, 2246822519) >>> 0;
          if (h2 % 100 < litPct) {
            this.lit.put(i === x0 ? i + 1 : i === x1 - 1 ? i - 1 : i, j, k === z0 ? k + 1 : k === z1 - 1 ? k - 1 : k, '#ffffff', 0.02);
            continue;
          }
          this.v.put(i, j, k, t.glass);
        }
    }
  }

  /** A solid block (a podium, a plinth, a hull). */
  slab(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string | ((i: number, j: number, k: number) => string), jitter?: number) {
    this.v.box(x0, y0, z0, x1, y1, z1, color, jitter);
  }

  /** A round layer: a filled disc of radius `r` (ellipse `r` by `rz`) at height y. */
  disc(cx: number, cz: number, r: number, y: number, color: string, rz = r, thick = 1) {
    for (let j = y; j < y + thick; j++)
      for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++)
        for (let k = Math.floor(cz - rz); k <= Math.ceil(cz + rz); k++) if (((i - cx) / r) ** 2 + ((k - cz) / rz) ** 2 <= 1) this.v.put(i, j, k, color);
  }

  /** A stepped pyramid from y, shrinking by one block each layer. */
  pyramid(cx: number, cz: number, w: number, d: number, y: number, color: string, layers = Math.min(w, d) / 2) {
    for (let l = 0; l < layers; l++) this.slab(Math.round(cx - w / 2) + l, y + l, Math.round(cz - d / 2) + l, Math.round(cx + w / 2) - l, y + l + 1, Math.round(cz + d / 2) - l, color);
  }
}

/** A straight line of blocks (a cable, a rail) from a to b. */
export function line(v: Vox, a: [number, number, number], b: [number, number, number], color: string) {
  const n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2])));
  for (let s = 0; s <= n; s++) v.put(Math.round(a[0] + ((b[0] - a[0]) * s) / n), Math.round(a[1] + ((b[1] - a[1]) * s) / n), Math.round(a[2] + ((b[2] - a[2]) * s) / n), color, 0.02);
}
