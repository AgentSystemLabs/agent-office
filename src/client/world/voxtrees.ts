import * as THREE from 'three';
import { mulberry32 } from '../../shared/rng';
import { Vox } from './vox';

// Trees built of real blocks, for everything that grows outside: a trunk of bark-coloured cubes and a
// crown of leaf cubes, a few variants of each, shared by every tree of that kind.

const S = 0.28;
const bark = (i: number, j: number, k: number) => ['#7a5233', '#6b4a2e', '#8a5e3a'][Math.abs(i + j * 3 + k) % 3];

const cache = new Map<string, THREE.BufferGeometry>();
const rand = mulberry32(777);

/** The shared material: colours live in the vertices. */
export const treeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });

/** A round-crowned tree, in blocks: `leaf` is its green (or autumn) colour; `variant` 0–3 picks its shape. */
export function leafyGeometry(leaf: string, variant: number): THREE.BufferGeometry {
  const key = `leafy|${leaf}|${variant % 4}`;
  let g = cache.get(key);
  if (!g) {
    const v = new Vox(S, 0.12);
    const h = 7 + (variant % 3);
    v.box(-S, 0, -S, S, h * S, S, bark, 0.06);
    const base = new THREE.Color(leaf);
    const light = `#${base.clone().offsetHSL(0, 0, 0.07).getHexString()}`;
    const dark = `#${base.clone().offsetHSL(0, 0, -0.08).getHexString()}`;
    const r = 6 + (variant % 2);
    v.ell(0, (h + 3) * S, 0, r * S, (r - 1) * S, r * S, (i, j) => (j > h + 4 ? light : leaf), 0.14);
    v.ell((2.5 + (variant % 2)) * S, (h + 5.5) * S, S, 3.5 * S, 3 * S, 3.5 * S, light, 0.14);
    v.ell(-3 * S, (h + 1.5) * S, -2 * S, 3.2 * S, 2.6 * S, 3.2 * S, dark, 0.14);
    g = v.build();
    cache.set(key, g);
  }
  return g;
}

/** A pine, in blocks: stacked square-ish tiers narrowing to a point. */
export function pineGeometry(leaf: string, variant: number): THREE.BufferGeometry {
  const key = `pine|${leaf}|${variant % 3}`;
  let g = cache.get(key);
  if (!g) {
    const v = new Vox(S, 0.12);
    v.box(-S, 0, -S, S, 6 * S, S, bark, 0.06);
    const tiers = 4 + (variant % 2);
    for (let t = 0; t < tiers; t++) {
      const r = (tiers - t + 1) * 1.1;
      const y0 = (3 + t * 3) * S;
      v.ell(0, y0 + S * 1.2, 0, r * S, 1.6 * S, r * S, leaf, 0.14);
    }
    v.box(-S * 0.5, (3 + tiers * 3) * S, -S * 0.5, S * 0.5, (4.4 + tiers * 3) * S, S * 0.5, leaf, 0.14);
    g = v.build();
    cache.set(key, g);
  }
  return g;
}

export const treeVariant = () => Math.floor(rand() * 4);
