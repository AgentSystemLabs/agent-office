import * as THREE from 'three';
import { STREET_Y } from '../../shared/layout';
import {
  CREEK,
  FARM,
  FOOTHILLS,
  LAKE,
  LIGHTHOUSE,
  LOOP,
  LOOP_HALF,
  LOOP_LENGTH,
  LOOP_PAVED,
  MOUNTAINS,
  PIER,
  PLACES,
  RIDGE,
  STREET_END,
  STREET_Z,
  TUNNEL,
  nearLoop,
  shoreX,
  type Place,
} from '../../shared/scenic';
import type { Collider } from './office';
import { bulb, neighbourBoxes, roadTexture, type NightParts } from './outside';
import { hazeReach } from './sky';
import { mergeByColor, mesh, textPlane, toon } from './toon';

// The scenic loop (see shared/scenic.ts), down on the street: the country road itself, and what you
// drive past on it. A farm on the way out of town to the east, then the pines, with a creek under a
// bridge; the mountains to the south, snow on their tops, a lake under them and a tunnel through a
// spur of them; up the coast, the beach, the sea and a pier, a lighthouse out on a rocky point; and
// back into town from the west. It's all made once and merged by material, a square of the map at
// a time so what's lost in the haze isn't drawn (see cull), and it drops with the street (see setLevel).

const G = STREET_Y;
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** The same numbers every time, so everyone drives past the same trees. */
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

/**
 * For something lying flat on the ground: drawn over whatever's under it (the higher `over`, the more
 * it wins), and never outlined, which would ink a flat strip's edges up off the ground.
 */
function flat(color: string, over: number, map: THREE.Texture | null = null, opts: { transparent?: boolean; opacity?: number } = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color, map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap, polygonOffset: true, polygonOffsetFactor: -over, polygonOffsetUnits: -over * 2, ...opts });
  m.userData.outlineParameters = { visible: false };
  return m;
}

interface Along {
  x: number;
  z: number;
  tx: number;
  tz: number;
}

/** A line's points with the way it goes at each (see RoadPoint). */
function withTangents(pts: { x: number; z: number }[]): Along[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: p.x, z: p.z, tx: (b.x - a.x) / len, tz: (b.z - a.z) / len };
  });
}

/** A smooth line through `knots`, `per` points between each two. */
function smooth(knots: [number, number][], per: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const n = knots.length;
  for (let i = 0; i < n - 1; i++) {
    const [p0, p1, p2, p3] = [i - 1, i, i + 1, i + 2].map((k) => knots[Math.max(0, Math.min(n - 1, k))]);
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0[0], p1[0], p2[0], p3[0]), z: f(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  out.push({ x: knots[n - 1][0], z: knots[n - 1][1] });
  return out;
}

/**
 * A strip along `pts`, from `right` to `left` meters off its middle (+ is its left, going along), at
 * height `y` (a number, or one for each side), with u running along it and v across (1 on the left).
 */
function strip(pts: Along[], right: number, left: number, y: number | ((i: number, side: 'l' | 'r') => number), u: (i: number) => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const at = (i: number, side: 'l' | 'r') => (typeof y === 'number' ? y : y(i, side));
  pts.forEach((p, i) => {
    // Left of the way along is (tz, -tx).
    pos.push(p.x + p.tz * left, at(i, 'l'), p.z - p.tx * left, p.x + p.tz * right, at(i, 'r'), p.z - p.tx * right);
    uv.push(u(i), 1, u(i), 0);
    if (i) {
      const l0 = (i - 1) * 2;
      idx.push(l0, l0 + 1, l0 + 2, l0 + 1, l0 + 3, l0 + 2);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function flatMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/** A point `off` meters to the left of the loop's middle at LOOP[i] (right, if negative). */
function beside(i: number, off: number): { x: number; z: number } {
  const p = LOOP[Math.max(0, Math.min(LOOP.length - 1, i))];
  return { x: p.x + p.tz * off, z: p.z - p.tx * off };
}

/** The loop's point nearest `d` meters round it. */
const indexAt = (d: number) => Math.max(0, Math.min(LOOP.length - 1, Math.round((d / LOOP_LENGTH) * (LOOP.length - 1))));

/** Where each bit of the loop starts and ends, meters round it. */
function stretch(place: Place): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const p of LOOP) {
    if (p.place !== place) continue;
    const last = out[out.length - 1];
    if (last && p.d - last.to < 3) last.to = p.d;
    else out.push({ from: p.d, to: p.d });
  }
  return out;
}

/** The loop's middle, a point every 4 m, to find the nearest bit of it to anywhere (further than nearLoop reaches). */
const COARSE = LOOP.filter((_, i) => i % 2 === 0);
function nearest(x: number, z: number): { off: number; place: Place; d: number } {
  let best = COARSE[0];
  let bestSq = Infinity;
  for (const p of COARSE) {
    const sq = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (sq < bestSq) {
      bestSq = sq;
      best = p;
    }
  }
  return { off: Math.sqrt(bestSq), place: best.place, d: best.d };
}

/** The loop and the street between its ends, as one closed outline. */
const RING = [...LOOP.map((p) => ({ x: p.x, z: p.z })), { x: 0, z: STREET_Z }];
function insideLoop(x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = RING.length - 1; i < RING.length; j = i++) {
    const a = RING[i];
    const b = RING[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance from (x, z) to a line through `pts`. */
function distToLine(pts: { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const k = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(x - a.x - ex * k, z - a.z - ez * k));
  }
  return best;
}

const inBox = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, x: number, z: number, pad = 0) => x > b.minX - pad && x < b.maxX + pad && z > b.minZ - pad && z < b.maxZ + pad;

// ---- Trees and things ----------------------------------------------------------------------------

const PINES = ['#2d6a4f', '#40916c', '#1b4332', '#52796f'];
const LEAVES = ['#5fb760', '#3f8f45', '#6fcf6a', '#74a57f'];
const AUTUMN = ['#f4a259', '#e76f51', '#e9c46a'];

/** A pine, feet at (x, z) on the street's level: three cones on a stubby trunk. */
function pine(into: THREE.Group, x: number, z: number, s: number, color: string, turn: number) {
  const g = new THREE.Group();
  // No ends on the trunk or the cones: nobody sees under a pine.
  g.add(mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.6, 6, 1, true), toon('#6f4e37'), 0, 0.8, 0));
  const leaf = toon(color);
  g.add(mesh(new THREE.ConeGeometry(1.9, 3.2, 7, 1, true), leaf, 0, 2.7, 0));
  g.add(mesh(new THREE.ConeGeometry(1.45, 2.6, 7, 1, true), leaf, 0, 4.1, 0));
  g.add(mesh(new THREE.ConeGeometry(0.95, 2.1, 7, 1, true), leaf, 0, 5.4, 0));
  g.position.set(x, G, z);
  g.rotation.y = turn;
  g.scale.set(s, s * (0.9 + (turn % 0.3)), s);
  into.add(g);
}

/** A leafy tree: a trunk and a couple of faceted blobs of leaves. */
function leafy(into: THREE.Group, x: number, z: number, s: number, color: string, turn: number) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.28, 2.1, 6, 1, true), toon('#8a5a3b'), 0, 1.05, 0));
  const leaf = toon(color);
  g.add(mesh(new THREE.IcosahedronGeometry(1.7, 1), leaf, 0, 3.2, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(1.15, 1), leaf, 0.8, 3.9, 0.35));
  g.position.set(x, G, z);
  g.rotation.y = turn;
  g.scale.setScalar(s);
  into.add(g);
}

/** A palm, leaning a little: a trunk in segments, fronds drooping all round, and coconuts. */
function palm(into: THREE.Group, x: number, z: number, s: number, turn: number) {
  const g = new THREE.Group();
  const bark = toon('#b08968');
  let lean = 0;
  let y = 0;
  for (let i = 0; i < 6; i++) {
    const seg = mesh(new THREE.CylinderGeometry(0.15 - i * 0.008, 0.2 - i * 0.008, 1.15, 6), bark, lean, y + 0.55, 0);
    seg.rotation.z = -0.05 - i * 0.03;
    g.add(seg);
    lean += 0.08 + i * 0.045;
    y += 1.08;
  }
  const frond = toon('#52b788');
  for (let k = 0; k < 8; k++) {
    const f = new THREE.Group();
    f.position.set(lean, y + 0.05, 0);
    f.rotation.y = (k / 8) * Math.PI * 2;
    // A long leaf, widest near its stem and drooping to a point.
    const leaf = mesh(new THREE.ConeGeometry(0.42, 3, 4).rotateX(Math.PI / 2).scale(1, 0.22, 1).translate(0, 0, 1.5), frond);
    leaf.rotation.x = 0.35 + (k % 2) * 0.2;
    f.add(leaf);
    g.add(f);
  }
  for (let k = 0; k < 3; k++) g.add(mesh(new THREE.SphereGeometry(0.16, 6, 5), toon('#7f5539'), lean + Math.cos(k * 2.1) * 0.25, y - 0.15, Math.sin(k * 2.1) * 0.25));
  g.position.set(x, G, z);
  g.rotation.y = turn;
  g.scale.setScalar(s);
  into.add(g);
}

/** A boulder: a lumpy, faceted grey rock, half sunk in the ground. */
function boulder(into: THREE.Group, x: number, z: number, r: number, turn: number, color = '#9d99a8') {
  const geo = new THREE.IcosahedronGeometry(r, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * 0.7);
  geo.computeVertexNormals();
  const m = mesh(geo, toon(color), x, G + r * 0.25, z);
  m.rotation.set(turn * 0.3, turn, turn * 0.2);
  into.add(m);
}

/**
 * A mountain (or a green hill) with its foot `r` round (x, z) and `h` high: a lumpy, faceted cone,
 * grass at its foot, rock up its sides and, on the tall ones, snow on top. Its triangles go into the
 * three lists by what they're made of, for merging.
 */
function mountain(out: Record<'grass' | 'rock' | 'dark' | 'snow', number[]>, x: number, z: number, r: number, h: number, seed: number, hill = false) {
  const rand = rng(seed);
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

/** A wooden sign on two posts, `text` on its face, facing `rotY` (its face toward +z turned by that). */
function signpost(into: THREE.Group, labels: THREE.Group, x: number, z: number, rotY: number, text: string, width = 5) {
  const g = new THREE.Group();
  const wood = toon('#7f5539');
  for (const sx of [-1, 1]) g.add(mesh(box(0.16, 3, 0.16), wood, sx * (width / 2 - 0.4), 1.5, 0));
  g.add(mesh(box(width, 1.4, 0.16), toon('#dda15e'), 0, 2.45, 0));
  g.position.set(x, G, z);
  g.rotation.y = rotY;
  into.add(g);
  const face = textPlane(text, { color: '#3d2b1f', size: 64 });
  const w = (face.geometry.parameters as { width: number }).width;
  face.scale.setScalar(Math.min(1.9, (width - 0.4) / w));
  face.position.set(x + Math.sin(rotY) * 0.09, G + 2.45, z + Math.cos(rotY) * 0.09);
  face.rotation.y = rotY;
  labels.add(face);
}

export interface Scenic {
  /** The road and everything along it (the text on the signs isn't merged). */
  group: THREE.Group;
  /** The sails of the windmill, the lighthouse's beam, boats bobbing and the water moving: `t` in seconds. */
  update(t: number): void;
  /**
   * Only what's near enough to see from `eye` through the haze (the fog's far edge down on the street
   * at `far`, and the street `street` down): the rest isn't drawn.
   */
  cull(eye: THREE.Vector3, street: number, far: number): void;
}

/** Builds the scenic loop into `group` (the office's `ground` group), its colliders into `colliders`, its lights into `night`. */
export function buildScenic(group: THREE.Group, colliders: Collider[], night: NightParts): Scenic {
  const root = new THREE.Group();
  group.add(root);
  const labels = new THREE.Group();
  root.add(labels);
  const rand = rng(20260929);
  /** What's built along each stretch, before it's all sorted into squares of the map and merged (see the end). */
  const parts: Record<'road' | 'farm' | 'forest' | 'mountains' | 'beach' | 'meadow' | 'coast', THREE.Group> = {
    road: new THREE.Group(),
    farm: new THREE.Group(),
    forest: new THREE.Group(),
    mountains: new THREE.Group(),
    beach: new THREE.Group(),
    meadow: new THREE.Group(),
    coast: new THREE.Group(),
  };
  /**
   * What's drawn only when it's near enough to see through the haze (see cull): its footprint, and
   * how high it stands over the street (the taller, the further off it shows over the haze).
   */
  const seen: { obj: THREE.Object3D; minX: number; maxX: number; minZ: number; maxZ: number; above: number }[] = [];
  const cullable = (obj: THREE.Object3D, minX: number, maxX: number, minZ: number, maxZ: number, above = 10) => seen.push({ obj, minX, maxX, minZ, maxZ, above });
  const around = (obj: THREE.Object3D, x: number, z: number, r: number, above = 10) => cullable(obj, x - r, x + r, z - r, z + r, above);
  /** Landmarks that show over the haze from further off than the rest: the silo, the windmill, the lighthouse. */
  const silo = new THREE.Group();
  const mill = new THREE.Group();
  const light = new THREE.Group();
  const trunk = (x: number, z: number, r: number, h: number) => colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, bottom: G, top: G + h });
  /** Where trees shouldn't go: taken by something else, or the road. */
  const taken: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => taken.every((t) => Math.hypot(t.x - x, t.z - z) > t.r + r);

  // ---- The road ---------------------------------------------------------------------------------
  // The street's asphalt, lines and all, carried on round the loop; the dashes line up where they
  // meet, and it starts a few meters back over the street's ends so there's no seam.
  const dashes = Math.round(LOOP_LENGTH / 8 + 0.5);
  const asphalt = roadTexture();
  const lead = [6, 4, 2].map((b) => ({ x: STREET_END - b, z: STREET_Z, d: -b, tx: 1, tz: 0 }));
  const tail = [2, 4, 6].map((b) => ({ x: -STREET_END + b, z: STREET_Z, d: LOOP_LENGTH + b, tx: 1, tz: 0 }));
  const way = [...lead, ...LOOP, ...tail];
  const roadU = (d: number) => 0.5 + (d / LOOP_LENGTH) * (dashes - 0.5);
  root.add(flatMesh(strip(way, -LOOP_HALF, LOOP_HALF, G - 0.008, (i) => roadU(way[i].d)), flat('#ffffff', 4, asphalt)));
  // The gravel either side starts under the asphalt's first few meters, not right at its edge.
  const verge = [lead[2], ...LOOP, tail[0]];
  root.add(flatMesh(strip(verge, -LOOP_HALF - 1.2, LOOP_HALF + 1.2, G - 0.012, () => 0), flat('#b5a98f', 3)));

  // The start line across the street, right in front of the office: where a lap starts and ends.
  const checks = canvasTexture(64, 256, (g) => {
    for (let r = 0; r < 16; r++) {
      for (let c = 0; c < 4; c++) {
        g.fillStyle = (r + c) % 2 ? '#1d1d24' : '#f8f8f2';
        g.fillRect(c * 16, r * 16, 16, 16);
      }
    }
  });
  const line = flatMesh(new THREE.PlaneGeometry(1.6, 7.6), flat('#ffffff', 6, checks));
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, G - 0.006, STREET_Z);
  root.add(line);

  const tunnel = { from: 0, to: 0 };
  for (const s of stretch('tunnel')) Object.assign(tunnel, s);
  // Where the road crosses the creek: the bridge.
  const creekLine = smooth(CREEK, 8);
  let bridge = 0;
  let bridgeOff = Infinity;
  LOOP.forEach((p) => {
    const d = distToLine(creekLine, p.x, p.z);
    if (d < bridgeOff) {
      bridgeOff = d;
      bridge = p.d;
    }
  });
  const onBridge = (d: number) => Math.abs(d - bridge) < 9;

  // White posts with reflectors down both sides, and a guardrail on the mountain side of the pass.
  const post = toon('#f1f1ee');
  const reflector = toon('#ff9f1c', { emissive: '#8a4b00' });
  for (let d = 12; d < LOOP_LENGTH - 6; d += 22) {
    if ((d > tunnel.from - 6 && d < tunnel.to + 6) || onBridge(d)) continue;
    const i = indexAt(d);
    for (const side of [-1, 1]) {
      const at = beside(i, side * (LOOP_HALF + 1.7));
      parts.road.add(mesh(box(0.14, 0.95, 0.14), post, at.x, G + 0.47, at.z));
      parts.road.add(mesh(box(0.15, 0.13, 0.15), reflector, at.x, G + 0.8, at.z, false));
    }
  }
  const steel = toon('#c3c7cf');
  for (const s of stretch('mountains')) {
    for (let d = s.from + 4; d < s.to - 2; d += 4) {
      if (d > tunnel.from - 3 && d < tunnel.to + 3) continue;
      const i = indexAt(d);
      const a = beside(i, LOOP_HALF + 1.3);
      const b = beside(indexAt(d + 4), LOOP_HALF + 1.3);
      parts.mountains.add(mesh(box(0.14, 0.75, 0.14), steel, a.x, G + 0.37, a.z));
      const rail = mesh(box(0.08, 0.32, Math.hypot(b.x - a.x, b.z - a.z) + 0.1), steel, (a.x + b.x) / 2, G + 0.62, (a.z + b.z) / 2);
      rail.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      parts.mountains.add(rail);
    }
  }
  // Nothing grows on the road or its verges.
  for (let i = 0; i < LOOP.length; i += 3) taken.push({ x: LOOP[i].x, z: LOOP[i].z, r: LOOP_PAVED + 2.2 });

  // ---- The town's ends: signs to the loop ------------------------------------------------------------
  // A billboard across the street from the garage, and a sign at each end of the street.
  {
    const g = new THREE.Group();
    const wood = toon('#5c4033');
    for (const sx of [-1, 1]) g.add(mesh(box(0.3, 5.6, 0.3), wood, sx * 3.2, 2.8, 0));
    g.add(mesh(box(8.4, 3.2, 0.25), toon('#264653'), 0, 4.1, 0));
    g.position.set(24, G, 37);
    g.rotation.y = Math.PI;
    parts.meadow.add(g);
    colliders.push({ minX: 20.6, maxX: 27.4, minZ: 36.8, maxZ: 37.2, bottom: G, top: G + 5.6 });
    const title = textPlane('🏎️ SCENIC LOOP', { color: '#ffd166', size: 72 });
    title.scale.setScalar(1.35);
    title.position.set(24, G + 4.75, 36.85);
    title.rotation.y = Math.PI;
    const sub = textPlane('🌾 farm · 🌲 pines · 🏔️ mountains · 🏖️ beach — 1.4 km, either way ⟷', { color: '#f1faee', size: 44 });
    const w = (sub.geometry.parameters as { width: number }).width;
    sub.scale.setScalar(7.8 / w);
    sub.position.set(24, G + 3.55, 36.85);
    sub.rotation.y = Math.PI;
    labels.add(title, sub);
  }
  signpost(parts.meadow, labels, STREET_END - 14, 20.2, -Math.PI / 2, '🏔️ Scenic Loop ⟶', 4.6);
  signpost(parts.meadow, labels, -STREET_END + 14, 20.2, Math.PI / 2, '⟵ Scenic Loop 🏖️', 4.6);

  // At the start of each stretch, a sign on the right (going round clockwise), facing the traffic.
  for (const place of ['farm', 'forest', 'mountains', 'beach', 'coast'] as Place[]) {
    const s = stretch(place)[0];
    if (!s) continue;
    const i = indexAt(s.from + 6);
    const p = LOOP[i];
    const at = beside(i, -(LOOP_HALF + 3.4));
    signpost(parts.road, labels, at.x, at.z, Math.atan2(-p.tx, -p.tz) - 0.3, `${PLACES[place].icon} ${PLACES[place].name}`);
    taken.push({ x: at.x, z: at.z, r: 3 });
  }

  // ---- The farm ---------------------------------------------------------------------------------
  {
    const f = parts.farm;
    // Fields of crops in rows, and a fence round the pasture.
    const rows = (a: string, b: string) =>
      canvasTexture(64, 64, (g) => {
        g.fillStyle = a;
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = b;
        for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 8, 64);
      });
    const crops = [rows('#e9c46a', '#d4a340'), rows('#80b918', '#55a630')];
    FARM.fields.forEach((b, k) => {
      const w = b.maxX - b.minX;
      const d = b.maxZ - b.minZ;
      const t = crops[k];
      t.repeat.set(w / 2.4, 1);
      const m = flatMesh(new THREE.PlaneGeometry(w, d), flat('#ffffff', 1, t));
      m.rotation.x = -Math.PI / 2;
      m.position.set((b.minX + b.maxX) / 2, G - 0.02, (b.minZ + b.maxZ) / 2);
      root.add(m);
      cullable(m, b.minX, b.maxX, b.minZ, b.maxZ);
      taken.push({ x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2, r: Math.hypot(w, d) / 2 });
    });
    // Hay bales rolled up in the wheat.
    const hay = toon('#e9c46a');
    const wheat = FARM.fields[0];
    for (let k = 0; k < 14; k++) {
      const x = wheat.minX + 4 + rand() * (wheat.maxX - wheat.minX - 8);
      const z = wheat.minZ + 4 + rand() * (wheat.maxZ - wheat.minZ - 8);
      const b = mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.3, 12).rotateZ(Math.PI / 2), hay, x, G + 0.85, z);
      b.rotation.y = rand() * Math.PI;
      f.add(b);
      trunk(x, z, 0.8, 1.7);
    }
    const P = FARM.pasture;
    const rail = toon('#a47148');
    const fence = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.ceil(len / 3);
      for (let k = 0; k <= n; k++) f.add(mesh(box(0.14, 1.2, 0.14), rail, x0 + ((x1 - x0) * k) / n, G + 0.6, z0 + ((z1 - z0) * k) / n));
      for (const y of [0.55, 1.0]) {
        const r = mesh(box(0.06, 0.1, len), rail, (x0 + x1) / 2, G + y, (z0 + z1) / 2);
        r.rotation.y = Math.atan2(x1 - x0, z1 - z0);
        f.add(r);
      }
      colliders.push({ minX: Math.min(x0, x1) - 0.1, maxX: Math.max(x0, x1) + 0.1, minZ: Math.min(z0, z1) - 0.1, maxZ: Math.max(z0, z1) + 0.1, bottom: G, top: G + 1.2, fence: true });
    };
    fence(P.minX, P.minZ, P.maxX, P.minZ);
    fence(P.maxX, P.minZ, P.maxX, P.maxZ);
    fence(P.maxX, P.maxZ, P.minX, P.maxZ);
    fence(P.minX, P.maxZ, P.minX, P.minZ + 5);
    taken.push({ x: (P.minX + P.maxX) / 2, z: (P.minZ + P.maxZ) / 2, r: 22 });
    // Cows, grazing.
    const white = toon('#f8f9fa');
    const black = toon('#22223b');
    const pink = toon('#ffb4a2');
    for (let k = 0; k < 6; k++) {
      const cow = new THREE.Group();
      cow.add(mesh(box(1.0, 0.85, 1.9), white, 0, 1.15, 0));
      cow.add(mesh(box(1.02, 0.5, 0.6), black, 0, 1.25, 0.25));
      cow.add(mesh(box(0.6, 0.4, 0.5), black, 0.22, 1.35, -0.55));
      const head = new THREE.Group();
      head.position.set(0, 1.25, 1.05);
      head.rotation.x = k % 2 ? 0.7 : 0.1;
      head.add(mesh(box(0.55, 0.55, 0.65), white, 0, 0, 0.25));
      head.add(mesh(box(0.5, 0.3, 0.2), pink, 0, -0.12, 0.62));
      for (const sx of [-1, 1]) head.add(mesh(box(0.08, 0.2, 0.08), toon('#fefae0'), sx * 0.2, 0.36, 0.1));
      cow.add(head);
      for (const [lx, lz] of [
        [0.35, 0.7],
        [-0.35, 0.7],
        [0.35, -0.7],
        [-0.35, -0.7],
      ])
        cow.add(mesh(box(0.2, 0.75, 0.2), white, lx, 0.37, lz));
      const x = P.minX + 5 + rand() * (P.maxX - P.minX - 10);
      const z = P.minZ + 4 + rand() * (P.maxZ - P.minZ - 8);
      cow.position.set(x, G, z);
      cow.rotation.y = rand() * Math.PI * 2;
      f.add(cow);
      colliders.push({ minX: x - 1, maxX: x + 1, minZ: z - 1, maxZ: z + 1, bottom: G, top: G + 1.6 });
    }
    // The barn: red, a gable roof, white trim and a big X-braced door facing the road.
    const barn = new THREE.Group();
    barn.add(mesh(box(10, 5.5, 14), toon('#b23a48'), 0, 2.75, 0));
    const gable = new THREE.Shape();
    gable.moveTo(-5.7, 0);
    gable.lineTo(5.7, 0);
    gable.lineTo(0, 3.8);
    gable.closePath();
    barn.add(mesh(new THREE.ExtrudeGeometry(gable, { depth: 14, bevelEnabled: false }).translate(0, 5.5, -7), toon('#fefae0'), 0, 0, 0));
    const roof = toon('#5c4d4d');
    for (const sx of [-1, 1]) {
      const r = mesh(box(6.9, 0.25, 15), roof, sx * 2.85, 7.45, 0);
      r.rotation.z = -sx * Math.atan2(3.8, 5.7);
      barn.add(r);
    }
    const trim = toon('#fefae0');
    barn.add(mesh(box(4.2, 4.3, 0.12), toon('#8d2b35'), 0, 2.15, -7.02));
    for (const s of [-1, 1]) {
      const brace = mesh(box(0.22, 5.8, 0.1), trim, 0, 2.15, -7.1);
      brace.rotation.z = s * Math.atan2(4.2, 4.3);
      barn.add(brace);
    }
    barn.add(mesh(box(4.6, 0.25, 0.14), trim, 0, 4.4, -7.08));
    barn.add(mesh(box(1.8, 1.4, 0.12), trim, 0, 6.4, -7.05));
    barn.add(mesh(box(1.3, 0.95, 0.14), toon('#3d2b1f'), 0, 6.4, -7.1));
    barn.position.set(FARM.barn.x, G, FARM.barn.z);
    barn.rotation.y = FARM.barn.rotY;
    f.add(barn);
    const lamp = bulb(night, '#ffd89a', 0.1);
    const lampAt = new THREE.Vector3(0, 4.9, -7.25).applyAxisAngle(new THREE.Vector3(0, 1, 0), FARM.barn.rotY).add(new THREE.Vector3(FARM.barn.x, G, FARM.barn.z));
    f.add(mesh(new THREE.SphereGeometry(0.2, 10, 8), lamp, lampAt.x, lampAt.y, lampAt.z, false));
    night.halos.push({ at: lampAt, size: 1.4, color: '#ffd89a', ground: true });
    colliders.push({ minX: FARM.barn.x - 7, maxX: FARM.barn.x + 7, minZ: FARM.barn.z - 7, maxZ: FARM.barn.z + 7, bottom: G, top: G + 9 });
    taken.push({ x: FARM.barn.x, z: FARM.barn.z, r: 11 });
    // The silo beside it.
    const S = FARM.silo;
    silo.add(mesh(new THREE.CylinderGeometry(3, 3, 13, 16), toon('#cfd2d6'), S.x, G + 6.5, S.z));
    for (const y of [3, 6.5, 10]) silo.add(mesh(new THREE.CylinderGeometry(3.05, 3.05, 0.25, 16), toon('#8d99ae'), S.x, G + y, S.z, false));
    silo.add(mesh(new THREE.SphereGeometry(3.05, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon('#8d99ae'), S.x, G + 13, S.z));
    colliders.push({ minX: S.x - 3, maxX: S.x + 3, minZ: S.z - 3, maxZ: S.z + 3, bottom: G, top: G + 16 });
    taken.push({ x: S.x, z: S.z, r: 6 });
  }
  // The windmill, north of the street, its sails turning (see update).
  let sails = new THREE.Group();
  {
    const W = FARM.windmill;
    const f = mill;
    f.add(mesh(new THREE.CylinderGeometry(2.2, 3.4, 12, 8), toon('#f1e9da'), W.x, G + 6, W.z));
    f.add(mesh(new THREE.ConeGeometry(2.7, 2.8, 8), toon('#8d5b4c'), W.x, G + 13.4, W.z));
    f.add(mesh(box(1.2, 2, 0.12), toon('#6f4e37'), W.x, G + 1, W.z + 3.1));
    f.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.4, 8).rotateX(Math.PI / 2), toon('#5c4033'), W.x, G + 12, W.z + 2.6));
    const cloth = toon('#fefae0');
    const frame = toon('#6f4e37');
    const blades = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const arm = new THREE.Group();
      arm.rotation.z = (k * Math.PI) / 2;
      arm.add(mesh(box(0.22, 8.5, 0.18), frame, 0, 4.4, 0));
      arm.add(mesh(box(1.5, 6.4, 0.08), cloth, 0.85, 5.2, -0.05));
      blades.add(arm);
    }
    sails = mergeByColor(blades);
    sails.position.set(W.x, G + 12, W.z + 3.35);
    root.add(sails);
    around(sails, W.x, W.z, 10, 17);
    colliders.push({ minX: W.x - 3, maxX: W.x + 3, minZ: W.z - 3, maxZ: W.z + 3, bottom: G, top: G + 14 });
    taken.push({ x: W.x, z: W.z, r: 7 });
  }

  // ---- Water: the creek, the lake and the sea ----------------------------------------------------------
  const ripples = (base: string, light: string) =>
    canvasTexture(128, 128, (g) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = light;
      g.lineWidth = 2.5;
      const r = rng(7);
      for (let k = 0; k < 10; k++) {
        const x = r() * 128;
        const y = r() * 128;
        const w = 14 + r() * 26;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + w / 2, y - 4, x + w, y);
        g.stroke();
      }
    });
  const waters: THREE.Texture[] = [];
  // The creek: a ribbon of water between muddy banks, under the bridge.
  {
    const line = withTangents(creekLine);
    const t = ripples('#4ea8de', '#9bd4f5');
    waters.push(t);
    let run = 0;
    const along = line.map((p, i) => (i ? (run += Math.hypot(p.x - line[i - 1].x, p.z - line[i - 1].z)) : 0));
    const xs = creekLine.map((q) => q.x);
    const zs = creekLine.map((q) => q.z);
    for (const m of [flatMesh(strip(line, -4.5, 4.5, G - 0.022, () => 0), flat('#a68a64', 1)), flatMesh(strip(line, -2.8, 2.8, G - 0.018, (i) => along[i] / 10), flat('#ffffff', 2, t))]) {
      root.add(m);
      cullable(m, Math.min(...xs) - 5, Math.max(...xs) + 5, Math.min(...zs) - 5, Math.max(...zs) + 5);
    }
    for (const p of creekLine) taken.push({ x: p.x, z: p.z, r: 5 });
    // The bridge's wooden railings, either side of the road over it.
    const wood = toon('#8b5e34');
    for (const side of [-1, 1]) {
      const i0 = indexAt(bridge - 9);
      const i1 = indexAt(bridge + 9);
      for (let i = i0; i <= i1; i += 1) {
        const a = beside(i, side * (LOOP_PAVED + 0.35));
        parts.forest.add(mesh(box(0.25, 1.1, 0.25), wood, a.x, G + 0.55, a.z));
        if (i < i1) {
          const b = beside(i + 1, side * (LOOP_PAVED + 0.35));
          const r = mesh(box(0.14, 0.18, Math.hypot(b.x - a.x, b.z - a.z) + 0.1), wood, (a.x + b.x) / 2, G + 1.0, (a.z + b.z) / 2);
          r.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
          parts.forest.add(r);
        }
      }
    }
  }
  // The lake under the mountains, a shore of sand round it and a little dock.
  {
    const t = ripples('#3a86c8', '#76b7e0');
    t.repeat.set(6, 3);
    waters.push(t);
    const shore = flatMesh(new THREE.CircleGeometry(1, 48), flat('#e9d8a6', 1));
    shore.scale.set(LAKE.rx + 3.5, LAKE.rz + 3.5, 1);
    shore.rotation.x = -Math.PI / 2;
    shore.position.set(LAKE.x, G - 0.022, LAKE.z);
    const water = flatMesh(new THREE.CircleGeometry(1, 48), flat('#ffffff', 2, t));
    water.scale.set(LAKE.rx, LAKE.rz, 1);
    water.rotation.x = -Math.PI / 2;
    water.position.set(LAKE.x, G - 0.018, LAKE.z);
    root.add(shore, water);
    for (const m of [shore, water]) cullable(m, LAKE.x - LAKE.rx - 4, LAKE.x + LAKE.rx + 4, LAKE.z - LAKE.rz - 4, LAKE.z + LAKE.rz + 4);
    taken.push({ x: LAKE.x, z: LAKE.z, r: LAKE.rx + 6 });
    const wood = toon('#9c6644');
    const dock = { x: LAKE.x - 6, z: LAKE.z - LAKE.rz - 1 };
    parts.mountains.add(mesh(box(2.4, 0.2, 9), wood, dock.x, G + 0.25, dock.z + 3.5));
    for (const [dx, dz] of [
      [-1.1, 0],
      [1.1, 0],
      [-1.1, 7.8],
      [1.1, 7.8],
    ])
      parts.mountains.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 6), wood, dock.x + dx, G + 0.2, dock.z + dz));
    parts.mountains.add(mesh(box(1.1, 0.5, 2.6), toon('#e63946'), dock.x + 2.6, G - 0.02, dock.z + 6.5));
    for (let k = 0; k < 9; k++) {
      const a = rand() * Math.PI * 2;
      boulder(parts.mountains, LAKE.x + Math.cos(a) * (LAKE.rx + 2), LAKE.z + Math.sin(a) * (LAKE.rz + 2), 0.8 + rand() * 1.4, rand() * 6);
    }
  }
  // The sea, west past the beach as far as you can see, the sand sloping down into it, and surf.
  const surf: THREE.MeshToonMaterial[] = [];
  {
    const t = ripples('#2a9bd4', '#62c2e8');
    t.repeat.set(90, 125);
    waters.push(t);
    const sea = flatMesh(new THREE.PlaneGeometry(1300, 1800), flat('#ffffff', 0, t));
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(-240 - 650, G - 0.15, 0);
    root.add(sea);
    const coast: Along[] = [];
    for (let z = -900; z <= 900; z += z > -300 && z < 600 ? 4 : 30) coast.push({ x: shoreX(z), z, tx: 0, tz: 0 });
    const line = withTangents(coast);
    // Going south (+z) along it, the land's on the left (+): flat sand up from the water's edge, and
    // under the water it slopes away, so the sea's surface meets it right at the edge.
    const sand = flat('#f2dfae', 1);
    root.add(flatMesh(strip(line, 4, 28, G - 0.015, () => 0), sand));
    root.add(flatMesh(strip(line, -10, 4, (_i, side) => (side === 'l' ? G - 0.015 : G - 0.5), () => 0), sand));
    const foam = flat('#ffffff', 1, null, { transparent: true, opacity: 0.7 });
    foam.depthWrite = false;
    surf.push(foam);
    root.add(flatMesh(strip(line, -2.6, 0.2, G - 0.135, () => 0), foam));
    // Walk into the shallows, or out along the pier, but not out to sea.
    const bands: [number, number][] = [
      [-400, PIER.z - PIER.width / 2],
      [PIER.z + PIER.width / 2, 640],
    ];
    for (const [z0, z1] of bands) {
      for (let z = z0; z < z1; z += 40) {
        const zEnd = Math.min(z1, z + 40);
        let x = Infinity;
        for (let k = z; k <= zEnd; k += 2) x = Math.min(x, shoreX(k));
        colliders.push({ minX: -1600, maxX: x - 6, minZ: z, maxZ: zEnd, bottom: G - 1, top: G + 2, fence: true });
      }
    }
    colliders.push({ minX: -1600, maxX: shoreX(PIER.z) - PIER.length - 0.2, minZ: PIER.z - PIER.width / 2, maxZ: PIER.z + PIER.width / 2, bottom: G - 1, top: G + 2, fence: true });
  }

  // ---- The mountains ------------------------------------------------------------------------------
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

  // ---- The tunnel -----------------------------------------------------------------------------------
  {
    const T = TUNNEL;
    const half = T.width / 2;
    const archR = half;
    const len = T.x0 - T.x1;
    // The spur's shape across the road (u is meters south of it), with the tunnel's arch through it.
    const profile: [number, number][] = [
      [-RIDGE.north, -0.6],
      [-RIDGE.north, 0],
      [-24, 5],
      [-17, 11],
      [-10, 16],
      [-4, 19],
      [3, 23],
      [10, RIDGE.height - 1],
      [17, RIDGE.height],
      [24, 23],
      [31, 15],
      [36, 7],
      [RIDGE.south, 0],
      [RIDGE.south, -0.6],
    ];
    const shape = new THREE.Shape(profile.map(([u, y]) => new THREE.Vector2(u, y)));
    const hole = new THREE.Path();
    hole.moveTo(-half, -0.3);
    hole.lineTo(half, -0.3);
    hole.lineTo(half, T.wall);
    hole.absarc(0, T.wall, archR, 0, Math.PI, false);
    hole.lineTo(-half, -0.3);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, steps: 12, curveSegments: 14 });
    // Across the road (u) is z, and along it is -x from the east end.
    geo.rotateY(-Math.PI / 2);
    geo.translate(T.x0, G, T.z);
    // Humped up in the middle and down toward its ends, so the cliff each end of the tunnel is cut in
    // isn't the whole spur's height and width; lumpy along the top. None of it round the arch, so the
    // lining fits (and an end's corners only move up and down or across, so each end stays flat).
    const top = T.wall + archR + 1;
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const u = p.getZ(i) - T.z;
      let y = p.getY(i) - G;
      const k = Math.pow(Math.sin((Math.PI * (T.x0 - x)) / len), 0.6);
      if (Math.abs(u) > half + 1.5) p.setZ(i, T.z + Math.sign(u) * (half + 1.5 + (Math.abs(u) - half - 1.5) * (0.45 + 0.55 * k)));
      if (y > top) {
        y = top + (y - top) * (0.3 + 0.7 * k);
        y += (Math.sin(x * 0.21 + u * 0.13) + Math.sin(x * 0.07 - u * 0.31)) * 1.6 * k;
        p.setY(i, G + y);
      }
    }
    geo.computeVertexNormals();
    // Its two ends are cliffs of rock, the tunnel's mouths in them; its sides and top are grass.
    const spur = new THREE.Mesh(geo, [toon('#9a93a6'), toon('#6f8f55')]);
    spur.castShadow = true;
    root.add(spur);
    const tunnelBox = (obj: THREE.Object3D) => cullable(obj, T.x1 - 20, T.x0 + 20, T.z - RIDGE.north - 5, T.z + RIDGE.south + 5, RIDGE.height + 6);
    tunnelBox(spur);
    // The walls and roof inside, a little in from the arch: dark rock, with a line of lamps along the top.
    const inset = 0.06;
    const arc: [number, number][] = [[-half + inset, -0.2]];
    for (let k = 0; k <= 16; k++) {
      const a = Math.PI - (k / 16) * Math.PI;
      arc.push([Math.cos(a) * (archR - inset), T.wall + Math.sin(a) * (archR - inset)]);
    }
    arc.push([half - inset, -0.2]);
    const pos: number[] = [];
    for (let k = 0; k < arc.length - 1; k++) {
      const [u0, y0] = arc[k];
      const [u1, y1] = arc[k + 1];
      const a = [T.x0, G + y0, T.z + u0];
      const b = [T.x0, G + y1, T.z + u1];
      const c = [T.x1, G + y1, T.z + u1];
      const d = [T.x1, G + y0, T.z + u0];
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
    // Lit by its own lamps, not the sun: shaded by hand, walls lighter than the roof.
    const col: number[] = [];
    const wall = new THREE.Color('#5d5766');
    const roof = new THREE.Color('#3b3643');
    for (let k = 0; k < arc.length - 1; k++) {
      const up = Math.max(0, (arc[k][1] + arc[k + 1][1]) / 2 - T.wall) / archR;
      const c = wall.clone().lerp(roof, Math.min(1, up));
      for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b);
    }
    const lining = new THREE.BufferGeometry();
    lining.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    lining.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const rock = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    rock.userData.outlineParameters = { visible: false };
    const inner = new THREE.Mesh(lining, rock);
    root.add(inner);
    tunnelBox(inner);
    // The road through it, as dim as the walls whatever the sun's doing outside.
    const end = (x: number) => ({ x, z: T.z, d: nearLoop(x, T.z)!.d, tx: -1, tz: 0 });
    const through = [end(T.x0), ...LOOP.filter((q) => q.x < T.x0 && q.x > T.x1 && Math.abs(q.z - T.z) < 1), end(T.x1)];
    const dim = (color: string, over: number, map: THREE.Texture | null = null) => {
      const m = new THREE.MeshBasicMaterial({ color, map, polygonOffset: true, polygonOffsetFactor: -over, polygonOffsetUnits: -over * 2 });
      m.userData.outlineParameters = { visible: false };
      return m;
    };
    for (const m of [
      new THREE.Mesh(strip(through, -LOOP_HALF - 1.2, LOOP_HALF + 1.2, G - 0.009, () => 0), dim('#5e574c', 4)),
      new THREE.Mesh(strip(through, -LOOP_HALF, LOOP_HALF, G - 0.006, (i) => roadU(through[i].d)), dim('#8d8d94', 5, asphalt)),
    ]) {
      root.add(m);
      tunnelBox(m);
    }
    const lamp = bulb(night, '#ffcf7a', 0.9);
    for (let x = T.x1 + 4; x < T.x0 - 2; x += 6) for (const u of [-2.2, 2.2]) parts.mountains.add(mesh(box(1.4, 0.12, 0.3), lamp, x, G + T.wall + archR - 0.9 + (u > 0 ? 0 : 0), T.z + u, false));
    // A stone arch round each end, and the tunnel's name over it.
    const stone = toon('#cdc5b4');
    for (const [x, face] of [
      [T.x0, Math.PI / 2],
      [T.x1, -Math.PI / 2],
    ]) {
      const out = Math.sign(face);
      const ring = mesh(new THREE.TorusGeometry(archR + 0.35, 0.45, 6, 16, Math.PI), stone, x + out * 0.2, G + T.wall, T.z);
      ring.rotation.y = Math.PI / 2;
      parts.mountains.add(ring);
      for (const u of [-1, 1]) parts.mountains.add(mesh(box(0.9, T.wall, 0.9), stone, x + out * 0.2, G + T.wall / 2, T.z + u * (half + 0.35)));
      const name = textPlane(`${PLACES.tunnel.icon} ${PLACES.tunnel.name.toUpperCase()}`, { color: '#fefae0', bg: '#3d405b', size: 56, border: '#cdc5b4' });
      name.scale.setScalar(1.5);
      name.position.set(x + out * 0.35, G + T.wall + archR + 1.6, T.z);
      name.rotation.y = face;
      labels.add(name);
    }
    // Rock either side of the road in and out of it, north and south: nobody walks over the spur.
    colliders.push({ minX: T.x1, maxX: T.x0, minZ: T.z - RIDGE.north * 0.5, maxZ: T.z - half - 0.25, bottom: G - 1, top: G + 1000 });
    colliders.push({ minX: T.x1, maxX: T.x0, minZ: T.z + half + 0.25, maxZ: T.z + RIDGE.south * 0.5, bottom: G - 1, top: G + 1000 });
    taken.push({ x: (T.x0 + T.x1) / 2, z: T.z, r: 42 });
  }

  // ---- The beach and the coast ------------------------------------------------------------------------
  const boats: { g: THREE.Group; x: number; z: number; phase: number }[] = [];
  {
    const b = parts.beach;
    const colors = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#f78c6b', '#9b5de5'];
    // Umbrellas and towels on the sand.
    for (const s of stretch('beach')) {
      for (let d = s.from + 10; d < s.to - 6; d += 9 + rand() * 7) {
        const p = LOOP[indexAt(d)];
        const x = shoreX(p.z) + 9 + rand() * 12;
        const z = p.z + (rand() - 0.5) * 6;
        if (Math.abs(z - PIER.z) < 6) continue;
        const color = colors[Math.floor(rand() * colors.length)];
        b.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6), toon('#f1f1ee'), x, G + 1.25, z));
        const top = mesh(new THREE.ConeGeometry(1.5, 0.6, 8), toon(color), x, G + 2.45, z);
        top.rotation.z = (rand() - 0.5) * 0.3;
        b.add(top);
        const towel = mesh(box(0.9, 0.03, 1.9), toon(colors[Math.floor(rand() * colors.length)]), x + 1.1, G + 0.02, z + 0.4, false);
        towel.rotation.y = rand() * 0.6;
        b.add(towel);
        taken.push({ x, z, r: 2.5 });
      }
    }
    // A lifeguard's tower.
    {
      const p = LOOP[indexAt(stretch('beach')[0].from + 95)];
      const x = shoreX(p.z) + 12;
      const z = p.z;
      const wood = toon('#f1f1ee');
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        b.add(mesh(box(0.2, 2.6, 0.2), wood, x + dx, G + 1.3, z + dz));
      b.add(mesh(box(2.6, 0.2, 2.6), wood, x, G + 2.7, z));
      b.add(mesh(box(2.2, 1.6, 2.2), toon('#e63946'), x, G + 3.6, z));
      b.add(mesh(box(2.3, 0.1, 1.5), toon('#bde0fe'), x - 1.15, G + 3.8, z));
      b.add(mesh(new THREE.ConeGeometry(2, 0.9, 4).rotateY(Math.PI / 4), toon('#fefae0'), x, G + 4.85, z));
      b.add(mesh(box(0.1, 0.9, 0.6), toon('#fefae0'), x - 1.12, G + 3.9, z - 0.2));
      b.add(mesh(box(0.06, 3, 0.06), toon('#3d405b'), x + 1, G + 5.6, z + 1));
      b.add(mesh(box(0.05, 0.6, 0.9), toon('#ffd166'), x + 1, G + 6.7, z + 1.45));
      colliders.push({ minX: x - 1.3, maxX: x + 1.3, minZ: z - 1.3, maxZ: z + 1.3, bottom: G, top: G + 5 });
      taken.push({ x, z, r: 3 });
    }
    // A beach volleyball net, and the snack shack by the road.
    {
      const p = LOOP[indexAt(stretch('beach')[0].from + 175)];
      const x = shoreX(p.z) + 14;
      const z = p.z;
      for (const dz of [-4.5, 4.5]) b.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), toon('#f1f1ee'), x, G + 1.3, z + dz));
      b.add(mesh(box(0.04, 0.9, 9), toon('#22223b'), x, G + 2.1, z));
      b.add(mesh(new THREE.SphereGeometry(0.22, 10, 8), toon('#ffd166'), x + 3, G + 0.22, z - 1));
      taken.push({ x, z, r: 6 });
    }
    {
      const q = stretch('beach')[0].from + 130;
      const i = indexAt(q);
      const p = LOOP[i];
      const at = beside(i, LOOP_HALF + 7);
      const shack = new THREE.Group();
      shack.add(mesh(box(4.4, 2.6, 3.2), toon('#ffcad4'), 0, 1.3, 0));
      shack.add(mesh(box(5, 0.2, 3.8), toon('#fefae0'), 0, 2.7, 0));
      for (let k = 0; k < 5; k++) {
        const stripe = mesh(box(1, 0.08, 1.4), toon(k % 2 ? '#fefae0' : '#ef476f'), -2 + k, 2.2, -2.2);
        stripe.rotation.x = -0.35;
        shack.add(stripe);
      }
      shack.add(mesh(box(4.4, 0.9, 0.2), toon('#fefae0'), 0, 1.1, -1.7));
      shack.position.set(at.x, G, at.z);
      // Its counter toward the road.
      shack.rotation.y = Math.atan2(p.tz, -p.tx);
      b.add(shack);
      const sign = textPlane('🍦 Snacks', { color: '#3d2b1f', bg: '#fefae0', size: 56 });
      sign.scale.setScalar(1.1);
      sign.position.copy(new THREE.Vector3(0, 3.35, -1.95).applyAxisAngle(new THREE.Vector3(0, 1, 0), shack.rotation.y).add(shack.position));
      sign.rotation.y = shack.rotation.y + Math.PI;
      labels.add(sign);
      colliders.push({ minX: at.x - 2.6, maxX: at.x + 2.6, minZ: at.z - 2.6, maxZ: at.z + 2.6, bottom: G, top: G + 2.8 });
      taken.push({ x: at.x, z: at.z, r: 5 });
    }
    // The pier, out into the sea on posts, with a rail along each side.
    {
      const x0 = shoreX(PIER.z) + 8;
      const x1 = shoreX(PIER.z) - PIER.length;
      const wood = toon('#b08968');
      const deck = 0.28;
      b.add(mesh(box(x0 - x1, 0.2, PIER.width), wood, (x0 + x1) / 2, G + deck - 0.1, PIER.z));
      for (let x = x1 + 1; x < x0; x += 4) {
        for (const s of [-1, 1]) {
          b.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 6), toon('#7f5539'), x, G - 0.5, PIER.z + s * (PIER.width / 2 - 0.2)));
          b.add(mesh(box(0.12, 1, 0.12), wood, x, G + deck + 0.5, PIER.z + s * (PIER.width / 2 - 0.1)));
        }
      }
      for (const s of [-1, 1]) b.add(mesh(box(x0 - x1 - 4, 0.12, 0.12), wood, (x0 + x1) / 2 - 2, G + deck + 0.95, PIER.z + s * (PIER.width / 2 - 0.1)));
      colliders.push({ minX: x1, maxX: x0, minZ: PIER.z - PIER.width / 2, maxZ: PIER.z + PIER.width / 2, bottom: G - 1, top: G + deck });
      for (const s of [-1, 1]) colliders.push({ minX: x1, maxX: x0 - 4, minZ: PIER.z + s * (PIER.width / 2) - 0.1, maxZ: PIER.z + s * (PIER.width / 2) + 0.1, bottom: G + deck, top: G + deck + 1, fence: true });
      colliders.push({ minX: x1 - 0.2, maxX: x1, minZ: PIER.z - PIER.width / 2, maxZ: PIER.z + PIER.width / 2, bottom: G + deck, top: G + deck + 1, fence: true });
      taken.push({ x: x0 - 4, z: PIER.z, r: 6 });
      night.halos.push({ at: new THREE.Vector3(x1 + 1, G + 2.4, PIER.z), size: 1.6, color: '#ffe8a3', ground: true });
      b.add(mesh(box(0.12, 2.2, 0.12), toon('#3d405b'), x1 + 1, G + 1.3, PIER.z + 1.7));
      b.add(mesh(new THREE.SphereGeometry(0.18, 10, 8), bulb(night, '#ffe8a3', 0.1), x1 + 1, G + 2.4, PIER.z + 1.7, false));
    }
    // Sailboats out on the water, bobbing.
    for (const [x, z] of [
      [-300, 170],
      [-335, 262],
      [-290, 330],
      [-320, 80],
    ]) {
      const g = new THREE.Group();
      const hull = new THREE.Shape();
      hull.moveTo(-2.6, 0.9);
      hull.lineTo(2.9, 0.9);
      hull.lineTo(2.2, 0);
      hull.lineTo(-2.2, 0);
      hull.closePath();
      g.add(mesh(new THREE.ExtrudeGeometry(hull, { depth: 1.8, bevelEnabled: false }).translate(0, 0, -0.9), toon('#fefae0')));
      g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 6.5, 6), toon('#6f4e37'), 0.3, 4, 0));
      const sail = new THREE.Shape();
      sail.moveTo(0, 0);
      sail.lineTo(0, 5.6);
      sail.lineTo(-2.8, 0);
      sail.closePath();
      g.add(mesh(new THREE.ShapeGeometry(sail), toon(colors[boats.length % colors.length]), 0.2, 1.2, 0));
      const boat = mergeByColor(g);
      boat.position.set(x, G - 0.3, z);
      boat.rotation.y = rand() * Math.PI * 2;
      root.add(boat);
      around(boat, x, z, 5);
      boats.push({ g: boat, x, z, phase: rand() * 6 });
    }
  }
  // The lighthouse out on its point, rocks to walk out along, and its beam going round at night.
  const beam = new THREE.Group();
  {
    const c = light;
    const L = LIGHTHOUSE;
    const land = shoreX(L.z);
    for (let x = land + 2; x > L.x; x -= 3.2) boulder(c, x, L.z + (rand() - 0.5) * 3, 1.8 + rand() * 1.4, rand() * 6, '#8d8a99');
    boulder(c, L.x, L.z, 7.5, 0.4, '#8d8a99');
    boulder(c, L.x - 3, L.z + 4, 4.5, 1.7, '#77738a');
    const white = toon('#f8f9fa');
    const red = toon('#d62828');
    const base = G + 2.4;
    c.add(mesh(new THREE.CylinderGeometry(3.4, 3.8, 2, 12), toon('#cdc5b4'), L.x, base - 0.9, L.z));
    const H = 18;
    for (let k = 0; k < 6; k++) {
      const r0 = 2.6 - (k / 6) * 0.8;
      const r1 = 2.6 - ((k + 1) / 6) * 0.8;
      c.add(mesh(new THREE.CylinderGeometry(r1, r0, H / 6, 14), k % 2 ? red : white, L.x, base + (k + 0.5) * (H / 6), L.z));
    }
    c.add(mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.3, 14), toon('#3d405b'), L.x, base + H + 0.15, L.z));
    const glass = bulb(night, '#fff3b0', 0.35);
    c.add(mesh(new THREE.CylinderGeometry(1.3, 1.3, 2, 12), glass, L.x, base + H + 1.3, L.z, false));
    c.add(mesh(new THREE.ConeGeometry(1.8, 1.6, 12), red, L.x, base + H + 3.1, L.z));
    c.add(mesh(new THREE.SphereGeometry(0.25, 8, 6), toon('#3d405b'), L.x, base + H + 4.05, L.z));
    night.halos.push({ at: new THREE.Vector3(L.x, base + H + 1.3, L.z), size: 9, color: '#fff3b0', ground: true });
    colliders.push({ minX: L.x - 3.8, maxX: L.x + 3.8, minZ: L.z - 3.8, maxZ: L.z + 3.8, bottom: G - 1, top: G + 30 });
    // Two long cones of light, going round, brightest at the lamp and fading out along their length.
    const fade = canvasTexture(4, 64, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 4, 64);
    });
    // Not wrapping round, or the faded end picks up the bright one.
    fade.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshBasicMaterial({ color: '#fff3b8', map: fade, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    mat.userData.outlineParameters = { visible: false };
    night.glows.push({ mat, max: 0.4 });
    for (const s of [-1, 1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(4.5, 70, 16, 1, true).translate(0, -35, 0), mat);
      cone.rotation.z = (s * Math.PI) / 2;
      beam.add(cone);
    }
    beam.position.set(L.x, base + H + 1.3, L.z);
    root.add(beam);
    around(beam, L.x, L.z, 70, H + 8);
  }

  // ---- Trees all round, by what's near them ---------------------------------------------------------
  const neighbours = neighbourBoxes();
  const town = (x: number, z: number) => (Math.abs(x) < 64 && z > -64 && z < 40) || (x > -24 && x < 14 && z > 30 && z < 72) || neighbours.some((b) => inBox(b, x, z, 5));
  const ok = (x: number, z: number, r: number) => free(x, z, r) && !town(x, z) && x > shoreX(z) + 26 && !MOUNTAINS.some(([mx, mz, mr]) => Math.hypot(mx - x, mz - z) < mr * 0.95);
  // The pines: thick right up to the road, thinning out further off, with a leafy tree here and there.
  for (let x = 110; x < 320; x += 5.5) {
    for (let z = 50; z < 340; z += 5.5) {
      const px = x + (rand() - 0.5) * 4.4;
      const pz = z + (rand() - 0.5) * 4.4;
      const n = nearest(px, pz);
      if (n.place !== 'forest' || n.off > 100 || rand() > (n.off < 40 ? 0.8 : 0.8 - ((n.off - 40) / 60) * 0.6) || !ok(px, pz, 1.4)) continue;
      const s = 0.85 + rand() * 0.7;
      if (rand() < 0.82) pine(parts.forest, px, pz, s, PINES[Math.floor(rand() * PINES.length)], rand() * 6);
      else leafy(parts.forest, px, pz, s * 0.9, rand() < 0.35 ? AUTUMN[Math.floor(rand() * AUTUMN.length)] : LEAVES[Math.floor(rand() * LEAVES.length)], rand() * 6);
      if (n.off < 35) trunk(px, pz, 0.26 * s, 2.2 * s);
      taken.push({ x: px, z: pz, r: 1.2 });
    }
  }
  // Pines scattered up to the mountains and round the lake.
  for (let x = -260; x < 300; x += 9) {
    for (let z = 250; z < 440; z += 9) {
      const px = x + (rand() - 0.5) * 7;
      const pz = z + (rand() - 0.5) * 7;
      const n = nearest(px, pz);
      if ((n.place !== 'mountains' && n.place !== 'tunnel') || n.off > 80 || rand() > 0.38 || !ok(px, pz, 1.6)) continue;
      const s = 0.9 + rand() * 0.8;
      pine(parts.mountains, px, pz, s, PINES[Math.floor(rand() * PINES.length)], rand() * 6);
      if (n.off < 30) trunk(px, pz, 0.26 * s, 2.2 * s);
      taken.push({ x: px, z: pz, r: 1.5 });
    }
  }
  // Palms along the coast road, and on the sand.
  for (const s of [...stretch('beach'), ...stretch('coast')]) {
    for (let d = s.from; d < s.to; d += 7 + rand() * 9) {
      const i = indexAt(d);
      for (const side of [1, -1]) {
        if (rand() < 0.35) continue;
        const at = beside(i, side * (LOOP_PAVED + 3 + rand() * (side > 0 ? 16 : 8)));
        if (!free(at.x, at.z, 1.2) || at.x < shoreX(at.z) + 6) continue;
        const sc = 0.9 + rand() * 0.45;
        palm(parts.beach, at.x, at.z, sc, rand() * 6);
        trunk(at.x, at.z, 0.2 * sc, 6 * sc);
        taken.push({ x: at.x, z: at.z, r: 2 });
      }
    }
  }
  // Leafy trees out in the fields and the meadows, inside the loop and out, well off the road.
  for (let x = -250; x < 320; x += 15) {
    for (let z = -260; z < 330; z += 15) {
      const px = x + (rand() - 0.5) * 12;
      const pz = z + (rand() - 0.5) * 12;
      const n = nearest(px, pz);
      if (n.place === 'forest' && n.off < 100) continue;
      if (rand() > (insideLoop(px, pz) ? 0.3 : 0.18) || !ok(px, pz, 3) || FARM.fields.some((f) => inBox(f, px, pz, 3)) || inBox(FARM.pasture, px, pz, 3)) continue;
      if (Math.hypot(px - LAKE.x, (pz - LAKE.z) * 2) < LAKE.rx + 8) continue;
      const s = 0.8 + rand() * 0.6;
      const into = n.place === 'beach' || n.place === 'coast' ? parts.coast : n.place === 'farm' ? parts.farm : parts.meadow;
      leafy(into, px, pz, s, rand() < 0.12 ? AUTUMN[Math.floor(rand() * AUTUMN.length)] : LEAVES[Math.floor(rand() * LEAVES.length)], rand() * 6);
      trunk(px, pz, 0.28 * s, 2.1 * s);
      taken.push({ x: px, z: pz, r: 3 });
    }
  }
  // Boulders by the road through the mountains.
  for (const s of stretch('mountains')) {
    for (let d = s.from; d < s.to; d += 14 + rand() * 20) {
      const at = beside(indexAt(d), (rand() < 0.6 ? 1 : -1) * (LOOP_PAVED + 4 + rand() * 12));
      if (!free(at.x, at.z, 1.5)) continue;
      const r = 0.8 + rand() * 1.6;
      boulder(parts.mountains, at.x, at.z, r, rand() * 6);
      colliders.push({ minX: at.x - r * 0.7, maxX: at.x + r * 0.7, minZ: at.z - r * 0.7, maxZ: at.z + r * 0.7, bottom: G, top: G + r * 0.9 });
      taken.push({ x: at.x, z: at.z, r: r + 1 });
    }
  }

  // Merged by material a square of the map at a time, so what's lost in the haze needn't be drawn.
  const TILE = 120;
  const byTile = new Map<string, THREE.Group>();
  for (const g of Object.values(parts)) {
    for (const child of [...g.children]) {
      const key = `${Math.floor(child.position.x / TILE)},${Math.floor(child.position.z / TILE)}`;
      let t = byTile.get(key);
      if (!t) byTile.set(key, (t = new THREE.Group()));
      t.add(child);
    }
  }
  for (const [key, g] of byTile) {
    const [tx, tz] = key.split(',').map(Number);
    const merged = mergeByColor(g);
    root.add(merged);
    // A tree on the edge of a square reaches a little way out of it.
    cullable(merged, tx * TILE - 10, (tx + 1) * TILE + 10, tz * TILE - 10, (tz + 1) * TILE + 10);
  }
  for (const [g, x, z, r, above] of [
    [silo, FARM.silo.x, FARM.silo.z, 4, 16],
    [mill, FARM.windmill.x, FARM.windmill.z, 6, 17],
    [light, LIGHTHOUSE.x, LIGHTHOUSE.z, 12, 26],
  ] as const) {
    const merged = mergeByColor(g);
    root.add(merged);
    around(merged, x, z, r, above);
  }
  for (const label of [...labels.children]) around(label, label.position.x, label.position.z, 4);

  return {
    group: root,
    cull(eye: THREE.Vector3, street: number, far: number) {
      const up = eye.y - street;
      for (const t of seen) {
        const reach = hazeReach(Math.max(up, t.above), far) + 10;
        const dx = Math.max(t.minX - eye.x, 0, eye.x - t.maxX);
        const dz = Math.max(t.minZ - eye.z, 0, eye.z - t.maxZ);
        t.obj.visible = dx * dx + dz * dz < reach * reach;
      }
    },
    update(t: number) {
      sails.rotation.z = -t * 0.7;
      beam.rotation.y = t * 0.8;
      for (const b of boats) {
        b.g.position.y = G - 0.3 + Math.sin(t * 1.3 + b.phase) * 0.12;
        b.g.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.06;
      }
      for (const w of waters) w.offset.set((t * 0.015) % 1, (t * 0.006) % 1);
      for (const m of surf) m.opacity = 0.45 + 0.3 * Math.sin(t * 0.9);
    },
  };
}
