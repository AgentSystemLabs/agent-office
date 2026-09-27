import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALCONY, DESKS, DESK_SIZE, EXIT_STAIRS, FLOOR, PLANTS, STREET_Y, WALL_HEIGHT, WINDOWS } from '../../shared/layout';
import type { Theme } from '../../shared/protocol';
import { batWingGeometry, glowTexture } from './costumes';
import type { Collider, Office } from './office';
import { SPOOKY_MOON } from './sky';
import { mergeByMaterial, mesh, textPlane, toon, toonUnique } from './toon';

/*
 * The building dressed up for a holiday (the costumes are in world/costumes.ts). Halloween puts
 * jack-o'-lanterns everywhere, on the desks, the sills, the counter, the balcony rail and all down
 * the street, with gravestones on the lawn, cobwebs in the corners and bats circling the building
 * and crossing the moon. Christmas turns the potted plants into little decorated trees with presents
 * under them, puts a present on every desk, a big lit tree out front and snowmen in the snow (the
 * sky makes it snow, see Sky.setTheme). Everything's built once and shown for its holiday. What's
 * down on the street goes further down the higher your floor is, as the street does (Office.setLevel).
 */

const G = STREET_Y;

/** Somewhere to put something: its foot at (x, y, z), `r` its size, turned so its front (+z) faces `rotY`. */
type Spot = [x: number, y: number, z: number, r: number, rotY: number];

const FACE = { south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 } as const;

/** A point `lx` along and `lz` out from a desk's middle, in its own frame (see DeskDef.rotY). */
function onDesk(d: { x: number; z: number; rotY: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(d.rotY);
  const s = Math.sin(d.rotY);
  return [d.x + lx * c + lz * s, d.z - lx * s + lz * c];
}

/** On every desk, in the back corner its own knick-knack leaves free (see buildDesk), facing whoever sits there. */
const DESK_SPOTS: Spot[] = DESKS.map((d, i) => {
  const [x, z] = onDesk(d, i % 3 === 1 ? 0.78 : -0.78, -0.28);
  return [x, DESK_SIZE.height, z, 0.12, d.rotY];
});

/** Jack-o'-lanterns: everywhere. */
function pumpkinSpots(): Spot[] {
  const spots: Spot[] = [...DESK_SPOTS];
  // The kitchen counter, and the lounge's coffee table.
  spots.push([-13, 1.03, 12.2, 0.14, FACE.north], [-16.65, 1.03, 12.25, 0.11, FACE.north], [13, 0.46, 0.25, 0.17, FACE.west]);
  // On the window sills, looking in.
  for (const o of WINDOWS) {
    if (o.y0 > 2) continue;
    if (o.wall === 'south') spots.push([o.u - 0.85, o.y0, FLOOR.maxZ - 0.08, 0.1, FACE.north]);
    if (o.wall === 'west') spots.push([FLOOR.minX + 0.08, o.y0, o.u + 0.85, 0.1, FACE.east]);
  }
  // Beside every potted plant, toward the middle of the room.
  for (const [x, z, s] of PLANTS) {
    const d = Math.hypot(x, z) || 1;
    spots.push([x - (x / d) * 0.55 * s, 0, z - (z / d) * 0.55 * s, 0.2 * s, Math.atan2(-x, -z)]);
  }
  // Under the TV, beside the elevator, out on the balcony and on the landing outside the exit.
  spots.push([17.55, 0, -2.4, 0.22, FACE.west], [17.6, 0, 2.3, 0.17, FACE.west], [10.35, 0, FLOOR.minZ + 0.4, 0.22, FACE.south]);
  for (const x of [-9.3, -5.8, -2.2, 1.4]) spots.push([x, 1.105, BALCONY.maxZ - 0.06, 0.13, FACE.north]);
  // (Only the south-east corner: the south-west one has the balcony's potted plant.)
  spots.push([BALCONY.maxX - 0.4, 0, BALCONY.maxZ - 0.4, 0.2, FACE.north]);
  spots.push([EXIT_STAIRS.minX + 0.3, 0, EXIT_STAIRS.landingZ0 + 0.25, 0.17, FACE.south]);
  // Down the street, at the foot of every lamp (see buildStreet), facing the office.
  for (const x of [-40, -28, -16, -4, 8, 16, 28, 40]) spots.push([x + 0.6, G + 0.04, 21.7, 0.3, FACE.north]);
  for (const x of [-34, -22, -4, 8, 26, 36]) spots.push([x + 0.6, G + 0.04, 32.3, 0.3, FACE.north]);
  // Heaps of them out front, either side of the garage, and at the balcony's posts.
  for (const sx of [-1, 1]) {
    spots.push([sx * 17.2, G, 19.2, 0.55, FACE.north], [sx * 18.3, G, 19.6, 0.38, FACE.north + sx * 0.4], [sx * 16.3, G, 19.9, 0.3, FACE.north - sx * 0.3]);
  }
  spots.push([BALCONY.minX + 0.75, G, BALCONY.maxZ - 0.2, 0.36, FACE.south], [BALCONY.maxX - 0.75, G, BALCONY.maxZ - 0.2, 0.36, FACE.south]);
  // Among the graves.
  spots.push([-22.4, G, -2.2, 0.32, FACE.east], [-22.6, G, 4.6, 0.26, FACE.east], [-24.6, G, 1.3, 0.3, FACE.east]);
  return spots;
}

/** Where the gravestones stand, on the lawn west of the office, facing its windows. */
const GRAVES: [x: number, z: number, kind: number][] = [
  [-23.2, -3.4, 0],
  [-23.4, -0.4, 1],
  [-23.1, 2.8, 2],
  [-23.3, 6, 0],
  [-25.8, -1.8, 2],
  [-25.9, 1.4, 1],
  [-25.7, 4.5, 0],
];

/** Where the snowmen stand, out front and round the side. */
const SNOWMEN: [x: number, z: number, rotY: number][] = [
  [-14, 18.6, 0.2],
  [13, 19.2, -0.3],
  [25.5, 6, -Math.PI / 2 + 0.3],
  [-23.5, 2, Math.PI / 2],
];

/** The big tree out front, on the lot by the sidewalk. */
const BIG_TREE = { x: -24, z: 17, height: 7.5 } as const;

// ---- Jack-o'-lanterns ---------------------------------------------------------------------------

/** A ribbed pumpkin 2 m across, sitting on y = 0, its face toward +z (u = 0.25 on the sphere's map). */
function pumpkinGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 36, 20);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.x, v.z);
    const rib = 1 + 0.06 * Math.cos(10 * a) * Math.sqrt(1 - v.y * v.y);
    // Squat, with a dimple on top where the stem goes.
    const dimple = v.y > 0.8 ? (v.y - 0.8) * 0.9 : 0;
    pos.setXYZ(i, v.x * rib, (v.y - dimple) * 0.78 + 0.78, v.z * rib);
  }
  geo.computeVertexNormals();
  return geo;
}

/** The carved face, lit from inside, and its skin: [what it looks like, what glows]. */
function pumpkinTextures(): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const W = 512;
  const H = 256;
  const face = (g: CanvasRenderingContext2D, fill: string, edge?: string) => {
    const shapes: [number, number][][] = [
      // Slanted triangle eyes.
      [
        [70, 112],
        [118, 110],
        [100, 76],
      ],
      [
        [138, 110],
        [186, 112],
        [156, 76],
      ],
      // A nose.
      [
        [118, 132],
        [138, 132],
        [128, 116],
      ],
      // A jagged grin with two teeth.
      [
        [66, 140],
        [92, 150],
        [100, 140],
        [110, 154],
        [146, 154],
        [156, 140],
        [164, 150],
        [190, 140],
        [178, 164],
        [154, 180],
        [128, 184],
        [102, 180],
        [78, 164],
      ],
    ];
    for (const s of shapes) {
      g.beginPath();
      s.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      if (edge) {
        g.lineWidth = 5;
        g.strokeStyle = edge;
        g.stroke();
      }
    }
  };
  const skin = document.createElement('canvas');
  skin.width = W;
  skin.height = H;
  const g = skin.getContext('2d')!;
  g.fillStyle = '#f28a1d';
  g.fillRect(0, 0, W, H);
  // Darker down the grooves between the ribs (see pumpkinGeometry), lighter on the ridges.
  for (let k = 0; k < 10; k++) {
    const x = (((0.3 + 0.1 * k) % 1) * W) | 0;
    const grad = g.createLinearGradient(x - 26, 0, x + 26, 0);
    grad.addColorStop(0, 'rgba(160, 60, 0, 0)');
    grad.addColorStop(0.5, 'rgba(160, 60, 0, 0.45)');
    grad.addColorStop(1, 'rgba(160, 60, 0, 0)');
    g.fillStyle = grad;
    g.fillRect(x - 26, 0, 52, H);
  }
  face(g, '#ffd23f', '#6b2d00');
  const glow = document.createElement('canvas');
  glow.width = W;
  glow.height = H;
  const e = glow.getContext('2d')!;
  e.fillStyle = '#000000';
  e.fillRect(0, 0, W, H);
  face(e, '#ffb347');
  return [skin, glow].map((c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }) as [THREE.CanvasTexture, THREE.CanvasTexture];
}

/** Places copies of `geo` at `spots` (scaled by r, turned by rotY) as one geometry. */
function scatter(geo: THREE.BufferGeometry, spots: Spot[], extra?: (m: THREE.Matrix4, i: number) => void): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const parts = spots.map(([x, y, z, r, rotY], i) => {
    m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, rotY), new THREE.Vector3(r, r, r));
    extra?.(m, i);
    return geo.clone().applyMatrix4(m);
  });
  const out = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return out;
}

/** Soft glows at `at`, one set of points per size. */
function halos(at: { p: THREE.Vector3; size: number; color: string }[]): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] {
  const map = glowTexture();
  const bySize = new Map<number, { pos: number[]; col: number[] }>();
  for (const h of at) {
    const size = Math.round(h.size * 10) / 10;
    let set = bySize.get(size);
    if (!set) bySize.set(size, (set = { pos: [], col: [] }));
    set.pos.push(h.p.x, h.p.y, h.p.z);
    const c = new THREE.Color(h.color);
    set.col.push(c.r, c.g, c.b);
  }
  return [...bySize].map(([size, { pos, col }]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ size, map, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  });
}

// ---- Gravestones, cobwebs, bats -----------------------------------------------------------------

/** A gravestone (a rounded slab, a cross, or a squat marker) with a mound of earth in front, facing +z. */
function gravestone(kind: number): THREE.Group {
  const g = new THREE.Group();
  const stone = toon('#9a9ca8');
  if (kind === 1) {
    g.add(mesh(new THREE.BoxGeometry(0.16, 1.2, 0.14), stone, 0, 0.6, 0));
    g.add(mesh(new THREE.BoxGeometry(0.62, 0.16, 0.14), stone, 0, 0.85, 0));
  } else {
    const w = kind === 2 ? 0.8 : 0.62;
    const h = kind === 2 ? 0.45 : 0.72;
    g.add(mesh(new THREE.BoxGeometry(w, h, 0.16), stone, 0, h / 2, 0));
    g.add(mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.16, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2), stone, 0, h, 0));
  }
  const mound = mesh(new THREE.SphereGeometry(0.55, 14, 8), toon('#5b4636'), 0, -0.02, 0.75);
  mound.scale.set(0.8, 0.22, 1.35);
  g.add(mound);
  g.rotation.z = (kind - 1) * 0.07;
  return g;
}

/** A spider's web, hub near the top, in a canvas: white threads on nothing. */
function webTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const hub = [128, 70] as const;
  const ends: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const a = -0.1 + (i / 10) * (Math.PI + 0.2);
    ends.push([hub[0] + Math.cos(a) * 260, hub[1] + Math.sin(a) * 260]);
  }
  g.strokeStyle = 'rgba(245, 245, 255, 0.9)';
  g.lineWidth = 2;
  for (const [x, y] of ends) {
    g.beginPath();
    g.moveTo(hub[0], hub[1]);
    g.lineTo(x, y);
    g.stroke();
  }
  g.lineWidth = 1.5;
  for (let r = 18; r < 240; r *= 1.32) {
    g.beginPath();
    ends.forEach(([x, y], i) => {
      const k = r / 260;
      const px = hub[0] + (x - hub[0]) * k;
      const py = hub[1] + (y - hub[1]) * k;
      if (i === 0) g.moveTo(px, py);
      // Sagging a little between the threads.
      else {
        const [x0, y0] = ends[i - 1];
        const mx = hub[0] + ((x + x0) / 2 - hub[0]) * k * 0.9;
        const my = hub[1] + ((y + y0) / 2 - hub[1]) * k * 0.9;
        g.quadraticCurveTo(mx, my, px, py);
      }
    });
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A web strung across a top corner of the room, where the walls meet the ceiling at (x, z). */
function cobweb(x: number, z: number, map: THREE.Texture): THREE.Mesh {
  const sx = Math.sign(x);
  const sz = Math.sign(z);
  const H = WALL_HEIGHT - 0.02;
  const S = 2.2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([x - sx * S, H, z, x, H, z - sz * S, x, H - S * 1.1, z], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.5, 0], 2));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }));
}

interface Bat {
  root: THREE.Group;
  wings: THREE.Object3D[];
  /** Round (cx, cz) at radius r, `speed` radians a second (the sign is which way), at height y. */
  cx: number;
  cz: number;
  r: number;
  y: number;
  speed: number;
  phase: number;
}

/** A bat: a black silhouette with flapping wings, flying toward +z. */
function bat(mat: THREE.Material, scale: number): { root: THREE.Group; wings: THREE.Object3D[] } {
  const root = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.12, 10, 8), mat, 0, 0, 0, false);
  body.scale.set(0.8, 0.75, 1.3);
  root.add(body);
  root.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), mat, 0, 0.03, 0.16, false));
  for (const sx of [-1, 1]) {
    const ear = mesh(new THREE.ConeGeometry(0.03, 0.08, 6), mat, sx * 0.04, 0.1, 0.16, false);
    ear.rotation.z = -sx * 0.3;
    root.add(ear);
  }
  const geo = batWingGeometry(0.6);
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.06, 0.02, 0.04);
    const w = mesh(geo, mat, 0, 0, 0, false);
    w.scale.x = sx;
    pivot.add(w);
    root.add(pivot);
    wings.push(pivot);
  }
  root.scale.setScalar(scale);
  return { root, wings };
}

// ---- Christmas ----------------------------------------------------------------------------------

/**
 * A decorated Christmas tree `h` tall standing at 0,0,0: tiers of branches, baubles, lights and a
 * star. `lit` collects where each light is, for their glow at night.
 */
function christmasTree(h: number, lights: THREE.MeshToonMaterial[], lit?: THREE.Vector3[], trunk = false): THREE.Group {
  const g = new THREE.Group();
  const greens = [toon('#1f7a3a'), toon('#2a9d4b'), toon('#23884a')];
  const tiers = 4;
  const base = trunk ? h * 0.1 : 0;
  if (trunk) g.add(mesh(new THREE.CylinderGeometry(h * 0.035, h * 0.045, base + 0.1, 10), toon('#6b4226'), 0, (base + 0.1) / 2, 0));
  const tierH = ((h - base) * 0.92) / (tiers * 0.72);
  const baubles = ['#e63946', '#ffd166', '#4cc9f0', '#f1faee', '#c77dff'].map((c) => toon(c));
  const rand = mulberry(Math.round(h * 1000));
  for (let i = 0; i < tiers; i++) {
    const r = (h * 0.34 * (tiers - i)) / tiers + h * 0.05;
    const y0 = base + i * tierH * 0.72;
    g.add(mesh(new THREE.ConeGeometry(r, tierH, 14), greens[i % 3], 0, y0 + tierH / 2, 0));
    // Baubles and lights round the tier's lower edge, where the branches stick out.
    const n = 5 + (tiers - i) * 2;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + i;
      const up = 0.08 + rand() * 0.35;
      const rr = r * (1 - up) + h * 0.006;
      const y = y0 + tierH * up;
      if (j % 2) {
        g.add(mesh(new THREE.SphereGeometry(h * 0.024, 10, 8), baubles[(i + j) % baubles.length], Math.cos(a) * rr, y, Math.sin(a) * rr, false));
      } else {
        const at = new THREE.Vector3(Math.cos(a) * (rr + h * 0.004), y + tierH * 0.05, Math.sin(a) * (rr + h * 0.004));
        g.add(mesh(new THREE.SphereGeometry(h * 0.013, 8, 6), lights[(i + j / 2) % lights.length], at.x, at.y, at.z, false));
        lit?.push(at);
      }
    }
  }
  // A gold star on top.
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = (i % 2 ? 0.45 : 1) * h * 0.07;
    if (i) star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const gold = toonUnique('#ffd166');
  gold.emissive.set('#ffb000');
  gold.emissiveIntensity = 0.6;
  const s = mesh(new THREE.ExtrudeGeometry(star, { depth: h * 0.02, bevelEnabled: false }).translate(0, 0, -h * 0.01), gold, 0, base + tierH * 0.72 * (tiers - 1) + tierH + h * 0.04, 0, false);
  g.add(s);
  const s2 = s.clone();
  s2.rotation.y = Math.PI / 2;
  g.add(s2);
  return g;
}

/** A wrapped present `w` across, sitting on y = 0. */
function present(w: number, paper: string, ribbon: string): THREE.Group {
  const g = new THREE.Group();
  const h = w * 0.8;
  g.add(mesh(new THREE.BoxGeometry(w, h, w), toon(paper), 0, h / 2, 0));
  const rib = toon(ribbon);
  g.add(mesh(new THREE.BoxGeometry(w * 1.02, h * 1.02, w * 0.18), rib, 0, h / 2, 0, false));
  g.add(mesh(new THREE.BoxGeometry(w * 0.18, h * 1.02, w * 1.02), rib, 0, h / 2, 0, false));
  for (const sx of [-1, 1]) {
    const loop = mesh(new THREE.TorusGeometry(w * 0.15, w * 0.05, 6, 12), rib, sx * w * 0.13, h + w * 0.1, 0, false);
    loop.rotation.y = Math.PI / 2;
    loop.rotation.x = sx * 0.4;
    g.add(loop);
  }
  return g;
}

const PAPERS: [string, string][] = [
  ['#e63946', '#ffd166'],
  ['#2a9d4b', '#e63946'],
  ['#4cc9f0', '#fffaf3'],
  ['#ffd166', '#c1121f'],
  ['#c77dff', '#ffd166'],
];

/** A snowman with a scarf, a carrot nose, coal eyes and buttons, twig arms and a top hat, facing +z. */
function snowman(): THREE.Group {
  const g = new THREE.Group();
  const snow = toon('#f4f8ff');
  const coal = toon('#23232b');
  const twig = toon('#6b4226');
  const balls: [number, number][] = [
    [0.55, 0.5],
    [0.4, 1.28],
    [0.28, 1.86],
  ];
  for (const [r, y] of balls) g.add(mesh(new THREE.SphereGeometry(r, 18, 14), snow, 0, y, 0));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), coal, sx * 0.1, 1.94, 0.24, false));
  const nose = mesh(new THREE.ConeGeometry(0.05, 0.3, 10).rotateX(Math.PI / 2), toon('#ff8c1a'), 0, 1.86, 0.4, false);
  g.add(nose);
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.SphereGeometry(0.045, 8, 6), coal, 0, 1.12 + i * 0.16, 0.39 - Math.abs(i - 1) * 0.02, false));
  const scarf = mesh(new THREE.TorusGeometry(0.29, 0.07, 8, 20), toon('#d62828'), 0, 1.6, 0);
  scarf.rotation.x = Math.PI / 2;
  g.add(scarf);
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.4, 0.05), toon('#d62828'), 0.18, 1.42, 0.24).rotateZ(0.2));
  for (const sx of [-1, 1]) {
    const arm = mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.9, 6), twig, sx * 0.72, 1.45, 0, false);
    arm.rotation.z = sx * 1.05;
    g.add(arm);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20), coal, 0, 2.1, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 20), coal, 0, 2.3, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.07, 20), toon('#d62828'), 0, 2.16, 0, false));
  return g;
}

/** A small seeded random, so the trees look the same every time. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -----------------------------------------------------------------------------------------------

export class Holiday {
  readonly group = new THREE.Group();
  theme: Theme | null = null;
  private halloween = new THREE.Group();
  private christmas = new THREE.Group();
  private pumpkin: THREE.MeshToonMaterial;
  private pumpkinGlow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] = [];
  private treeGlow: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] = [];
  private bats: Bat[] = [];
  /** Bats far off round the moon, which ride along with you like the moon does. */
  private moonBats = new THREE.Group();
  private lights: THREE.MeshToonMaterial[];
  private colliders: Record<Theme, Collider[]> = { halloween: [], christmas: [] };
  /**
   * Each holiday's things down on the street (and on the landing outside the bottom floor's exit),
   * how far down the street is from the floor you're on, and where their colliders are from the bottom floor.
   */
  private street: Record<Theme, THREE.Group> = { halloween: new THREE.Group(), christmas: new THREE.Group() };
  private drop = 0;
  private base = new Map<Collider, { top: number; bottom: number }>();
  /** The plants' leaves, and the tree each becomes at Christmas. */
  private plants: { leaves: THREE.Object3D[]; tree: THREE.Object3D }[] = [];
  private readonly camPos = new THREE.Vector3();

  constructor(private office: Office) {
    this.halloween.visible = this.christmas.visible = false;
    this.group.add(this.halloween, this.christmas);
    this.halloween.add(this.street.halloween);
    this.christmas.add(this.street.christmas);

    // ---- Halloween ----
    const [skin, glow] = pumpkinTextures();
    const gradientMap = (toon('#fff') as THREE.MeshToonMaterial).gradientMap;
    this.pumpkin = new THREE.MeshToonMaterial({ map: skin, emissive: '#ffffff', emissiveMap: glow, emissiveIntensity: 0.5, gradientMap });
    const stem = new THREE.CylinderGeometry(0.09, 0.15, 0.4, 7).rotateZ(0.12).translate(0, 1.6, 0);
    // In the office and out on its balcony, which every floor has; and down on the street, or out
    // past the west wall on the bottom floor's landing.
    const all = pumpkinSpots();
    const down = (s: Spot) => s[1] < 0 || s[0] < FLOOR.minX;
    for (const [spots, into] of [
      [all.filter((s) => !down(s)), this.halloween],
      [all.filter(down), this.street.halloween],
    ] as const) {
      into.add(mesh(scatter(pumpkinGeometry(), spots), this.pumpkin));
      into.add(mesh(scatter(stem, spots), toon('#5b6e2a')));
      // Candlelight spilling out of each face at night.
      const face = new THREE.Vector3();
      const glows = halos(
        spots.map(([x, y, z, r, rotY]) => ({
          p: face.set(x + Math.sin(rotY) * r * 1.35, y + r * 0.8, z + Math.cos(rotY) * r * 1.35).clone(),
          size: r * 5,
          color: '#ffa640',
        })),
      );
      into.add(...glows);
      this.pumpkinGlow.push(...glows);
    }

    const graves = new THREE.Group();
    const rip: THREE.Mesh[] = [];
    for (const [x, z, kind] of GRAVES) {
      const s = gravestone(kind);
      s.position.set(x, G, z);
      s.rotation.y = FACE.east + (kind - 1) * 0.12;
      graves.add(s);
      this.colliders.halloween.push({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.45, maxZ: z + 0.45, bottom: G, top: G + 1.2 });
      if (kind !== 1) {
        const label = textPlane('R.I.P.', { color: '#2b2d42', size: 56 });
        label.scale.multiplyScalar(kind === 2 ? 0.55 : 0.45);
        label.position.set(x + 0.09, G + (kind === 2 ? 0.28 : 0.5), z);
        label.rotation.y = s.rotation.y;
        rip.push(label);
      }
    }
    this.street.halloween.add(mergeByMaterial(graves), ...rip);

    const web = webTexture();
    for (const [x, z] of [
      [FLOOR.minX, FLOOR.minZ],
      [FLOOR.maxX, FLOOR.minZ],
      [FLOOR.minX, FLOOR.maxZ],
    ]) {
      this.halloween.add(cobweb(x, z, web));
    }

    const batMat = new THREE.MeshBasicMaterial({ color: '#150b1f', side: THREE.DoubleSide });
    const rand = mulberry(31);
    for (let i = 0; i < 12; i++) {
      const b = bat(batMat, 1.2 + rand() * 0.8);
      this.halloween.add(b.root);
      this.bats.push({ ...b, cx: (rand() - 0.5) * 6, cz: (rand() - 0.5) * 6, r: 23 + rand() * 12, y: 2.5 + rand() * 9, speed: (0.15 + rand() * 0.15) * (i % 3 ? 1 : -1), phase: rand() * 7 });
    }
    // Against the moon: 70 m off in its direction, so they cross it now and then.
    const farMat = new THREE.MeshBasicMaterial({ color: '#0d0612', side: THREE.DoubleSide, fog: false });
    const toMoon = new THREE.Vector3(Math.cos(SPOOKY_MOON.el) * Math.sin(SPOOKY_MOON.az), Math.sin(SPOOKY_MOON.el), -Math.cos(SPOOKY_MOON.el) * Math.cos(SPOOKY_MOON.az)).multiplyScalar(70);
    for (let i = 0; i < 4; i++) {
      const b = bat(farMat, 2.4);
      this.moonBats.add(b.root);
      this.bats.push({ ...b, cx: toMoon.x, cz: toMoon.z, r: 3 + rand() * 4, y: toMoon.y + (rand() - 0.5) * 3, speed: (0.6 + rand() * 0.4) * (i % 2 ? 1 : -1), phase: rand() * 7 });
    }
    this.halloween.add(this.moonBats);

    // ---- Christmas ----
    this.lights = ['#ffe28a', '#ff5a5a', '#6ec3ff', '#7dff8a'].map((c) => {
      const m = toonUnique(c);
      m.emissive.set(c);
      m.emissiveIntensity = 0.6;
      m.userData.outlineParameters = { visible: false };
      return m;
    });
    // The potted plants become little trees, with presents round the pot.
    office.plants.forEach((p, i) => {
      const tree = new THREE.Group();
      const t = christmasTree(1.25, this.lights);
      t.position.y = 0.45;
      tree.add(t);
      const gifts = new THREE.Group();
      for (const [x, z, w, rot] of [
        [0.45, 0.2, 0.26, 0.3],
        [-0.3, 0.42, 0.2, -0.5],
        [0.12, -0.46, 0.22, 0.9],
      ]) {
        const [paper, ribbon] = PAPERS[(i + Math.round(w * 10)) % PAPERS.length];
        const g = present(w, paper, ribbon);
        g.position.set(x, 0, z);
        g.rotation.y = rot;
        gifts.add(g);
      }
      tree.add(gifts);
      const merged = mergeByMaterial(tree);
      merged.visible = false;
      p.add(merged);
      this.plants.push({ leaves: p.children.slice(1, 4), tree: merged });
    });
    // A present on every desk.
    const deskGifts = new THREE.Group();
    DESK_SPOTS.forEach(([x, y, z, , rotY], i) => {
      const [paper, ribbon] = PAPERS[i % PAPERS.length];
      const g = present(0.17, paper, ribbon);
      g.position.set(x, y, z);
      g.rotation.y = rotY + 0.3;
      deskGifts.add(g);
    });
    this.christmas.add(mergeByMaterial(deskGifts));
    // The big tree out front, lit up, with a heap of presents.
    const out = new THREE.Group();
    const lit: THREE.Vector3[] = [];
    const big = christmasTree(BIG_TREE.height, this.lights, lit, true);
    out.add(big);
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + 0.4;
      const w = 0.45 + (i % 3) * 0.15;
      const [paper, ribbon] = PAPERS[i % PAPERS.length];
      const g = present(w, paper, ribbon);
      g.position.set(Math.cos(a) * 1.9, 0, Math.sin(a) * 1.9);
      g.rotation.y = a;
      out.add(g);
    }
    // Merging keeps only what's inside the group, so it's placed after.
    const tree = mergeByMaterial(out);
    tree.position.set(BIG_TREE.x, G, BIG_TREE.z);
    this.street.christmas.add(tree);
    this.colliders.christmas.push({ minX: BIG_TREE.x - 1.5, maxX: BIG_TREE.x + 1.5, minZ: BIG_TREE.z - 1.5, maxZ: BIG_TREE.z + 1.5, bottom: G, top: G + BIG_TREE.height });
    this.treeGlow = halos(lit.map((p, i) => ({ p: p.clone().add(new THREE.Vector3(BIG_TREE.x, G, BIG_TREE.z)), size: 0.9, color: ['#ffe28a', '#ff5a5a', '#6ec3ff', '#7dff8a'][i % 4] })));
    this.street.christmas.add(...this.treeGlow);
    const men = new THREE.Group();
    for (const [x, z, rotY] of SNOWMEN) {
      const s = snowman();
      s.position.set(x, G, z);
      s.rotation.y = rotY;
      men.add(s);
      this.colliders.christmas.push({ minX: x - 0.55, maxX: x + 0.55, minZ: z - 0.55, maxZ: z + 0.55, bottom: G, top: G + 2.5 });
    }
    this.street.christmas.add(mergeByMaterial(men));
    // Every collider here is down on the street.
    for (const c of [...this.colliders.halloween, ...this.colliders.christmas]) this.base.set(c, { top: c.top, bottom: c.bottom ?? 0 });
  }

  /** Puts up a holiday's decorations (taking down the other's), or none. */
  set(theme: Theme | null) {
    if (theme === this.theme) return;
    const colliders = this.office.colliders;
    if (this.theme) for (const c of this.colliders[this.theme]) colliders.splice(colliders.indexOf(c), 1);
    this.theme = theme;
    if (theme) colliders.push(...this.colliders[theme]);
    this.halloween.visible = theme === 'halloween';
    this.christmas.visible = theme === 'christmas';
    for (const p of this.plants) {
      p.tree.visible = theme === 'christmas';
      for (const l of p.leaves) l.visible = theme !== 'christmas';
    }
  }

  /** `lampsOn` is how far the lamps are on (see Sky), 0 by day and 1 at night: the candles and the tree lights glow brighter. */
  update(t: number, lampsOn: number, camera: THREE.Camera) {
    const drop = STREET_Y - this.office.night.street;
    if (drop !== this.drop) {
      this.drop = drop;
      for (const g of Object.values(this.street)) g.position.y = -drop;
      for (const [c, b] of this.base) {
        c.top = b.top - drop;
        c.bottom = b.bottom - drop;
      }
    }
    if (this.theme === 'halloween') {
      // Candlelight: a slow flicker, and now and then a gutter.
      const flicker = 0.88 + 0.08 * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 17.1) + 0.04 * Math.sin(t * 29.7);
      this.pumpkin.emissiveIntensity = (0.45 + 0.9 * lampsOn) * flicker;
      for (const h of this.pumpkinGlow) {
        h.material.opacity = (0.15 + 0.75 * lampsOn) * flicker;
        h.visible = h.material.opacity > 0.01;
      }
      camera.getWorldPosition(this.camPos);
      this.moonBats.position.copy(this.camPos);
      for (const b of this.bats) {
        const a = b.phase + t * b.speed;
        const x = b.cx + Math.cos(a) * b.r;
        const z = b.cz + Math.sin(a) * b.r;
        b.root.position.set(x, b.y + Math.sin(t * 0.9 + b.phase) * 1.2, z);
        // Along the circle, the way it's going, banking into the turn.
        b.root.rotation.set(0, Math.atan2(-Math.sin(a) * Math.sign(b.speed), Math.cos(a) * Math.sign(b.speed)), Math.sign(b.speed) * 0.35);
        const flap = Math.sin(t * 16 + b.phase * 3);
        b.wings.forEach((w, i) => (w.rotation.z = (i ? 1 : -1) * (0.15 + flap * 0.65)));
      }
    } else if (this.theme === 'christmas') {
      const base = 0.35 + 0.9 * lampsOn;
      this.lights.forEach((m, i) => (m.emissiveIntensity = base * (0.55 + 0.45 * Math.sin(t * 2.2 + i * 1.7))));
      for (const h of this.treeGlow) {
        h.material.opacity = lampsOn * 0.8;
        h.visible = h.material.opacity > 0.01;
      }
    }
  }
}
