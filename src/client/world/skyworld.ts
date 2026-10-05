import * as THREE from 'three';
import { mulberry32 } from '../../shared/rng';
import { Vox } from './vox';

// The world round the office, in blocks like the rest: terraced voxel clouds, and floating islands
// with autumn trees, a waterfall, lit lanterns and a rocky underside that trails off into points.

const AUTUMN = ['#d9782b', '#c9482f', '#e8a23b', '#e58aa3', '#7aa93f', '#5f8f35', '#b9552c'];

/** A cloud of fine blocks: a flat lavender base with rounded white puffs heaped on it, shaded by height. */
export function cloudGeometry(rand: () => number): THREE.BufferGeometry {
  const s = 1;
  const v = new Vox(s, 0.035);
  const w = 14 + rand() * 18;
  const d = 10 + rand() * 12;
  const shade = (_i: number, j: number) => (j < 1 ? '#cfc4e8' : j < 3 ? '#e1daf2' : j < 6 ? '#f0ecfa' : '#ffffff');
  const lumps = 3 + Math.floor(rand() * 3);
  for (let n = 0; n < lumps; n++) {
    const cx = (rand() - 0.5) * w * 1.1;
    const cz = (rand() - 0.5) * d * 1.1;
    const rx = w * (0.4 + rand() * 0.3);
    const rz = d * (0.45 + rand() * 0.3);
    v.ell(cx, 1.5, cz, rx, 2.2, rz, (i, j, k) => shade(i, j));
    // Puffs on top, each a smaller ball, so the outline rolls instead of stepping.
    const puffs = 4 + Math.floor(rand() * 4);
    for (let q = 0; q < puffs; q++) {
      const px = cx + (rand() - 0.5) * rx * 1.4;
      const pz = cz + (rand() - 0.5) * rz * 1.4;
      const pr = 3 + rand() * 4.5;
      v.ell(px, 2 + pr * 0.45, pz, pr * 1.2, pr * 0.8, pr, (i, j, k) => shade(i, j));
    }
  }
  return v.build();
}

/** One floating island: a disc of grass over soil and stone that narrows to a point, trees on it, a waterfall off one edge. */
function islandGeometry(rand: () => number, radius: number, withFall: boolean): { geo: THREE.BufferGeometry; lanterns: THREE.Vector3[] } {
  const s = 0.7;
  const v = new Vox(s, 0.07);
  const R = radius / s;
  const depth = Math.round(R * 0.9);
  const lobes = Array.from({ length: 4 }, () => ({ a: rand() * Math.PI * 2, f: 0.1 + rand() * 0.16 }));
  const edge = (ang: number) => 1 + lobes.reduce((t, l, i) => t + Math.sin(ang * (i + 2) + l.a) * l.f * 0.5, 0);
  const grass = (i: number, j: number, k: number) => ['#5e9b3a', '#6aa843', '#4f8a33', '#78b04a'][Math.abs(i * 7 + k * 13 + j) % 4];
  for (let j = 0; j >= -depth; j--) {
    const t = -j / depth;
    const r = R * edge(0) * (1 - Math.pow(t, 1.25) * 0.97);
    for (let i = -Math.ceil(R * 1.4); i <= R * 1.4; i++)
      for (let k = -Math.ceil(R * 1.4); k <= R * 1.4; k++) {
        const ang = Math.atan2(k, i);
        const lim = r * edge(ang) * 0.9;
        const dist = Math.hypot(i, k);
        if (dist > lim) continue;
        const rock = j < -3 ? (Math.abs(i * 3 + k * 5 + j) % 3 === 0 ? '#4a3d63' : '#3a2f52') : '#7a5638';
        v.put(i, j, k, j === 0 ? grass : rock);
        // Ragged stalactites hanging off the underside.
        if (j === -depth + 2 && rand() < 0.08) for (let h = 1; h < 3 + rand() * 6; h++) v.put(i, j - h, k, '#2c2440');
      }
  }
  // Trees and bushes, in the colours of autumn.
  const lanterns: THREE.Vector3[] = [];
  const count = Math.round(R * 0.9);
  for (let n = 0; n < count; n++) {
    const a = rand() * Math.PI * 2;
    const dist = Math.sqrt(rand()) * R * 0.78 * edge(a);
    const i = Math.round(Math.cos(a) * dist);
    const k = Math.round(Math.sin(a) * dist);
    const trunk = 3 + Math.floor(rand() * 4);
    const cc = AUTUMN[Math.floor(rand() * AUTUMN.length)];
    for (let h = 1; h <= trunk; h++) v.put(i, h, k, '#6b4a2e');
    const cr = 2.2 + rand() * 1.8;
    v.ell((i + 0.5) * s, (trunk + 1.5) * s, (k + 0.5) * s, cr * s, cr * s * 0.85, cr * s, cc, 0.14);
    if (rand() < 0.18) lanterns.push(new THREE.Vector3((i + 0.5) * s + 0.5, (trunk + 3) * s, (k + 0.5) * s));
  }
  // A small stone hut with a lit window, now and then.
  if (rand() < 0.7) {
    const hx = Math.round(R * 0.2);
    v.box(hx * s, s, -2 * s, (hx + 4) * s, 5 * s, 2 * s, '#c9b79a', 0.05);
    v.box((hx - 1) * s, 5 * s, -3 * s, (hx + 5) * s, 6 * s, 3 * s, '#a4452d', 0.05);
    v.box((hx + 1) * s, 6 * s, -2 * s, (hx + 3) * s, 7 * s, 2 * s, '#a4452d', 0.05);
    lanterns.push(new THREE.Vector3((hx + 2) * s, 3 * s, 2.2 * s));
  }
  if (withFall) {
    const a = rand() * Math.PI * 2;
    const i = Math.round(Math.cos(a) * R * 0.86 * edge(a));
    const k = Math.round(Math.sin(a) * R * 0.86 * edge(a));
    for (let j = 1; j > -depth * 2.2; j--) for (let o = 0; o < 2; o++) v.put(i + Math.round(Math.cos(a) * 1.5) + o, j, k + Math.round(Math.sin(a) * 1.5), ['#cfeaff', '#ffffff', '#9fd0f5'][Math.abs(j) % 3], 0.04);
  }
  return { geo: v.build(), lanterns };
}

export interface SkyWorld {
  group: THREE.Group;
  update(t: number): void;
}

/** The voxel sky world: clouds and floating islands in a wide ring round the office. `cloud` is the sky's own cloud material (it goes grey with the weather). */
export function buildSkyWorld(cloud: THREE.MeshStandardMaterial, bulbMat: (color: string) => THREE.Material): SkyWorld {
  const rand = mulberry32(4242);
  const group = new THREE.Group();
  cloud.fog = false;
  cloud.vertexColors = true;
  cloud.needsUpdate = true;
  const land = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, fog: false });
  const glow = bulbMat('#ffd27a');

  const clouds = Array.from({ length: 5 }, () => cloudGeometry(rand));
  for (let n = 0; n < 34; n++) {
    const a = (n / 34) * Math.PI * 2 + rand() * 0.4;
    const dist = 110 + rand() * 150;
    const m = new THREE.Mesh(clouds[n % clouds.length], cloud);
    m.position.set(Math.cos(a) * dist, 150 + rand() * 90, Math.sin(a) * dist);
    m.rotation.y = rand() * Math.PI * 2;
    m.scale.setScalar(1.2 + rand() * 1.6);
    group.add(m);
  }

  const bobs: { m: THREE.Object3D; y: number; p: number }[] = [];
  const kinds = [
    { r: 9, fall: true },
    { r: 6, fall: false },
    { r: 12, fall: true },
    { r: 5, fall: false },
    { r: 8, fall: false },
  ].map((k) => ({ ...islandGeometry(rand, k.r, k.fall), r: k.r }));
  const lantern = new THREE.BoxGeometry(0.5, 0.7, 0.5);
  for (let n = 0; n < 16; n++) {
    const kind = kinds[n % kinds.length];
    const a = (n / 16) * Math.PI * 2 + rand() * 0.3;
    const dist = 140 + rand() * 160;
    const isle = new THREE.Group();
    isle.add(new THREE.Mesh(kind.geo, land));
    for (const p of kind.lanterns) {
      const l = new THREE.Mesh(lantern, glow);
      l.position.copy(p);
      isle.add(l);
    }
    const y = 230 + rand() * 90;
    isle.position.set(Math.cos(a) * dist, y, Math.sin(a) * dist);
    isle.rotation.y = rand() * Math.PI * 2;
    isle.scale.setScalar(1 + rand() * 0.7);
    group.add(isle);
    bobs.push({ m: isle, y, p: rand() * 6.28 });
  }

  return {
    group,
    update(t) {
      for (const b of bobs) b.m.position.y = b.y + Math.sin(t * 0.35 + b.p) * 1.2;
    },
  };
}
