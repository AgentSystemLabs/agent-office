import * as THREE from 'three';
import { FLOOR, ROOF_DROP, WALL_T } from '../../shared/layout';
import type { NightParts } from './outside';
import { mergeByMaterial, mesh, toon } from './toon';

// The city around the rooftop bar: the building's own walls going down to the street, a grid of
// streets with cars running along them, parks, and blocks of buildings out to the haze, most of them
// lower than the roof so you look out over them, with a skyline of towers further off. At night
// their windows light up, the street lamps come on and the cars' lights show.
//
// Everything is built from a handful of shared materials (a window texture per paint, repeated a
// window at a time), merged into a few meshes, so the whole city is a few dozen draw calls.

/** The street, this far below the roof. */
const G = -ROOF_DROP;
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

export interface City {
  group: THREE.Group;
  /** The cars along the streets, the blinking lights on the towers: `night` is how dark it is (0–1). */
  update(t: number, dt: number, night: number): void;
}

/** The same numbers every time, so everyone sees the same city. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
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
/** The building under the roof, in the office's outside paint. */
const TOWER_PAINT: Paint = { wall: '#e07a5f', glass: '#bfe3ff', wide: 0.62, tall: 0.6 };

/** One bay of one storey: the wall with a window in it. */
function bayTexture(p: Paint): THREE.CanvasTexture {
  const S = 64;
  return canvasTexture(S, S, (g) => {
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
  const r = rng(seed);
  return canvasTexture(N * C, N * C, (g) => {
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
  box(cx: number, cz: number, w: number, d: number, y0: number, y1: number, ou: number, ov: number, storey = STOREY) {
    const hw = w / 2;
    const hd = d / 2;
    const floors = Math.max(1, Math.round((y1 - y0) / storey));
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
  return canvasTexture(S, S, (g) => {
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
  return canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
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
  const r = rng(20260927);

  // The ground: every block and street, repeated out to the haze.
  const size = PERIOD * 24;
  const groundGeo = new THREE.PlaneGeometry(size, size);
  groundGeo.rotateX(-Math.PI / 2);
  const uv = groundGeo.getAttribute('uv') as THREE.BufferAttribute;
  const gp = groundGeo.getAttribute('position') as THREE.BufferAttribute;
  // Line the texture up with the streets: a road down its middle falls on x = STREET_X, z = STREET_Z.
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (gp.getX(i) - STREET_X) / PERIOD + 0.5, (gp.getZ(i) - STREET_Z) / PERIOD + 0.5);
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshToonMaterial({ map: groundTexture(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  ground.position.y = G;
  ground.receiveShadow = false;
  group.add(ground);

  // Buildings, a bucket of walls for each paint.
  const walls = PAINTS.map(() => new Walls());
  const tops = new Walls();
  const extras = new THREE.Group();
  const parks = new THREE.Group();
  const beacons: number[] = [];
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
        const park = mesh(new THREE.PlaneGeometry(inner, inner).rotateX(-Math.PI / 2), toon('#8fcf7a'), bx, G + 0.03, bz, false);
        parks.add(park);
        for (let k = 0; k < 7; k++) {
          const t = tree(r);
          t.position.set(bx + (r() - 0.5) * (inner - 6), G, bz + (r() - 0.5) * (inner - 6));
          parks.add(t);
        }
        continue;
      }
      // The block split into lots: one big one, two halves or four quarters.
      const split = r();
      const lots: [number, number, number, number][] = [];
      const gap = 2;
      if (split < 0.25) lots.push([bx, bz, inner, inner]);
      else if (split < 0.6) {
        const w = (inner - gap) / 2;
        const alongX = r() < 0.5;
        for (const s of [-1, 1]) lots.push(alongX ? [bx + (s * (w + gap)) / 2, bz, w, inner] : [bx, bz + (s * (w + gap)) / 2, inner, w]);
      } else {
        const w = (inner - gap) / 2;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) lots.push([bx + (sx * (w + gap)) / 2, bz + (sz * (w + gap)) / 2, w, w]);
      }
      // Lower than the roof round about, so you see out over them; taller further out, and tallest
      // downtown, off to the north-east, where the skyline is.
      const downtown = Math.max(0, 1 - Math.hypot(bx - 210, bz + 220) / 150);
      for (const [lx, lz, lw, ld] of lots) {
        const set = 1 + r() * 3;
        const w = lw - set * 2;
        const d = ld - set * 2;
        if (w < 6 || d < 6) continue;
        let h: number;
        if (dist < 100) h = 9 + r() * 24 + (r() < 0.1 ? 8 : 0);
        else if (dist < 190) h = r() < 0.1 ? 50 + r() * 40 : 12 + r() * 28;
        else h = r() < 0.2 ? 65 + r() * 95 : 20 + r() * 30;
        h *= 1 + downtown * 1.3;
        const glassy = h > 70 && r() < 0.6;
        const paint = glassy ? GLASS_TOWERS[Math.floor(r() * GLASS_TOWERS.length)] : Math.floor(r() * 7);
        const ou = Math.floor(r() * 16);
        const ov = Math.floor(r() * 16);
        const bucket = walls[paint];
        bucket.box(lx, lz, w, d, G, G + h, ou, ov);
        let topY = G + h;
        let tw = w;
        let td = d;
        // Tall ones step back once or twice on the way up.
        if (h > 55 && r() < 0.6) {
          tw = w * (0.55 + r() * 0.25);
          td = d * (0.55 + r() * 0.25);
          const up = 12 + r() * h * 0.5;
          tops.top(lx, lz, w, d, topY);
          bucket.box(lx, lz, tw, td, topY, topY + up, ou + 5, ov + 3);
          topY += up;
        }
        tops.top(lx, lz, tw, td, topY);
        // On the roof: a water tower, a box of air conditioning, or a mast with a red light.
        const what = r();
        if (topY - G > 90) {
          const mast = mesh(new THREE.CylinderGeometry(0.2, 0.35, 12, 6), toon('#8d99ae'), lx, topY + 6, lz, false);
          extras.add(mast);
          beacons.push(lx, topY + 12.3, lz);
        } else if (what < 0.3) {
          const wt = new THREE.Group();
          for (const [sx, sz] of [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ])
            wt.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.4, 5), toon('#5b3a29'), sx * 1.1, 1.2, sz * 1.1, false));
          wt.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 3.2, 12), toon('#9c6b4a'), 0, 4, 0, false));
          wt.add(mesh(new THREE.ConeGeometry(1.8, 1.3, 12), toon('#6b4a35'), 0, 6.25, 0, false));
          wt.position.set(lx + (r() - 0.5) * tw * 0.4, topY, lz + (r() - 0.5) * td * 0.4);
          extras.add(wt);
        } else if (what < 0.65) {
          extras.add(mesh(new THREE.BoxGeometry(3 + r() * 3, 1.6, 2 + r() * 2), toon('#c9ccd4'), lx + (r() - 0.5) * tw * 0.4, topY + 0.8, lz + (r() - 0.5) * td * 0.4, false));
        }
      }
    }
  }

  // The office's own building, from the street up to the roof, in its outside paint.
  const tower = new Walls();
  tower.box((B.minX + B.maxX) / 2, (B.minZ + B.maxZ) / 2, B.maxX - B.minX, B.maxZ - B.minZ, G, -0.3, 0, 0, 4.5);
  // Its plaza, with a few trees in front.
  parks.add(mesh(new THREE.PlaneGeometry(inner, inner).rotateX(-Math.PI / 2), toon('#cfc8b8'), blockAt(0, 0).x, G + 0.02, blockAt(0, 0).z, false));
  for (const [x, z] of [
    [-16, 18],
    [-6, 18],
    [6, 18],
    [16, 18],
    [-20, -18],
    [20, -18],
  ]) {
    const t = tree(r);
    t.position.set(x, G, z);
    parks.add(t);
  }

  const gradient = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
  const material = (p: Paint, seed: number) => {
    const lit = litTexture(p, seed);
    lit.repeat.set(1 / 16, 1 / 16);
    const m = new THREE.MeshToonMaterial({ map: bayTexture(p), emissive: '#ffffff', emissiveMap: lit, emissiveIntensity: 0, gradientMap: gradient });
    night.windows.push(m);
    return m;
  };
  walls.forEach((w, i) => {
    if (!w.pos.length) return;
    const m = new THREE.Mesh(w.geometry(), material(PAINTS[i], i + 1));
    group.add(m);
  });
  const towerMesh = new THREE.Mesh(tower.geometry(), material(TOWER_PAINT, 99));
  towerMesh.receiveShadow = true;
  group.add(towerMesh);
  group.add(new THREE.Mesh(tops.geometry(), toon('#a19d97')));
  group.add(mergeByMaterial(extras));
  group.add(mergeByMaterial(parks));

  // Street lamps down both sides of every street, and red lights blinking on the masts.
  const glow = glowTexture();
  const lampPos: number[] = [];
  for (let k = -n; k <= n; k++) {
    for (let a = -RADIUS; a <= RADIUS; a += 28) {
      for (const s of [-1, 1]) {
        const off = s * (ROAD / 2 + 0.6);
        const sx = STREET_X + k * PERIOD;
        const sz = STREET_Z + k * PERIOD;
        if (Math.hypot(sx, a) < RADIUS) lampPos.push(sx + off, G + 5, a);
        if (Math.hypot(a, sz) < RADIUS) lampPos.push(a, G + 5, sz + off);
      }
    }
  }
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
  const lamps = new THREE.Points(lampGeo, new THREE.PointsMaterial({ size: 4, map: glow, color: '#ffcf8a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  lamps.visible = false;
  group.add(lamps);
  const beaconGeo = new THREE.BufferGeometry();
  beaconGeo.setAttribute('position', new THREE.Float32BufferAttribute(beacons, 3));
  const beaconMat = new THREE.PointsMaterial({ size: 5, map: glow, color: '#ff3b30', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const beaconPoints = new THREE.Points(beaconGeo, beaconMat);
  group.add(beaconPoints);

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
    group.add(m);
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
      if (c.alongX) at.set(c.at, G, c.lane);
      else at.set(c.lane, G, c.at);
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

  return {
    group,
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
