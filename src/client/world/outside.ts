import * as THREE from 'three';
import { ELEVATOR, ELEVATOR_FRONT, FLOOR, ROAD, SLAB, STREET_Y, WALL_T } from '../../shared/layout';
import { LOT, SIDE_LOT } from '../../shared/garage';
import { STREET_END, shoreX } from '../../shared/scenic';
import { mulberry32 } from '../../shared/rng';
import type { Collider } from './types';
import type { Fixture, StreetSite } from './office/fixture';
import { canvasTexture } from './texture';
import { leafyGeometry, treeMaterial } from './voxtrees';
import { buildSkyWorld, type SkyWorld } from './skyworld';
import { mergeByMaterial, mesh, textPlane, toon, toonUnique } from './toon';

const G = STREET_Y;
/** The building's footprint, walls included. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
/** Parking bays are this wide; the rows of them start at x = -16. */
const BAY = 3.2;

/** A light that throws a pool of light around it at night (see sky.ts): where, how far, and its color. */
export interface Lamp {
  x: number;
  y: number;
  z: number;
  reach: number;
  color: string;
  /** How bright, at the middle of the pool. */
  power: number;
  /** Down by the street (a street lamp, the one over the exit): it's further down the higher your floor is. */
  ground?: boolean;
}

/** Everything that changes between day and night and with the weather, for the sky to drive. */
export interface NightParts {
  /** Bulbs whose glow goes from `day` (emissive intensity by day) up to full at night. */
  bulbs: { mat: THREE.MeshStandardMaterial; day: number }[];
  /** Where each bulb's soft halo goes at night, and its color; `ground` as for a Lamp. */
  halos: { at: THREE.Vector3; size: number; color: string; ground?: boolean }[];
  lamps: Lamp[];
  /** How far below the floor you're on the street is (see streetBelow): what the `ground` lamps drop with. */
  street: number;
  /** The neighbours' walls, whose windows light up at night. */
  windows: THREE.MeshStandardMaterial[];
  clouds: THREE.MeshStandardMaterial;
  /** Rain running down the office windows. */
  wetGlass: THREE.MeshBasicMaterial;
  /** Light you only see at night (the lighthouse's beam): see-through, `max` opaque when it's dark. */
  glows: { mat: THREE.Material; max: number }[];
}

/** A bulb that glows `day` much by day and fully at night. */
export function bulb(night: NightParts, color: string, day = 0): THREE.MeshStandardMaterial {
  const mat = toonUnique(color);
  mat.emissive.set(color);
  mat.emissiveIntensity = day;
  night.bulbs.push({ mat, day });
  return mat;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** A flat, textured toon plane lying on the ground. */
function groundPlane(w: number, d: number, x: number, y: number, z: number, map: THREE.Texture | null, color = '#ffffff'): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color, map });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

/**
 * Polished concrete with painted bays along the back wall and along the front, and a hatched box
 * to keep clear in front of the elevator, which takes up a bay at the back.
 */
function garageFloorTexture(): THREE.CanvasTexture {
  const w = B.maxX - B.minX;
  const d = B.maxZ - B.minZ;
  const px = 32; // pixels per meter
  return canvasTexture(Math.round(w * px), Math.round(d * px), (g) => {
    g.fillStyle = '#c9ccd4';
    g.fillRect(0, 0, w * px, d * px);
    // A few darker blotches, so it isn't a flat slab.
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(90, 96, 110, ${0.015 + Math.random() * 0.025})`;
      g.beginPath();
      g.ellipse(Math.random() * w * px, Math.random() * d * px, 10 + Math.random() * 30, 6 + Math.random() * 20, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    const X = (x: number) => (x - B.minX) * px;
    const Z = (z: number) => (z - B.minZ) * px;
    const lift = { minX: ELEVATOR.x - ELEVATOR.width / 2, maxX: ELEVATOR.x + ELEVATOR.width / 2, minZ: ELEVATOR_FRONT, maxZ: ELEVATOR_FRONT + 2.2 };
    g.fillStyle = '#fffaf0';
    for (const [z0, z1] of [
      [B.minZ + 0.3, B.minZ + 5.8],
      [B.maxZ - 5.8, B.maxZ - 0.3],
    ]) {
      for (let x = -16; x <= 16.01; x += BAY) {
        // Not out of the elevator's shaft and across the box in front of it.
        if (z0 < lift.maxZ && x > lift.minX - 0.1 && x < lift.maxX + 0.1) continue;
        g.fillRect(X(x) - 2, Z(z0), 4, (z1 - z0) * px);
      }
    }
    // The box in front of the elevator's doors: a yellow outline, hatched across.
    g.save();
    g.beginPath();
    g.rect(X(lift.minX), Z(lift.minZ), (lift.maxX - lift.minX) * px, (lift.maxZ - lift.minZ) * px);
    g.clip();
    g.strokeStyle = '#ffd166';
    g.lineWidth = 7;
    for (let d = -3; d < 6; d += 0.45) {
      g.beginPath();
      g.moveTo(X(lift.minX + d), Z(lift.minZ));
      g.lineTo(X(lift.minX + d + 3), Z(lift.maxZ));
      g.stroke();
    }
    g.restore();
    g.strokeStyle = '#ffd166';
    g.lineWidth = 8;
    g.strokeRect(X(lift.minX) + 4, Z(lift.minZ) + 4, (lift.maxX - lift.minX) * px - 8, (lift.maxZ - lift.minZ) * px - 8);
    // Arrows down the aisle, pointing out to the street.
    g.fillStyle = '#ffd166';
    for (const x of [-8, 8]) {
      const cx = X(x);
      const cz = Z(0);
      g.fillRect(cx - 5, cz - 60, 10, 90);
      g.beginPath();
      g.moveTo(cx - 22, cz + 30);
      g.lineTo(cx + 22, cz + 30);
      g.lineTo(cx, cz + 62);
      g.closePath();
      g.fill();
    }
  });
}

/**
 * Downstairs: the open garage under the office's floor slab (see world/stack.ts): concrete
 * walls at the back and on the west side, columns along the open front and east side, and strip
 * lights. The Lambos and Ferraris parked in it are features/cars/world.ts's.
 */
export function buildGarage(group: THREE.Group, colliders: Collider[]) {
  const w = B.maxX - B.minX;
  const d = B.maxZ - B.minZ;
  const cx = (B.minX + B.maxX) / 2;
  const cz = (B.minZ + B.maxZ) / 2;
  const ceiling = -SLAB;
  const concrete = toon('#d3d6dd');
  // The slab over it, which is the office's floor, is world/stack.ts's: holes go through it to the floor below.

  group.add(groundPlane(w, d, cx, G + 0.004, cz, garageFloorTexture()));

  // The back and west walls, with a yellow band along them, and the columns and lights: all merged at the end.
  const parts = new THREE.Group();
  const wallH = ceiling - G;
  const yellow = toon('#ffd166');
  const walls: [number, number, number, number][] = [
    [B.minX, B.maxX, B.minZ, B.minZ + WALL_T],
    [B.minX, B.minX + WALL_T, B.minZ, B.maxZ],
  ];
  for (const [x0, x1, z0, z1] of walls) {
    parts.add(mesh(box(x1 - x0, wallH, z1 - z0), concrete, (x0 + x1) / 2, G + wallH / 2, (z0 + z1) / 2));
    parts.add(mesh(box(x1 - x0 + 0.02, 0.35, z1 - z0 + 0.02), yellow, (x0 + x1) / 2, G + 1.1, (z0 + z1) / 2, false));
    colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, bottom: G, top: ceiling });
  }
  const sign = textPlane('🏎️  GARAGE', { bg: '#2b2d42', color: '#ffd166', size: 64, border: '#ffd166' });
  sign.scale.multiplyScalar(1.6);
  sign.position.set(0, G + 2.3, B.minZ + WALL_T + 0.02);
  group.add(sign);

  // Columns holding up the office, along the open sides and down the middle.
  const cols: [number, number][] = [];
  for (const x of [B.maxX - 0.25, -9.6, 0, 9.6]) cols.push([x, B.maxZ - 0.25], [x, 0]);
  cols.push([B.maxX - 0.25, -6.5], [B.maxX - 0.25, 6.5], [B.maxX - 0.25, B.minZ + 0.25]);
  const colMat = toon('#e6e8ee');
  for (const [x, z] of cols) {
    parts.add(mesh(box(0.5, wallH, 0.5), colMat, x, G + wallH / 2, z));
    parts.add(mesh(box(0.52, 0.5, 0.52), yellow, x, G + 0.25, z, false));
    colliders.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25, bottom: G, top: ceiling });
  }

  // Strip lights on the ceiling.
  const light = toon('#ffffff', { emissive: '#fff4d6' });
  for (const x of [-13, -4.8, 4.8, 13]) for (const z of [-4.5, 4.5]) parts.add(mesh(box(2.6, 0.07, 0.22), light, x, ceiling - 0.04, z, false));
  group.add(mergeByMaterial(parts));
}

/** Grass in blocks: a field of square tufts in a handful of greens, a block (2 m) to a square, sharp however far it stretches. */
function grassTexture(w: number, d: number): THREE.CanvasTexture {
  const n = 32;
  const rand = mulberry32(99);
  const tones = ['#8fcf6b', '#9bd777', '#84c561', '#a5dd80', '#7bbb5a'];
  const t = canvasTexture(n * 4, n * 4, (g) => {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        g.fillStyle = tones[Math.floor(rand() * tones.length)];
        g.fillRect(x * 4, y * 4, 4, 4);
        if (rand() < 0.05) {
          g.fillStyle = ['#f2e86d', '#f4a6c0', '#ffffff'][Math.floor(rand() * 3)];
          g.fillRect(x * 4 + 1, y * 4 + 1, 2, 2);
        }
      }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.repeat.set(w / 8, d / 8);
  return t;
}

export function tree(scale: number): THREE.Group {
  const t = new THREE.Group();
  const m = new THREE.Mesh(leafyGeometry('#5fb760', Math.floor(scale * 13)), treeMaterial);
  m.castShadow = true;
  t.add(m);
  t.scale.setScalar(scale);
  return t;
}

/** A building across the street or out back: a painted block with rows of windows and a roof cap. */
function building(w: number, h: number, d: number, color: string, lit: THREE.MeshStandardMaterial[]): THREE.Group {
  const g = new THREE.Group();
  // Where the windows go across a floor (in 256ths): each column's middle half, 70 to 190 up.
  const face = (n: number) =>
    canvasTexture(256, 256, (c) => {
      c.fillStyle = color;
      c.fillRect(0, 0, 256, 256);
      c.fillStyle = '#bfe3ff';
      for (let i = 0; i < n; i++) c.fillRect(((i + 0.25) / n) * 256, 70, (0.5 / n) * 256, 120);
      c.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < n; i++) c.fillRect(((i + 0.25) / n) * 256, 70, (0.12 / n) * 256, 120);
    });
  // At night about half of them are lit: lamps, a ceiling light, the odd TV.
  const lights = (n: number, floors: number) =>
    canvasTexture(64, 64 * floors, (c) => {
      c.fillStyle = '#000000';
      c.fillRect(0, 0, 64, 64 * floors);
      for (let f = 0; f < floors; f++) {
        for (let i = 0; i < n; i++) {
          if (Math.random() < 0.45) continue;
          c.fillStyle = Math.random() < 0.15 ? '#9ec9ff' : Math.random() < 0.5 ? '#ffd27a' : '#ffe6b0';
          c.fillRect(((i + 0.25) / n) * 64, f * 64 + (70 / 256) * 64, (0.5 / n) * 64, (120 / 256) * 64);
        }
      }
    });
  const floors = Math.max(1, Math.round(h / 3.2));
  const walls = (span: number) => {
    const n = Math.max(1, Math.round(span / 2.6));
    const t = face(n);
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, floors);
    const m = new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: lights(n, floors), emissiveIntensity: 0 });
    lit.push(m);
    return m;
  };
  const sides = walls(d);
  const fronts = walls(w);
  const mats = [sides, sides, toon(color), toon(color), fronts, fronts];
  g.add(new THREE.Mesh(box(w, h, d), mats));
  (g.children[0] as THREE.Mesh).position.y = h / 2;
  (g.children[0] as THREE.Mesh).castShadow = true;
  g.add(mesh(box(w + 0.4, 0.4, d + 0.4), toon('#fffaf3'), 0, h + 0.2, 0));
  return g;
}

/** A street lamp on the sidewalk at (x, z), its arm reaching out over the road toward `toward` (±1 in z). */
export function streetLamp(parts: THREE.Group, night: NightParts, glass: THREE.MeshStandardMaterial, colliders: Collider[], x: number, z: number, toward: number) {
  const ink = toon('#3d405b');
  const H = 5;
  parts.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 10), ink, x, G + 0.25, z));
  parts.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, H, 8), ink, x, G + H / 2, z));
  parts.add(mesh(box(0.08, 0.08, 1.3), ink, x, G + H - 0.05, z + toward * 0.6));
  const hz = z + toward * 1.2;
  parts.add(mesh(new THREE.CylinderGeometry(0.12, 0.42, 0.26, 12), ink, x, G + H - 0.1, hz));
  parts.add(mesh(new THREE.SphereGeometry(0.22, 12, 8), glass, x, G + H - 0.3, hz, false));
  colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2, bottom: G, top: G + H });
  night.halos.push({ at: new THREE.Vector3(x, G + H - 0.34, hz), size: 2.4, color: '#ffd89a', ground: true });
  night.lamps.push({ x, y: G + H - 0.6, z: hz, reach: 10, color: '#ffcf8a', power: 4, ground: true });
}

/**
 * How far the grass goes, every way from the office: from the top floor the haze is up to HAZE_MAX
 * off (see world/sky.ts), and out at the far corners of the scenic loop too, so its edges must be
 * further than that even at the edge of the view. To the west it stops at the beach (world/scenic/).
 */
const REACH = 900;
/** Where the grass stops to the west, under the beach's sand, whose flat top is everywhere past here. */
const LAWN_WEST = Math.ceil(Math.max(...Array.from({ length: 1801 }, (_, i) => shoreX(i - 900))) + 4);

/** The street's asphalt: white lines along its edges and a dashed yellow one down the middle, 8 m to a dash and a gap. */
export function roadTexture(): THREE.CanvasTexture {
  const road = canvasTexture(256, 128, (g) => {
    g.fillStyle = '#5b606c';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#f1f1f1';
    g.fillRect(0, 6, 256, 4);
    g.fillRect(0, 118, 256, 4);
    g.fillStyle = '#ffd166';
    g.fillRect(0, 61, 150, 6);
  });
  road.wrapS = THREE.RepeatWrapping;
  return road;
}

/**
 * The neighbours' buildings: [x, z, width, height, depth, paint], across the street and further out
 * behind and beside the office. The gap across the street from the balcony is the golf hole's
 * (GOLF_HOLE in layout).
 */
const NEIGHBOURS: [number, number, number, number, number, string][] = [
  [-38, 45, 12, 10, 9, '#8ecae6'],
  [-22, 46, 14, 16, 10, '#ffb4a2'],
  [12, 47, 16, 19, 12, '#cdb4db'],
  [30, 45, 12, 9, 9, '#ffd6a5'],
  [-20, -42, 18, 14, 10, '#a2d2ff'],
  [8, -44, 16, 20, 12, '#f4acb7'],
  [-48, -6, 10, 12, 16, '#ffe5b4'],
  [50, 4, 10, 15, 18, '#bde0fe'],
];

/** Which way a neighbour at (x, z) is turned: its front to the office. */
const facing = (x: number, z: number) => (Math.abs(x) > 40 ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : z > 0 ? Math.PI : 0);

/** The neighbours' footprints, and how tall each stands (roof cap included) above the street. */
export function neighbourBoxes(): { minX: number; maxX: number; minZ: number; maxZ: number; top: number }[] {
  return NEIGHBOURS.map(([x, z, w, h, d]) => {
    // Turned a quarter, its width runs along z.
    const [hx, hz] = Math.abs(Math.sin(facing(x, z))) > 0.5 ? [d / 2, w / 2] : [w / 2, d / 2];
    return { minX: x - hx - 0.2, maxX: x + hx + 0.2, minZ: z - hz - 0.2, maxZ: z + hz + 0.2, top: h + 0.4 };
  });
}

/**
 * Everything outside, down on the street: grass, the lot in front of the garage, a road with
 * sidewalks and street lamps, trees and neighbours' buildings, and in `sky` some clouds.
 */
export function buildStreet(group: THREE.Group, colliders: Collider[], night: NightParts, sky: THREE.Group): SkyWorld {
  void night;
  // What you stand on anywhere out there, the lot and the road and the grass alike, and the beach.
  // (What it looks like is the city's, see streetcity.ts.)
  colliders.push({ minX: -REACH, maxX: REACH, minZ: -REACH, maxZ: REACH, bottom: G - 1, top: G });
  void group;

  // The voxel sky world: terraced clouds and floating islands, too far off for the fog to hide.
  const world = buildSkyWorld(night.clouds, (c) => bulb(night, c, 0.9));
  sky.add(world.group);
  return world;
}
