import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// What the thinking garden is grown from: shaped leaf geometry (curved, tapered, folded along the midrib),
// and two batches that merge everything into a few meshes, so hundreds of leaves cost one draw call. The
// foliage batch bakes colour (a lighter midrib, darker edges and tips) and a sway weight into its vertices;
// a vertex shader injection turns that into wind (see foliageMaterial).

/** A small deterministic random, so the garden grows the same way on every load. */
export function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LeafShape {
  rows: number;
  /** Vertices across (odd): 3 is a V with a midrib, 5 a gentler curve. */
  cols?: number;
  length: number;
  width: number;
  /** Half-width at `t` along the leaf (0..1), for row `row`: lanceolate, ovate, or notched like a monstera. */
  profile: (t: number, row: number) => number;
  /** How far the tip droops, in radians of bend over the whole length. */
  arch?: number;
  /** How far the edges fall away from the midrib, as a fraction of the half-width. */
  fold?: number;
  /** The base lobes of a heart-shaped leaf reach back past the stalk by this fraction of the length. */
  heart?: number;
}

/** (sin(pi * t^p))^q: a leaf that starts and ends at a point, fullest where `p` says. */
export const lance = (p: number, q = 1) => (t: number) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, p))), q);

/**
 * One leaf lying along +z from the origin, its face up (+y). `uv` is (t along it, |u| across it from its
 * midrib): what FoliageBatch colours it by.
 */
export function leafGeometry(s: LeafShape): THREE.BufferGeometry {
  const { rows, length: L, width: W, arch = 0, fold = 0.25, cols = 3, heart = 0 } = s;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let y = 0;
  let z = 0;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    if (i > 0) {
      const a = arch * (t - 0.5 / rows);
      z += (Math.cos(a) * L) / rows;
      y -= (Math.sin(a) * L) / rows;
    }
    const a = arch * t;
    const hw = (W / 2) * s.profile(t, i);
    const back = heart * L * Math.pow(Math.max(0, 1 - t / 0.3), 2);
    for (let c = 0; c < cols; c++) {
      const u = (c / (cols - 1)) * 2 - 1;
      const au = Math.abs(u);
      const drop = fold * hw * Math.pow(au, 1.3);
      const b = back * au;
      // The centreline runs (0, -sin a, cos a) and its up is (0, cos a, sin a).
      pos.push(u * hw, y - Math.cos(a) * drop + Math.sin(a) * b, z - Math.sin(a) * drop - Math.cos(a) * b);
      uv.push(t, au);
    }
  }
  for (let i = 0; i < rows; i++)
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface FrondShape {
  length: number;
  pairs: number;
  /** The longest leaflet, and its width as a fraction of that. */
  leaflet: number;
  ratio: number;
  /** How the rachis (the frond's spine) arches, and how its leaflets fan out and droop. */
  arch: number;
  spread: number;
  droop: number;
  /** Rachis thickness. */
  spine?: number;
}

/** A pinnate frond (a fern's, a palm's) along +z: an arched spine with a leaflet pair at every step. */
export function frondGeometry(f: FrondShape): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(leafGeometry({ rows: 6, length: f.length, width: f.spine ?? 0.03, profile: (t) => 1 - 0.7 * t, arch: f.arch, fold: 0 }));
  const leaflet = leafGeometry({ rows: 3, length: 1, width: f.ratio, profile: lance(0.7, 0.8), arch: f.droop, fold: 0.5 });
  const a = f.arch || 1e-4;
  const [d, n, p, side, basis, scale] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Matrix4(), new THREE.Vector3()];
  const [xv, yv, zv] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let i = 0; i < f.pairs; i++) {
    const t = 0.1 + (0.88 * i) / Math.max(1, f.pairs - 1);
    const ang = a * t;
    p.set(0, (-f.length * (1 - Math.cos(ang))) / a, (f.length * Math.sin(ang)) / a);
    d.set(0, -Math.sin(ang), Math.cos(ang));
    n.set(0, Math.cos(ang), Math.sin(ang));
    const len = f.leaflet * Math.pow(Math.sin(Math.PI * (0.08 + 0.9 * t)), 0.6) * (1 - 0.25 * t);
    for (const sx of [-1, 1]) {
      side.set(sx, 0, 0);
      zv.copy(d).multiplyScalar(Math.cos(f.spread)).addScaledVector(side, Math.sin(f.spread)).normalize();
      yv.copy(n).addScaledVector(zv, -n.dot(zv)).normalize();
      xv.crossVectors(yv, zv);
      basis.makeBasis(xv, yv, zv).setPosition(p).scale(scale.set(len, len, len));
      const g = leaflet.clone().applyMatrix4(basis);
      const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, 0.5 * t + 0.5 * uv.getX(k));
      parts.push(g);
    }
  }
  return mergeGeometries(parts)!;
}

const V = new THREE.Vector3();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const S = new THREE.Vector3();

/** Where a leaf goes: at (x, y, z), growing along `yaw` (0 = +z), tipped `pitch` radians up, `s` times its size and `w` times as wide. */
export function place(x: number, y: number, z: number, yaw: number, pitch: number, s = 1, roll = 0, w = 1): THREE.Matrix4 {
  E.set(-pitch, yaw, roll, 'YXZ');
  return new THREE.Matrix4().compose(V.set(x, y, z), Q.setFromEuler(E), S.set(s * w, s, s));
}

const ribDefault = new THREE.Color('#cbdc8e');
const tmp = new THREE.Color();

/** Every leaf of the garden: merged into one mesh, each vertex carrying its colour, how far it sways and its phase. */
export class FoliageBatch {
  private geos: THREE.BufferGeometry[] = [];
  count = 0;

  /** `limit` is the most room leaves may take on the deck (x, z): a leaf that reaches past it is held there, so nothing hangs over the glass. */
  constructor(private limit: THREE.Box3) {}

  /** `sway` is how far (m) the tip moves in the wind; the base stays put. */
  add(tpl: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color, sway: number, phase: number, rib: THREE.Color = ribDefault) {
    const g = tpl.clone().applyMatrix4(m);
    const uv = g.attributes.uv;
    const n = uv.count;
    const pos = g.attributes.position;
    for (let i = 0; i < n; i++) pos.setXYZ(i, THREE.MathUtils.clamp(pos.getX(i), this.limit.min.x, this.limit.max.x), pos.getY(i), THREE.MathUtils.clamp(pos.getZ(i), this.limit.min.z, this.limit.max.z));
    const col = new Float32Array(n * 3);
    const sw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = uv.getX(i);
      const u = uv.getY(i);
      tmp.copy(color).multiplyScalar((0.84 + 0.24 * (1 - u)) * (1 - 0.12 * t));
      if (u < 0.01) tmp.lerp(rib, 0.34 * (1 - 0.6 * t));
      col.set([tmp.r, tmp.g, tmp.b], i * 3);
      sw[i] = sway * (0.12 + 0.88 * t * t);
    }
    g.deleteAttribute('uv');
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(n).fill(phase), 1));
    this.geos.push(g);
    this.count++;
  }

  build(wind: { value: number }): THREE.Mesh {
    const m = new THREE.Mesh(this.geos.length ? mergeGeometries(this.geos)! : new THREE.BufferGeometry(), foliageMaterial(wind));
    for (const g of this.geos) g.dispose();
    m.castShadow = true;
    m.receiveShadow = true;
    // The wind moves vertices past the bounds they were measured with.
    m.frustumCulled = false;
    return m;
  }
}

/** Leaves, double-sided and a little glossy, swaying in a wind that gusts and eases (`wind.value` is the time). */
export function foliageMaterial(wind: { value: number }): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.52, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSway;\nattribute float aPhase;\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float gust = 0.65 + 0.35 * sin(uTime * 0.37 + position.x * 0.35 + position.z * 0.27);
        float ph = uTime * 1.35 + aPhase;
        transformed.x += (sin(ph) + 0.4 * sin(ph * 2.3 + position.z)) * aSway * gust;
        transformed.z += (cos(ph * 0.83) + 0.3 * sin(ph * 1.9)) * aSway * gust * 0.7;
        transformed.y -= abs(sin(ph)) * aSway * 0.15;`,
      );
  };
  return m;
}

export type Kind = 'wood' | 'stone' | 'soil' | 'moss' | 'iron' | 'cloth';

const KINDS: Record<Kind, { roughness: number; metalness: number; cast: boolean }> = {
  wood: { roughness: 0.8, metalness: 0, cast: true },
  stone: { roughness: 0.92, metalness: 0, cast: true },
  soil: { roughness: 1, metalness: 0, cast: false },
  moss: { roughness: 1, metalness: 0, cast: false },
  iron: { roughness: 0.42, metalness: 0.85, cast: true },
  cloth: { roughness: 0.95, metalness: 0, cast: true },
};

/** A cheap hash of a point, 0..1: the grain that stops flat colours looking plastic. */
export function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Everything solid (trunks, timber, stone, soil, cloth): merged per material, colour in the vertices. */
export class Solids {
  private by = new Map<Kind, THREE.BufferGeometry[]>();

  /** `noise` varies the colour from vertex to vertex; `grain` varies it in vertical streaks (bark, boards); `moss` greens whatever faces up (rocks). */
  add(kind: Kind, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4, noise = 0.1, grain = 0, moss = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (m) g.applyMatrix4(m);
    const base = new THREE.Color(color);
    const green = new THREE.Color('#4b7d38');
    const c = new THREE.Color();
    const p = g.attributes.position;
    const nrm = g.attributes.normal;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const k = 1 + noise * (hash3(x * 9, y * 9, z * 9) - 0.5) * 2 + grain * (hash3(Math.round(x * 40), 0, Math.round(z * 40)) - 0.5) * 2;
      c.copy(base).multiplyScalar(k);
      if (moss) c.lerp(green, moss * THREE.MathUtils.smoothstep(nrm.getY(i) + 0.25 * hash3(x * 5, y * 5, z * 5), 0.35, 0.85));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (this.by.get(kind) ?? this.by.set(kind, []).get(kind)!).push(g);
  }

  build(): THREE.Group {
    const out = new THREE.Group();
    for (const [kind, geos] of this.by) {
      const o = KINDS[kind];
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.roughness, metalness: o.metalness });
      const m = new THREE.Mesh(mergeGeometries(geos)!, mat);
      m.castShadow = o.cast;
      m.receiveShadow = true;
      out.add(m);
      for (const g of geos) g.dispose();
    }
    return out;
  }
}
