import * as THREE from 'three';

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
/** Brightness of a face corner by how many neighbours crowd it: the baked soft shadow where blocks meet. */
const AO = [0.52, 0.72, 0.87, 1];

/** A colour for a block: a hex, a grey (to be tinted by the material), nothing (white, tinted by the material) or a function of the block. */
export type VoxColor = string | number | null | ((i: number, j: number, k: number) => string);

const noise = (i: number, j: number, k: number) => {
  let h = Math.imul(i * 73856093 ^ j * 19349663 ^ k * 83492791, 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1;
};

/**
 * Real voxel models, as in the look prototype: a sparse grid of tiny cubes merged into one mesh, hidden
 * faces dropped, each block a touch different in tone and each corner shaded by what's next to it.
 * Blocks with no colour are grey, so the mesh's material (a shirt, a skin, a hair colour) tints them.
 */
export class Vox {
  private cells = new Map<number, { i: number; j: number; k: number; r: number; g: number; b: number }>();

  constructor(private size: number, private jitter = 0.06) {}

  private key(i: number, j: number, k: number) {
    return ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);
  }

  private has(i: number, j: number, k: number) {
    return this.cells.has(this.key(i, j, k));
  }

  put(i: number, j: number, k: number, color: VoxColor = null, jitter = this.jitter) {
    const c = new THREE.Color();
    if (typeof color === 'number') c.setScalar(color);
    else if (color === null) c.setScalar(1);
    else c.set(typeof color === 'function' ? color(i, j, k) : color);
    c.multiplyScalar(1 + noise(i, j, k) * jitter);
    this.cells.set(this.key(i, j, k), { i, j, k, r: c.r, g: c.g, b: c.b });
  }

  /** A block of voxels between two corners, in the model's own units. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: VoxColor = null, jitter?: number) {
    const s = this.size;
    const a = Math.round(x0 / s), b = Math.round(y0 / s), c = Math.round(z0 / s);
    const d = Math.max(a + 1, Math.round(x1 / s)), e = Math.max(b + 1, Math.round(y1 / s)), f = Math.max(c + 1, Math.round(z1 / s));
    for (let i = a; i < d; i++) for (let j = b; j < e; j++) for (let k = c; k < f; k++) this.put(i, j, k, color, jitter);
    return this;
  }

  /** A lump of voxels: an ellipsoid, for a bun, a puff of curls. */
  ell(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, color: VoxColor = null, jitter?: number) {
    const s = this.size;
    for (let i = Math.floor((cx - rx) / s); i <= Math.ceil((cx + rx) / s); i++)
      for (let j = Math.floor((cy - ry) / s); j <= Math.ceil((cy + ry) / s); j++)
        for (let k = Math.floor((cz - rz) / s); k <= Math.ceil((cz + rz) / s); k++) {
          const x = (i + 0.5) * s - cx, y = (j + 0.5) * s - cy, z = (k + 0.5) * s - cz;
          if ((x * x) / (rx * rx) + (y * y) / (ry * ry) + (z * z) / (rz * rz) <= 1) this.put(i, j, k, color, jitter);
        }
    return this;
  }

  build(): THREE.BufferGeometry {
    const s = this.size, pos: number[] = [], nor: number[] = [], col: number[] = [];
    for (const v of this.cells.values()) {
      for (const n of DIRS) {
        if (this.has(v.i + n[0], v.j + n[1], v.k + n[2])) continue;
        const u = n[0] ? [0, 1, 0] : n[1] ? [0, 0, 1] : [1, 0, 0];
        const w = n[0] ? [0, 0, 1] : n[1] ? [1, 0, 0] : [0, 1, 0];
        const flip = n[0] + n[1] + n[2] < 0;
        const q: number[][] = [], ao: number[] = [];
        for (const [cu, cv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          q.push([(v.i + 0.5 + 0.5 * n[0] + 0.5 * cu * u[0] + 0.5 * cv * w[0]) * s,
            (v.j + 0.5 + 0.5 * n[1] + 0.5 * cu * u[1] + 0.5 * cv * w[1]) * s,
            (v.k + 0.5 + 0.5 * n[2] + 0.5 * cu * u[2] + 0.5 * cv * w[2]) * s]);
          const bx = v.i + n[0], by = v.j + n[1], bz = v.k + n[2];
          const s1 = this.has(bx + cu * u[0], by + cu * u[1], bz + cu * u[2]) ? 1 : 0;
          const s2 = this.has(bx + cv * w[0], by + cv * w[1], bz + cv * w[2]) ? 1 : 0;
          const c3 = this.has(bx + cu * u[0] + cv * w[0], by + cu * u[1] + cv * w[1], bz + cu * u[2] + cv * w[2]) ? 1 : 0;
          ao.push(AO[s1 && s2 ? 0 : 3 - (s1 + s2 + c3)]);
        }
        const tris = ao[0] + ao[2] < ao[1] + ao[3] ? [[1, 2, 3], [1, 3, 0]] : [[0, 1, 2], [0, 2, 3]];
        for (const t of tris) {
          for (const idx of flip ? [t[0], t[2], t[1]] : t) {
            pos.push(q[idx][0], q[idx][1], q[idx][2]);
            nor.push(n[0], n[1], n[2]);
            col.push(v.r * ao[idx], v.g * ao[idx], v.b * ao[idx]);
          }
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}
