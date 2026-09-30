import * as THREE from 'three';
import { mulberry32 } from '../../../shared/rng';
import { FOOTHILLS, MOUNTAINS, TUNNEL } from '../../../shared/scenic';
import { mergeByColor, mesh, toon } from '../toon';
import { G, type ScenicKit } from './kit';

/**
 * A mountain (or a green hill) with its foot `r` round (x, z) and `h` high: a lumpy, faceted cone,
 * grass at its foot, rock up its sides and, on the tall ones, snow on top. Its triangles go into the
 * three lists by what they're made of, for merging.
 */
function mountain(out: Record<'grass' | 'rock' | 'dark' | 'snow', number[]>, x: number, z: number, r: number, h: number, seed: number, hill = false) {
  const rand = mulberry32(seed);
  const n = r > 60 ? 14 : 11;
  const rings = 6;
  const ring: THREE.Vector3[][] = [];
  const spin = rand() * Math.PI * 2;
  for (let k = 0; k < rings; k++) {
    const f = k / rings;
    const row: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = spin + ((i + (k ? (rand() - 0.5) * 0.5 : 0)) / n) * Math.PI * 2;
      const rr = r * Math.pow(1 - f, hill ? 0.7 : 1.1) * (k ? 0.82 + rand() * 0.3 : 1);
      const y = k ? h * f * (0.9 + rand() * 0.18) : -0.6;
      row.push(new THREE.Vector3(x + Math.cos(a) * rr, G + y, z + Math.sin(a) * rr));
    }
    ring.push(row);
  }
  const peak = new THREE.Vector3(x + (rand() - 0.5) * r * 0.12, G + h, z + (rand() - 0.5) * r * 0.12);
  const snowline = h * (0.58 + rand() * 0.08);
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    const y = (a.y + b.y + c.y) / 3 - G;
    const band = hill ? (y > h * 0.55 && rand() < 0.5 ? 'dark' : 'grass') : h > 90 && y > snowline + (rand() - 0.5) * h * 0.08 ? 'snow' : y < h * 0.15 ? 'grass' : rand() < 0.5 ? 'rock' : 'dark';
    // Wound so they face out (and up).
    out[band].push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
  };
  for (let k = 0; k < rings; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (k === rings - 1) {
        tri(ring[k][i], ring[k][j], peak);
        continue;
      }
      tri(ring[k][i], ring[k][j], ring[k + 1][i]);
      tri(ring[k][j], ring[k + 1][j], ring[k + 1][i]);
    }
  }
}

/** Merged, flat-shaded meshes from `mountain`'s triangle lists. */
function mountainMeshes(out: Record<'grass' | 'rock' | 'dark' | 'snow', number[]>, colors: Record<'grass' | 'rock' | 'dark' | 'snow', string>): THREE.Mesh[] {
  return (Object.keys(out) as (keyof typeof out)[])
    .filter((k) => out[k].length)
    .map((k) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(out[k], 3));
      geo.computeVertexNormals();
      return mesh(geo, toon(colors[k]), 0, 0, 0, true);
    });
}

/** The mountains to the south, the green foothills, and the spur the tunnel goes through. */
export function buildMountains(kit: ScenicKit) {
  const { root, colliders, taken } = kit;
  {
    const tris = { grass: [] as number[], rock: [] as number[], dark: [] as number[], snow: [] as number[] };
    MOUNTAINS.forEach(([x, z, r, h], k) => {
      mountain(tris, x, z, r, h, 100 + k);
      colliders.push({ minX: x - r * 0.55, maxX: x + r * 0.55, minZ: z - r * 0.55, maxZ: z + r * 0.55, bottom: G - 1, top: G + 1000 });
      taken.push({ x, z, r: r * 0.9 });
    });
    FOOTHILLS.forEach(([x, z, r, h], k) => {
      mountain(tris, x, z, r, h, 200 + k, true);
      colliders.push({ minX: x - r * 0.45, maxX: x + r * 0.45, minZ: z - r * 0.45, maxZ: z + r * 0.45, bottom: G - 1, top: G + 1000 });
      taken.push({ x, z, r: r * 0.8 });
    });
    // The spur the tunnel goes through, and the shoulders of rock either side of each end of it.
    const T = TUNNEL;
    const spurs: [number, number, number, number][] = [
      [T.x0 + 1, T.z - 22, 12, 17],
      [T.x0 + 2, T.z + 27, 15, 26],
      [T.x1 - 1, T.z - 22, 12, 16],
      [T.x1 - 2, T.z + 27, 15, 27],
    ];
    spurs.forEach(([x, z, r, h], k) => mountain(tris, x, z, r, h, 300 + k));
    const group = new THREE.Group();
    for (const m of mountainMeshes(tris, { grass: '#6a994e', rock: '#8e8aa0', dark: '#77738a', snow: '#f4f7fb' })) group.add(m);
    const range = mergeByColor(group);
    // Big faces at a slant to the sun streak with their own shadow; they're too big to be shaded by anything else.
    range.traverse((o) => (o.receiveShadow = false));
    root.add(range);
  }
}
