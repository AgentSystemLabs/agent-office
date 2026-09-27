import * as THREE from 'three';
import { FLOOR, SLAB, STREET_Y, WALL_T } from '../../shared/layout';
import { CAR, supercar, type CarKind } from './cars';
import type { Collider } from './office';
import { mergeByMaterial, mesh, textPlane, toon, toonUnique } from './toon';

const G = STREET_Y;
/** The building's footprint, walls included. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
/** Parking bays are this wide; the rows of them start at x = -16. */
const BAY = 3.2;
/** The street runs east–west in front of the building (south, +z). */
export const ROAD = { minZ: 23, maxZ: 31 } as const;

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A flat, textured toon plane lying on the ground. */
function groundPlane(w: number, d: number, x: number, y: number, z: number, map: THREE.Texture | null, color = '#ffffff'): THREE.Mesh {
  const mat = new THREE.MeshToonMaterial({ color, map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

/** Polished concrete with painted bays along the back wall and along the front. */
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
    g.fillStyle = '#fffaf0';
    for (const [z0, z1] of [
      [B.minZ + 0.3, B.minZ + 5.8],
      [B.maxZ - 5.8, B.maxZ - 0.3],
    ]) {
      for (let x = -16; x <= 16.01; x += BAY) g.fillRect(X(x) - 2, Z(z0), 4, (z1 - z0) * px);
    }
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
 * Downstairs: the office's floor slab (the garage ceiling), and the open garage under it: concrete
 * walls at the back and on the west side, columns along the open front and east side, strip
 * lights, and a row of Lambos and a row of Ferraris.
 */
export function buildGarage(group: THREE.Group, colliders: Collider[]) {
  const w = B.maxX - B.minX;
  const d = B.maxZ - B.minZ;
  const cx = (B.minX + B.maxX) / 2;
  const cz = (B.minZ + B.maxZ) / 2;
  const ceiling = -SLAB;
  const concrete = toon('#d3d6dd');
  const band = toon('#e8a87c');

  // The slab: concrete underneath, a peach band between the floors outside. Its top sits under the office floor.
  const slab = new THREE.Mesh(box(w, SLAB - 0.01, d), [band, band, concrete, concrete, band, band]);
  slab.position.set(cx, -SLAB / 2 - 0.005, cz);
  // Its underside faces away from the sun anyway; taking shadows only streaks it.
  slab.castShadow = true;
  group.add(slab);
  colliders.push({ ...B, bottom: ceiling, top: 0 });

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

  // The cars: Lambos nose-in along the back wall, Ferraris backed in facing the street.
  const cars: [CarKind, string, number, number][] = [
    ['lambo', '#8ac926', -14.4, -1],
    ['lambo', '#ff7b00', -8, -1],
    ['lambo', '#ffd000', 1.6, -1],
    ['lambo', '#7b2cbf', 11.2, -1],
    ['ferrari', '#d90429', -14.4, 1],
    ['ferrari', '#d90429', -4.8, 1],
    ['ferrari', '#ffc300', 4.8, 1],
    ['ferrari', '#e5383b', 14.4, 1],
  ];
  const lot = new THREE.Group();
  for (const [kind, color, x, face] of cars) {
    const z = face < 0 ? B.minZ + WALL_T + 0.4 + CAR.length / 2 : B.maxZ - 0.5 - CAR.length / 2;
    park(lot, colliders, kind, color, x, z, face < 0 ? Math.PI : 0);
  }
  // One left out front, for everyone upstairs to look at.
  park(lot, colliders, 'lambo', '#00b4d8', 9, 18.2, Math.PI / 2);
  group.add(mergeByMaterial(lot));
}

/** Parks a car at (x, z) turned by `rotY` (a multiple of 90°), with colliders you can hop up on. */
function park(group: THREE.Group, colliders: Collider[], kind: CarKind, color: string, x: number, z: number, rotY: number) {
  const car = supercar(kind, color);
  car.position.set(x, G, z);
  car.rotation.y = rotY;
  group.add(car);
  // A rectangle in the car's own frame (x across, z nose-ward), in the world.
  const c = Math.round(Math.cos(rotY));
  const sn = Math.round(Math.sin(rotY));
  const rect = (x0: number, x1: number, z0: number, z1: number, top: number) => {
    const xs = [x0 * c + z0 * sn, x1 * c + z1 * sn];
    const zs = [-x0 * sn + z0 * c, -x1 * sn + z1 * c];
    colliders.push({ minX: x + Math.min(...xs), maxX: x + Math.max(...xs), minZ: z + Math.min(...zs), maxZ: z + Math.max(...zs), bottom: G, top: G + top });
  };
  rect(-CAR.width / 2 + 0.08, CAR.width / 2 - 0.08, -CAR.length / 2 + 0.08, CAR.length / 2 - 0.08, CAR.body);
  rect(-0.6, 0.6, -1.3, 0.1, CAR.roof);
}

function tree(scale: number): THREE.Group {
  const t = new THREE.Group();
  t.add(mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.2, 8), toon('#8a5a3b'), 0, 1.1, 0));
  t.add(mesh(new THREE.SphereGeometry(1.6, 12, 10), toon('#5fb760'), 0, 3.2, 0));
  t.add(mesh(new THREE.SphereGeometry(1.1, 12, 10), toon('#3f8f45'), 0.8, 3.9, 0.4));
  t.add(mesh(new THREE.SphereGeometry(1.0, 12, 10), toon('#6fcf6a'), -0.7, 3.8, -0.3));
  t.scale.setScalar(scale);
  return t;
}

/** A building across the street or out back: a painted block with rows of windows and a roof cap. */
function building(w: number, h: number, d: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const face = (cols: number) =>
    canvasTexture(256, 256, (c) => {
      c.fillStyle = color;
      c.fillRect(0, 0, 256, 256);
      c.fillStyle = '#bfe3ff';
      const n = Math.max(1, cols);
      for (let i = 0; i < n; i++) c.fillRect(((i + 0.25) / n) * 256, 70, (0.5 / n) * 256, 120);
      c.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < n; i++) c.fillRect(((i + 0.25) / n) * 256, 70, (0.12 / n) * 256, 120);
    });
  const floors = Math.max(1, Math.round(h / 3.2));
  const walls = (span: number) => {
    const t = face(Math.round(span / 2.6));
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, floors);
    return new THREE.MeshToonMaterial({ map: t, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
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

/**
 * Everything outside, down on the street: grass, the lot in front of the garage, a road with
 * sidewalks, trees, neighbours' buildings and some clouds.
 */
export function buildStreet(group: THREE.Group) {
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), toon('#a7d98b'));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = G - 0.03;
  lawn.receiveShadow = true;
  group.add(lawn);

  // The lot in front of the garage, out to the sidewalk.
  const lot = groundPlane(60, 21 - B.maxZ, 0, G - 0.01, (B.maxZ + 21) / 2, null, '#9a9ea8');
  group.add(lot);
  const sideways = groundPlane(12, B.maxZ - B.minZ + 6, B.maxX + 6, G - 0.012, (B.minZ + B.maxZ) / 2 + 1, null, '#9a9ea8');
  group.add(sideways);

  // The road: asphalt, white edge lines and a dashed yellow middle.
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
  road.repeat.set(400 / 8, 1);
  group.add(groundPlane(400, ROAD.maxZ - ROAD.minZ, 0, G - 0.008, (ROAD.minZ + ROAD.maxZ) / 2, road));
  for (const [z0, z1] of [
    [21, ROAD.minZ],
    [ROAD.maxZ, ROAD.maxZ + 2],
  ]) {
    group.add(mesh(box(400, 0.08, z1 - z0), toon('#e3ddd0'), 0, G, (z0 + z1) / 2));
  }
  const forest = new THREE.Group();

  // Trees along the sidewalks and around the building.
  const trees: [number, number, number][] = [
    [-34, 22, 1.1],
    [-22, 22, 1],
    [22, 22, 1.05],
    [34, 22, 0.95],
    [-40, 32.5, 1.1],
    [-12, 32.5, 1],
    [14, 32.5, 1.15],
    [42, 32.5, 1],
    [-27, -8, 1.2],
    [-29, 4, 1],
    [-26, 14, 0.9],
    [29, -6, 1.1],
    [30, 6, 1.25],
    [-12, -22, 1.2],
    [4, -24, 1],
    [18, -21, 1.1],
  ];
  for (const [x, z, s] of trees) {
    const t = tree(s);
    t.position.set(x, G, z);
    forest.add(t);
  }
  group.add(mergeByMaterial(forest));

  // The neighbours: across the street, and further out behind and beside the office.
  const blocks: [number, number, number, number, number, string][] = [
    [-38, 45, 12, 10, 9, '#8ecae6'],
    [-22, 46, 14, 16, 10, '#ffb4a2'],
    [-5, 45, 12, 12, 9, '#b5e48c'],
    [12, 47, 16, 19, 12, '#cdb4db'],
    [30, 45, 12, 9, 9, '#ffd6a5'],
    [-20, -42, 18, 14, 10, '#a2d2ff'],
    [8, -44, 16, 20, 12, '#f4acb7'],
    [-48, -6, 10, 12, 16, '#ffe5b4'],
    [50, 4, 10, 15, 18, '#bde0fe'],
  ];
  for (const [x, z, w, h, d, color] of blocks) {
    const b = building(w, h, d, color);
    b.position.set(x, G, z);
    // Face the office.
    b.rotation.y = Math.abs(x) > 40 ? (x > 0 ? -Math.PI / 2 : Math.PI / 2) : z > 0 ? Math.PI : 0;
    group.add(b);
  }

  // Puffy clouds, too far off for the fog to hide.
  const cloud = toonUnique('#ffffff');
  cloud.fog = false;
  const sky = new THREE.Group();
  for (const [x, y, z, s] of [
    [-70, 34, -60, 1.3],
    [-10, 40, -90, 1.6],
    [60, 36, -70, 1.2],
    [90, 30, 20, 1.4],
    [-95, 32, 30, 1.1],
    [30, 38, 95, 1.5],
    [-45, 36, 90, 1.2],
  ]) {
    const c = new THREE.Group();
    for (const [dx, dy, r] of [
      [0, 0, 5],
      [5.5, -1, 3.8],
      [-5.5, -1.2, 3.6],
      [2.5, 2.4, 3.4],
    ]) {
      const puff = mesh(new THREE.SphereGeometry(r, 14, 10), cloud, dx, dy, 0, false);
      puff.scale.y = 0.75;
      c.add(puff);
    }
    c.position.set(x, y, z);
    c.scale.setScalar(s);
    c.lookAt(0, y, 0);
    sky.add(c);
  }
  group.add(mergeByMaterial(sky));
}
