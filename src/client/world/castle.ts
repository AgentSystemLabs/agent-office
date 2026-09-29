import * as THREE from 'three';
import type { FloorPalette } from '../../shared/floors';
import { KIOSK, STATION_AGENT, deskSeat, type DeskDef, type StationKind } from '../../shared/layout';
import { BENCH_OUT, BOARD_KEYS, COUNCIL, THRONE_SIZE, type BoardKey, type MapPlan, type PropConfig } from '../../shared/maps';
import type { PropKind } from '../../shared/maps/props';
import { PROP_SIZE, boxFootprint } from '../../shared/maps/props';
import { NavGrid, deskPoint, type Pt } from '../../shared/nav';
import { Person } from './character';
import { glowTexture } from './costumes';
import { buildGong, type Gong } from './gong';
import { vacancyMarker, type Collider, type DeskView, type Interactable } from './office';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon, toonUnique } from './toon';
import type { World } from './world';

/*
 * The castle's style of map (see shared/maps/castle.ts for the castle itself): a long stone hall
 * under a timber roof, pillars and pointed arches down both sides, stained glass high in the walls,
 * a dais at one end with a throne of iron blades on it, long tables with benches for the workers,
 * lecterns for the board agents, a round table for meetings, and fire everywhere. Everything is
 * placed from the map's plan, so another map in this style is just other numbers.
 */

/** The most torches and braziers that light the room for real (the rest just glow). */
const MAX_LIGHTS = 8;
const TABLE_TOP = 0.78;
const BENCH_TOP = 0.45;
const DOORWAY = { width: 5, height: 6.6 } as const;

// ---- Textures -------------------------------------------------------------------------------------

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

/** A little randomness that's the same every time, so every browser sees the same stones. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(color: string, k: number): string {
  const c = new THREE.Color(color);
  c.offsetHSL(0, 0, k);
  return `#${c.getHexString()}`;
}

/** Courses of dressed stone, with mortar between. One tile is 4 m wide and 2 m high. */
function ashlar(color: string, seed: number): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(seed);
    g.fillStyle = shade(color, -0.12);
    g.fillRect(0, 0, 512, 256);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 64 : 0;
      for (let col = -1; col < 5; col++) {
        const x = col * 128 + off;
        g.fillStyle = shade(color, (rand() - 0.5) * 0.09);
        g.fillRect(x + 3, row * 64 + 3, 122, 58);
        g.fillStyle = 'rgba(255,255,255,0.06)';
        g.fillRect(x + 3, row * 64 + 3, 122, 6);
      }
    }
  };
}

/** Big worn flagstones, 2 m a tile. */
function flagstones(color: string): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(7);
    g.fillStyle = shade(color, -0.14);
    g.fillRect(0, 0, 512, 512);
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const off = r % 2 ? 64 : 0;
        g.fillStyle = shade(color, (rand() - 0.5) * 0.1);
        g.fillRect(c * 128 + off + 4, r * 128 + 4, 120, 120);
        if (off) {
          g.fillStyle = shade(color, (rand() - 0.5) * 0.1);
          g.fillRect(-64 + 4, r * 128 + 4, 120, 120);
        }
      }
    }
  };
}

/** Dark boards, for the roof's underside. */
function boards(color: string): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    g.fillStyle = shade(color, -0.08);
    g.fillRect(0, 0, 256, 256);
    const rand = seeded(3);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = shade(color, (rand() - 0.5) * 0.08);
      g.fillRect(i * 32 + 1, 0, 30, 256);
    }
  };
}

const GLASS = ['#b3261e', '#1f4fb4', '#d9a520', '#2e8b57', '#6a2c91', '#d8631c', '#1b7a8c'];

/** Stained glass: a diamond lattice of colored panes in lead, and a bright roundel in the middle. */
function stainedGlass(seed: number, w: number, h: number): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(seed);
    g.fillStyle = '#1b1612';
    g.fillRect(0, 0, w, h);
    const cell = w / 5;
    for (let y = -cell; y < h + cell; y += cell / 2) {
      for (let x = -cell; x < w + cell; x += cell) {
        const cx = x + ((Math.round(y / (cell / 2)) % 2) * cell) / 2;
        g.fillStyle = GLASS[Math.floor(rand() * GLASS.length)];
        g.globalAlpha = 0.75 + rand() * 0.25;
        g.beginPath();
        g.moveTo(cx, y - cell / 2 + 3);
        g.lineTo(cx + cell / 2 - 3, y);
        g.lineTo(cx, y + cell / 2 - 3);
        g.lineTo(cx - cell / 2 + 3, y);
        g.closePath();
        g.fill();
      }
    }
    g.globalAlpha = 1;
    // A roundel: a gold ring, a star in it.
    const r = w * 0.3;
    g.lineWidth = 8;
    g.strokeStyle = '#1b1612';
    g.fillStyle = '#f2d06b';
    g.beginPath();
    g.arc(w / 2, h * 0.42, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = GLASS[Math.floor(rand() * 3)];
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 ? r * 0.42 : r * 0.85;
      g.lineTo(w / 2 + Math.cos(a) * rr, h * 0.42 + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.stroke();
  };
}

/** A rose window: petals of glass round a gold heart, spokes of stone between them. */
function roseGlass(g: CanvasRenderingContext2D) {
  const s = 512;
  const c = s / 2;
  g.fillStyle = '#1b1612';
  g.fillRect(0, 0, s, s);
  const rand = seeded(11);
  for (let ring = 3; ring >= 1; ring--) {
    const n = ring * 8;
    for (let i = 0; i < n; i++) {
      g.fillStyle = GLASS[(i + ring) % GLASS.length];
      g.globalAlpha = 0.8 + rand() * 0.2;
      g.beginPath();
      g.moveTo(c, c);
      g.arc(c, c, (ring / 3) * c - 6, (i / n) * Math.PI * 2 + 0.03, ((i + 1) / n) * Math.PI * 2 - 0.03);
      g.closePath();
      g.fill();
    }
  }
  g.globalAlpha = 1;
  g.strokeStyle = '#1b1612';
  g.lineWidth = 10;
  for (const r of [c / 3, (2 * c) / 3]) {
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#f2d06b';
  g.beginPath();
  g.arc(c, c, c / 6, 0, Math.PI * 2);
  g.fill();
  g.stroke();
}

/** A banner: its field in `color` with a gold border, a crown, and a word or two at the foot. */
function paintBanner(g: CanvasRenderingContext2D, w: number, h: number, color: string, motto?: string) {
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.fillStyle = shade(color, -0.12);
  for (let x = 0; x < w; x += 24) g.fillRect(x, 0, 10, h);
  g.strokeStyle = '#e8b93a';
  g.lineWidth = w * 0.05;
  g.strokeRect(w * 0.06, w * 0.06, w * 0.88, h - w * 0.12);
  // The crown.
  const cx = w / 2;
  const cy = h * 0.3;
  const cw = w * 0.52;
  g.fillStyle = '#f2c94c';
  g.strokeStyle = '#6b4a10';
  g.lineWidth = w * 0.015;
  g.beginPath();
  g.moveTo(cx - cw / 2, cy + cw * 0.35);
  g.lineTo(cx - cw / 2, cy - cw * 0.15);
  g.lineTo(cx - cw / 4, cy + cw * 0.08);
  g.lineTo(cx, cy - cw * 0.32);
  g.lineTo(cx + cw / 4, cy + cw * 0.08);
  g.lineTo(cx + cw / 2, cy - cw * 0.15);
  g.lineTo(cx + cw / 2, cy + cw * 0.35);
  g.closePath();
  g.fill();
  g.stroke();
  for (const dx of [-cw / 2, 0, cw / 2]) {
    g.beginPath();
    g.arc(cx + dx, cy - (dx ? cw * 0.19 : cw * 0.36), w * 0.035, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  if (motto) {
    g.fillStyle = '#f7e7b4';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = w * 0.13;
    g.font = `900 ${size}px Georgia, 'Times New Roman', serif`;
    while (g.measureText(motto).width > w * 0.8 && size > 10) {
      size *= 0.9;
      g.font = `900 ${size}px Georgia, 'Times New Roman', serif`;
    }
    g.fillText(motto, cx, h * 0.62);
  }
}

// ---- Shapes ---------------------------------------------------------------------------------------

/**
 * A pointed arch's outline, `span` across at its feet (y 0), made of two arcs of radius `r` (at
 * least span / 2; the bigger, the pointier), grown outward by `grow`.
 */
function archPath(shape: THREE.Shape | THREE.Path, span: number, r: number, grow: number, reverse = false) {
  const cxL = -span / 2 + r;
  const cxR = span / 2 - r;
  const R = r + grow;
  // Where the left arc (round its center right of the middle) reaches the middle, at the point.
  const apex = Math.acos((span / 2 - r) / R);
  if (!reverse) {
    // Up the left arc from its foot to the point, then down the right one to its foot.
    shape.absarc(cxL, 0, R, Math.PI, apex, true);
    shape.absarc(cxR, 0, R, Math.PI - apex, 0, true);
  } else {
    shape.absarc(cxR, 0, R, 0, Math.PI - apex, false);
    shape.absarc(cxL, 0, R, apex, Math.PI, false);
  }
}

/** The apex height of a pointed arch (see archPath). */
function archRise(span: number, r: number, grow = 0): number {
  const d = r - span / 2;
  return Math.sqrt(Math.max(0, (r + grow) ** 2 - d * d));
}

/** A band of stone following a pointed arch: `span` wide inside, `band` thick, `depth` deep (along z), feet at y 0. */
function archBand(span: number, band: number, depth: number, r = span * 0.8): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-span / 2 - band, 0);
  archPath(s, span, r, band);
  s.lineTo(span / 2, 0);
  archPath(s, span, r, 0, true);
  s.lineTo(-span / 2 - band, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** A slab `width` wide and `height` high with a pointed arch `span` wide cut out of its foot: the stone over a doorway. */
function archFill(width: number, height: number, span: number, depth: number, r: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(-span / 2, 0);
  archPath(s, span, r, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(width / 2, height);
  s.lineTo(-width / 2, height);
  s.lineTo(-width / 2, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** A flat pointed-arch window pane, `w` wide and `h` high to its point, with UVs over its bounding box. */
function archPane(w: number, h: number): THREE.ShapeGeometry {
  const r = w * 0.85;
  const rise = archRise(w, r);
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, h - rise);
  // Up the arch, using a shape of its own, then shifted up onto the jambs.
  const top = new THREE.Shape();
  top.moveTo(-w / 2, 0);
  archPath(top, w, r, 0);
  const pts = top.getPoints(10).map((v) => new THREE.Vector2(v.x, v.y + h - rise));
  for (const v of pts.slice(1)) s.lineTo(v.x, v.y);
  s.lineTo(w / 2, 0);
  s.lineTo(-w / 2, 0);
  const geo = new THREE.ShapeGeometry(s, 10);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, pos.getY(i) / h);
  return geo;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** A thin rod from `a` to `b` (a chain, a pole). */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const along = b.clone().sub(a);
  const m = mesh(new THREE.CylinderGeometry(r, r, along.length(), 5), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, false);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize());
  return m;
}

/** What the builder hands the props: where to put meshes, what's in the way, and the fires to animate. */
interface Kit {
  /** The top of whatever the floor is at (x, z): the dais, or the floor. */
  floorAt(x: number, z: number): number;
  group: THREE.Group;
  /** Merged into a few draw calls at the end: whatever never moves. */
  still: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  flames: Flame[];
  lights: { light: THREE.PointLight; base: number; phase: number }[];
  mats: Mats;
  height: number;
  /** Every seat by id, as it's built. */
  desks: Map<string, DeskView>;
  /** What paints itself over later: the stained glass (dimmer at night), the banners and the shields (in a floor's colors). */
  glass: THREE.MeshBasicMaterial[];
  banners: Banner[];
  shields: THREE.MeshToonMaterial[];
  /** How many windows so far, so each one's glass is its own pattern. */
  windows: number;
  gong?: Gong;
}

interface Mats {
  stone: THREE.Material;
  stoneDark: THREE.Material;
  wood: THREE.Material;
  woodDark: THREE.Material;
  iron: THREE.Material;
  steel: THREE.Material;
  gold: THREE.Material;
  carpet: THREE.Material;
  velvet: THREE.Material;
  parchment: THREE.Material;
  candle: THREE.Material;
}

// ---- Fire ------------------------------------------------------------------------------------------

interface Flame {
  mesh: THREE.Object3D;
  glow: THREE.Sprite;
  size: number;
  phase: number;
}

/** Every flame's cones: the same two shapes, scaled. */
const FLAME_OUTER = new THREE.ConeGeometry(0.45, 1, 8).translate(0, 0.5, 0);
const FLAME_INNER = new THREE.ConeGeometry(0.25, 0.7, 8).translate(0, 0.35, 0);
const FLAME_OUT = new THREE.MeshBasicMaterial({ color: '#ff8c2a', toneMapped: false });
const FLAME_IN = new THREE.MeshBasicMaterial({ color: '#ffe38a', toneMapped: false });
FLAME_OUT.userData.outlineParameters = { visible: false };
FLAME_IN.userData.outlineParameters = { visible: false };

/** A licking flame `size` tall at (x, y, z) in `parent`, with a warm glow round it. */
function flame(kit: Kit, parent: THREE.Object3D, x: number, y: number, z: number, size: number): void {
  const f = new THREE.Group();
  f.position.set(x, y, z);
  const outer = new THREE.Mesh(FLAME_OUTER, FLAME_OUT);
  const inner = new THREE.Mesh(FLAME_INNER, FLAME_IN);
  inner.position.y = 0.02;
  f.add(outer, inner);
  f.scale.setScalar(size);
  parent.add(f);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb45a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(x, y + size * 0.45, z);
  glow.scale.setScalar(size * 5);
  parent.add(glow);
  kit.flames.push({ mesh: f, glow, size, phase: Math.random() * 10 });
}

/** A real light at (x, y, z) (in `parent`), while there are few enough of them. */
function fireLight(kit: Kit, parent: THREE.Object3D, x: number, y: number, z: number, power: number) {
  if (kit.lights.length >= MAX_LIGHTS) return;
  const light = new THREE.PointLight('#ffae5c', power, 22, 1.6);
  light.position.set(x, y, z);
  parent.add(light);
  kit.lights.push({ light, base: power, phase: Math.random() * 10 });
}

// ---- The props -----------------------------------------------------------------------------------

/** Puts a group at a prop's spot, turned its way: `y` up, or on whatever's underfoot there (the dais). */
function placed(p: PropConfig, y = p.y ?? 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(p.x, y, p.z);
  g.rotation.y = p.rotY ?? 0;
  return g;
}

function collide(kit: Kit, x: number, z: number, w: number, d: number, rotY: number, top: number, extra: Partial<Collider> = {}) {
  const [minX, maxX, minZ, maxZ] = boxFootprint(x, z, w, d, rotY);
  kit.colliders.push({ minX, maxX, minZ, maxZ, top, ...extra });
}

function pillar(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const w = PROP_SIZE.pillar * s;
  const H = kit.height;
  const g = placed(p, 0);
  const { stone, stoneDark } = kit.mats;
  g.add(mesh(box(w, 0.7, w), stoneDark, 0, 0.35, 0));
  g.add(mesh(box(w * 0.86, 0.18, w * 0.86), stoneDark, 0, 0.79, 0));
  // Four shafts clustered round a core, the way a Gothic pier is.
  g.add(mesh(box(w * 0.62, H - 1.9, w * 0.62), stone, 0, 0.7 + (H - 1.9) / 2, 0));
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    g.add(mesh(new THREE.CylinderGeometry(w * 0.17, w * 0.17, H - 1.9, 10), stone, dx * w * 0.31, 0.7 + (H - 1.9) / 2, dz * w * 0.31));
  }
  g.add(mesh(box(w * 1.05, 0.5, w * 1.05), stoneDark, 0, H - 1.0, 0));
  g.add(mesh(box(w * 0.8, 0.5, w * 0.8), stoneDark, 0, H - 0.5, 0));
  kit.still.add(g);
  collide(kit, p.x, p.z, w, w, p.rotY ?? 0, 99);
}

/** Pointed arches between neighbouring pillars along each side (the arcade). */
function arcade(kit: Kit, pillars: PropConfig[]) {
  const rows = new Map<number, PropConfig[]>();
  for (const p of pillars) {
    const k = Math.round(p.x * 10);
    rows.set(k, [...(rows.get(k) ?? []), p]);
  }
  const H = kit.height;
  for (const row of rows.values()) {
    row.sort((a, b) => a.z - b.z);
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1];
      const b = row[i];
      const gap = b.z - a.z;
      const w = PROP_SIZE.pillar * Math.max(a.scale ?? 1, b.scale ?? 1);
      if (gap > 9 || gap < w + 1) continue;
      const span = gap - w * 0.9;
      const rise = archRise(span, span * 0.8, 0.45);
      const spring = Math.max(2.5, H - 1.25 - rise);
      const arch = mesh(archBand(span, 0.45, w * 0.55), kit.mats.stone, 0, 0, 0);
      arch.position.set(a.x, spring, (a.z + b.z) / 2);
      arch.rotation.y = Math.PI / 2;
      kit.still.add(arch);
      // The wall over the arch, up to the beam the roof trusses sit on.
      kit.still.add(mesh(box(w * 0.5, 0.5, gap), kit.mats.stoneDark, a.x, H - 0.25, (a.z + b.z) / 2));
    }
  }
}

function torch(kit: Kit, p: PropConfig) {
  const y = p.y ?? 2.7;
  const g = placed(p, y);
  const { iron, woodDark } = kit.mats;
  // An iron bracket on the wall, the torch leaning out of its cup.
  g.add(mesh(box(0.22, 0.34, 0.06), iron, 0, 0, 0.03));
  const arm = mesh(box(0.05, 0.05, 0.36), iron, 0, -0.08, 0.2);
  g.add(arm);
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.06, 0.16, 8), iron, 0, 0.02, 0.36));
  const stick = mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.62, 6), woodDark, 0, 0.26, 0.4);
  stick.rotation.x = 0.25;
  g.add(stick);
  kit.group.add(g);
  flame(kit, g, 0, 0.56, 0.48, 0.34);
  g.updateMatrixWorld(true);
  if (p.light) {
    const at = g.localToWorld(new THREE.Vector3(0, 0.8, 0.7));
    fireLight(kit, kit.group, at.x, at.y, at.z, 16);
  }
}

function brazier(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  g.scale.setScalar(s);
  const { iron } = kit.mats;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.05, 6), iron, Math.sin(a) * 0.26, 0.5, Math.cos(a) * 0.26);
    leg.rotation.set(Math.cos(a) * 0.22, 0, -Math.sin(a) * 0.22);
    g.add(leg);
  }
  const bowl = new THREE.LatheGeometry(
    [
      [0.05, 0],
      [0.38, 0.08],
      [0.55, 0.3],
      [0.58, 0.34],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    16,
  );
  g.add(mesh(bowl, iron, 0, 0.95, 0));
  g.add(mesh(new THREE.TorusGeometry(0.57, 0.035, 6, 20).rotateX(Math.PI / 2), kit.mats.gold, 0, 1.28, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.08, 14), toon('#3a1f14', { emissive: '#7a2a0a' }), 0, 1.2, 0, false));
  kit.group.add(g);
  flame(kit, g, 0, 1.2, 0, 0.62);
  flame(kit, g, 0.2, 1.2, 0.12, 0.38);
  flame(kit, g, -0.18, 1.2, -0.1, 0.42);
  if (p.light) fireLight(kit, kit.group, p.x, g.position.y + 2.3 * s, p.z, 30);
  kit.colliders.push({ minX: p.x - 0.5 * s, maxX: p.x + 0.5 * s, minZ: p.z - 0.5 * s, maxZ: p.z + 0.5 * s, top: g.position.y + 1.3 * s, fence: true });
}

function chandelier(kit: Kit, p: PropConfig) {
  const y = p.y ?? kit.height - 4;
  const g = placed(p, y);
  const { iron, candle } = kit.mats;
  const R = 1.35 * (p.scale ?? 1);
  g.add(mesh(new THREE.TorusGeometry(R, 0.06, 6, 28).rotateX(Math.PI / 2), iron, 0, 0, 0));
  g.add(mesh(new THREE.TorusGeometry(R * 0.45, 0.04, 6, 20).rotateX(Math.PI / 2), iron, 0, -0.35, 0));
  // Three chains up to a ring, and one from there up to the roof.
  const up = kit.height + 1 - y;
  const hub = new THREE.Vector3(0, 1.4, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    g.add(rod(new THREE.Vector3(Math.sin(a) * R, 0, Math.cos(a) * R), hub, 0.018, iron));
  }
  g.add(rod(hub, new THREE.Vector3(0, up, 0), 0.03, iron));
  kit.group.add(g);
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.sin(a) * R;
    const z = Math.cos(a) * R;
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), candle, x, 0.18, z, false));
    flame(kit, g, x, 0.34, z, 0.11);
  }
}

/** The banners, to repaint in a floor's colors; the great one with the project's name on it. */
interface Banner {
  tex: THREE.CanvasTexture;
  w: number;
  h: number;
  great: boolean;
}

function banner(kit: Kit, p: PropConfig, color: string) {
  const w = p.width ?? 1.2;
  const h = p.height ?? 4;
  const g = placed(p, p.y ?? kit.height - 2);
  const great = w >= 3;
  const pw = 256;
  const ph = Math.min(2048, Math.max(64, Math.round((256 * h) / w)));
  const tex = canvasTexture(pw, ph, (c) => paintBanner(c, pw, ph, color));
  kit.banners.push({ tex, w: pw, h: ph, great });
  // Cut to a swallowtail at the foot.
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, -h);
  s.lineTo(0, -h + w * 0.45);
  s.lineTo(-w / 2, -h);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, 1 + pos.getY(i) / h);
  const cloth = new THREE.MeshToonMaterial({ map: tex, side: THREE.DoubleSide, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  g.add(mesh(geo, cloth, 0, 0, 0.08, false));
  // The pole it hangs from, with a gold knob either end.
  g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, w + 0.4, 8).rotateZ(Math.PI / 2), kit.mats.woodDark, 0, 0.05, 0.1, false));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), kit.mats.gold, sx * (w / 2 + 0.22), 0.05, 0.1, false));
  kit.group.add(g);
}

function glassWindow(kit: Kit, p: PropConfig, seed: number) {
  const w = p.width ?? 2.2;
  const h = p.height ?? 5;
  const g = placed(p, p.y ?? 6);
  // The picture's as tall as the window is for its width, within reason.
  const th = Math.min(1024, Math.max(64, Math.round((256 * h) / w)));
  const tex = canvasTexture(256, th, stainedGlass(seed, 256, th));
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  mat.userData.outlineParameters = { visible: false };
  kit.glass.push(mat);
  g.add(mesh(archPane(w, h), mat, 0, 0, 0.02, false));
  // A stone frame round it: the jambs, the sill, and the arch over it.
  const r = w * 0.85;
  const rise = archRise(w, r);
  const { stoneDark } = kit.mats;
  for (const sx of [-1, 1]) g.add(mesh(box(0.28, h - rise, 0.3), stoneDark, sx * (w / 2 + 0.14), (h - rise) / 2, 0.05));
  g.add(mesh(box(w + 0.7, 0.25, 0.45), stoneDark, 0, -0.12, 0.12));
  g.add(mesh(archBand(w, 0.28, 0.3, r), stoneDark, 0, h - rise, 0.05));
  // A mullion down the middle.
  g.add(mesh(box(0.09, h - rise * 0.6, 0.12), stoneDark, 0, (h - rise * 0.6) / 2, 0.06, false));
  // Not merged with the stonework: the glass keeps its picture's coordinates that way.
  kit.group.add(g);
}

function rose(kit: Kit, p: PropConfig) {
  const d = p.width ?? 4.5;
  const g = placed(p, p.y ?? kit.height - 3);
  const mat = new THREE.MeshBasicMaterial({ map: canvasTexture(512, 512, roseGlass), toneMapped: false });
  mat.userData.outlineParameters = { visible: false };
  kit.glass.push(mat);
  g.add(mesh(new THREE.CircleGeometry(d / 2, 40), mat, 0, 0, 0.03, false));
  g.add(mesh(new THREE.TorusGeometry(d / 2 + 0.1, 0.22, 8, 40), kit.mats.stoneDark, 0, 0, 0.08));
  for (let i = 0; i < 8; i++) {
    const spoke = mesh(box(0.1, d - 0.2, 0.1), kit.mats.stoneDark, 0, 0, 0.07, false);
    spoke.rotation.z = (i / 8) * Math.PI;
    g.add(spoke);
  }
  kit.group.add(g);
}

function carpet(kit: Kit, p: PropConfig) {
  const w = p.width ?? 3;
  const l = p.length ?? 10;
  const g = placed(p, kit.floorAt(p.x, p.z));
  g.add(mesh(box(w, 0.025, l), kit.mats.carpet, 0, 0.013, 0, false));
  for (const sx of [-1, 1]) g.add(mesh(box(0.14, 0.03, l), kit.mats.gold, sx * (w / 2 - 0.2), 0.016, 0, false));
  kit.still.add(g);
}

/** A knight in pale stone on a plinth, leaning on a sword. */
function statue(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  g.scale.setScalar(s);
  const pale = toon('#c9c2b4');
  const plinth = kit.mats.stoneDark;
  g.add(mesh(box(1.3, 1.0, 1.3), plinth, 0, 0.5, 0));
  g.add(mesh(box(1.45, 0.15, 1.45), plinth, 0, 1.07, 0));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.95, 8), pale, sx * 0.16, 1.62, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.26, 0.95, 10), pale, 0, 2.55, 0));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), pale, sx * 0.36, 2.95, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.4, 12), pale, 0, 3.28, 0));
  g.add(mesh(new THREE.SphereGeometry(0.21, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), pale, 0, 3.45, 0));
  g.add(mesh(box(0.28, 0.035, 0.05), toon('#6e675c'), 0, 3.3, 0.2, false));
  // Both hands on the pommel of a sword stood point down in front of it.
  g.add(mesh(box(0.1, 1.15, 0.03), pale, 0, 1.75, 0.36));
  g.add(mesh(box(0.5, 0.07, 0.07), pale, 0, 2.35, 0.36));
  g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), pale, 0, 2.55, 0.36));
  for (const sx of [-1, 1]) {
    const arm = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6), pale, sx * 0.22, 2.55, 0.2);
    arm.rotation.set(0.7, 0, -sx * 0.5);
    g.add(arm);
  }
  kit.still.add(g);
  collide(kit, p.x, p.z, PROP_SIZE.statue * s, PROP_SIZE.statue * s, p.rotY ?? 0, 99);
}

function armor(kit: Kit, p: PropConfig) {
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steel, iron, woodDark } = kit.mats;
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.08, 12), woodDark, 0, 0.04, 0));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.9, 8), steel, sx * 0.13, 0.53, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.8, 10), steel, 0, 1.38, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.12, 10), iron, 0, 1.0, 0));
  for (const sx of [-1, 1]) {
    g.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), steel, sx * 0.36, 1.72, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.62, 6), steel, sx * 0.4, 1.35, 0));
  }
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.36, 12), steel, 0, 2.02, 0));
  g.add(mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), steel, 0, 2.18, 0));
  g.add(mesh(box(0.26, 0.035, 0.05), iron, 0, 2.06, 0.19, false));
  g.add(mesh(new THREE.ConeGeometry(0.05, 0.3, 6), toon('#9b1c1c'), 0, 2.45, 0, false));
  // A halberd at its side.
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.7, 6), woodDark, 0.52, 1.35, 0.1));
  g.add(mesh(box(0.05, 0.4, 0.28), steel, 0.52, 2.55, 0.2));
  kit.still.add(g);
  const r = PROP_SIZE.armor;
  kit.colliders.push({ minX: p.x - r, maxX: p.x + r, minZ: p.z - r, maxZ: p.z + r, top: 99 });
}

function shield(kit: Kit, p: PropConfig) {
  const g = placed(p, p.y ?? 3.5);
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0.5);
  s.lineTo(0.5, 0.5);
  s.quadraticCurveTo(0.5, -0.3, 0, -0.75);
  s.quadraticCurveTo(-0.5, -0.3, -0.5, 0.5);
  const field = toonUnique('#9b1c1c');
  kit.shields.push(field);
  g.add(mesh(new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false }), field, 0, 0, 0.12));
  g.add(mesh(box(0.16, 1.05, 0.02), kit.mats.gold, 0, -0.1, 0.19, false));
  g.add(mesh(box(0.8, 0.16, 0.02), kit.mats.gold, 0, 0.15, 0.19, false));
  // Two swords crossed behind it.
  for (const sx of [-1, 1]) {
    const sword = new THREE.Group();
    sword.add(mesh(box(0.08, 1.6, 0.02), kit.mats.steel, 0, 0.1, 0, false));
    sword.add(mesh(box(0.34, 0.06, 0.05), kit.mats.gold, 0, -0.7, 0, false));
    sword.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 6), kit.mats.woodDark, 0, -0.85, 0, false));
    sword.position.set(0, -0.1, 0.06);
    sword.rotation.z = sx * 0.75;
    g.add(sword);
  }
  kit.group.add(g);
}

function hearth(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const w = (p.width ?? PROP_SIZE.hearth.width) * s;
  const d = PROP_SIZE.hearth.depth * s;
  const at = placed(p, 0);
  // Built from its back (against the wall) out; its spot is its middle.
  const g = new THREE.Group();
  g.position.z = -d / 2;
  at.add(g);
  const { stoneDark, stone, woodDark } = kit.mats;
  g.add(mesh(box(w, 2.6, 0.25), toon('#2a211c'), 0, 1.3, 0.12));
  for (const sx of [-1, 1]) g.add(mesh(box(0.5, 2.3, d), stoneDark, sx * (w / 2 - 0.25), 1.15, d / 2));
  g.add(mesh(box(w + 0.3, 0.35, d + 0.2), stoneDark, 0, 2.45, d / 2 + 0.05));
  g.add(mesh(box(w + 0.1, 0.15, d + 0.1), woodDark, 0, 2.7, d / 2 + 0.05));
  // The hood, tapering up to the roof.
  const hood = mesh(new THREE.CylinderGeometry(w * 0.32, w * 0.55, kit.height - 2.8, 4, 1), stone, 0, 2.8 + (kit.height - 2.8) / 2, d * 0.3);
  hood.rotation.y = Math.PI / 4;
  hood.scale.z = 0.45;
  g.add(hood);
  g.add(mesh(box(w - 0.8, 0.1, d - 0.2), toon('#3a1f14', { emissive: '#5a1a05' }), 0, 0.05, d / 2, false));
  for (const [x, rz] of [
    [-0.3, 0.2],
    [0.25, -0.25],
    [0, 0],
  ]) {
    const log = mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.1, 8), woodDark, x, 0.18, d / 2);
    log.rotation.set(0, rz, Math.PI / 2);
    g.add(log);
  }
  kit.group.add(at);
  flame(kit, g, 0, 0.2, d / 2, 0.75);
  flame(kit, g, -0.35, 0.2, d / 2 + 0.1, 0.5);
  flame(kit, g, 0.35, 0.2, d / 2 - 0.05, 0.55);
  at.updateMatrixWorld(true);
  if (p.light) {
    const lit = g.localToWorld(new THREE.Vector3(0, 1.1, d + 0.6));
    fireLight(kit, kit.group, lit.x, lit.y, lit.z, 34);
  }
  collide(kit, p.x, p.z, w, d, p.rotY ?? 0, 99);
}

function cask(kit: Kit, p: PropConfig): Interactable {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  g.scale.setScalar(s);
  const { woodDark, iron, wood } = kit.mats;
  g.add(mesh(box(1.7, 0.12, 0.9), woodDark, 0, 0.3, 0));
  for (const sx of [-0.6, 0.6]) g.add(mesh(box(0.12, 0.3, 0.9), woodDark, sx, 0.15, 0));
  for (const [x, y, r] of [
    [-0.42, 0.72, 0.36],
    [0.42, 0.72, 0.36],
    [0, 1.33, 0.32],
  ]) {
    const barrel = new THREE.Group();
    barrel.add(mesh(new THREE.CylinderGeometry(r, r, 0.85, 14).rotateX(Math.PI / 2), wood, 0, 0, 0));
    for (const bz of [-0.3, 0, 0.3]) barrel.add(mesh(new THREE.TorusGeometry(r + 0.01, 0.022, 5, 18), iron, 0, 0, bz, false));
    barrel.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 6).rotateX(Math.PI / 2), iron, 0, -r * 0.4, 0.46, false));
    barrel.position.set(x, y, 0);
    g.add(barrel);
  }
  // Tankards on the rack.
  for (const x of [-0.72, 0.72]) g.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.18, 10), toon('#8d939c'), x, 1.0, 0.25, false));
  const sign = textPlane('🍺 Ale', { bg: '#efe3c2', size: 48 });
  sign.scale.multiplyScalar(0.55);
  sign.position.set(0, 1.85, 0.2);
  g.add(sign);
  kit.group.add(g);
  const r = p.rotY ?? 0;
  collide(kit, p.x, p.z, PROP_SIZE.cask.width * s, PROP_SIZE.cask.depth * s, r, g.position.y + 1.6 * s);
  const it: Interactable = { kind: 'coffee', label: '🍺 Ale casks', x: p.x + Math.sin(r) * 1.1, y: g.position.y, z: p.z + Math.cos(r) * 1.1, radius: 1.5 };
  g.userData.interact = it;
  return it;
}

function plainTable(kit: Kit, p: PropConfig) {
  const w = p.width ?? 1.4;
  const l = p.length ?? 3;
  const g = placed(p, kit.floorAt(p.x, p.z));
  g.add(mesh(roundedBox(w, 0.1, l, 0.05), kit.mats.wood, 0, TABLE_TOP - 0.05, 0));
  for (const sz of [-1, 1]) g.add(mesh(box(w - 0.2, TABLE_TOP - 0.1, 0.12), kit.mats.woodDark, 0, (TABLE_TOP - 0.1) / 2, sz * (l / 2 - 0.3)));
  kit.still.add(g);
  collide(kit, p.x, p.z, w, l, p.rotY ?? 0, g.position.y + TABLE_TOP);
}

function candles(kit: Kit, p: PropConfig) {
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { iron, candle } = kit.mats;
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.06, 10), iron, 0, 0.03, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), iron, 0, 0.83, 0));
  g.add(mesh(box(0.7, 0.04, 0.04), iron, 0, 1.6, 0, false));
  kit.group.add(g);
  for (const x of [-0.33, 0, 0.33]) {
    const y = x ? 1.62 : 1.66;
    g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 6), candle, x, y + 0.13, 0, false));
    flame(kit, g, x, y + 0.27, 0, 0.1);
  }
  kit.colliders.push({ minX: p.x - 0.25, maxX: p.x + 0.25, minZ: p.z - 0.25, maxZ: p.z + 0.25, top: 99 });
}

// ---- The throne ----------------------------------------------------------------------------------

/** A sword, point up, `len` long from its guard to its tip, its hilt below the guard. */
const BLADE = toon('#7f8791');
const RUST = toon('#6f5a4e');

function sword(g: THREE.Group, len: number, mats: Mats, rust: boolean) {
  const steel = rust ? RUST : BLADE;
  g.add(mesh(box(0.075, len, 0.016), steel, 0, len / 2, 0, false));
  g.add(mesh(new THREE.ConeGeometry(0.053, 0.13, 4).rotateY(Math.PI / 4).scale(1, 1, 0.25), steel, 0, len + 0.065, 0, false));
  g.add(mesh(box(0.3, 0.04, 0.045), mats.iron, 0, 0, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.18, 5), mats.iron, 0, -0.1, 0, false));
  g.add(mesh(new THREE.SphereGeometry(0.035, 6, 5), mats.iron, 0, -0.2, 0, false));
}

/**
 * The throne of iron blades: an iron seat and back, and hundreds of swords (well, a couple of
 * hundred) welded round it, fanning out behind in a jagged crown, bristling from the arms and
 * spilling off the base. Faces +z; its seat is `seatY` up.
 */
function ironThrone(mats: Mats): THREE.Group {
  const g = new THREE.Group();
  const rand = seeded(1234);
  const { iron, velvet } = mats;
  g.add(mesh(box(1.9, 0.36, 1.7), iron, 0, 0.18, -0.1));
  g.add(mesh(box(1.3, 0.32, 1.1), iron, 0, 0.52, 0));
  g.add(mesh(roundedBox(1.08, 0.1, 0.92, 0.05), velvet, 0, 0.71, 0.05));
  g.add(mesh(box(1.4, 1.9, 0.3), iron, 0, 1.6, -0.55));
  g.add(mesh(roundedBox(0.95, 1.1, 0.08, 0.05), velvet, 0, 1.3, -0.38));
  for (const sx of [-1, 1]) {
    g.add(mesh(box(0.2, 0.42, 1.1), iron, sx * 0.72, 0.9, 0));
    // Blades bristling forward off the ends of the arms, and up and out along them.
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Group();
      sword(s, 0.45 + rand() * 0.35, mats, rand() < 0.2);
      s.position.set(sx * (0.72 + (rand() - 0.5) * 0.12), 0.95 + rand() * 0.15, 0.45 - i * 0.2);
      s.rotation.set(Math.PI / 2 - 0.5 - rand() * 0.4, 0, sx * (0.5 + rand() * 0.6));
      g.add(s);
    }
  }
  // The crown of blades behind the back: fanning out from behind the seat, longest in the middle.
  for (let layer = 0; layer < 4; layer++) {
    const n = 30 - layer * 5;
    for (let i = 0; i < n; i++) {
      const a = -1.45 + (2.9 * (i + rand() * 0.6)) / n;
      const len = 1.1 + 2.7 * Math.cos(a) ** 2 - layer * 0.35 + rand() * 0.55;
      const s = new THREE.Group();
      sword(s, len, mats, rand() < 0.15);
      s.position.set(Math.sin(a) * 0.35, 1.25 + Math.cos(a) * 0.45, -0.72 - layer * 0.1);
      s.rotation.set(-0.12 - layer * 0.08 + (rand() - 0.5) * 0.1, (rand() - 0.5) * 0.4, -a);
      g.add(s);
    }
  }
  // Swords spilling off the base in every direction but the front, points out and down.
  for (let i = 0; i < 30; i++) {
    const a = Math.PI * 0.35 + rand() * Math.PI * 1.3;
    const s = new THREE.Group();
    sword(s, 0.5 + rand() * 0.5, mats, rand() < 0.3);
    s.position.set(Math.sin(a) * 0.85, 0.2 + rand() * 0.2, -0.1 + Math.cos(a) * 0.75);
    s.rotation.set(0, a, Math.PI / 2 - 0.2 - rand() * 0.5);
    s.rotateY(Math.PI / 2);
    g.add(s);
  }
  // And a few down the front of the seat.
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Group();
    sword(s, 0.35 + rand() * 0.2, mats, false);
    s.position.set(-0.5 + i * 0.2, 0.45, 0.56);
    s.rotation.set(Math.PI / 2 + 0.9, 0, (rand() - 0.5) * 0.4);
    g.add(s);
  }
  return mergeByMaterial(g);
}

// ---- Building it ---------------------------------------------------------------------------------

/** Each kind of prop, put up (every kind there is has one: see PROP_KINDS). */
const PROPS: Record<PropKind, (kit: Kit, p: PropConfig) => void> = {
  pillar,
  torch,
  brazier,
  chandelier,
  banner: (kit, p) => banner(kit, p, '#9b1c1c'),
  window: (kit, p) => glassWindow(kit, p, kit.windows++),
  rose,
  carpet,
  statue,
  armor,
  shield,
  hearth,
  gong: (kit, p) => {
    const gong = buildGong({ x: p.x, y: kit.floorAt(p.x, p.z), z: p.z, rotY: p.rotY ?? 0 });
    kit.group.add(gong.group);
    kit.colliders.push(...gong.colliders);
    kit.interactables.push(gong.interactable);
    kit.gong = gong;
  },
  cask: (kit, p) => kit.interactables.push(cask(kit, p)),
  table: plainTable,
  candles,
};

/** The colors of the stone and the rest, as the map's palette has them. */
function materials(pal: { stone: string; wood: string; trim: string; carpet: string }): Mats {
  return {
    stone: toon(pal.stone),
    stoneDark: toon(shade(pal.stone, -0.1)),
    wood: toon(pal.wood),
    woodDark: toon(shade(pal.wood, -0.1)),
    iron: toon('#2f3036'),
    steel: toon('#a3a9b2'),
    gold: toon(pal.trim),
    carpet: toon(pal.carpet),
    velvet: toon('#6d1414'),
    parchment: toon('#efe3c2'),
    candle: toon('#f3ead2'),
  };
}

/** A toon material with a picture on it (stone, flagstones, boards). */
const toonMap = (map: THREE.Texture) => new THREE.MeshToonMaterial({ color: '#ffffff', map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });

/** The hall's outside walls are this thick. */
const WALL = 0.6;

/**
 * The shell of the hall: the floor, the four walls (a doorway in the one nearest the map's door,
 * with its great doors), and the timber roof. Returns where the doorway is, which way is out through
 * it, and how to swing the doors (0 shut, 1 open).
 */
function buildShell(kit: Kit, plan: MapPlan, pal: Mats & { floorColor: string; stoneColor: string }): { doorAt: THREE.Vector3; out: Pt; swing(open: number): void } {
  const b = plan.bounds;
  const H = plan.height;
  const W = b.maxX - b.minX;
  const L = b.maxZ - b.minZ;
  const { group, still, mats } = kit;
  const floor = mesh(new THREE.PlaneGeometry(W, L), toonMap(canvasTexture(512, 512, flagstones(pal.floorColor), [W / 4, L / 4])), 0, 0, 0, false);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  group.add(floor);
  kit.colliders.push({ minX: b.minX - 1, maxX: b.maxX + 1, minZ: b.minZ - 1, maxZ: b.maxZ + 1, top: 0 });

  // Which wall the doors are in: the one nearest the door.
  const door = plan.door;
  const gaps = { west: door.x - b.minX, east: b.maxX - door.x, north: door.z - b.minZ, south: b.maxZ - door.z };
  const doorWall = (Object.keys(gaps) as (keyof typeof gaps)[]).reduce((a, k) => (gaps[k] < gaps[a] ? k : a), 'south');
  const out: Pt = doorWall === 'west' ? [-1, 0] : doorWall === 'east' ? [1, 0] : doorWall === 'north' ? [0, -1] : [0, 1];
  const T = WALL;
  const stoneTex = canvasTexture(512, 256, ashlar(pal.stoneColor, 5), [W / 4, H / 2]);
  const wallMat = (along: number) => {
    const t = stoneTex.clone();
    t.repeat.set(along / 4, H / 2);
    t.needsUpdate = true;
    return toonMap(t);
  };
  const walls: [keyof typeof gaps, number, number, number, number][] = [
    ['west', b.minX - T / 2, (b.minZ + b.maxZ) / 2, T, L + 2 * T],
    ['east', b.maxX + T / 2, (b.minZ + b.maxZ) / 2, T, L + 2 * T],
    ['north', (b.minX + b.maxX) / 2, b.minZ - T / 2, W, T],
    ['south', (b.minX + b.maxX) / 2, b.maxZ + T / 2, W, T],
  ];
  for (const [side, x, z, w, d] of walls) {
    const alongX = side === 'north' || side === 'south';
    const mat = wallMat(alongX ? w : d);
    if (side !== doorWall) {
      group.add(mesh(box(w, H, d), mat, x, H / 2, z));
      kit.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: 99 });
      continue;
    }
    // A doorway through this one: the wall either side of it, and over it.
    const u = alongX ? door.x : door.z;
    const lo = alongX ? x - w / 2 : z - d / 2;
    const hi = alongX ? x + w / 2 : z + d / 2;
    const d0 = u - DOORWAY.width / 2;
    const d1 = u + DOORWAY.width / 2;
    for (const [a, bb] of [
      [lo, d0],
      [d1, hi],
    ]) {
      const m = (a + bb) / 2;
      const span = bb - a;
      if (span <= 0) continue;
      group.add(alongX ? mesh(box(span, H, d), mat, m, H / 2, z) : mesh(box(w, H, span), mat, x, H / 2, m));
      kit.colliders.push(alongX ? { minX: a, maxX: bb, minZ: z - d / 2, maxZ: z + d / 2, top: 99 } : { minX: x - w / 2, maxX: x + w / 2, minZ: a, maxZ: bb, top: 99 });
    }
    group.add(alongX ? mesh(box(DOORWAY.width, H - DOORWAY.height, d), mat, u, (H + DOORWAY.height) / 2, z) : mesh(box(w, H - DOORWAY.height, DOORWAY.width), mat, x, (H + DOORWAY.height) / 2, u));
    // The workers come and go through it; you stay in the hall.
    kit.colliders.push(alongX ? { minX: d0, maxX: d1, minZ: z - d / 2, maxZ: z + d / 2, top: 99, fence: true } : { minX: x - w / 2, maxX: x + w / 2, minZ: d0, maxZ: d1, top: 99, fence: true });
  }
  // Skirting and a cornice round the room.
  for (const [side, x, z, w, d] of walls) {
    const alongX = side === 'north' || side === 'south';
    const inset = alongX ? [0, (side === 'north' ? 1 : -1) * (T / 2 + 0.06)] : [(side === 'west' ? 1 : -1) * (T / 2 + 0.06), 0];
    const len = alongX ? w : d;
    still.add(mesh(alongX ? box(len, 0.5, 0.14) : box(0.14, 0.5, len), mats.stoneDark, x + inset[0], 0.25, z + inset[1], false));
    still.add(mesh(alongX ? box(len, 0.35, 0.24) : box(0.24, 0.35, len), mats.stoneDark, x + inset[0], H - 0.2, z + inset[1], false));
  }
  // Outside the doors: a landing, so workers have somewhere to walk off to, and the grass beyond.
  const lx = doorWall === 'west' ? b.minX - 3 : doorWall === 'east' ? b.maxX + 3 : door.x;
  const lz = doorWall === 'north' ? b.minZ - 3 : doorWall === 'south' ? b.maxZ + 3 : door.z;
  group.add(mesh(box(Math.abs(out[0]) ? 6 : 7, 0.2, Math.abs(out[0]) ? 7 : 6), mats.stoneDark, lx, -0.1, lz));
  kit.colliders.push({ minX: lx - 3.5, maxX: lx + 3.5, minZ: lz - 3.5, maxZ: lz + 3.5, top: 0 });
  const grass = mesh(new THREE.PlaneGeometry(240, 240), toon('#5d7a3a'), (b.minX + b.maxX) / 2, -0.25, (b.minZ + b.maxZ) / 2, false);
  grass.rotation.x = -Math.PI / 2;
  group.add(grass);

  // The great doors, swinging in when someone comes up to them.
  const leaves: THREE.Group[] = [];
  const doorAt = new THREE.Vector3(doorWall === 'west' ? b.minX : doorWall === 'east' ? b.maxX : door.x, 0, doorWall === 'north' ? b.minZ : doorWall === 'south' ? b.maxZ : door.z);
  const frame = new THREE.Group();
  frame.position.copy(doorAt);
  frame.rotation.y = Math.atan2(out[0], out[1]);
  const r = DOORWAY.width * 0.7;
  const feet = DOORWAY.height - archRise(DOORWAY.width, r);
  // Each leaf is half the arch: square up to where the arch springs, then following its curve up to the point.
  const half = new THREE.Shape();
  half.moveTo(0, 0);
  half.lineTo(DOORWAY.width / 2, 0);
  const arc = new THREE.Shape();
  arc.moveTo(-DOORWAY.width / 2, 0);
  archPath(arc, DOORWAY.width, r, 0);
  const curve = arc.getPoints(12).filter((v) => v.x <= 0.001);
  for (const v of [...curve].reverse()) half.lineTo(v.x + DOORWAY.width / 2, v.y + feet);
  half.lineTo(0, 0);
  const leafGeo = new THREE.ExtrudeGeometry(half, { depth: 0.16, bevelEnabled: false, curveSegments: 12 });
  leafGeo.translate(0, 0, -0.08);
  const oak = toon('#4a2d18');
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * (DOORWAY.width / 2), 0, 0.1);
    const leaf = new THREE.Group();
    leaf.add(mesh(leafGeo, oak, 0, 0, 0));
    for (const y of [1.1, 2.6]) leaf.add(mesh(box(DOORWAY.width / 2 - 0.1, 0.12, 0.2), mats.iron, DOORWAY.width / 4, y, 0, false));
    leaf.add(mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 14), mats.iron, DOORWAY.width / 2 - 0.35, 2.0, -0.12, false));
    // The right one is the left one turned over.
    leaf.scale.x = -side;
    hinge.add(leaf);
    frame.add(hinge);
    leaves.push(hinge);
  }
  // A pointed arch of stone over the doorway, filling it in above the arch, and the jambs under it.
  frame.add(mesh(archFill(DOORWAY.width + 1, DOORWAY.height - feet + 0.4, DOORWAY.width, T + 0.24, r), mats.stoneDark, 0, feet, T / 2));
  for (const sx of [-1, 1]) frame.add(mesh(box(0.5, feet, T + 0.24), mats.stoneDark, sx * (DOORWAY.width / 2 + 0.25), feet / 2, T / 2));
  group.add(frame);

  // The roof: a truss across the hall over each pair of pillars, and boarding over them up to the ridge.
  const rise = W * 0.3;
  const pitch = Math.atan2(rise, W / 2);
  const roofWood = toonMap(canvasTexture(256, 256, boards('#3b2618'), [L / 4, W / 4]));
  for (const side of [-1, 1]) {
    const slope = mesh(box(Math.hypot(W / 2, rise) + 0.8, 0.25, L + 2 * T), roofWood, (side * W) / 4, H + rise / 2, (b.minZ + b.maxZ) / 2, false);
    slope.rotation.z = -side * pitch;
    group.add(slope);
  }
  // The gables at either end.
  for (const z of [b.minZ - T / 2, b.maxZ + T / 2]) {
    const tri = new THREE.Shape();
    tri.moveTo(-W / 2 - T, 0);
    tri.lineTo(W / 2 + T, 0);
    tri.lineTo(0, rise + 0.2);
    tri.closePath();
    group.add(mesh(new THREE.ExtrudeGeometry(tri, { depth: T, bevelEnabled: false }), mats.stone, (b.minX + b.maxX) / 2, H, z - T / 2, false));
  }
  // Over the pillars, where there are pillars, else every 6 m.
  const pillarZs = [...new Set((plan.config?.props ?? []).filter((q) => q.kind === 'pillar').map((q) => Math.round(q.z * 10) / 10))].sort((a, z) => a - z);
  const trussZs: number[] = pillarZs.length >= 2 ? pillarZs : [];
  if (!trussZs.length) for (let z = b.minZ + 3; z < b.maxZ - 1; z += 6) trussZs.push(z);
  for (const z of trussZs) {
    const t = new THREE.Group();
    t.add(mesh(box(W, 0.45, 0.4), mats.woodDark, 0, H - 0.1, 0, false));
    t.add(mesh(box(0.35, rise, 0.35), mats.woodDark, 0, H + rise / 2, 0, false));
    for (const side of [-1, 1]) {
      const rafter = mesh(box(Math.hypot(W / 2, rise), 0.35, 0.35), mats.woodDark, (side * W) / 4, H + rise / 2 - 0.15, 0, false);
      rafter.rotation.z = -side * pitch;
      t.add(rafter);
      const strut = mesh(box(Math.hypot(W / 4, rise / 2), 0.25, 0.3), mats.woodDark, (side * W) / 8, H + rise / 4, 0, false);
      strut.rotation.z = side * Math.atan2(rise / 2, W / 4);
      t.add(strut);
    }
    t.position.set((b.minX + b.maxX) / 2, 0, z);
    still.add(t);
  }
  still.add(mesh(box(0.4, 0.4, L), mats.woodDark, (b.minX + b.maxX) / 2, H + rise - 0.3, (b.minZ + b.maxZ) / 2, false));

  return {
    doorAt,
    out,
    swing(open) {
      const e = open * open * (3 - 2 * open);
      leaves.forEach((h, i) => (h.rotation.y = (i ? -1 : 1) * e * 1.4));
    },
  };
}

/** The dais at the throne's end of the hall, its steps and runner, and the throne of blades on it. Returns somewhere to sit. */
function buildDais(kit: Kit, plan: MapPlan): Interactable | undefined {
  const t = plan.throne;
  const dais = plan.dais;
  if (!t || !dais) return undefined;
  const { mats } = kit;
  const g = new THREE.Group();
  g.position.set(t.x, 0, t.z);
  g.rotation.y = t.rotY;
  // It runs 2.4 m in front of the throne (the rest behind), with its steps down from there.
  const front = 2.4;
  const stepD = 0.7;
  const top = dais.height;
  const at = (lx: number, lz: number) => [t.x + Math.cos(t.rotY) * lx + Math.sin(t.rotY) * lz, t.z - Math.sin(t.rotY) * lx + Math.cos(t.rotY) * lz] as const;
  g.add(mesh(box(dais.width, top, dais.depth), mats.stoneDark, 0, top / 2, front - dais.depth / 2));
  g.add(mesh(box(dais.width + 0.06, 0.1, 0.12), mats.gold, 0, top - 0.04, front, false));
  const [cx, cz] = at(0, front - dais.depth / 2);
  collide(kit, cx, cz, dais.width, dais.depth, t.rotY, top);
  for (let k = 1; k <= dais.steps; k++) {
    const y = (top * (dais.steps + 1 - k)) / (dais.steps + 1);
    const lz = front + (k - 0.5) * stepD;
    g.add(mesh(box(dais.width - k * 0.4, y, stepD), mats.stoneDark, 0, y / 2, lz));
    const [sx, sz] = at(0, lz);
    collide(kit, sx, sz, dais.width - k * 0.4, stepD, t.rotY, y);
    g.add(mesh(box(2.6, 0.03, stepD), mats.carpet, 0, y + 0.012, lz, false));
  }
  // A runner up the dais to the throne.
  g.add(mesh(box(2.6, 0.03, front + 0.2), mats.carpet, 0, top + 0.012, front / 2 - 0.1, false));
  for (const sx of [-1, 1]) g.add(mesh(box(0.12, 0.035, front + dais.steps * stepD), mats.gold, sx * 1.2, top + 0.014, (front + dais.steps * stepD) / 2 - 0.2, false));
  const iron = ironThrone(mats);
  iron.position.set(0, top, 0);
  g.add(iron);
  kit.group.add(g);
  collide(kit, t.x - Math.sin(t.rotY) * 0.2, t.z - Math.cos(t.rotY) * 0.2, THRONE_SIZE.width, THRONE_SIZE.depth, t.rotY, 99);
  const seat: Interactable = { kind: 'seat', seatId: t.id, x: t.x, y: t.y, z: t.z, radius: 1.7 };
  iron.userData.interact = seat;
  kit.interactables.push(seat);
  return seat;
}

/** The long tables and their benches, as the plan has them, with candles down the middle. */
function buildTables(kit: Kit, plan: MapPlan) {
  const { mats } = kit;
  for (const t of plan.tables) {
    const g = new THREE.Group();
    g.position.set(t.x, 0, t.z);
    g.rotation.y = t.rotY;
    // Along local z; the benches along its sides.
    g.add(mesh(roundedBox(t.width, 0.1, t.length, 0.05), mats.wood, 0, TABLE_TOP - 0.05, 0));
    g.add(mesh(box(0.16, 0.12, t.length - 0.8), mats.woodDark, 0, 0.22, 0));
    const legs = Math.max(2, Math.round(t.length / 3.2) + 1);
    for (let i = 0; i < legs; i++) {
      const lz = -t.length / 2 + 0.35 + (i * (t.length - 0.7)) / (legs - 1);
      g.add(mesh(box(t.width - 0.3, TABLE_TOP - 0.1, 0.12), mats.woodDark, 0, (TABLE_TOP - 0.1) / 2, lz));
    }
    // Candles down the middle, between the places.
    for (let i = 0; i < t.seats - 1; i++) {
      const lz = (i + 1 - t.seats / 2) * (t.length / t.seats);
      g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.05, 8), mats.iron, 0, TABLE_TOP + 0.025, lz, false));
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), mats.candle, 0, TABLE_TOP + 0.16, lz, false));
      flame(kit, g, 0, TABLE_TOP + 0.28, lz, 0.08);
    }
    for (const s of t.sides) {
      const bx = s * (t.width / 2 + BENCH_OUT);
      g.add(mesh(roundedBox(0.44, 0.08, t.length - 0.2, 0.03), mats.wood, bx, BENCH_TOP - 0.04, 0));
      for (let i = 0; i < legs; i++) {
        const lz = -t.length / 2 + 0.4 + (i * (t.length - 0.8)) / (legs - 1);
        g.add(mesh(box(0.34, BENCH_TOP - 0.08, 0.08), mats.woodDark, bx, (BENCH_TOP - 0.08) / 2, lz));
      }
      collide(kit, t.x + Math.cos(t.rotY) * bx, t.z - Math.sin(t.rotY) * bx, 0.44, t.length - 0.2, t.rotY, BENCH_TOP);
    }
    kit.group.add(g);
    collide(kit, t.x, t.z, t.width, t.length, t.rotY, TABLE_TOP);
  }
}

/** A place at a table: its tome, the worker on the bench, a plate and a goblet, and the '+' while it's free. */
function placeSetting(kit: Kit, def: DeskDef, overflow: boolean): { view: DeskView; it: Interactable } {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, TABLE_TOP, -0.02);
  laptopAnchor.scale.setScalar(1.1);
  g.add(laptopAnchor);
  // On the bench, facing the table.
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, BENCH_TOP - 0.08, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  g.add(seatAnchor);
  // Up on the table beside the tome.
  const stage = new THREE.Object3D();
  stage.position.set(0.66, TABLE_TOP - 0.07, 0.12);
  g.add(stage);
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.02, 14), toon('#8d939c'), -0.62, TABLE_TOP + 0.01, 0.12, false));
  g.add(mesh(new THREE.CylinderGeometry(0.045, 0.03, 0.14, 8), kit.mats.gold, -0.62, TABLE_TOP + 0.08, -0.12, false));
  const vacancy = vacancyMarker(1.35);
  g.add(vacancy);
  // An overflow seat is put away until they're all taken (see setBeanbags).
  g.visible = !overflow;
  const it: Interactable = { kind: 'desk', deskId: def.id, ...xz(deskSeat(def, 1.25)), radius: 1.3, off: overflow };
  kit.interactables.push(it);
  g.userData.interact = it;
  kit.group.add(g);
  return { view: { def, group: g, laptopAnchor, seatAnchor, stage, chair: new THREE.Group(), vacancy, vacancyY: 1.35 }, it };
}

/** The round meeting table, its chairs, and the easel with the meeting's board and sign. */
function buildCouncil(kit: Kit, plan: MapPlan): { board?: THREE.Mesh; sign?: THREE.Mesh } {
  const cp = plan.council;
  if (!cp) return {};
  const { mats } = kit;
  const t = new THREE.Group();
  t.position.set(cp.x, 0, cp.z);
  t.add(mesh(new THREE.CylinderGeometry(COUNCIL.radius, COUNCIL.radius, 0.1, 32), mats.wood, 0, COUNCIL.height - 0.05, 0));
  t.add(mesh(new THREE.TorusGeometry(COUNCIL.radius, 0.04, 6, 32).rotateX(Math.PI / 2), mats.gold, 0, COUNCIL.height - 0.05, 0, false));
  t.add(mesh(new THREE.CylinderGeometry(0.18, 0.28, COUNCIL.height - 0.1, 10), mats.woodDark, 0, (COUNCIL.height - 0.1) / 2, 0));
  t.add(mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.08, 14), mats.woodDark, 0, 0.04, 0));
  // A map of the realm on the table.
  const chart = mesh(new THREE.CircleGeometry(0.55, 24), mats.parchment, 0, COUNCIL.height + 0.006, 0, false);
  chart.rotation.x = -Math.PI / 2;
  t.add(chart);
  kit.group.add(t);
  // A square inside the round top, so its corners don't stick out past the edge.
  const r = COUNCIL.radius * Math.SQRT1_2;
  kit.colliders.push({ minX: cp.x - r, maxX: cp.x + r, minZ: cp.z - r, maxZ: cp.z + r, top: COUNCIL.height });
  const meeting: Interactable = { kind: 'meeting', x: cp.x, z: cp.z, radius: 2.2 };
  t.userData.interact = meeting;
  kit.interactables.push(meeting);
  for (const def of plan.meeting) kit.desks.set(def.id, councilChair(kit, def));
  // An easel behind the table, away from its head, with the meeting's board and how it's going.
  const easel = new THREE.Group();
  easel.position.set(cp.x - Math.sin(cp.rotY) * COUNCIL.easel, 0, cp.z - Math.cos(cp.rotY) * COUNCIL.easel);
  easel.rotation.y = cp.rotY;
  for (const sx of [-1, 1]) {
    const leg = mesh(box(0.1, 2.9, 0.1), mats.woodDark, sx * 1.05, 1.42, 0);
    leg.rotation.z = sx * -0.05;
    easel.add(leg);
  }
  easel.add(mesh(box(0.1, 2.5, 0.1), mats.woodDark, 0, 1.2, -0.45));
  easel.add(mesh(box(2.5, 1.6, 0.08), mats.woodDark, 0, 1.95, 0.02));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.4), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  board.position.set(0, 1.95, 0.07);
  easel.add(board);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.34), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  sign.position.set(0, 0.92, 0.07);
  easel.add(mesh(box(1.3, 0.42, 0.06), mats.woodDark, 0, 0.92, 0.02));
  easel.add(sign);
  const title = textPlane('🤝 The small council', { bg: '#efe3c2', size: 56 });
  title.scale.multiplyScalar(0.62);
  title.position.set(0, 2.98, 0.06);
  easel.add(title);
  easel.userData.interact = meeting;
  kit.group.add(easel);
  const [minX, maxX, minZ, maxZ] = boxFootprint(easel.position.x, easel.position.z, 2.6, 0.5, cp.rotY);
  kit.colliders.push({ minX, maxX, minZ, maxZ, top: 99 });
  return { board, sign };
}

/** The four boards, framed in wood and iron on the walls, with a painted sign over each. */
function buildBoards(kit: Kit, plan: MapPlan): Record<BoardKey, THREE.Mesh> {
  const { mats } = kit;
  const faces = {} as Record<BoardKey, THREE.Mesh>;
  for (const k of BOARD_KEYS) {
    const bd = plan.boards[k];
    const nx = Math.sin(bd.rotY);
    const nz = Math.cos(bd.rotY);
    const g = new THREE.Group();
    g.position.set(bd.x + nx * 0.1, bd.y, bd.z + nz * 0.1);
    g.rotation.y = bd.rotY;
    g.add(mesh(box(bd.width + 0.36, bd.height + 0.36, 0.12), mats.woodDark, 0, 0, 0));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(mesh(box(0.3, 0.3, 0.05), mats.iron, sx * (bd.width / 2 + 0.05), sy * (bd.height / 2 + 0.05), 0.08, false));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bd.width, bd.height), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    face.position.z = 0.07;
    g.add(face);
    faces[k] = face;
    const label = textPlane(bd.label, { bg: '#efe3c2', color: '#3b2618', size: 64, border: '#6b4526' });
    label.scale.multiplyScalar(1.15);
    label.position.set(0, bd.height / 2 + 0.55, 0.06);
    g.add(label);
    const it: Interactable = { kind: k, x: bd.x + nx * 1.6, z: bd.z + nz * 1.6, radius: 2.4 };
    kit.interactables.push(it);
    g.userData.interact = it;
    kit.group.add(g);
  }
  return faces;
}

/** The herald (the Hand of the King), in a robe of office with a gold chain, where the plan has him. */
function buildHerald(kit: Kit, plan: MapPlan): World['herald'] {
  const hd = plan.herald;
  if (!hd) return undefined;
  const person = new Person(hd.name, '#1f4d3a', { skin: 2, hair: 5, style: 0 });
  const y = kit.floorAt(hd.x, hd.z);
  person.root.position.set(hd.x, y, hd.z);
  person.root.rotation.y = hd.rotY;
  person.setLabel(hd.name, null);
  person.setDoing(hd.says);
  const robe = mesh(
    new THREE.LatheGeometry(
      [
        [0.36, 0.02],
        [0.3, 0.5],
        [0.27, 0.95],
      ].map(([r, yy]) => new THREE.Vector2(r, yy)),
      20,
    ),
    toon('#1f4d3a'),
  );
  person.root.add(robe);
  const chain = mesh(new THREE.TorusGeometry(0.24, 0.025, 6, 20), kit.mats.gold, 0, 0.98, 0.04, false);
  chain.rotation.x = Math.PI / 2 - 0.35;
  person.root.add(chain);
  // The pin of his office.
  person.root.add(mesh(box(0.1, 0.12, 0.03), kit.mats.gold, 0.1, 0.86, 0.27, false));
  kit.group.add(person.root);
  const interactable: Interactable = { kind: 'herald', x: hd.x + Math.sin(hd.rotY) * 0.9, y, z: hd.z + Math.cos(hd.rotY) * 0.9, radius: 1.9 };
  person.root.userData.interact = interactable;
  kit.interactables.push(interactable);
  kit.colliders.push({ minX: hd.x - 0.35, maxX: hd.x + 0.35, minZ: hd.z - 0.35, maxZ: hd.z + 0.35, top: 99 });
  return { person, interactable };
}

/** Puts up the hall in `plan` (a castle-style map). */
export function buildCastle(plan: MapPlan): World {
  const c = plan.config!;
  const b = plan.bounds;
  const H = plan.height;
  const pal = { stone: '#9a9186', floor: '#7b746a', carpet: '#8e1b1b', wood: '#6b4526', trim: '#d9ab2e', ...(c.palette ?? {}) };
  const group = new THREE.Group();
  const kit: Kit = {
    group,
    still: new THREE.Group(),
    colliders: [],
    interactables: [],
    flames: [],
    lights: [],
    mats: materials(pal),
    height: H,
    desks: new Map(),
    glass: [],
    banners: [],
    shields: [],
    windows: 1,
    floorAt(x, z) {
      let top = 0;
      for (const cc of kit.colliders) if (cc.top < 50 && !cc.fence && cc.top > top && x > cc.minX && x < cc.maxX && z > cc.minZ && z < cc.maxZ) top = cc.top;
      return top;
    },
  };

  const shell = buildShell(kit, plan, { ...kit.mats, floorColor: pal.floor, stoneColor: pal.stone });
  // The dais before the props, so what stands on it stands on its top (see Kit.floorAt).
  buildDais(kit, plan);
  const props = c.props ?? [];
  for (const p of props) PROPS[p.kind as PropKind](kit, p);
  arcade(
    kit,
    props.filter((p) => p.kind === 'pillar'),
  );
  buildTables(kit, plan);
  const overflow = new Map<string, Interactable>();
  for (const def of plan.desks) kit.desks.set(def.id, placeSetting(kit, def, false).view);
  for (const def of plan.overflow) {
    const { view, it } = placeSetting(kit, def, true);
    kit.desks.set(def.id, view);
    overflow.set(def.id, it);
  }
  for (const def of plan.stations) kit.desks.set(def.id, lectern(kit, def));
  const council = buildCouncil(kit, plan);
  const boardMeshes = buildBoards(kit, plan);
  const herald = buildHerald(kit, plan);
  group.add(mergeByMaterial(kit.still));

  // Walking about: in through the doors and out again, round what's in the way.
  const nav = new NavGrid(b, plan.obstacles!);
  const { doorAt, out } = shell;
  const inside: Pt = [plan.door.x, plan.door.z];
  const threshold: Pt = [doorAt.x + out[0] * 0.2, doorAt.z + out[1] * 0.2];
  const beyond: Pt = [doorAt.x + out[0] * 3, doorAt.z + out[1] * 3];
  let doorOpen = 0;

  // How the day's light and the fires light the room: see mood.
  const warmSky = new THREE.Color('#ffe2bc');
  const warmGround = new THREE.Color('#4a3322');
  const haze = new THREE.Color('#2a1e16');
  const glassDay = new THREE.Color('#ffffff');
  const glassNight = new THREE.Color('#5a4a6a');

  // What setLook and setProjectName were last told, which the great banner shows.
  let name = '';
  let look: FloorPalette = { name: '', wall: pal.stone, trim: '#9b1c1c', floor: pal.floor, floorAlt: pal.floor, seam: pal.floor };
  const repaint = () => {
    for (const bn of kit.banners) {
      paintBanner(bn.tex.image.getContext('2d') as CanvasRenderingContext2D, bn.w, bn.h, heraldry(look), bn.great ? name : undefined);
      bn.tex.needsUpdate = true;
    }
    for (const s of kit.shields) s.color.set(heraldry(look));
  };
  const gongAt = kit.gong?.top;

  return {
    plan,
    group,
    colliders: kit.colliders,
    interactables: kit.interactables,
    pickables: [group],
    desks: kit.desks,
    boardMeshes,
    meetingBoard: council.board,
    meetingSign: council.sign,
    gong: kit.gong,
    nav,
    ways: {
      home: (seat, from) => ({ way: [...(from ? nav.route(from, inside) : nav.wayFrom(seat, inside)), threshold, beyond], chute: false }),
      in: (seat) => [beyond, threshold, ...nav.wayTo(inside, seat)],
    },
    rain: [{ area: b, top: () => Math.min(H - 1, 9) }],
    device: 'tome',
    room: { wall: WALL, enclosed: true },
    acoustics: {
      gong: gongAt ? { x: gongAt.x, y: gongAt.y - 1.8, z: gongAt.z } : null,
      windows: props.filter((p) => p.kind === 'window').map((p) => ({ x: p.x, y: (p.y ?? 6) + (p.height ?? 5) / 2, z: p.z })),
    },
    herald,
    setBeanbags(outNow) {
      for (const [id, it] of overflow) {
        const show = outNow.has(id);
        kit.desks.get(id)!.group.visible = show;
        it.off = !show;
      }
      return [];
    },
    setLook(p) {
      // The banners and shields take the floor's own color, so each project's hall is its own.
      look = p;
      repaint();
    },
    setProjectName(n) {
      if (n === name) return;
      name = n;
      repaint();
    },
    update(t, dt, people) {
      for (const f of kit.flames) {
        const k = 0.85 + 0.12 * Math.sin(t * 13 + f.phase) + 0.08 * Math.sin(t * 29 + f.phase * 2);
        f.mesh.scale.set(f.size * (0.95 + 0.08 * Math.sin(t * 17 + f.phase)), f.size * k, f.size * (0.95 + 0.08 * Math.cos(t * 19 + f.phase)));
        f.mesh.rotation.y = t * 2 + f.phase;
        f.glow.material.opacity = 0.55 + 0.25 * k;
      }
      for (const l of kit.lights) l.light.intensity = l.base * (0.82 + 0.1 * Math.sin(t * 11 + l.phase) + 0.08 * Math.sin(t * 23 + l.phase * 3));
      // The doors swing in for anyone coming up to them, from either side.
      let near = false;
      for (const q of people) if (Math.hypot(q.x - doorAt.x, q.z - doorAt.z) < 4) near = true;
      const want = near ? 1 : 0;
      if (doorOpen !== want) {
        doorOpen = want > doorOpen ? Math.min(1, doorOpen + dt * 1.2) : Math.max(0, doorOpen - dt * 0.8);
        shell.swing(doorOpen);
      }
      for (const d of kit.desks.values()) {
        if (!d.vacancy.visible || !d.group.visible || d.def.station) continue;
        d.vacancy.position.y = d.vacancyY + Math.sin(t * 2 + d.def.x) * 0.06;
        d.vacancy.rotation.y = t * 1.2;
      }
      kit.gong?.update(dt);
      herald?.person.update(dt, t, false, false);
    },
    mood(lights, daylight) {
      // Torchlit: a warm, dim hall whatever the weather, a little brighter by day through the glass.
      lights.hemi.color.copy(warmSky);
      lights.hemi.groundColor.copy(warmGround);
      lights.hemi.intensity = 0.45 + 0.4 * daylight;
      lights.ambient.color.copy(warmSky);
      lights.ambient.intensity = 0.24 + 0.12 * daylight;
      lights.sun.intensity *= 0.4;
      const fog = lights.scene.fog as THREE.Fog | null;
      if (fog) {
        fog.color.copy(haze);
        fog.near = 45;
        fog.far = 140;
      }
      for (const g of kit.glass) g.color.copy(glassNight).lerp(glassDay, 0.25 + 0.75 * daylight);
    },
    dispose() {
      // Its geometry, and every material with a picture of its own (walls, banners, glass, signs); the
      // cached toon materials are everyone's, and stay.
      const freed = new Set<THREE.Material>();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
          const map = (mat as THREE.MeshBasicMaterial).map;
          if (!map || freed.has(mat)) continue;
          map.dispose();
          mat.dispose();
          freed.add(mat);
        }
      });
    },
  };
}

const xz = (p: { x: number; z: number }) => ({ x: p.x, z: p.z });

/** A floor's colors as heraldry: its trim's hue, deep and rich, for the banners and the shields. */
function heraldry(p: FloorPalette): string {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(p.trim).getHSL(hsl);
  return `#${new THREE.Color().setHSL(hsl.h, 0.62, 0.3).getHexString()}`;
}

const LECTERN_SIGN: Record<StationKind, string> = { issues: '📜 Ask me', pulls: '🔀 Ask me', queue: '📋 Ask me' };

/** A board agent's lectern (a scribe's desk): the agent stands behind it, as at the office's kiosk. */
function lectern(kit: Kit, def: DeskDef): DeskView {
  const kind = def.station!;
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const { woodDark, wood, parchment } = kit.mats;
  g.add(mesh(box(0.5, 0.06, 0.4), woodDark, 0, 0.03, 0));
  g.add(mesh(box(0.14, 0.95, 0.14), woodDark, 0, 0.5, 0));
  const top = new THREE.Group();
  top.position.set(0, 1.0, 0);
  top.rotation.x = 0.35;
  top.add(mesh(box(KIOSK.width, 0.06, KIOSK.depth), wood, 0, 0, 0));
  // An open book on it, its pages facing whoever walks up (-z, the room).
  for (const sx of [-1, 1]) {
    const pg = mesh(box(0.28, 0.03, 0.36), parchment, sx * 0.15, 0.045, 0, false);
    pg.rotation.z = sx * 0.08;
    top.add(pg);
  }
  top.add(mesh(box(0.02, 0.2, 0.02), toon('#f3ead2'), 0.3, 0.1, 0.15, false));
  g.add(top);
  // The agent's color on a cloth over the front, and a sign.
  g.add(mesh(box(0.42, 0.55, 0.02), toon(STATION_AGENT[kind].color), 0, 0.62, -0.09, false));
  const sign = textPlane(LECTERN_SIGN[kind], { bg: '#efe3c2', size: 56 });
  sign.scale.multiplyScalar(0.55);
  sign.position.set(0, 0.62, -0.11);
  sign.rotation.y = Math.PI;
  g.add(sign);
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.visible = false;
  g.add(laptopAnchor);
  // On its feet behind the lectern, facing it and the room beyond.
  const stand = new THREE.Object3D();
  stand.position.set(0, -0.07 * 1.1, KIOSK.stand);
  stand.rotation.y = Math.PI;
  stand.scale.setScalar(1.1);
  const seatAnchor = stand.clone();
  g.add(seatAnchor);
  const vacancy = new THREE.Group();
  vacancy.add(stand);
  g.add(vacancy);
  const stage = new THREE.Object3D();
  stage.position.set(0, 1.0, 0);
  stage.rotation.y = Math.PI;
  g.add(stage);
  kit.group.add(g);
  const corners = [-1, 1].flatMap((t) => [-0.25, KIOSK.stand + 0.35].map((s) => deskPoint(def, (t * KIOSK.width) / 2, s)));
  kit.colliders.push({ minX: Math.min(...corners.map((p) => p[0])), maxX: Math.max(...corners.map((p) => p[0])), minZ: Math.min(...corners.map((p) => p[1])), maxZ: Math.max(...corners.map((p) => p[1])), top: 1.5, fence: true });
  const [fx, fz] = deskPoint(def, 0, -1);
  const it: Interactable = { kind: 'station', deskId: def.id, x: fx, z: fz, radius: 1.3 };
  kit.interactables.push(it);
  g.userData.interact = it;
  return { def, group: g, laptopAnchor, seatAnchor, stage, chair: new THREE.Group(), vacancy, vacancyY: 0 };
}

/** A high-backed chair at the meeting table, with its tome on the table in front of it. */
function councilChair(kit: Kit, def: DeskDef): DeskView {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const chair = new THREE.Group();
  chair.position.set(0, 0, 0.85);
  const { woodDark, velvet, gold } = kit.mats;
  chair.add(mesh(box(0.6, 0.08, 0.56), woodDark, 0, 0.46, 0));
  chair.add(mesh(roundedBox(0.52, 0.06, 0.48, 0.04), velvet, 0, 0.52, 0, false));
  chair.add(mesh(box(0.6, 1.25, 0.08), woodDark, 0, 1.1, 0.26));
  chair.add(mesh(roundedBox(0.44, 0.7, 0.04, 0.04), velvet, 0, 1.05, 0.21, false));
  chair.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), gold, -0.28, 1.76, 0.26, false));
  chair.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), gold, 0.28, 1.76, 0.26, false));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) chair.add(mesh(box(0.07, 0.46, 0.07), woodDark, sx * 0.25, 0.23, sz * 0.22));
  g.add(chair);
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, COUNCIL.height, -0.05);
  laptopAnchor.scale.setScalar(0.95);
  g.add(laptopAnchor);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.46, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  g.add(seatAnchor);
  const stage = new THREE.Object3D();
  stage.position.set(0.45, COUNCIL.height - 0.07, -0.1);
  g.add(stage);
  const vacancy = vacancyMarker(1.45);
  g.add(vacancy);
  kit.group.add(g);
  kit.colliders.push({ minX: def.x + Math.sin(def.rotY) * 0.85 - 0.3, maxX: def.x + Math.sin(def.rotY) * 0.85 + 0.3, minZ: def.z + Math.cos(def.rotY) * 0.85 - 0.3, maxZ: def.z + Math.cos(def.rotY) * 0.85 + 0.3, top: 0.5 });
  const it: Interactable = { kind: 'desk', deskId: def.id, ...xz(deskSeat(def, 1.5)), radius: 1.1 };
  kit.interactables.push(it);
  g.userData.interact = it;
  return { def, group: g, laptopAnchor, seatAnchor, stage, chair, vacancy, vacancyY: 1.45 };
}
