import * as THREE from 'three';
import { FLOOR, SLAB, STREET_Y, WALL_T, roofDrop } from '../../shared/layout';
import { mulberry32 } from '../../shared/rng';
import type { NightParts } from './outside';
import { tilingCanvasTexture } from './texture';
import { mergeByMaterial, mesh, toon } from './toon';
import { buildTower } from './tower';

// The city around the rooftop bar: the building's own floors going down to the street (as the tower
// looks from outside, world/tower.ts), a grid of streets with cars running along them, parks, and
// blocks of buildings out to the haze, most of them lower than the roof so you look out over them,
// with a skyline of towers further off. At night their windows light up, the street lamps come on
// and the cars' lights show. The building is as tall as there are floors, so the street is that far
// down (see setFloors), and the buildings round about are only as tall as leaves the view over them.
//
// Everything is built from a handful of shared materials (a window texture per paint, repeated a
// window at a time), merged into a few meshes, so the whole city is a few dozen draw calls.

/** The building, walls included. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
/** A block and the street beside it; streets run down x = 28 + 56k and z = 27 + 56k. */
const PERIOD = 56;
const STREET_X = 28;
const STREET_Z = 27;
/** The road, and a sidewalk either side. */
const ROAD = 8;
const WALK = 2;
/** How far out the city goes: past this the haze has it anyway. */
const RADIUS = 330;
/** One storey, and one bay of windows, in meters. */
const STOREY = 3.3;
const BAY = 2.8;
/** How far down the street was from the roof the neighbours' heights were picked for: six floors. */
const LAID_OUT = roofDrop(6);

export interface City {
  group: THREE.Group;
  /**
   * The building has `floors` floors under the roof: the street goes as far down as that is tall,
   * and the buildings nearby come down to stay under the roof.
   */
  setFloors(floors: number, wings?: readonly number[]): void;
  /** The cars along the streets, the blinking lights on the towers: `night` is how dark it is (0–1). */
  update(t: number, dt: number, night: number): void;
}

/** How a building's walls look: its paint, and the windows in it (glass towers are nearly all window). */
interface Paint {
  wall: string;
  glass: string;
  /** The window's share of a bay across and of a storey up. */
  wide: number;
  tall: number;
}

const PAINTS: Paint[] = [
  { wall: '#d9a27e', glass: '#a9d6f5', wide: 0.5, tall: 0.55 },
  { wall: '#c96f5a', glass: '#b8e0f7', wide: 0.45, tall: 0.55 },
  { wall: '#e9dcc3', glass: '#9cc9ea', wide: 0.55, tall: 0.6 },
  { wall: '#b9c0c9', glass: '#bfe3ff', wide: 0.6, tall: 0.55 },
  { wall: '#a7c4d9', glass: '#e6f4ff', wide: 0.5, tall: 0.6 },
  { wall: '#e8b4b8', glass: '#bfe3ff', wide: 0.5, tall: 0.55 },
  { wall: '#f1e3b3', glass: '#a9d6f5', wide: 0.45, tall: 0.5 },
  // Glass towers.
  { wall: '#4f6d8a', glass: '#7fb8d8', wide: 0.9, tall: 0.82 },
  { wall: '#3e7c7c', glass: '#8fd3d0', wide: 0.9, tall: 0.82 },
];
const GLASS_TOWERS = [7, 8];

/** One bay of one storey: the wall with a window in it. */
function bayTexture(p: Paint): THREE.CanvasTexture {
  const S = 64;
  return tilingCanvasTexture(S, S, (g) => {
    g.fillStyle = p.wall;
    g.fillRect(0, 0, S, S);
    const w = S * p.wide;
    const h = S * p.tall;
    const x = (S - w) / 2;
    const y = S * 0.18;
    g.fillStyle = p.glass;
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(x + w * 0.12, y, w * 0.1, h);
    // A sill under it.
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(x - 2, y + h, w + 4, 3);
  });
}

/** Which windows are lit at night: 16 × 16 bays of them, each building showing a different part. */
function litTexture(p: Paint, seed: number): THREE.CanvasTexture {
  const N = 16;
  const C = 16;
  const r = mulberry32(seed);
  return tilingCanvasTexture(N * C, N * C, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, N * C, N * C);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (r() < 0.5) continue;
        const k = r();
        g.fillStyle = k < 0.12 ? '#9ec9ff' : k < 0.55 ? '#ffd27a' : '#ffe6b0';
        const w = C * p.wide;
        const h = C * p.tall;
        g.fillRect(i * C + (C - w) / 2, j * C + C * 0.18, w, h);
      }
    }
  });
}

/** Wall faces piling up for one material, to be one mesh. */
class Walls {
  pos: number[] = [];
  norm: number[] = [];
  uv: number[] = [];
  index: number[] = [];

  /** A quad from its bottom-left corner `a` along `u` (across) and up `h`, facing `n`; `uv` is [u0, v0, u1, v1]. */
  quad(a: [number, number, number], u: [number, number, number], h: number, n: [number, number, number], uv: [number, number, number, number]) {
    const i = this.pos.length / 3;
    const [x, y, z] = a;
    const up: [number, number, number] = n[1] === 1 ? [0, 0, -h] : [0, h, 0];
    this.pos.push(x, y, z, x + u[0], y + u[1], z + u[2], x + u[0] + up[0], y + u[1] + up[1], z + u[2] + up[2], x + up[0], y + up[1], z + up[2]);
    for (let k = 0; k < 4; k++) this.norm.push(...n);
    const [u0, v0, u1, v1] = uv;
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.index.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** The four walls of a box from y0 to y1, windows a bay across and a storey up, lit windows from (ou, ov) of the pattern. */
  box(cx: number, cz: number, w: number, d: number, y0: number, y1: number, ou: number, ov: number) {
    const hw = w / 2;
    const hd = d / 2;
    const floors = Math.max(1, Math.round((y1 - y0) / STOREY));
    const h = y1 - y0;
    const across = (span: number) => Math.max(1, Math.round(span / BAY));
    const cw = across(w);
    const cd = across(d);
    this.quad([cx - hw, y0, cz + hd], [w, 0, 0], h, [0, 0, 1], [ou, ov, ou + cw, ov + floors]);
    this.quad([cx + hw, y0, cz - hd], [-w, 0, 0], h, [0, 0, -1], [ou + 3, ov, ou + 3 + cw, ov + floors]);
    this.quad([cx + hw, y0, cz + hd], [0, 0, -d], h, [1, 0, 0], [ou + 7, ov, ou + 7 + cd, ov + floors]);
    this.quad([cx - hw, y0, cz - hd], [0, 0, d], h, [-1, 0, 0], [ou + 11, ov, ou + 11 + cd, ov + floors]);
  }

  /** A flat top at y. */
  top(cx: number, cz: number, w: number, d: number, y: number) {
    this.quad([cx - w / 2, y, cz + d / 2], [w, 0, 0], d, [0, 1, 0], [0, 0, 1, 1]);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.index);
    g.computeBoundingSphere();
    return g;
  }
}

/** The streets and blocks, a block at a time: roads, sidewalks, crossings and the lane markings. */
function groundTexture(): THREE.CanvasTexture {
  const S = 512;
  const px = S / PERIOD;
  return tilingCanvasTexture(S, S, (g) => {
    g.fillStyle = '#b3aea4';
    g.fillRect(0, 0, S, S);
    const mid = S / 2;
    const road = ROAD * px;
    const walk = (ROAD + WALK * 2) * px;
    g.fillStyle = '#d9d3c5';
    g.fillRect(mid - walk / 2, 0, walk, S);
    g.fillRect(0, mid - walk / 2, S, walk);
    g.fillStyle = '#4b505c';
    g.fillRect(mid - road / 2, 0, road, S);
    g.fillRect(0, mid - road / 2, S, road);
    // Dashed yellow down the middle of each road, stopping short of the crossing.
    g.fillStyle = '#ffd166';
    for (let i = 0; i < S; i += 24) {
      if (Math.abs(i + 6 - mid) < walk * 0.9) continue;
      g.fillRect(mid - 1.5, i, 3, 12);
      g.fillRect(i, mid - 1.5, 12, 3);
    }
    // Zebra crossings round the intersection.
    g.fillStyle = '#f1f1f1';
    for (let k = -road / 2 + 3; k < road / 2 - 3; k += 7) {
      for (const s of [-1, 1]) {
        g.fillRect(mid + k, mid + s * (walk / 2 + 2) - (s < 0 ? 16 : 0), 4, 16);
        g.fillRect(mid + s * (walk / 2 + 2) - (s < 0 ? 16 : 0), mid + k, 16, 4);
      }
    }
  });
}

function tree(r: () => number): THREE.Group {
  const t = new THREE.Group();
  const s = 0.8 + r() * 0.7;
  t.add(mesh(new THREE.CylinderGeometry(0.25 * s, 0.32 * s, 2.4 * s, 6), toon('#8a5a3b'), 0, 1.2 * s, 0, false));
  t.add(mesh(new THREE.SphereGeometry(1.9 * s, 8, 6), toon(r() < 0.5 ? '#5fb760' : '#4ea657'), 0, 3.4 * s, 0, false));
  return t;
}

/** Soft round blob, for lamps seen from far off. */
function glowTexture(): THREE.CanvasTexture {
  return tilingCanvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
}

/**
 * A building on a lot, as it was laid out round a roof LAID_OUT up. How much of that height it
 * stands depends on how far out it is (`ring`: close by, further out, or on the skyline) and on how
 * tall the office's building is (see rise).
 */
interface Lot {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  paint: number;
  /** Where its lit windows start in the pattern. */
  ou: number;
  ov: number;
  ring: 0 | 1 | 2;
  /** Tall ones step back on the way up: the top part's footprint, and how much taller it goes. */
  step?: { w: number; d: number; up: number };
  /** On its roof: a mast with a red light, a water tower, or a box of air conditioning. */
  top?: { kind: 'mast' } | { kind: 'tank'; x: number; z: number } | { kind: 'plant'; x: number; z: number; w: number; d: number };
}

/**
 * How much of its laid-out height a building in `ring` stands with the street `drop` below the roof.
 * Close by they come down with the roof, to stay under it; further out a bit less, and the skyline
 * stays the skyline. Up to six floors, where they were laid out; no taller past that.
 */
function rise(ring: number, drop: number): number {
  const k = Math.min(1, drop / LAID_OUT);
  return ring === 0 ? k : ring === 1 ? Math.sqrt(k) : 1;
}

interface Car {
  /** Along x (true) or z. */
  alongX: boolean;
  /** The lane's line across the street, and which way it drives (±1). */
  lane: number;
  dir: number;
  at: number;
  speed: number;
}

export function buildCity(night: NightParts): City {
  const group = new THREE.Group();
  /** Everything down on the street, which is as far below the roof as the building is tall. */
  const street = new THREE.Group();
  group.add(street);
  // The same numbers every time, so everyone sees the same city.
  const r = mulberry32(20260927);

  // The ground: every block and street, repeated out to the haze.
  const size = PERIOD * 24;
  const groundGeo = new THREE.PlaneGeometry(size, size);
  groundGeo.rotateX(-Math.PI / 2);
  const uv = groundGeo.getAttribute('uv') as THREE.BufferAttribute;
  const gp = groundGeo.getAttribute('position') as THREE.BufferAttribute;
  // Line the texture up with the streets: a road down its middle falls on x = STREET_X, z = STREET_Z.
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (gp.getX(i) - STREET_X) / PERIOD + 0.5, (gp.getZ(i) - STREET_Z) / PERIOD + 0.5);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshToonMaterial({ map: groundTexture(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  ground.receiveShadow = false;
  street.add(ground);

  // The blocks: parks now and then, and lots with a building on each, laid out once. How tall the
  // buildings stand depends on the roof (see raise, below).
  const lots: Lot[] = [];
  const parks = new THREE.Group();
  const blockAt = (i: number, j: number) => ({ x: STREET_X - PERIOD / 2 + i * PERIOD, z: STREET_Z - PERIOD / 2 + j * PERIOD });
  const inner = PERIOD - ROAD - WALK * 2;
  const n = Math.ceil(RADIUS / PERIOD) + 1;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const { x: bx, z: bz } = blockAt(i, j);
      const dist = Math.hypot(bx, bz);
      if (dist > RADIUS) continue;
      // The block the office stands on: a plaza round it.
      if (i === 0 && j === 0) continue;
      // Now and then a park, with trees.
      if (r() < 0.1 && dist > 60) {
        const park = mesh(new THREE.PlaneGeometry(inner, inner).rotateX(-Math.PI / 2), toon('#8fcf7a'), bx, 0.03, bz, false);
        parks.add(park);
        for (let k = 0; k < 7; k++) {
          const t = tree(r);
          t.position.set(bx + (r() - 0.5) * (inner - 6), 0, bz + (r() - 0.5) * (inner - 6));
          parks.add(t);
        }
        continue;
      }
      // The block split into lots: one big one, two halves or four quarters.
      const split = r();
      const plots: [number, number, number, number][] = [];
      const gap = 2;
      if (split < 0.25) plots.push([bx, bz, inner, inner]);
      else if (split < 0.6) {
        const w = (inner - gap) / 2;
        const alongX = r() < 0.5;
        for (const s of [-1, 1]) plots.push(alongX ? [bx + (s * (w + gap)) / 2, bz, w, inner] : [bx, bz + (s * (w + gap)) / 2, inner, w]);
      } else {
        const w = (inner - gap) / 2;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) plots.push([bx + (sx * (w + gap)) / 2, bz + (sz * (w + gap)) / 2, w, w]);
      }
      // Lower than the roof round about, so you see out over them; taller further out, and tallest
      // downtown, off to the north-east, where the skyline is.
      const downtown = Math.max(0, 1 - Math.hypot(bx - 210, bz + 220) / 150);
      for (const [lx, lz, lw, ld] of plots) {
        const back = 1 + r() * 3;
        const w = lw - back * 2;
        const d = ld - back * 2;
        if (w < 6 || d < 6) continue;
        let h: number;
        if (dist < 100) h = 9 + r() * 24 + (r() < 0.1 ? 8 : 0);
        else if (dist < 190) h = r() < 0.1 ? 50 + r() * 40 : 12 + r() * 28;
        else h = r() < 0.2 ? 65 + r() * 95 : 20 + r() * 30;
        h *= 1 + downtown * 1.3;
        const glassy = h > 70 && r() < 0.6;
        const paint = glassy ? GLASS_TOWERS[Math.floor(r() * GLASS_TOWERS.length)] : Math.floor(r() * 7);
        const lot: Lot = { x: lx, z: lz, w, d, h, paint, ou: Math.floor(r() * 16), ov: Math.floor(r() * 16), ring: dist < 100 ? 0 : dist < 190 ? 1 : 2 };
        let tall = h;
        let tw = w;
        let td = d;
        // Tall ones step back once on the way up.
        if (h > 55 && r() < 0.6) {
          tw = w * (0.55 + r() * 0.25);
          td = d * (0.55 + r() * 0.25);
          lot.step = { w: tw, d: td, up: 12 + r() * h * 0.5 };
          tall += lot.step.up;
        }
        // On the roof: a water tower, a box of air conditioning, or a mast with a red light.
        const what = r();
        if (tall > 90) lot.top = { kind: 'mast' };
        else if (what < 0.3) lot.top = { kind: 'tank', x: lx + (r() - 0.5) * tw * 0.4, z: lz + (r() - 0.5) * td * 0.4 };
        else if (what < 0.65) {
          const pw = 3 + r() * 3;
          const pd = 2 + r() * 2;
          lot.top = { kind: 'plant', w: pw, d: pd, x: lx + (r() - 0.5) * tw * 0.4, z: lz + (r() - 0.5) * td * 0.4 };
        }
        lots.push(lot);
      }
    }
  }

  // The office's own building, a floor per project, from the street up to the roof, and the open
  // garage at the bottom: walled at the back and on the west side, columns along the other two.
  const building = buildTower([], night);
  group.add(building.group);
  const garage = new THREE.Group();
  const garageH = -STREET_Y - SLAB;
  const concrete = toon('#d3d6dd');
  garage.add(mesh(new THREE.BoxGeometry(B.maxX - B.minX, garageH, WALL_T), concrete, (B.minX + B.maxX) / 2, garageH / 2, B.minZ + WALL_T / 2, false));
  garage.add(mesh(new THREE.BoxGeometry(WALL_T, garageH, B.maxZ - B.minZ), concrete, B.minX + WALL_T / 2, garageH / 2, (B.minZ + B.maxZ) / 2, false));
  const column = new THREE.BoxGeometry(0.5, garageH, 0.5);
  for (const x of [B.maxX - 0.25, -9.6, 0, 9.6]) garage.add(mesh(column, toon('#e6e8ee'), x, garageH / 2, B.maxZ - 0.25, false));
  for (const z of [-6.5, 6.5, B.minZ + 0.25]) garage.add(mesh(column, toon('#e6e8ee'), B.maxX - 0.25, garageH / 2, z, false));
  garage.add(mesh(new THREE.PlaneGeometry(B.maxX - B.minX, B.maxZ - B.minZ).rotateX(-Math.PI / 2), toon('#9a9ea8'), (B.minX + B.maxX) / 2, 0.03, (B.minZ + B.maxZ) / 2, false));
  street.add(mergeByMaterial(garage));
  // Its plaza, with a few trees in front.
  parks.add(mesh(new THREE.PlaneGeometry(inner, inner).rotateX(-Math.PI / 2), toon('#cfc8b8'), blockAt(0, 0).x, 0.02, blockAt(0, 0).z, false));
  for (const [x, z] of [
    [-16, 18],
    [-6, 18],
    [6, 18],
    [16, 18],
    [-20, -18],
    // Clear of the back office, when a floor's built out into one (see WING).
    [21, -20],
  ]) {
    const t = tree(r);
    t.position.set(x, 0, z);
    parks.add(t);
  }
  street.add(mergeByMaterial(parks));

  // The buildings' walls (a material for each paint), their roofs, and what's on them.
  const gradient = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
  const paintMats = new Map<number, THREE.MeshToonMaterial>();
  const paintOf = (i: number) => {
    let m = paintMats.get(i);
    if (!m) {
      const p = PAINTS[i];
      const lit = litTexture(p, i + 1);
      lit.repeat.set(1 / 16, 1 / 16);
      m = new THREE.MeshToonMaterial({ map: bayTexture(p), emissive: '#ffffff', emissiveMap: lit, emissiveIntensity: 0, gradientMap: gradient });
      night.windows.push(m);
      paintMats.set(i, m);
    }
    return m;
  };
  const roofs = toon('#a19d97');
  const mastGeo = new THREE.CylinderGeometry(0.2, 0.35, 12, 6);
  const legGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.4, 5);
  const tankGeo = new THREE.CylinderGeometry(1.6, 1.6, 3.2, 12);
  const capGeo = new THREE.ConeGeometry(1.8, 1.3, 12);
  const unitGeo = new THREE.BoxGeometry(1, 1.6, 1);
  const glow = glowTexture();
  const beaconMat = new THREE.PointsMaterial({ size: 5, map: glow, color: '#ff3b30', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const beaconPoints = new THREE.Points(new THREE.BufferGeometry(), beaconMat);
  street.add(beaconPoints);
  let raised: THREE.Object3D[] = [];

  /** Puts up the buildings, each as tall as `rise` says with the street `drop` below the roof. */
  const raise = (drop: number) => {
    for (const o of raised) {
      o.removeFromParent();
      o.traverse((m) => {
        if ((m as THREE.Mesh).isMesh) (m as THREE.Mesh).geometry.dispose();
      });
    }
    raised = [];
    const walls = new Map<number, Walls>();
    const tops = new Walls();
    const extras = new THREE.Group();
    const beacons: number[] = [];
    for (const lot of lots) {
      const k = rise(lot.ring, drop);
      let bucket = walls.get(lot.paint);
      if (!bucket) walls.set(lot.paint, (bucket = new Walls()));
      let topY = lot.h * k;
      bucket.box(lot.x, lot.z, lot.w, lot.d, 0, topY, lot.ou, lot.ov);
      let tw = lot.w;
      let td = lot.d;
      if (lot.step) {
        tops.top(lot.x, lot.z, lot.w, lot.d, topY);
        tw = lot.step.w;
        td = lot.step.d;
        bucket.box(lot.x, lot.z, tw, td, topY, topY + lot.step.up * k, lot.ou + 5, lot.ov + 3);
        topY += lot.step.up * k;
      }
      tops.top(lot.x, lot.z, tw, td, topY);
      const top = lot.top;
      if (top?.kind === 'mast') {
        extras.add(mesh(mastGeo, toon('#8d99ae'), lot.x, topY + 6, lot.z, false));
        beacons.push(lot.x, topY + 12.3, lot.z);
      } else if (top?.kind === 'tank') {
        const wt = new THREE.Group();
        for (const [sx, sz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ])
          wt.add(mesh(legGeo, toon('#5b3a29'), sx * 1.1, 1.2, sz * 1.1, false));
        wt.add(mesh(tankGeo, toon('#9c6b4a'), 0, 4, 0, false));
        wt.add(mesh(capGeo, toon('#6b4a35'), 0, 6.25, 0, false));
        wt.position.set(top.x, topY, top.z);
        extras.add(wt);
      } else if (top?.kind === 'plant') {
        const unit = mesh(unitGeo, toon('#c9ccd4'), top.x, topY + 0.8, top.z, false);
        unit.scale.set(top.w, 1, top.d);
        extras.add(unit);
      }
    }
    for (const [paint, w] of walls) raised.push(new THREE.Mesh(w.geometry(), paintOf(paint)));
    raised.push(new THREE.Mesh(tops.geometry(), roofs), mergeByMaterial(extras));
    street.add(...raised);
    beaconPoints.geometry.dispose();
    beaconPoints.geometry = new THREE.BufferGeometry();
    beaconPoints.geometry.setAttribute('position', new THREE.Float32BufferAttribute(beacons, 3));
  };

  // Street lamps down both sides of every street, and red lights blinking on the masts.
  const lampPos: number[] = [];
  for (let k = -n; k <= n; k++) {
    for (let a = -RADIUS; a <= RADIUS; a += 28) {
      for (const s of [-1, 1]) {
        const off = s * (ROAD / 2 + 0.6);
        const sx = STREET_X + k * PERIOD;
        const sz = STREET_Z + k * PERIOD;
        if (Math.hypot(sx, a) < RADIUS) lampPos.push(sx + off, 5, a);
        if (Math.hypot(a, sz) < RADIUS) lampPos.push(a, 5, sz + off);
      }
    }
  }
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
  const lamps = new THREE.Points(lampGeo, new THREE.PointsMaterial({ size: 4, map: glow, color: '#ffcf8a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  lamps.visible = false;
  street.add(lamps);

  // Cars, up and down the streets round the office's block.
  const cars: Car[] = [];
  const lanes: [boolean, number][] = [
    [true, STREET_Z],
    [true, STREET_Z - PERIOD],
    [false, STREET_X],
    [false, STREET_X - PERIOD],
    [true, STREET_Z + PERIOD],
    [false, STREET_X + PERIOD],
  ];
  for (const [alongX, line] of lanes) {
    for (let k = 0; k < 7; k++) {
      const dir = k % 2 ? 1 : -1;
      cars.push({ alongX, lane: line + dir * (ROAD / 4) * (alongX ? 1 : -1), dir, at: -RADIUS + r() * RADIUS * 2, speed: 9 + r() * 6 });
    }
  }
  const body = new THREE.BoxGeometry(4.2, 1.05, 1.9).translate(0, 0.9, 0);
  const cabin = new THREE.BoxGeometry(2.2, 0.7, 1.7).translate(-0.3, 1.75, 0);
  const carGeo = mergeGeometries([body, cabin]);
  const carMesh = new THREE.InstancedMesh(carGeo, toon('#ffffff'), cars.length);
  const paints = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f4f1de', '#3d405b', '#e07a5f', '#8ecae6'];
  cars.forEach((_, i) => carMesh.setColorAt(i, new THREE.Color(paints[Math.floor(r() * paints.length)])));
  const headMat = new THREE.MeshBasicMaterial({ color: '#fff6d0' });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#ff2d2d' });
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.3, 1.6).translate(2.12, 0.95, 0), headMat, cars.length);
  const tails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.25, 1.6).translate(-2.12, 0.95, 0), tailMat, cars.length);
  for (const m of [carMesh, heads, tails]) {
    m.frustumCulled = false;
    street.add(m);
  }
  const place = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const moveCars = (dt: number) => {
    cars.forEach((c, i) => {
      c.at += c.dir * c.speed * dt;
      if (c.at > RADIUS) c.at -= RADIUS * 2;
      if (c.at < -RADIUS) c.at += RADIUS * 2;
      if (c.alongX) at.set(c.at, 0, c.lane);
      else at.set(c.lane, 0, c.at);
      // The car's nose is +x: turned to face the way it's going.
      const yaw = c.alongX ? (c.dir > 0 ? 0 : Math.PI) : c.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      q.setFromAxisAngle(up, yaw);
      place.compose(at, q, one);
      carMesh.setMatrixAt(i, place);
      heads.setMatrixAt(i, place);
      tails.setMatrixAt(i, place);
    });
    for (const m of [carMesh, heads, tails]) m.instanceMatrix.needsUpdate = true;
  };
  moveCars(0);

  // Clouds, drifting past at about the height of the towers.
  const cloud = night.clouds;
  const sky = new THREE.Group();
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + r();
    const dist = 220 + r() * 120;
    const c = new THREE.Group();
    for (const [dx, dy, rad] of [
      [0, 0, 9],
      [10, -2, 7],
      [-10, -2, 6.5],
      [4, 4, 6],
    ]) {
      const puff = mesh(new THREE.SphereGeometry(rad, 12, 9), cloud, dx, dy, 0, false);
      puff.scale.y = 0.7;
      c.add(puff);
    }
    c.position.set(Math.cos(a) * dist, 40 + r() * 50, Math.sin(a) * dist);
    c.lookAt(0, c.position.y, 0);
    sky.add(c);
  }
  group.add(mergeByMaterial(sky));

  let floorsNow = 0;
  let wingsNow = '';
  let riseNow = -1;
  return {
    group,
    setFloors(floors, wings = []) {
      floors = Math.max(1, floors);
      if (floors === floorsNow && wings.join() === wingsNow) return;
      floorsNow = floors;
      wingsNow = wings.join();
      const drop = roofDrop(floors);
      street.position.y = -drop;
      building.set(floors, floors, wings);
      // The buildings only change height up to six floors (see rise).
      const k = Math.min(1, drop / LAID_OUT);
      if (k !== riseNow) {
        riseNow = k;
        raise(drop);
      }
    },
    update(t, dt, dark) {
      moveCars(dt);
      lamps.visible = dark > 0.02;
      lamps.material.opacity = dark;
      headMat.color.setScalar(0.75 + 0.25 * dark);
      // The masts' lights blink, a second on and a second off, brighter at night.
      beaconMat.opacity = (Math.sin(t * Math.PI) > 0 ? 1 : 0.08) * (0.35 + 0.65 * dark);
    },
  };
}

/** Puts geometries (position and normal only) into one. */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const norm: number[] = [];
  for (const g of geos) {
    const flat = g.index ? g.toNonIndexed() : g;
    pos.push(...(flat.getAttribute('position').array as Float32Array));
    norm.push(...(flat.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  return out;
}
