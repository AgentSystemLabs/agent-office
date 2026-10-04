import * as THREE from 'three';
import { Vox } from '../../../world/vox';
import { mix } from './voxkit';
import { hash3 } from './leaves';

// Everything in the garden that isn't a plant, built of blocks the same way: boards, posts, rocks, stones
// and moss are all rasterised into one grid of small cubes, hidden faces dropped, each corner shaded by
// its neighbours. One grid is one mesh.

export const blockMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
const P = new THREE.Vector3();

export class Blocks {
  readonly v: Vox;
  constructor(readonly s = 0.05, jitter = 0.07) {
    this.v = new Vox(s, jitter);
  }

  /** A timber board, post or slab: `w`, `h`, `d` across, up and deep, centred at (x, y, z), turned about y and then tipped about x. Never thinner than one block. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, rotY: number, rotX: number, color: string, grain = 0.12, jitter?: number) {
    const s = this.s;
    const half = [Math.max(w, s) / 2, Math.max(h, s) / 2, Math.max(d, s) / 2];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0, 'YXZ'));
    const inv = q.clone().invert();
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let c = 0; c < 8; c++) {
      P.set(c & 1 ? half[0] : -half[0], c & 2 ? half[1] : -half[1], c & 4 ? half[2] : -half[2]).applyQuaternion(q);
      const p = [P.x + x, P.y + y, P.z + z];
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], p[a]);
        hi[a] = Math.max(hi[a], p[a]);
      }
    }
    const long = half[0] >= half[1] && half[0] >= half[2] ? 0 : half[1] >= half[2] ? 1 : 2;
    const dark = mix(color, '#000000', 0.22);
    for (let i = Math.floor(lo[0] / s); i <= Math.floor(hi[0] / s); i++)
      for (let j = Math.floor(lo[1] / s); j <= Math.floor(hi[1] / s); j++)
        for (let k = Math.floor(lo[2] / s); k <= Math.floor(hi[2] / s); k++) {
          P.set((i + 0.5) * s - x, (j + 0.5) * s - y, (k + 0.5) * s - z).applyQuaternion(inv);
          if (Math.abs(P.x) > half[0] || Math.abs(P.y) > half[1] || Math.abs(P.z) > half[2]) continue;
          // Grain: streaks that run along the board's length.
          const cross = long === 0 ? [P.y, P.z] : long === 1 ? [P.x, P.z] : [P.x, P.y];
          const streak = grain > 0 && hash3(Math.round(cross[0] / s) * 3.1, Math.round(cross[1] / s) * 1.7, long) > 0.72;
          this.v.put(i, j, k, streak ? dark : color, jitter);
        }
  }

  /** A lump (a rock, a cushion of moss): an ellipsoid with a rough surface, cut off below `minY`. `color` is told how high up the block is (-1 to 1) and a random number. */
  blob(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, rotY: number, color: (ny: number, n: number) => string, rough = 0.3, minY = 0, jitter?: number) {
    const s = this.s;
    const r = Math.max(rx, rz) * 1.2;
    const [cs, sn] = [Math.cos(rotY), Math.sin(rotY)];
    for (let i = Math.floor((cx - r) / s); i <= Math.ceil((cx + r) / s); i++)
      for (let j = Math.floor(Math.max(minY, cy - ry * 1.2) / s); j <= Math.ceil((cy + ry * 1.2) / s); j++)
        for (let k = Math.floor((cz - r) / s); k <= Math.ceil((cz + r) / s); k++) {
          const [dx, dy, dz] = [(i + 0.5) * s - cx, (j + 0.5) * s - cy, (k + 0.5) * s - cz];
          if ((j + 0.5) * s < minY) continue;
          const [lx, lz] = [dx * cs - dz * sn, dx * sn + dz * cs];
          const n = hash3(i * 0.7, j * 0.7, k * 0.7);
          if ((lx / rx) ** 2 + (dy / ry) ** 2 + (lz / rz) ** 2 <= 1 + rough * (n - 0.5)) this.v.put(i, j, k, color(dy / ry, n), jitter);
        }
  }

  /** A flat round slab (a stepping stone, a lily pad, a basin): from y0 up `thick`. */
  disc(cx: number, y0: number, cz: number, rx: number, rz: number, thick: number, rotY: number, color: (n: number) => string, rough = 0.25, jitter?: number) {
    const s = this.s;
    const r = Math.max(rx, rz) * 1.2;
    const [cs, sn] = [Math.cos(rotY), Math.sin(rotY)];
    const [j0, j1] = [Math.floor(y0 / s + 0.001), Math.max(Math.floor(y0 / s + 0.001), Math.ceil((y0 + thick) / s - 0.001) - 1)];
    for (let i = Math.floor((cx - r) / s); i <= Math.ceil((cx + r) / s); i++)
      for (let k = Math.floor((cz - r) / s); k <= Math.ceil((cz + r) / s); k++) {
        const [dx, dz] = [(i + 0.5) * s - cx, (k + 0.5) * s - cz];
        const [lx, lz] = [dx * cs - dz * sn, dx * sn + dz * cs];
        const n = hash3(i * 0.9, 5, k * 0.9);
        if ((lx / rx) ** 2 + (lz / rz) ** 2 <= 1 + rough * (n - 0.5)) for (let j = j0; j <= j1; j++) this.v.put(i, j, k, color(n), jitter);
      }
  }

  /** A thin ring of blocks, `r` out from the centre. */
  ring(cx: number, y: number, cz: number, r: number, color: string) {
    const s = this.s;
    for (let i = Math.floor((cx - r) / s) - 1; i <= Math.ceil((cx + r) / s) + 1; i++)
      for (let k = Math.floor((cz - r) / s) - 1; k <= Math.ceil((cz + r) / s) + 1; k++)
        if (Math.abs(Math.hypot((i + 0.5) * s - cx, (k + 0.5) * s - cz) - r) <= s * 0.55) this.v.put(i, Math.floor(y / s), k, color, 0);
  }

  mesh(material: THREE.Material = blockMaterial): THREE.Mesh {
    const m = new THREE.Mesh(this.v.build(), material);
    m.castShadow = m.receiveShadow = true;
    return m;
  }
}

/** Stone greys with moss growing on the tops. */
export const rock = (grey: string[], mossy = 0.5) => (ny: number, n: number) => (ny > 0.35 && n > 1 - mossy * (ny + 0.3) ? ['#4e8a3a', '#5a9640', '#3f7a38'][Math.floor(n * 7) % 3] : grey[Math.floor(n * 11) % grey.length]);

