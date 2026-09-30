import * as THREE from 'three';
import type { FloorPalette } from '../../shared/floors';
import { KIOSK, STATION_AGENT, deskSeat, type DeskDef, type StationKind } from '../../shared/layout';
import { BENCH_OUT, BOARD_KEYS, COUNCIL, THRONE_SIZE, type BoardKey, type MapPlan, type PropConfig } from '../../shared/maps';
import { PROP_SIZE, boxFootprint, type PropKind } from '../../shared/maps/props';
import { NavGrid, deskPoint, type Pt } from '../../shared/nav';
import { Person } from './character';
import { glowTexture } from './costumes';
import { buildGong, type Gong } from './gong';
import { vacancyMarker, type Collider, type DeskView, type Interactable } from './office';
import { canvasTexture, seeded, shade } from './textures';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon, toonUnique } from './toon';
import type { World } from './world';

/*
 * The cyberpunk style of map (see shared/maps/cyberpunk.ts for the plaza itself): a neon concourse
 * under a steel ceiling, lit by signs, holo billboards and LED strips, with the rain-slick city
 * showing through the glazing at the ends. The workers sit at console benches in the arcade, the
 * boards hang on the side walls between the shopfronts, and at the north end a chrome dais carries
 * the boss's chair, its fixer, and a wall of neon behind. Everything is placed from the map's plan,
 * so another map in this style is just other numbers.
 */

/** How thick the outside walls are. */
const WALL = 0.6;
const TABLE_TOP = 0.78;
const BENCH_TOP = 0.46;
const DOORWAY = { width: 6, height: 5.6 } as const;
/** The most neon lights that light the plaza for real (the rest just glow). */
const MAX_LIGHTS = 14;
/** The shopfronts: a wide sign is a shop's, so a doorway and its glow are built under it. */
const SHOP_W = 2.9;

// ---- Textures -------------------------------------------------------------------------------------

/** Rain-slick asphalt: dark, mottled, with a faint sheen down the middle. */
function asphalt(color: string): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(21);
    g.fillStyle = color;
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2200; i++) {
      const x = rand() * 512;
      const y = rand() * 512;
      g.fillStyle = rand() < 0.5 ? shade(color, (rand() - 0.5) * 0.16) : shade(color, rand() * 0.08);
      g.fillRect(x, y, 1 + rand() * 5, 1 + rand() * 3);
    }
    // Cracks and patch seams.
    g.strokeStyle = shade(color, -0.12);
    g.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      let x = rand() * 512;
      let y = rand() * 512;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rand() - 0.5) * 90;
        y += (rand() - 0.5) * 90;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  };
}

/** A wall of concrete panels with seams and rivets: one tile is 4 m wide and 3 m high. */
function panels(color: string, seed: number): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(seed);
    g.fillStyle = color;
    g.fillRect(0, 0, 512, 384);
    g.strokeStyle = shade(color, -0.12);
    g.lineWidth = 3;
    for (let x = 0; x <= 512; x += 128) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 384);
      g.stroke();
    }
    for (let y = 0; y <= 384; y += 192) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(512, y);
      g.stroke();
    }
    for (const [x, y] of [
      [10, 10],
      [502, 10],
      [10, 374],
      [502, 374],
    ] as const) {
      g.fillStyle = shade(color, 0.08);
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 90; i++) {
      g.fillStyle = shade(color, (rand() - 0.6) * 0.1);
      g.fillRect(rand() * 512, rand() * 384, 20 + rand() * 60, 6 + rand() * 20);
    }
  };
}

/** A neon sign: a dark board, a steel frame, and the words in glowing tubes. */
function neonSign(text: string, color: string): THREE.CanvasTexture {
  const W = 640;
  const H = 200;
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#0b0d13';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#39404e';
    g.lineWidth = 8;
    g.strokeRect(4, 4, W - 8, H - 8);
    g.font = '900 104px Nunito, ui-rounded, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // The glow of the tubes, then their bright core.
    g.shadowColor = color;
    g.shadowBlur = 40;
    g.fillStyle = color;
    g.fillText(text, W / 2, H / 2 + 6);
    g.shadowBlur = 20;
    g.fillText(text, W / 2, H / 2 + 6);
    g.shadowBlur = 0;
    g.globalAlpha = 0.9;
    g.fillStyle = '#ffffff';
    g.font = '900 96px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText(text, W / 2, H / 2 + 6);
    g.globalAlpha = 1;
  });
}

/** A holographic billboard: bands of ads and glyphs that scroll, the way a holo-loop does. */
function billboard(seed: number): THREE.CanvasTexture {
  const W = 512;
  const H = 512;
  const t = canvasTexture(W, H, (g) => {
    const rand = seeded(seed);
    const cols = ['#ff2c9c', '#2de2e6', '#ffd60a', '#39ff88', '#a06bff'];
    g.fillStyle = '#070810';
    g.fillRect(0, 0, W, H);
    let y = 0;
    while (y < H) {
      const kind = Math.floor(rand() * 3);
      const h = 70 + rand() * 90;
      const c = cols[Math.floor(rand() * cols.length)];
      if (kind === 0) {
        // A band of glyphs.
        for (let x = 14; x < W - 40; x += 54) {
          g.strokeStyle = c;
          g.lineWidth = 6;
          g.strokeRect(x, y + 14, 36, 36);
          g.beginPath();
          g.moveTo(x + 8, y + 32);
          g.lineTo(x + 28, y + 32);
          g.moveTo(x + 18, y + 22);
          g.lineTo(x + 18, y + 44);
          g.stroke();
        }
      } else if (kind === 1) {
        // A big word.
        g.font = `900 ${Math.floor(h * 0.6)}px Nunito, ui-rounded, system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.shadowColor = c;
        g.shadowBlur = 26;
        g.fillStyle = c;
        g.fillText(['SYNTH', 'NEON', 'CHROME', 'GRID', 'VOID', 'KROME'][Math.floor(rand() * 6)], W / 2, y + h / 2);
        g.shadowBlur = 0;
      } else {
        // A product: a glossy box with a price.
        g.fillStyle = shade(c, -0.25);
        g.fillRect(40, y + 10, 150, h - 20);
        g.fillStyle = c;
        g.fillRect(46, y + 16, 138, 14);
        g.font = '900 40px Nunito, ui-rounded, system-ui, sans-serif';
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillStyle = '#ffffff';
        g.fillText(`${Math.floor(rand() * 900) + 99}€`, 220, y + h / 2);
      }
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(0, y + h - 4, W, 4);
      y += h;
    }
    // Scanlines.
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** The city outside: towers of lit windows and neon, on a purple night. */
function skyline(): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(77);
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#120a24');
    grad.addColorStop(0.55, '#2a1240');
    grad.addColorStop(1, '#4a1b52');
    g.fillStyle = grad;
    g.fillRect(0, 0, 2048, 512);
    for (let i = 0; i < 340; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.6})`;
      g.fillRect(rand() * 2048, rand() * 180, 1 + rand() * 2, 1 + rand() * 2);
    }
    // Two rows of towers, the far ones dim.
    for (const far of [true, false]) {
      for (let x = -40; x < 2048; ) {
        const w = 40 + rand() * 90;
        const h = (far ? 130 : 190) + rand() * (far ? 130 : 230);
        const base = far ? 330 : 470;
        const c = far ? shade('#2b2440', rand() * 0.06) : shade('#151222', rand() * 0.08);
        g.fillStyle = c;
        g.fillRect(x, base - h, w, h + 60);
        // Lit windows.
        for (let wy = base - h + 10; wy < base - 10; wy += 14) {
          for (let wx = x + 5; wx < x + w - 8; wx += 12) {
            if (rand() < 0.42) {
              g.fillStyle = ['#ffd9a0', '#9fe8ff', '#ff9fd0', '#fff3c0'][Math.floor(rand() * 4)];
              g.globalAlpha = 0.5 + rand() * 0.5;
              g.fillRect(wx, wy, 5, 7);
            }
          }
        }
        g.globalAlpha = 1;
        // A neon band or a sign on some of them.
        if (!far && rand() < 0.4) {
          g.fillStyle = ['#ff2c9c', '#2de2e6', '#ffd60a'][Math.floor(rand() * 3)];
          g.shadowColor = g.fillStyle as string;
          g.shadowBlur = 18;
          g.fillRect(x + 4, base - h + 8, w - 8, 10);
          g.shadowBlur = 0;
        }
        if (!far && rand() < 0.3) {
          g.fillStyle = '#ff2c9c';
          g.fillRect(x + w * 0.3, base - h - 26, w * 0.4, 18);
        }
        x += w + 8 + rand() * 40;
      }
    }
    // Haze along the street.
    const haze = g.createLinearGradient(0, 340, 0, 512);
    haze.addColorStop(0, 'rgba(120,40,140,0)');
    haze.addColorStop(1, 'rgba(160,60,150,0.5)');
    g.fillStyle = haze;
    g.fillRect(0, 340, 2048, 172);
  };
}

/** A tower face: rows of lit windows, for the boxes just outside the glass. */
function towerFace(color: string, seed: number): THREE.CanvasTexture {
  return canvasTexture(256, 512, (g) => {
    const rand = seeded(seed);
    g.fillStyle = color;
    g.fillRect(0, 0, 256, 512);
    for (let y = 8; y < 500; y += 24) {
      for (let x = 8; x < 248; x += 20) {
        if (rand() < 0.34) {
          g.fillStyle = ['#ffd9a0', '#9fe8ff', '#ff9fd0'][Math.floor(rand() * 3)];
          g.globalAlpha = 0.35 + rand() * 0.6;
          g.fillRect(x, y, 10, 12);
        }
      }
    }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 3;
    for (let y = 0; y < 512; y += 48) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y);
      g.stroke();
    }
  });
}

/** A plasteel barrier's hazard face. */
function hazard(color: string): THREE.CanvasTexture {
  return canvasTexture(256, 64, (g) => {
    g.fillStyle = '#1a1d24';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = color;
    for (let x = -64; x < 256; x += 48) {
      g.beginPath();
      g.moveTo(x, 64);
      g.lineTo(x + 24, 0);
      g.lineTo(x + 48, 0);
      g.lineTo(x + 24, 64);
      g.closePath();
      g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 28, 256, 8);
  });
}

// ---- Materials, glow and the kit ------------------------------------------------------------------

export interface CyberMats {
  wall: THREE.Material;
  floor: THREE.Material;
  /** Painted steel: the dais, the frames, the gantry. */
  steel: THREE.Material;
  steelDark: THREE.Material;
  /** The benches and consoles. */
  dark: THREE.Material;
  darkAlt: THREE.Material;
  /** Anything that glows for real. */
  neon: (color: string) => THREE.MeshToonMaterial;
  white: THREE.Material;
  gold: THREE.Material;
  seat: THREE.Material;
}

/** A bright, unlit-looking material: the tower is emissive so it reads as a tube, not a painted strip. */
function neonMat(color: string): THREE.MeshToonMaterial {
  const m = toonUnique(color);
  m.emissive.set(color);
  m.emissiveIntensity = 1.15;
  m.userData.outlineParameters = { visible: false };
  return m;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** A toon material with a picture on it (asphalt, panels). */
const toonMap = (map: THREE.Texture) => new THREE.MeshToonMaterial({ color: '#ffffff', map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
/** A flat, unlit material with a picture on it (a sign's glowing face, a billboard). */
const flatMap = (map: THREE.Texture, opts: { transparent?: boolean } = {}) =>
  new THREE.MeshBasicMaterial({ map, transparent: !!opts.transparent, side: THREE.DoubleSide, toneMapped: false });

/** An unlit material for something that must not be dimmed by the night (a neon tube, a hologram). */
function flat(color: string, opacity = 1): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false });
  m.userData.outlineParameters = { visible: false };
  return m;
}

const GLASS = new THREE.MeshBasicMaterial({ color: '#a9d4ff', transparent: true, opacity: 0.11, depthWrite: false, side: THREE.DoubleSide });

/** A cylinder from `a` to `b` (a beam, a railing post, a neon tube). */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, shadow = false): THREE.Mesh {
  const along = b.clone().sub(a);
  const m = mesh(new THREE.CylinderGeometry(r, r, along.length(), 6), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, shadow);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize());
  return m;
}

/** A glowing tube between two points on the same plane: the plaza's neon. */
function tube(parent: THREE.Object3D, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, mat: THREE.Material) {
  parent.add(rod(new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz), r, mat));
}

/** What the builder hands the props: where to put meshes, what's in the way, and what animates. */
interface Kit {
  /** The top of whatever the floor is at (x, z): the dais, or the floor. */
  floorAt(x: number, z: number): number;
  group: THREE.Group;
  /** Merged into a few draw calls at the end: whatever never moves. */
  still: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  mats: CyberMats;
  height: number;
  /** The plaza's footprint, for the shell's spans. */
  bounds: MapPlan['bounds'];
  /** The floor's own color: the plaza's neon, and every project's floor paints itself with it. */
  ledColor: string;
  /** The columns the map asked for, for the gantry over them. */
  pillars: { x: number; z: number }[];
  /** The rain over the city, seen through the glass. */
  rain?: { lines: THREE.LineSegments; pos: Float32Array; homes: number[][]; n: number };
  /** Every seat by id, as it's built. */
  desks: Map<string, DeskView>;
  /** What paints itself over later, in a floor's own color: the ad boards. */
  banners: { tex: THREE.CanvasTexture; w: number; h: number; great: boolean }[];
  /** The plaza's holograms, signs and lights, animated each frame. */
  holos: Holo[];
  screens: Screen[];
  neons: Neon[];
  flames: Flame[];
  steam?: Steam;
  gong?: Gong;
}

/** A flame: cones that flicker, with their glow. */
interface Flame {
  group: THREE.Object3D;
  glow: THREE.Sprite;
  size: number;
  phase: number;
}

const FLAME_OUTER = new THREE.ConeGeometry(0.45, 1, 8).translate(0, 0.5, 0);
const FLAME_INNER = new THREE.ConeGeometry(0.25, 0.7, 8).translate(0, 0.35, 0);
const FLAME_OUT = new THREE.MeshBasicMaterial({ color: '#ff8c2a', toneMapped: false });
const FLAME_IN = new THREE.MeshBasicMaterial({ color: '#ffe38a', toneMapped: false });
FLAME_OUT.userData.outlineParameters = { visible: false };
FLAME_IN.userData.outlineParameters = { visible: false };

/** A hologram hanging over its projector. */
interface Holo {
  group: THREE.Group;
  core: THREE.Object3D;
  cone: THREE.Mesh;
  glow: THREE.Sprite;
  color: THREE.Color;
  phase: number;
  /** The height its core turns at (a floor projector's, or the meeting table's). */
  baseY: number;
}

/** A billboard's picture, scrolled and flickered. */
interface Screen {
  tex: THREE.CanvasTexture;
  /** How fast the picture scrolls (0: it just flickers). */
  speed: number;
  base: THREE.MeshBasicMaterial;
}

/** A neon light, its color pulsing. */
interface Neon {
  light: THREE.PointLight;
  base: number;
  phase: number;
  color: THREE.Color;
}

/** The steam off the street grates: one drift of points over them all. */
class Steam {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private pos: Float32Array;
  private home: number[] = [];
  private phases: number[] = [];
  private n = 0;

  constructor(private max: number) {
    this.pos = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ size: 1.1, map: glowTexture(), color: '#cfe6ff', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.userData.outlineParameters = { visible: false };
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** A grate at (x, y, z) lets off `per` drifting puffs. */
  add(x: number, y: number, z: number, per = 14) {
    for (let i = 0; i < per && this.n < this.max; i++, this.n++) {
      this.home.push(x, y, z);
      this.phases.push(i / per + Math.random() * 0.08);
    }
  }

  update(t: number) {
    for (let i = 0; i < this.n; i++) {
      const k = (this.phases[i] + t * 0.14) % 1;
      const spread = 0.1 + k * 1.1;
      this.pos[i * 3] = this.home[i * 3] + Math.sin(this.phases[i] * 40 + t * 0.6) * spread;
      this.pos[i * 3 + 1] = this.home[i * 3 + 1] + k * 2.6;
      this.pos[i * 3 + 2] = this.home[i * 3 + 2] + Math.cos(this.phases[i] * 31 + t * 0.5) * spread;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

/** A neon light at (x, y, z) (in `parent`), while there are few enough of them. */
function neonLight(kit: Kit, parent: THREE.Object3D, x: number, y: number, z: number, color: string, power: number) {
  if (kit.neons.length >= MAX_LIGHTS) return;
  const light = new THREE.PointLight(color, power, 20, 1.7);
  light.position.set(x, y, z);
  parent.add(light);
  kit.neons.push({ light, base: power, phase: Math.random() * 10, color: new THREE.Color(color) });
}

// ---- The props ------------------------------------------------------------------------------------

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

const signText = (p: PropConfig, fallback: string) => (p.text ?? fallback).slice(0, 24);

/** An ad board in a floor's color, with the project's name on it when it's the big one. */
function paintAd(g: CanvasRenderingContext2D, w: number, h: number, color: string, name?: string) {
  g.fillStyle = '#0a0c12';
  g.fillRect(0, 0, w, h);
  g.fillStyle = color;
  g.fillRect(0, 0, w, h * 0.06);
  g.fillRect(0, h * 0.94, w, h * 0.06);
  g.font = `900 ${Math.floor(h * (name ? 0.6 : 0.42))}px Nunito, ui-rounded, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 26;
  g.fillStyle = color;
  g.fillText((name || 'NIGHT CITY').toUpperCase(), w / 2, h / 2);
  g.shadowBlur = 0;
  g.globalAlpha = 0.85;
  g.fillStyle = '#ffffff';
  g.fillText((name || 'NIGHT CITY').toUpperCase(), w / 2, h / 2);
  g.globalAlpha = 1;
}

/** A steel column, floor to ceiling, with an LED strip up its face and a hazard cuff at the foot. */
function column(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const w = PROP_SIZE.pillar * s;
  const H = kit.height;
  const g = placed(p, 0);
  const { steel, steelDark } = kit.mats;
  g.add(mesh(box(w * 1.15, 0.5, w * 1.15), steelDark, 0, 0.25, 0));
  g.add(mesh(box(w, H - 1, w), steel, 0, 0.5 + (H - 1) / 2, 0));
  g.add(mesh(box(w * 1.2, 0.4, w * 1.2), steelDark, 0, H - 0.6, 0));
  g.add(mesh(box(w * 1.2, 0.4, w * 1.2), steelDark, 0, H - 0.2, 0));
  // An LED strip up the face and round the foot, in the floor's own color when it's the plaza's.
  const led = kit.mats.neon(kit.ledColor);
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const strip = mesh(box(dx ? 0.06 : w * 0.7, H - 1.4, dz ? 0.06 : w * 0.7), led, dx * w * 0.54, 0.5 + (H - 1) / 2, dz * w * 0.54, false);
    g.add(strip);
  }
  kit.still.add(g);
  collide(kit, p.x, p.z, w * 1.2, w * 1.2, 0, 99);
}

/** A neon sign on a wall, with its tubes, its glow, and a shopfront under a wide one. */
function neonSignProp(kit: Kit, p: PropConfig) {
  const w = p.width ?? 1.6;
  const h = p.height ?? 0.9;
  const y = p.y ?? 3.4;
  const color = p.color ?? '#ff2c9c';
  const g = placed(p);
  g.position.y = y;
  const { steelDark, neon } = kit.mats;
  // The board, its steel frame, and its glowing face.
  g.add(mesh(box(w + 0.16, h + 0.16, 0.1), steelDark, 0, -h / 2, 0));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flatMap(neonSign(signText(p, 'NEON'), color)));
  face.position.set(0, -h / 2, 0.06);
  g.add(face);
  // A tube round the board's edge, and one over its top.
  const tubeMat = neon(color);
  tube(g, -w / 2 - 0.1, -h - 0.1, 0.07, w / 2 + 0.1, -h - 0.1, 0.07, 0.028, tubeMat);
  tube(g, -w / 2 - 0.1, -h - 0.1, 0.07, -w / 2 - 0.1, 0.1, 0.07, 0.028, tubeMat);
  tube(g, w / 2 + 0.1, -h - 0.1, 0.07, w / 2 + 0.1, 0.1, 0.07, 0.028, tubeMat);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, -h / 2, 0.18);
  glow.scale.set(w * 1.7, h * 2.4, 1);
  g.add(glow);
  if (p.light) neonLight(kit, g, 0, -h / 2, 0.6, color, 3.4);
  kit.group.add(g);
  floorGlow(kit, p.x, p.z, p.rotY ?? 0, w * 1.3, 5.5, color, 0.4);
  // A wide sign is a shop's: a doorway, its glow, and a canopy under it.
  if (w >= 2) shopfront(kit, p, color);
}

/** A shopfront under its sign: a recessed dark doorway with a lit interior and a small awning. */
function shopfront(kit: Kit, p: PropConfig, color: string) {
  const g = placed(p, 0);
  const { steelDark, steel, dark } = kit.mats;
  const sw = SHOP_W;
  // The recess: side jambs, a lintel, a floor step, and a bright mouth.
  g.add(mesh(box(0.28, 3.4, 0.5), steelDark, -sw / 2, 1.7, 0.2));
  g.add(mesh(box(0.28, 3.4, 0.5), steelDark, sw / 2, 1.7, 0.2));
  g.add(mesh(box(sw + 0.3, 0.4, 0.5), steelDark, 0, 3.4, 0.2));
  g.add(mesh(box(sw + 0.5, 0.12, 0.9), steel, 0, 0.06, 0.35));
  const mouth = mesh(box(sw - 0.4, 3.1, 0.06), flat(shade(color, -0.2), 0.75), 0, 1.6, 0.42, false);
  g.add(mouth);
  // A strip of light down each jamb, and a canopy over the door.
  const led = kit.mats.neon(color);
  for (const sx of [-1, 1]) tube(g, sx * (sw / 2 - 0.16), 0.2, 0.45, sx * (sw / 2 - 0.16), 3.0, 0.45, 0.03, led);
  const canopy = mesh(box(sw + 0.6, 0.1, 0.9), steelDark, 0, 3.1, 0.6);
  canopy.rotation.x = 0.14;
  g.add(canopy);
  g.add(mesh(box(sw - 0.6, 0.05, 0.3), kit.mats.neon(color), 0, 3.03, 0.95, false));
  // A crate or two and a cone outside.
  g.add(mesh(box(0.5, 0.5, 0.5), dark, -sw / 2 - 0.35, 0.25, 0.5));
  g.add(mesh(new THREE.ConeGeometry(0.16, 0.5, 8), toon('#ff6b35'), sw / 2 + 0.4, 0.25, 0.5, false));
  kit.still.add(g);
  // (The wall behind it is not walked into, so nothing to collide with.)
}

/** A holographic billboard high on a wall: a scrolling picture, its frame, and its haze. */
function billboardProp(kit: Kit, p: PropConfig) {
  const w = p.width ?? 3.6;
  const h = p.height ?? 2.2;
  const g = placed(p);
  g.position.y = p.y ?? 6;
  const { steelDark } = kit.mats;
  g.add(mesh(box(w + 0.3, h + 0.3, 0.14), steelDark, 0, 0, 0));
  const tex = billboard(kit.screens.length * 7 + 3);
  const mat = flatMap(tex);
  mat.fog = true;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  face.position.z = 0.1;
  g.add(face);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#7fd4ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 0, 0.3);
  glow.scale.set(w * 1.5, h * 1.9, 1);
  g.add(glow);
  kit.group.add(g);
  kit.screens.push({ tex, speed: 0.012 + (kit.screens.length % 3) * 0.006, base: mat });
  floorGlow(kit, p.x, p.z, p.rotY ?? 0, w * 1.1, 7, '#7fd4ff', 0.3);
  if (p.light) neonLight(kit, g, 0, 0, 1.2, '#7fd4ff', 3);
}

/** A hologram projector: a plinth, a lens, and a shape of light turning over it. */
function hologram(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const color = p.color ?? '#2de2e6';
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark, steel } = kit.mats;
  g.add(mesh(new THREE.CylinderGeometry(0.34 * s, 0.44 * s, 0.16 * s, 12), steelDark, 0, 0.08 * s, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.1 * s, 0.16 * s, 0.7 * s, 10), steel, 0, 0.5 * s, 0));
  const lens = mesh(new THREE.CylinderGeometry(0.2 * s, 0.24 * s, 0.1 * s, 12), kit.mats.neon(color), 0, 0.9 * s, 0, false);
  g.add(lens);
  // The hologram: a wireframe-ish shape of bright edges over a faint cone of light.
  const shape = new THREE.Group();
  shape.position.y = 1.7 * s;
  const edge = flat(color, 0.95);
  shape.add(new THREE.Mesh(new THREE.TorusGeometry(0.4 * s, 0.02 * s, 6, 24), edge));
  const inner = new THREE.Mesh(new THREE.TorusGeometry(0.22 * s, 0.018 * s, 6, 18), edge);
  inner.rotation.x = Math.PI / 2.4;
  shape.add(inner);
  shape.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.34 * s, 0), new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.85, toneMapped: false })));
  const cone = mesh(new THREE.ConeGeometry(0.46 * s, 1.6 * s, 18, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }), 0, 1.7 * s, 0, false);
  cone.rotation.x = Math.PI;
  g.add(cone);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 1.7 * s, 0);
  glow.scale.setScalar(2.4 * s);
  g.add(glow, shape);
  kit.group.add(g);
  kit.holos.push({ group: g, core: shape, cone, glow, color: new THREE.Color(color), phase: Math.random() * 7, baseY: 1.7 * s });
  neonLight(kit, g, 0, 1.5 * s, 0, color, 2.2);
  collide(kit, p.x, p.z, 0.8 * s, 0.8 * s, 0, g.position.y + 0.95 * s);
}

/** A vending machine: E for a drink, like the office's coffee. */
function vending(kit: Kit, p: PropConfig): Interactable {
  const s = p.scale ?? 1;
  const color = p.color ?? '#ff2c9c';
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark, dark } = kit.mats;
  const W = PROP_SIZE.machine.width * s;
  const D = PROP_SIZE.machine.depth * s;
  const H = 1.9 * s;
  g.add(mesh(box(W, H, D), steelDark, 0, H / 2, 0));
  // Its glowing front: a panel of bottles, a slot, and a lit strip.
  const panel = mesh(box(W - 0.16, H - 0.5, 0.04), flat(shade(color, -0.35), 0.85), 0, H / 2 + 0.1, D / 2 + 0.01, false);
  g.add(panel);
  const bottle = toon('#8ecae6');
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 3; i++) {
      g.add(mesh(new THREE.CylinderGeometry(0.045 * s, 0.05 * s, 0.18 * s, 8), bottle, (-0.24 + i * 0.24) * s, (1.15 + r * 0.32) * s, D / 2 + 0.04, false));
    }
  }
  g.add(mesh(box(W - 0.2, 0.1 * s, 0.06), kit.mats.neon(color), 0, 0.72 * s, D / 2 + 0.03, false));
  g.add(mesh(box(0.26 * s, 0.12 * s, 0.05), dark, 0, 0.5 * s, D / 2 + 0.04, false));
  const label = textPlane('⚡ Drinks', { bg: '#0a0c12', color: '#ffffff', size: 44 });
  label.scale.multiplyScalar(0.42);
  label.position.set(0, H - 0.16 * s, D / 2 + 0.05);
  g.add(label);
  kit.group.add(g);
  const r = p.rotY ?? 0;
  collide(kit, p.x, p.z, W, D, r, g.position.y + H);
  const it: Interactable = { kind: 'coffee', label: '🥤 Vending machine', x: p.x + Math.sin(r) * 1.0, y: g.position.y, z: p.z + Math.cos(r) * 1.0, radius: 1.5 };
  g.userData.interact = it;
  return it;
}

/** Stacked cases and a pallet. */
function cases(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { dark, darkAlt, steel } = kit.mats;
  g.add(mesh(box(1.0 * s, 0.7 * s, 0.9 * s), dark, 0, 0.35 * s, 0));
  g.add(mesh(box(0.8 * s, 0.55 * s, 0.7 * s), darkAlt, -0.08 * s, 0.97 * s, 0.06 * s));
  g.add(mesh(box(0.9 * s, 0.08 * s, 0.1 * s), steel, 0, 0.5 * s, 0.46 * s, false));
  for (const sx of [-1, 1]) g.add(mesh(box(0.1 * s, 0.7 * s, 0.9 * s), steel, sx * 0.5 * s, 0.35 * s, 0, false));
  kit.still.add(g);
  collide(kit, p.x, p.z, 1.1 * s, 1.0 * s, p.rotY ?? 0, g.position.y + 1.3 * s);
}

/** A steel grate breathing steam: in the floor, or in a wall at `y`. */
function grate(kit: Kit, p: PropConfig) {
  const g = placed(p);
  const { steelDark, steel } = kit.mats;
  const onWall = p.y !== undefined;
  g.position.y = p.y ?? 0;
  g.add(mesh(box(1.2, onWall ? 0.9 : 0.06, onWall ? 0.06 : 1.2), steelDark, 0, onWall ? 0 : 0.03, 0));
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1) - 0.5) * 0.95;
    g.add(mesh(onWall ? box(0.06, 0.05, 0.9) : box(0.9, 0.04, 0.06), steel, onWall ? 0 : t, onWall ? t : 0.07, onWall ? t : 0, false));
  }
  kit.still.add(g);
  kit.steam?.add(p.x, g.position.y + 0.1, p.z);
}

/** A plasteel barrier, lit along its top. */
function barrier(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const w = (p.width ?? PROP_SIZE.barrier.width) * s;
  const color = p.color ?? '#ff2c9c';
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark } = kit.mats;
  const h = 0.95 * s;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h * 0.7), flatMap(hazard(color)));
  face.position.set(0, h * 0.45, 0.09 * s);
  g.add(face);
  const back = face.clone();
  back.position.z = -0.09 * s;
  back.rotation.y = Math.PI;
  g.add(back);
  g.add(mesh(box(w, 0.08 * s, 0.3 * s), steelDark, 0, h, 0));
  g.add(mesh(box(w, 0.08 * s, 0.3 * s), steelDark, 0, h * 0.12, 0));
  for (const sx of [-1, 1]) g.add(mesh(box(0.14 * s, h, 0.24 * s), steelDark, sx * (w / 2 - 0.1 * s), h / 2, 0));
  tube(g, -w / 2, h + 0.06 * s, 0, w / 2, h + 0.06 * s, 0, 0.025, kit.mats.neon(color));
  kit.still.add(g);
  collide(kit, p.x, p.z, w, 0.4 * s, p.rotY ?? 0, g.position.y + h);
}

/** A tube light on a wall, in a cage, burning toward `rotY`. */
function wallLamp(kit: Kit, p: PropConfig) {
  const color = p.color ?? '#bfe9ff';
  const g = placed(p);
  const { steelDark, steel } = kit.mats;
  g.add(mesh(box(0.16, 0.34, 0.16), steelDark, 0, 0, -0.2));
  g.add(mesh(box(0.1, 0.1, 0.34), steel, 0, 0, -0.04));
  const tubeMat = kit.mats.neon(color);
  const tubeMesh = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), tubeMat, 0, 0, 0.18, false);
  tubeMesh.rotation.x = Math.PI / 2;
  g.add(tubeMesh);
  for (const sx of [-1, 1]) g.add(mesh(box(0.02, 0.16, 0.7), steel, sx * 0.07, 0, 0.18, false));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 0, 0.3);
  glow.scale.setScalar(2.4);
  g.add(glow);
  kit.group.add(g);
  if (p.light) neonLight(kit, g, 0, 0, 0.5, color, 3.2);
}

/** A fire in an oil drum. */
function fireDrum(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark, steel } = kit.mats;
  g.add(mesh(new THREE.CylinderGeometry(0.38 * s, 0.38 * s, 0.95 * s, 14), steelDark, 0, 0.48 * s, 0));
  for (const y of [0.28, 0.72]) g.add(mesh(new THREE.TorusGeometry(0.39 * s, 0.03, 6, 18).rotateX(Math.PI / 2), steel, 0, y * s, 0, false));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const hole = mesh(new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.06, 6), flat('#ff8c2a'), Math.cos(a) * 0.38 * s, 0.55 * s, Math.sin(a) * 0.38 * s, false);
    hole.rotation.z = Math.PI / 2;
    hole.rotation.y = -a;
    g.add(hole);
  }
  const f = new THREE.Group();
  f.position.y = 0.95 * s;
  f.add(new THREE.Mesh(FLAME_OUTER, FLAME_OUT));
  const inner = new THREE.Mesh(FLAME_INNER, FLAME_IN);
  inner.position.y = 0.02;
  f.add(inner);
  f.scale.setScalar(s);
  g.add(f);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb45a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 1.25 * s, 0);
  glow.scale.setScalar(5 * s);
  g.add(glow);
  kit.group.add(g);
  kit.flames.push({ group: f, glow, size: s, phase: Math.random() * 9 });
  if (p.light) neonLight(kit, g, 0, 1.4 * s, 0, '#ff8c2a', 3.6);
  collide(kit, p.x, p.z, 0.9 * s, 0.9 * s, 0, g.position.y + 0.95 * s);
}

/** A ring of LED tubes hanging from the ceiling at `y`. */
function ringLight(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const color = p.color ?? '#bfe9ff';
  const y = p.y ?? kit.height - 2.4;
  const g = placed(p);
  g.position.y = y;
  const r = 1.1 * s;
  g.add(mesh(new THREE.TorusGeometry(r, 0.05, 6, 30).rotateX(Math.PI / 2), kit.mats.steelDark, 0, 0, 0, false));
  const led = kit.mats.neon(color);
  g.add(mesh(new THREE.TorusGeometry(r - 0.1, 0.035, 6, 30).rotateX(Math.PI / 2), led, 0, -0.06, 0, false));
  g.add(mesh(new THREE.TorusGeometry(r - 0.34, 0.035, 6, 30).rotateX(Math.PI / 2), led, 0, -0.06, 0, false));
  for (const sx of [-1, 1]) tube(g, sx * r, 0, 0, sx * r, kit.height - y, 0, 0.012, kit.mats.steelDark);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, -0.2, 0);
  glow.scale.setScalar(5 * s);
  g.add(glow);
  kit.group.add(g);
  if (p.light) neonLight(kit, g, 0, -0.3, 0, color, 4);
}

/** A hanging ad board in the floor's color, with the project's name on the great one. */
function adBoard(kit: Kit, p: PropConfig) {
  const w = p.width ?? 2.4;
  const h = p.height ?? 3.4;
  const y = p.y ?? 8;
  const g = placed(p);
  g.position.y = y;
  const { steelDark } = kit.mats;
  g.add(mesh(box(w + 0.2, h + 0.2, 0.08), steelDark, 0, -h / 2, 0));
  const tex = canvasTexture(384, 512, (c) => paintAd(c, 384, 512, kit.ledColor));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flatMap(tex));
  face.position.set(0, -h / 2, 0.055);
  g.add(face);
  const back = face.clone();
  back.rotation.y = Math.PI;
  back.position.z = -0.055;
  g.add(back);
  const rod = mesh(box(w + 0.3, 0.08, 0.08), steelDark, 0, 0, 0);
  g.add(rod);
  kit.group.add(g);
  kit.banners.push({ tex, w: 384, h: 512, great: w >= 3 });
}

/** A window in a wall, with the city's lights behind it. */
function cityWindow(kit: Kit, p: PropConfig) {
  const w = p.width ?? 2.3;
  const h = p.height ?? 2.6;
  const y = p.y ?? 2.2;
  const g = placed(p);
  g.position.y = y;
  const { steelDark } = kit.mats;
  g.add(mesh(box(w + 0.3, h + 0.3, 0.12), steelDark, 0, h / 2, 0));
  const tex = towerFace('#151222', Math.round((p.x + p.z) * 13) + 5);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 6, h / 6);
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), flatMap(tex)).translateZ(0.07));
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(w, h), GLASS).translateZ(0.1));
  tube(g, -w / 2, 0, 0.12, -w / 2, h, 0.12, 0.025, kit.mats.neon('#2de2e6'));
  tube(g, w / 2, 0, 0.12, w / 2, h, 0.12, 0.025, kit.mats.neon('#2de2e6'));
  kit.group.add(g);
}

/** A round holographic porthole, at `y`. */
function porthole(kit: Kit, p: PropConfig) {
  const s = p.width ?? 3;
  const y = p.y ?? 5;
  const color = p.color ?? '#ff2c9c';
  const g = placed(p);
  g.position.y = y;
  g.add(mesh(new THREE.TorusGeometry(s / 2, 0.1, 8, 28), kit.mats.steelDark, 0, 0, 0, false));
  g.add(new THREE.Mesh(new THREE.CircleGeometry(s / 2 - 0.08, 28), flat(shade(color, -0.35), 0.9)).translateZ(0.04));
  for (let i = 0; i < 3; i++) g.add(new THREE.Mesh(new THREE.TorusGeometry((s / 2 - 0.25) * (1 - i * 0.28), 0.03, 6, 26), kit.mats.neon(color)).translateZ(0.08 + i * 0.01));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 0, 0.2);
  glow.scale.setScalar(s * 1.6);
  g.add(glow);
  kit.group.add(g);
}

/** A glowing guide strip on the floor, `width` by `length` along `rotY`. */
function floorStrip(kit: Kit, p: PropConfig) {
  const w = p.width ?? 1.4;
  const l = p.length ?? 8;
  const color = p.color ?? kit.ledColor;
  const g = placed(p, (p.y ?? 0) + 0.02);
  const strip = mesh(new THREE.PlaneGeometry(w, l), flat(color, 0.55), 0, 0, 0, false);
  strip.rotation.x = -Math.PI / 2;
  g.add(strip);
  for (const sx of [-1, 1]) {
    const edge = mesh(new THREE.PlaneGeometry(0.08, l), flat(color, 0.95), (sx * w) / 2, 0.005, 0, false);
    edge.rotation.x = -Math.PI / 2;
    g.add(edge);
  }
  kit.group.add(g);
}

/** A chrome figure on a plinth: the corporation's mascot. */
function chromeStatue(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark, steel, gold } = kit.mats;
  g.add(mesh(box(0.9 * s, 0.5 * s, 0.9 * s), steelDark, 0, 0.25 * s, 0));
  g.add(mesh(box(0.7 * s, 0.16 * s, 0.7 * s), gold, 0, 0.56 * s, 0, false));
  // A polished diamond, the way a corpo lobby has one.
  const gem = mesh(new THREE.OctahedronGeometry(0.5 * s, 0), steel, 0, 1.35 * s, 0);
  gem.scale.y = 1.5;
  g.add(gem);
  tube(g, -0.5 * s, 0.62 * s, 0.5 * s, 0.5 * s, 0.62 * s, 0.5 * s, 0.02, kit.mats.neon('#2de2e6'));
  tube(g, -0.5 * s, 0.62 * s, -0.5 * s, 0.5 * s, 0.62 * s, -0.5 * s, 0.02, kit.mats.neon('#2de2e6'));
  kit.still.add(g);
  collide(kit, p.x, p.z, 1.0 * s, 1.0 * s, p.rotY ?? 0, g.position.y + 1.9 * s);
}

/** A security drone on a charging stand. */
function sentry(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark, steel } = kit.mats;
  const color = p.color ?? '#ff2c9c';
  g.add(mesh(new THREE.CylinderGeometry(0.06 * s, 0.1 * s, 1.1 * s, 8), steelDark, 0, 0.55 * s, 0));
  const body = new THREE.Group();
  body.position.y = 1.3 * s;
  body.add(mesh(new THREE.SphereGeometry(0.34 * s, 16, 12), steel, 0, 0, 0));
  body.add(mesh(new THREE.SphereGeometry(0.16 * s, 12, 8), flat(color), 0, 0.02 * s, 0.28 * s, false));
  for (const sx of [-1, 1]) {
    const wing = mesh(box(0.5 * s, 0.05 * s, 0.2 * s), steelDark, sx * 0.45 * s, 0.1 * s, 0, false);
    wing.rotation.z = sx * 0.25;
    body.add(wing);
  }
  g.add(body);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 1.32 * s, 0.3 * s);
  glow.scale.setScalar(1.4 * s);
  g.add(glow);
  kit.group.add(g);
  collide(kit, p.x, p.z, 0.7 * s, 0.7 * s, 0, g.position.y + 1.7 * s);
}

/** A hanging plaque with the corporation's crest on it. */
function plaque(kit: Kit, p: PropConfig) {
  const w = p.width ?? 0.9;
  const y = p.y ?? 3;
  const color = p.color ?? '#ffd60a';
  const g = placed(p);
  g.position.y = y;
  const { steelDark, gold } = kit.mats;
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(w / 2, -w * 0.7);
  shape.lineTo(0, -w * 1.05);
  shape.lineTo(-w / 2, -w * 0.7);
  shape.closePath();
  g.add(mesh(new THREE.ShapeGeometry(shape), gold, 0, 0, 0, false));
  g.add(mesh(new THREE.TorusGeometry(w * 0.22, 0.03, 6, 18), steelDark, 0, -w * 0.45, 0.02, false));
  tube(g, -w / 2, 0, 0.03, 0, -w * 1.05, 0.03, 0.02, kit.mats.neon(color));
  tube(g, w / 2, 0, 0.03, 0, -w * 1.05, 0.03, 0.02, kit.mats.neon(color));
  kit.group.add(g);
}

/** A backlit wall of screens: the bar's video wall. */
function videoWall(kit: Kit, p: PropConfig) {
  const w = p.width ?? PROP_SIZE.hearth.width;
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark } = kit.mats;
  const h = 2.4 * s;
  g.add(mesh(box(w, h, 0.4 * s), steelDark, 0, h / 2, 0));
  const tex = billboard(kit.screens.length * 7 + 11);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, h - 0.4), flatMap(tex));
  face.position.set(0, h / 2, 0.21 * s);
  g.add(face);
  kit.screens.push({ tex, speed: 0.02, base: face.material as THREE.MeshBasicMaterial });
  tube(g, -w / 2, h - 0.1, 0.22 * s, w / 2, h - 0.1, 0.22 * s, 0.03, kit.mats.neon(p.color ?? '#2de2e6'));
  kit.group.add(g);
  collide(kit, p.x, p.z, w, 0.4 * s, p.rotY ?? 0, g.position.y + h);
  if (p.light) neonLight(kit, g, 0, 1.6, 0.8, p.color ?? '#2de2e6', 5);
}

/** A small fridge of drinks: E for a can, like the office's coffee. */
function drinksFridge(kit: Kit, p: PropConfig): Interactable {
  const s = p.scale ?? 1;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steelDark, steel } = kit.mats;
  const color = p.color ?? '#39ff88';
  g.add(mesh(box(0.9 * s, 1.6 * s, 0.7 * s), steelDark, 0, 0.8 * s, 0));
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.6 * s, 1.1 * s), flat(color, 0.4)).translateY(0.85 * s).translateZ(0.36 * s));
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.16 * s, 8), toon('#8ecae6'), (-0.18 + i * 0.18) * s, 1.0 * s, 0.36 * s, false));
  const label = textPlane('🥤 Cold ones', { bg: '#0a0c12', color: '#ffffff', size: 44 });
  label.scale.multiplyScalar(0.38);
  label.position.set(0, 1.72 * s, 0.1);
  g.add(label);
  kit.group.add(g);
  const r = p.rotY ?? 0;
  collide(kit, p.x, p.z, 0.9 * s, 0.7 * s, r, g.position.y + 1.6 * s);
  const it: Interactable = { kind: 'coffee', label: '🥤 Cold ones', x: p.x + Math.sin(r) * 0.9, y: g.position.y, z: p.z + Math.cos(r) * 0.9, radius: 1.4 };
  g.userData.interact = it;
  return it;
}

/** A steel work table with nothing to sit at. */
function steelTable(kit: Kit, p: PropConfig) {
  const w = p.width ?? 1.4;
  const l = p.length ?? 3;
  const g = placed(p, kit.floorAt(p.x, p.z));
  const { steel, steelDark } = kit.mats;
  g.add(mesh(roundedBox(w, 0.1, l, 0.04), steel, 0, TABLE_TOP - 0.05, 0));
  g.add(mesh(box(w - 0.2, 0.16, l - 0.4), steelDark, 0, TABLE_TOP - 0.16, 0, false));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) g.add(mesh(box(0.08, TABLE_TOP - 0.1, 0.08), steelDark, sx * (w / 2 - 0.1), (TABLE_TOP - 0.1) / 2, sz * (l / 2 - 0.2)));
  kit.still.add(g);
  collide(kit, p.x, p.z, w, l, p.rotY ?? 0, g.position.y + TABLE_TOP);
}

/** A floor uplight: a can in the ground, throwing light up a wall. */
function uplight(kit: Kit, p: PropConfig) {
  const color = p.color ?? '#bfe9ff';
  const g = placed(p, (p.y ?? 0));
  const { steelDark } = kit.mats;
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.1, 12), steelDark, 0, 0.05, 0));
  g.add(new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), flat(color)).rotateX(-Math.PI / 2).translateY(0.101));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 0.3, 0);
  glow.scale.setScalar(1.6);
  g.add(glow);
  kit.group.add(g);
  if (p.light) neonLight(kit, g, 0, 0.6, 0, color, 2.4);
}

/** Every kind of prop, put up (every kind there is has one: see PROP_KINDS). */
const PROPS: Record<PropKind, (kit: Kit, p: PropConfig) => void> = {
  pillar: column,
  torch: wallLamp,
  brazier: fireDrum,
  chandelier: ringLight,
  banner: adBoard,
  window: cityWindow,
  rose: porthole,
  carpet: floorStrip,
  statue: chromeStatue,
  armor: sentry,
  shield: plaque,
  hearth: videoWall,
  gong: (kit, p) => {
    const gong = buildGong({ x: p.x, y: kit.floorAt(p.x, p.z), z: p.z, rotY: p.rotY ?? 0 });
    kit.group.add(gong.group);
    kit.colliders.push(...gong.colliders);
    kit.interactables.push(gong.interactable);
    kit.gong = gong;
  },
  cask: (kit, p) => kit.interactables.push(drinksFridge(kit, p)),
  table: steelTable,
  candles: uplight,
  sign: neonSignProp,
  screen: billboardProp,
  holo: hologram,
  machine: (kit, p) => kit.interactables.push(vending(kit, p)),
  crate: cases,
  vent: grate,
  barrier,
};

/** A soft glow around a point (a tube's halo), without a real light. */
function halo(parent: THREE.Object3D, x: number, y: number, z: number, color: string, size: number) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0.5 }));
  s.material.userData.outlineParameters = { visible: false };
  s.position.set(x, y, z);
  s.scale.setScalar(size);
  parent.add(s);
}

/** The streak a sign or a screen throws on the wet floor, fading as it runs into the room. */
let streakTex: THREE.CanvasTexture | null = null;
function streakTexture(): THREE.CanvasTexture {
  if (streakTex) return streakTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  // Ripples across it, so it reads as a puddle rather than a painted stripe.
  const rand = seeded(13);
  for (let i = 0; i < 26; i++) {
    g.clearRect(0, Math.floor(rand() * 256), 64, 1 + Math.floor(rand() * 3));
  }
  return (streakTex = new THREE.CanvasTexture(c));
}

/** The puddle of light under a sign at (x, z) facing `rotY`, `w` wide and running `len` out. */
function floorGlow(kit: Kit, x: number, z: number, rotY: number, w: number, len: number, color: string, opacity: number) {
  const g = new THREE.Group();
  g.position.set(x, 0.018, z);
  g.rotation.y = rotY;
  const mat = new THREE.MeshBasicMaterial({ map: streakTexture(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  mat.userData.outlineParameters = { visible: false };
  const p = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mat);
  p.rotation.x = -Math.PI / 2;
  p.position.z = len / 2;
  g.add(p);
  kit.group.add(g);
}

/** A ceiling light panel, with its glow. */
function ceilingPanel(kit: Kit, x: number, z: number, lit: boolean) {
  const H = kit.height;
  const color = '#dff4ff';
  kit.group.add(mesh(box(3.0, 0.1, 1.2), kit.mats.neon(color), x, H - 0.28, z, false));
  kit.group.add(mesh(box(3.3, 0.16, 1.5), kit.mats.steelDark, x, H - 0.19, z, false));
  halo(kit.group, x, H - 0.45, z, color, 7);
  if (lit) neonLight(kit, kit.group, x, H - 1.2, z, color, 6);
}

/** A wall's dressing: vertical conduits and vents between the shopfronts and the boards. */
function wallDetail(kit: Kit, side: -1 | 1, b: MapPlan['bounds'], H: number) {
  const x = side * (b.maxX - 0.16);
  const { steelDark, steel } = kit.mats;
  // The spots along each wall that are free of a board (z -20 and 14) and a shopfront (z -24.5,
  // -12, 2 and 18.5, about 1.5 m either way).
  for (const z of [-15.5, -8, 6.5, 24]) {
    // A pair of conduits running up to the cable tray, with a box at the foot.
    for (const [dx, r] of [
      [-0.12, 0.07],
      [0.12, 0.05],
    ] as const) {
      kit.still.add(mesh(new THREE.CylinderGeometry(r, r, H - 1.8, 8), steel, x, (H - 1.8) / 2, z + dx, false));
    }
    kit.still.add(mesh(box(0.44, 0.5, 0.44), steelDark, x, 0.25, z, false));
    kit.still.add(mesh(box(0.07, H - 1.8, 0.3), steelDark, x - side * 0.06, (H - 1.8) / 2, z, false));
    // A vent at head height, its slats.
    kit.still.add(mesh(box(0.2, 0.5, 0.9), steelDark, x, 2.0, z, false));
    for (let i = 0; i < 4; i++) kit.still.add(mesh(box(0.04, 0.06, 0.8), steel, x - side * 0.1, 1.82 + i * 0.12, z, false));
  }
}

// ---- The shell ------------------------------------------------------------------------------------

/** The steel truss over the plaza at (x, z), and the LED batten hanging under it. */
function truss(kit: Kit, z: number, W: number, H: number, led: THREE.Material) {
  const { steel, steelDark } = kit.mats;
  const t = new THREE.Group();
  const w = W + 2 * WALL;
  t.add(mesh(box(w, 0.5, 0.4), steelDark, 0, H - 0.25, 0, false));
  t.add(mesh(box(w, 0.3, 0.28), steel, 0, H - 1.5, 0, false));
  // Zig-zag webs between the two chords.
  for (let x = -w / 2 + 1; x < w / 2 - 0.5; x += 2) {
    const web = mesh(box(2.1, 0.14, 0.14), steel, x + 0.5, H - 0.9, 0, false);
    web.rotation.z = (Math.round(x) % 4 === 0 ? 1 : -1) * 0.62;
    t.add(web);
  }
  t.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, w - 1, 6).rotateZ(Math.PI / 2), led, 0, H - 1.75, 0, false));
  t.position.set((kit.bounds.minX + kit.bounds.maxX) / 2, 0, z);
  kit.still.add(t);
}

/** A hanging bundle of cables, from (x0, y0, z0) to (x1, y1, z1), sagging. */
function cable(kit: Kit, ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number) {
  const a = new THREE.Vector3(ax, ay, az);
  const b = new THREE.Vector3(bx, by, bz);
  const mid = a.clone().lerp(b, 0.5);
  mid.y -= sag;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const mat = toon('#101218');
  kit.still.add(mesh(new THREE.TubeGeometry(curve, 12, 0.035, 5), mat, 0, 0, 0, false));
}

/**
 * The plaza's shell: the wet floor and its glowing lines, concrete walls with windows onto the city,
 * a glazed south end with the way out, a steel ceiling of trusses and cables, the gantry down the
 * arcade, and the city itself beyond the glass — towers, a skyline, and rain.
 */
function buildShell(kit: Kit, plan: MapPlan, pal: { floor: string; stone: string; trim: string }): { doorAt: THREE.Vector3; out: Pt; gate: THREE.Mesh } {
  const b = plan.bounds;
  const H = plan.height;
  const W = b.maxX - b.minX;
  const L = b.maxZ - b.minZ;
  const { group, still, mats } = kit;

  // The floor: wet asphalt with two guide lines down the concourse and stripes at the dais end.
  const floorTex = canvasTexture(512, 512, asphalt(pal.floor), [W / 4, L / 4]);
  const floor = mesh(new THREE.PlaneGeometry(W, L), toonMap(floorTex), 0, 0, 0, false);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  floor.receiveShadow = true;
  group.add(floor);
  kit.colliders.push({ minX: b.minX - 1, maxX: b.maxX + 1, minZ: b.minZ - 1, maxZ: b.maxZ + 1, top: 0 });
  for (const sx of [-1, 1]) group.add(new THREE.Mesh(new THREE.PlaneGeometry(0.12, L - 2), flat(sx < 0 ? '#ff2c9c' : '#2de2e6', 0.5)).rotateX(-Math.PI / 2).translateX(sx * 2.2).translateY(0.012));
  for (let i = 0; i < 7; i++) group.add(new THREE.Mesh(new THREE.PlaneGeometry(14 - i * 1.6, 0.1), flat('#ffd60a', 0.25)).rotateX(-Math.PI / 2).translateY(0.012).translateZ(b.minZ + 3 + i * 1.1));

  // Walls west, east and north: concrete panels with bands of windows onto the city.
  const T = WALL;
  const wallTex = (along: number) => toonMap(canvasTexture(512, 384, panels(pal.stone, 5), [along / 4, H / 3]));
  const walls: [side: 'west' | 'east' | 'north', x: number, z: number, w: number, d: number][] = [
    ['west', b.minX - T / 2, (b.minZ + b.maxZ) / 2, T, L + 2 * T],
    ['east', b.maxX + T / 2, (b.minZ + b.maxZ) / 2, T, L + 2 * T],
    ['north', (b.minX + b.maxX) / 2, b.minZ - T / 2, W + 2 * T, T],
  ];
  for (const [side, x, z, w, d] of walls) {
    group.add(mesh(box(w, H, d), wallTex(side === 'north' ? W : L), x, H / 2, z));
    kit.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, top: 99 });
    const along = side === 'north' ? 'x' : 'z';
    const len = side === 'north' ? W : L;
    for (let u = -len / 2 + 4; u <= len / 2 - 4; u += 6) {
      // A band of windows, high on the wall, with a lit tower face behind the glass.
      const wy = 6.2;
      const win = new THREE.Group();
      win.position.set(along === 'x' ? x + u : x + (side === 'west' ? 0.02 : -0.02), wy, along === 'z' ? z + u : z + 0.02);
      win.rotation.y = along === 'x' ? 0 : side === 'west' ? Math.PI / 2 : -Math.PI / 2;
      const t = towerFace('#151222', Math.round(u * 7) + 40);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(3.4 / 8, 1.7 / 8);
      win.add(mesh(new THREE.PlaneGeometry(3.4, 1.7), flatMap(t), 0, 0, -0.08, false));
      win.add(mesh(new THREE.PlaneGeometry(3.4, 1.7), GLASS, 0, 0, -0.02, false));
      win.add(mesh(box(3.6, 0.12, 0.24), mats.steelDark, 0, 0.9, 0.04, false));
      win.add(mesh(box(3.6, 0.12, 0.24), mats.steelDark, 0, -0.9, 0.04, false));
      win.add(mesh(box(0.12, 1.9, 0.24), mats.steelDark, -1.74, 0, 0.04, false));
      win.add(mesh(box(0.12, 1.9, 0.24), mats.steelDark, 1.74, 0, 0.04, false));
      group.add(win);
    }
  }
  // A cable tray and a neon cove along each side wall, and the pipes and vents on it.
  for (const sx of [-1, 1] as const) {
    still.add(mesh(box(0.3, 0.16, L - 1), mats.steelDark, sx * (W / 2 - 0.5), H - 1.2, 0, false));
    still.add(mesh(box(0.12, 0.06, L - 1), kit.mats.neon('#2de2e6'), sx * (W / 2 - 0.42), H - 1.34, 0, false));
    for (let z = b.minZ + 8; z < b.maxZ - 6; z += 16) halo(group, sx * (W / 2 - 0.6), H - 1.4, z, '#2de2e6', 5);
    wallDetail(kit, sx, b, H);
  }

  // The south end: a glazed curtain wall, with the doorway in the middle and the city beyond.
  const southZ = b.maxZ + T / 2;
  const doorL = -DOORWAY.width / 2;
  const doorR = DOORWAY.width / 2;
  const spans: [number, number][] = [
    [b.minX - T, doorL],
    [doorR, b.maxX + T],
  ];
  for (const [a, c] of spans) {
    group.add(mesh(box(c - a, 0.45, T), mats.steelDark, (a + c) / 2, 0.22, southZ));
    group.add(mesh(box(c - a, 0.03, T - 0.2), mats.steel, (a + c) / 2, 0.45, southZ, false));
    for (let x = a; x < c - 0.4; x += 3) {
      const mull = Math.min(0.16, c - x);
      group.add(mesh(box(0.16, DOORWAY.height, 0.18), mats.steelDark, x + 0.08, DOORWAY.height / 2, southZ, false));
      const glassW = Math.min(3 - 0.16, c - x - 0.16);
      if (glassW > 0.2) {
        const glass = mesh(new THREE.PlaneGeometry(glassW, DOORWAY.height - 0.5), GLASS, x + 0.16 + glassW / 2, 0.45 + (DOORWAY.height - 0.5) / 2, southZ + 0.02, false);
        group.add(glass);
      }
    }
    kit.colliders.push({ minX: a, maxX: c, minZ: southZ - T / 2, maxZ: southZ + T / 2, top: 99 });
  }
  // Above the way in and out: a beam, its sign, and a light curtain across it.
  group.add(mesh(box(DOORWAY.width + 1, H - DOORWAY.height, T), mats.steelDark, 0, (H + DOORWAY.height) / 2, southZ));
  const lintel = new THREE.Mesh(new THREE.PlaneGeometry(DOORWAY.width + 0.6, 0.7), flatMap(billboard(99)));
  lintel.position.set(0, DOORWAY.height + 0.45, southZ - 0.35);
  lintel.rotation.y = Math.PI;
  group.add(lintel);
  const gate = new THREE.Mesh(new THREE.PlaneGeometry(DOORWAY.width - 0.2, DOORWAY.height), flat(pal.trim, 0.1));
  gate.position.set(0, DOORWAY.height / 2, southZ);
  group.add(gate);
  // The threshold and the landing.
  still.add(mesh(box(DOORWAY.width + 0.4, 0.06, 0.6), mats.steel, 0, 0.03, southZ + T / 2, false));

  // The ceiling: panels, trusses, hanging cables.
  const ceilTex = canvasTexture(256, 256, panels(shade(pal.stone, -0.14), 9), [W / 4, L / 4]);
  const ceil = mesh(new THREE.PlaneGeometry(W + 2 * T, L + 2 * T), toonMap(ceilTex), 0, H, 0, false);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, H, 0);
  group.add(ceil);
  const led = kit.mats.neon('#bfe9ff');
  for (let z = b.minZ + 4; z <= b.maxZ - 3; z += 8) truss(kit, z, W, H, led);
  for (const sx of [-1, 1]) for (let z = b.minZ + 6; z <= b.maxZ - 4; z += 12) {
    cable(kit, sx * (W / 2 - 0.4), H - 1.3, z, sx * 8, H - 3.4, z + 3, 0.8);
    cable(kit, sx * (W / 2 - 0.4), H - 1.3, z + 3, sx * 8, H - 3.4, z + 5, 0.6);
  }
  // Light panels in the ceiling between the trusses: the plaza's own lighting, a few of them real.
  let lit = 0;
  for (let z = b.minZ + 8; z <= b.maxZ - 4; z += 8) {
    for (const x of [-8, 0, 8]) {
      const on = (Math.round((z - b.minZ) / 8) + (x > 0 ? 1 : x < 0 ? 2 : 0)) % 3 === 0 && lit < 5;
      if (on) lit++;
      ceilingPanel(kit, x, z, on);
    }
  }

  // The gantry: over every row of columns, an I-beam with a neon batten and cables across.
  const pillarXs = [...new Set(kit.pillars.map((q) => Math.round(q.x * 10) / 10))];
  for (const px of pillarXs) {
    const zs = kit.pillars.filter((q) => Math.round(q.x * 10) / 10 === px).map((q) => q.z);
    if (zs.length < 2) continue;
    const z0 = Math.min(...zs);
    const z1 = Math.max(...zs);
    still.add(mesh(box(0.5, 0.7, z1 - z0), mats.steel, px, 5.1, (z0 + z1) / 2, false));
    still.add(mesh(box(1.1, 0.12, z1 - z0), mats.steelDark, px, 5.62, (z0 + z1) / 2, false));
    still.add(mesh(box(1.1, 0.12, z1 - z0), mats.steelDark, px, 4.62, (z0 + z1) / 2, false));
    still.add(mesh(box(0.1, 0.1, z1 - z0 - 0.6), kit.mats.neon('#ff2c9c'), px, 4.8, (z0 + z1) / 2, false));
    for (let za = z0 + 2; za < z1; za += 4) cable(kit, px + 0.2, H - 1.2, za, px + 0.2, 5.3, za + 1.5, 1.4);
  }

  // The city, beyond the glass: the skyline on a cylinder, towers close in, floating ads, and rain.
  const sky = canvasTexture(2048, 512, skyline());
  sky.colorSpace = THREE.SRGBColorSpace;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 70, 40, 1, true), new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false, toneMapped: false }));
  ring.position.set(0, 14, 0);
  group.add(ring);
  const towers = new THREE.Group();
  const rand = seeded(5);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.16;
    const r = 34 + rand() * 60;
    const tw = 9 + rand() * 16;
    const th = 30 + rand() * 78;
    const t = towerFace('#1a1626', i * 3 + 1);
    t.repeat.set(tw / 8, th / 8);
    const tower = mesh(box(tw, th, tw), new THREE.MeshToonMaterial({ color: '#ffffff', map: t, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }), Math.sin(a) * r, th / 2 - 22, Math.cos(a) * r, false);
    towers.add(tower);
    // A neon band or two up its face.
    const cols = ['#ff2c9c', '#2de2e6', '#ffd60a', '#39ff88'];
    for (let k = 0; k < 3; k++) {
      const band = mesh(box(tw * 0.92, 0.5, tw * 0.08), flat(cols[Math.floor(rand() * cols.length)], 0.95), Math.sin(a) * r, -12 + rand() * (th - 8), Math.cos(a) * r + tw * 0.5, false);
      band.lookAt(0, band.position.y, 0);
      towers.add(band);
    }
    // A holo sign near the top.
    if (rand() < 0.8) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(tw * 0.9, tw * 0.6), flatMap(billboard(Math.floor(rand() * 90) + 1)));
      sign.position.set(Math.sin(a) * (r + 0.1), th - 25 - 3, Math.cos(a) * (r + 0.1));
      sign.lookAt(0, sign.position.y, 0);
      towers.add(sign);
    }
  }
  // Holo ads floating over the street, and a monorail line across the sky.
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2;
    const r = 26 + rand() * 46;
    const ad = new THREE.Mesh(new THREE.PlaneGeometry(8 + rand() * 8, 4 + rand() * 4), flatMap(billboard(200 + i)));
    ad.position.set(Math.sin(a) * r, 16 + rand() * 26, Math.cos(a) * r);
    ad.lookAt(0, ad.position.y, 0);
    towers.add(ad);
    halo(towers, ad.position.x, ad.position.y, ad.position.z, '#7fd4ff', 16);
  }
  group.add(towers);
  const railY = 30;
  const monorail = mesh(box(2.6, 0.7, 2.6), kit.mats.steelDark, 0, railY, 0, false);
  monorail.scale.set(70, 1, 0.5);
  monorail.rotation.y = 0.5;
  group.add(monorail);
  tube(group, -70, railY, 30, 60, railY, 5, 0.12, flat('#9fe8ff', 0.8));
  // Rain over the city (and the terrace): streaks falling, only ever seen through the glass.
  const rainN = 900;
  const rainPos = new Float32Array(rainN * 6);
  const rainSeed = seeded(31);
  const homes: number[][] = [];
  for (let i = 0; i < rainN; i++) {
    const a = rainSeed() * Math.PI * 2;
    const r = 20 + rainSeed() * 90;
    homes.push([Math.sin(a) * r, -6 + rainSeed() * 40, Math.cos(a) * r, 0.5 + rainSeed() * 0.5]);
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: '#9fd4ff', transparent: true, opacity: 0.4, depthWrite: false, fog: false }));
  rain.frustumCulled = false;
  group.add(rain);
  kit.rain = { lines: rain, pos: rainPos, homes, n: rainN };

  // The terrace outside the doors: a wet deck with a railing, a noodle stand and planters.
  const deckZ0 = b.maxZ + T;
  const deckZ1 = deckZ0 + 9;
  const deck = mesh(box(24, 0.3, deckZ1 - deckZ0), mats.steelDark, 0, -0.15, (deckZ0 + deckZ1) / 2);
  group.add(deck);
  kit.colliders.push({ minX: -12, maxX: 12, minZ: deckZ0, maxZ: deckZ1, top: 0 });
  const puddle = (x: number, z: number, s: number, c: string) => {
    const p = new THREE.Mesh(new THREE.CircleGeometry(s, 20), flat(c, 0.3));
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 0.16, z);
    group.add(p);
  };
  puddle(-4, deckZ0 + 3, 2.2, '#ff2c9c');
  puddle(3.4, deckZ0 + 5.4, 1.6, '#2de2e6');
  puddle(7.5, deckZ0 + 2.2, 1.2, '#ffd60a');
  // Its railing: posts, a top rail, and a lit edge, with the city behind and below.
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 2.4) + 1);
    for (let i = 0; i < n; i++) {
      const x = x0 + ((x1 - x0) * i) / (n - 1);
      const z = z0 + ((z1 - z0) * i) / (n - 1);
      group.add(mesh(box(0.1, 1.15, 0.1), mats.steelDark, x, 0.72, z, false));
    }
    tube(group, x0, 1.28, z0, x1, 1.28, z1, 0.05, mats.steel);
    tube(group, x0, 0.5, z0, x1, 0.5, z1, 0.04, kit.mats.neon('#2de2e6'));
    const [minX, maxX] = [Math.min(x0, x1) - 0.2, Math.max(x0, x1) + 0.2];
    const [minZ, maxZ] = [Math.min(z0, z1) - 0.2, Math.max(z0, z1) + 0.2];
    kit.colliders.push({ minX, maxX, minZ, maxZ, top: 99, fence: true });
  };
  rail(-12, deckZ1, 12, deckZ1);
  rail(-12, deckZ0, -12, deckZ1);
  rail(12, deckZ0, 12, deckZ1);
  // Lights out here: lanterns on the rail's posts, and two floods over the deck.
  for (const x of [-9, -3, 3, 9]) kit.group.add(mesh(new THREE.SphereGeometry(0.18, 10, 8), flat('#ff6b35'), x, 1.5, deckZ1 - 0.2, false));
  for (const x of [-9, -3, 3, 9]) halo(kit.group, x, 1.5, deckZ1 - 0.2, '#ff6b35', 2.6);
  for (const x of [-12, 12]) kit.group.add(mesh(box(0.3, 0.3, 0.3), kit.mats.neon('#dff4ff'), x, 3.4, deckZ0 + 0.8, false));
  neonLight(kit, kit.group, 0, 3.2, deckZ0 + 2, '#bfe9ff', 5);
  // The noodle stand, with its lanterns.
  const stand = new THREE.Group();
  stand.position.set(-7.5, 0, deckZ0 + 2.4);
  stand.rotation.y = 1.4;
  stand.add(mesh(box(3, 2.2, 1.6), mats.steelDark, 0, 1.1, 0));
  stand.add(mesh(box(3.4, 0.12, 2.2), mats.steel, 0, 2.26, 0.2, false));
  stand.add(new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.8), flatMap(neonSign('RAMEN', '#ff6b35'))).translateY(1.6).translateZ(0.81));
  for (const sx of [-1, 1]) stand.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), flat('#ff6b35'), sx * 1.2, 1.85, 0.9, false));
  group.add(stand);
  kit.colliders.push({ minX: -9.2, maxX: -5.8, minZ: deckZ0 + 1.4, maxZ: deckZ0 + 3.4, top: 99 });
  for (const [x, z] of [
    [6.5, deckZ0 + 1.4],
    [9, deckZ0 + 3.2],
  ] as const) {
    group.add(mesh(box(0.9, 0.9, 0.9), mats.dark, x, 0.45, z));
    group.add(mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.5, 10), toon('#2f5d3a'), x, 1.1, z, false));
    collide(kit, x, z, 0.9, 0.9, 0, 0.9);
  }

  const doorAt = new THREE.Vector3(0, 0, b.maxZ);
  return { doorAt, out: [0, 1], gate };
}

// ---- The dais, the desks and the rest -------------------------------------------------------------

/** The chrome dais at the north end, the boss's chair on it, and the wall of light behind. */
function buildDais(kit: Kit, plan: MapPlan): Interactable | undefined {
  const t = plan.throne;
  const dais = plan.dais;
  if (!t || !dais) return undefined;
  const { mats } = kit;
  const g = new THREE.Group();
  g.position.set(t.x, 0, t.z);
  g.rotation.y = t.rotY;
  const front = 2.4;
  const top = dais.height;
  const at = (lx: number, lz: number) => [t.x + Math.cos(t.rotY) * lx + Math.sin(t.rotY) * lz, t.z - Math.sin(t.rotY) * lx + Math.cos(t.rotY) * lz] as const;
  // The platform, with a lit edge and steps down its front.
  g.add(mesh(box(dais.width, top, dais.depth), mats.steelDark, 0, top / 2, front - dais.depth / 2));
  g.add(mesh(box(dais.width + 0.1, 0.12, 0.12), kit.mats.neon(kit.ledColor), 0, top - 0.06, front));
  for (let k = 1; k <= dais.steps; k++) {
    const y = (top * (dais.steps + 1 - k)) / (dais.steps + 1);
    const lz = front + (k - 0.5) * 0.7;
    g.add(mesh(box(dais.width, y, 0.7), mats.steel, 0, y / 2, lz));
    g.add(mesh(box(dais.width - 0.2, 0.04, 0.04), kit.mats.neon(kit.ledColor), 0, y + 0.02, lz + 0.34, false));
  }
  const [cx, cz] = at(0, front - dais.depth / 2);
  collide(kit, cx, cz, dais.width, dais.depth, t.rotY, top);
  // The chair: a chrome frame with magenta cushions, and a gunmetal desk in front of it.
  const chair = new THREE.Group();
  chair.position.set(0, top, front - 1.15);
  chair.add(mesh(box(1.0, 0.12, 0.9), mats.steel, 0, 0.52, 0));
  chair.add(mesh(roundedBox(0.86, 0.14, 0.78, 0.05), mats.seat, 0, 0.64, 0, false));
  chair.add(mesh(box(1.0, 1.5, 0.14), mats.steel, 0, 1.3, -0.42));
  chair.add(mesh(roundedBox(0.82, 0.9, 0.1, 0.05), mats.seat, 0, 1.26, -0.31, false));
  chair.add(mesh(box(0.12, 0.5, 0.12), mats.steelDark, 0, 0.25, 0));
  chair.add(mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.08, 16), mats.steelDark, 0, 0.05, 0));
  for (const sx of [-1, 1]) tube(chair, sx * 1.14, 0.9, -0.1, sx * 1.14, 0.9, 1.6, 0.03, kit.mats.neon('#ff2c9c'));
  g.add(chair);
  const seat: Interactable = { kind: 'seat', seatId: t.id, x: t.x, y: t.y, z: t.z, radius: 1.7 };
  chair.userData.interact = seat;
  kit.interactables.push(seat);
  // The console in front of the chair.
  g.add(mesh(box(4.2, 0.1, 0.9), mats.steel, 0, top + 0.78, front - 0.2));
  g.add(mesh(box(4.0, 0.7, 0.5), mats.steelDark, 0, top + 0.4, front - 0.2, false));
  g.add(mesh(box(4.0, 0.06, 0.06), kit.mats.neon('#2de2e6'), 0, top + 0.85, front + 0.24, false));
  // The wall of light behind: one great holo screen, framed in neon.
  const big = new THREE.Mesh(new THREE.PlaneGeometry(13, 5), flatMap(billboard(7)));
  big.position.set(t.x, 9.4, plan.bounds.minZ + 0.2);
  kit.group.add(big);
  kit.screens.push({ tex: (big.material as THREE.MeshBasicMaterial).map as THREE.CanvasTexture, speed: 0.008, base: big.material as THREE.MeshBasicMaterial });
  for (const [x0, y0, x1, y1] of [
    [-6.6, 6.9, 6.6, 6.9],
    [-6.6, 11.9, 6.6, 11.9],
    [-6.6, 6.9, -6.6, 11.9],
    [6.6, 6.9, 6.6, 11.9],
  ] as const)
    tube(kit.group, x0, y0, plan.bounds.minZ + 0.3, x1, y1, plan.bounds.minZ + 0.3, 0.05, kit.mats.neon('#ff2c9c'));
  floorGlow(kit, t.x, plan.bounds.minZ + 0.4, 0, 15, 9, '#ff2c9c', 0.22);
  kit.group.add(g);
  return seat;
}

/** The console benches the workers sit at, as the plan has them: a steel deck with an LED edge. */
function buildTables(kit: Kit, plan: MapPlan) {
  const { mats } = kit;
  for (const t of plan.tables) {
    const g = new THREE.Group();
    g.position.set(t.x, 0, t.z);
    g.rotation.y = t.rotY;
    g.add(mesh(roundedBox(t.width, 0.1, t.length, 0.04), mats.steel, 0, TABLE_TOP - 0.05, 0));
    g.add(mesh(box(t.width - 0.3, 0.3, t.length - 0.4), mats.steelDark, 0, TABLE_TOP - 0.25, 0, false));
    const legs = Math.max(2, Math.round(t.length / 3.2) + 1);
    for (let i = 0; i < legs; i++) {
      const lz = -t.length / 2 + 0.35 + (i * (t.length - 0.7)) / (legs - 1);
      g.add(mesh(box(t.width - 0.3, TABLE_TOP - 0.1, 0.1), mats.steelDark, 0, (TABLE_TOP - 0.1) / 2, lz));
    }
    // A glowing strip under each long edge, and a cable tray.
    for (const s of t.sides) g.add(mesh(box(0.05, 0.05, t.length - 0.3), kit.mats.neon(s < 0 ? '#ff2c9c' : '#2de2e6'), (s * t.width) / 2 - s * 0.03, TABLE_TOP - 0.14, 0, false));
    // A holo-terminal between every pair of places, and a case of parts.
    for (let i = 0; i < t.seats - 1; i++) {
      const lz = (i + 1 - t.seats / 2) * (t.length / t.seats);
      g.add(mesh(box(0.5, 0.05, 0.34), mats.steelDark, 0, TABLE_TOP + 0.03, lz, false));
      g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.28), flat(i % 2 ? '#2de2e6' : '#ff2c9c', 0.8)).rotateX(-Math.PI / 2).translateY(TABLE_TOP + 0.06).translateZ(lz));
    }
    for (const s of t.sides) {
      const bx = s * (t.width / 2 + BENCH_OUT);
      g.add(mesh(roundedBox(0.44, 0.1, t.length - 0.2, 0.03), mats.dark, bx, BENCH_TOP - 0.05, 0, false));
      for (let i = 0; i < legs; i++) {
        const lz = -t.length / 2 + 0.4 + (i * (t.length - 0.8)) / (legs - 1);
        g.add(mesh(box(0.36, BENCH_TOP - 0.1, 0.08), mats.steelDark, bx, (BENCH_TOP - 0.1) / 2, lz));
      }
      collide(kit, t.x + Math.cos(t.rotY) * bx, t.z - Math.sin(t.rotY) * bx, 0.44, t.length - 0.2, t.rotY, BENCH_TOP);
    }
    kit.group.add(g);
    collide(kit, t.x, t.z, t.width, t.length, t.rotY, TABLE_TOP);
  }
}

/** A place at a console bench: its terminal anchor, the worker on the bench, a mug and the '+'. */
function placeSetting(kit: Kit, def: DeskDef, overflow: boolean): { view: DeskView; it: Interactable } {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, TABLE_TOP, -0.02);
  laptopAnchor.scale.setScalar(1.1);
  g.add(laptopAnchor);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, BENCH_TOP - 0.08, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  g.add(seatAnchor);
  const stage = new THREE.Object3D();
  stage.position.set(0.66, TABLE_TOP - 0.07, 0.12);
  g.add(stage);
  // A mug of synth-coffee, and a little fan of mem-cards.
  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.075, 0.14, 10), toon('#2de2e6'), -0.64, TABLE_TOP + 0.07, 0.12, false));
  g.add(mesh(box(0.16, 0.02, 0.1), toon('#ffd60a'), -0.64, TABLE_TOP + 0.01, -0.14, false));
  const vacancy = vacancyMarker(1.35);
  g.add(vacancy);
  g.visible = !overflow;
  const it: Interactable = { kind: 'desk', deskId: def.id, ...deskSeat(def, 1.25), radius: 1.3, off: overflow };
  kit.interactables.push(it);
  g.userData.interact = it;
  kit.group.add(g);
  return { view: { def, group: g, laptopAnchor, seatAnchor, stage, chair: new THREE.Group(), vacancy, vacancyY: 1.35 }, it };
}

/** A board agent's info kiosk: a pedestal with a glowing screen, the agent standing behind it. */
function lectern(kit: Kit, def: DeskDef): DeskView {
  const kind = def.station!;
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const { steelDark, steel } = kit.mats;
  const color = STATION_AGENT[kind].color;
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.08, 12), steelDark, 0, 0.04, 0));
  g.add(mesh(box(0.14, 0.95, 0.14), steelDark, 0, 0.5, 0));
  const top = new THREE.Group();
  top.position.set(0, 1.0, 0);
  top.rotation.x = 0.35;
  top.add(mesh(box(KIOSK.width, 0.07, KIOSK.depth), steel, 0, 0, 0));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(KIOSK.width - 0.14, KIOSK.depth + 0.1), flat(shade(color, -0.3), 0.95));
  screen.position.set(0, 0.05, -0.05);
  screen.rotation.x = -Math.PI / 2;
  top.add(screen);
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(KIOSK.width - 0.2, 0.05), flat(color, 0.9));
  scan.position.set(0, 0.06, 0);
  scan.rotation.x = -Math.PI / 2;
  top.add(scan);
  g.add(top);
  const sign = textPlane(kind === 'issues' ? '📟 Ask me' : kind === 'pulls' ? '🔀 Ask me' : '📋 Ask me', { bg: '#0a0c12', color: '#ffffff', size: 52 });
  sign.scale.multiplyScalar(0.5);
  sign.position.set(0, 0.66, -0.12);
  sign.rotation.y = Math.PI;
  g.add(sign);
  g.add(mesh(box(KIOSK.width - 0.1, 0.5, 0.02), flat(shade(color, -0.5), 0.7), 0, 0.42, -0.09, false));
  g.add(mesh(box(KIOSK.width - 0.2, 0.04, 0.04), kit.mats.neon(color), 0, 0.18, -0.11, false));
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.visible = false;
  g.add(laptopAnchor);
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

/** A chrome stool at the meeting table. */
function councilChair(kit: Kit, def: DeskDef): DeskView {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const chair = new THREE.Group();
  chair.position.set(0, 0, 0.85);
  const { steel, steelDark, seat } = kit.mats;
  chair.add(mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.1, 14), seat, 0, 0.5, 0, false));
  chair.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.45, 8), steel, 0, 0.26, 0));
  chair.add(mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.05, 12), steelDark, 0, 0.03, 0));
  chair.add(mesh(roundedBox(0.5, 0.6, 0.08, 0.04), seat, 0, 0.92, 0.2, false));
  for (const sx of [-1, 1]) chair.add(mesh(box(0.06, 0.6, 0.06), steel, sx * 0.24, 0.62, 0.2));
  g.add(chair);
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, COUNCIL.height, -0.05);
  laptopAnchor.scale.setScalar(0.95);
  g.add(laptopAnchor);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.52, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  g.add(seatAnchor);
  const stage = new THREE.Object3D();
  stage.position.set(0.45, COUNCIL.height - 0.07, -0.1);
  g.add(stage);
  const vacancy = vacancyMarker(1.45);
  g.add(vacancy);
  kit.group.add(g);
  kit.colliders.push({ minX: def.x + Math.sin(def.rotY) * 0.85 - 0.3, maxX: def.x + Math.sin(def.rotY) * 0.85 + 0.3, minZ: def.z + Math.cos(def.rotY) * 0.85 - 0.3, maxZ: def.z + Math.cos(def.rotY) * 0.85 + 0.3, top: 0.55 });
  const it: Interactable = { kind: 'desk', deskId: def.id, ...deskSeat(def, 1.5), radius: 1.1 };
  kit.interactables.push(it);
  g.userData.interact = it;
  return { def, group: g, laptopAnchor, seatAnchor, stage, chair, vacancy, vacancyY: 1.45 };
}

/** The round holo table, its chairs, and the stand with the meeting's board and sign. */
function buildCouncil(kit: Kit, plan: MapPlan): { board?: THREE.Mesh; sign?: THREE.Mesh } {
  const cp = plan.council;
  if (!cp) return {};
  const { mats } = kit;
  const t = new THREE.Group();
  t.position.set(cp.x, 0, cp.z);
  t.add(mesh(new THREE.CylinderGeometry(COUNCIL.radius, COUNCIL.radius, 0.09, 32), mats.steelDark, 0, COUNCIL.height - 0.045, 0));
  t.add(mesh(new THREE.CylinderGeometry(0.24, 0.3, COUNCIL.height - 0.09, 12), mats.steel, 0, (COUNCIL.height - 0.09) / 2, 0));
  t.add(mesh(new THREE.TorusGeometry(COUNCIL.radius, 0.045, 6, 36).rotateX(Math.PI / 2), kit.mats.neon('#2de2e6'), 0, COUNCIL.height - 0.02, 0, false));
  // The projector in the middle of the table, with its holo above it.
  const holo = new THREE.Group();
  holo.position.y = COUNCIL.height;
  holo.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.1, 12), mats.steel, 0, 0.05, 0));
  const shape = new THREE.Group();
  shape.position.y = 0.75;
  const edge = flat('#7fd4ff', 0.9);
  shape.add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.016, 6, 22), edge));
  const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: '#7fd4ff', wireframe: true, transparent: true, opacity: 0.8, toneMapped: false }));
  shape.add(inner);
  const cone = mesh(new THREE.ConeGeometry(0.36, 1.3, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#7fd4ff', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }), 0, 0.7, 0, false);
  cone.rotation.x = Math.PI;
  holo.add(cone, shape);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#7fd4ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, 0.75, 0);
  glow.scale.setScalar(2.4);
  holo.add(glow);
  t.add(holo);
  kit.group.add(t);
  kit.holos.push({ group: holo, core: shape, cone, glow, color: new THREE.Color('#7fd4ff'), phase: Math.random() * 9, baseY: 0.75 });
  const r = COUNCIL.radius * Math.SQRT1_2;
  kit.colliders.push({ minX: cp.x - r, maxX: cp.x + r, minZ: cp.z - r, maxZ: cp.z + r, top: COUNCIL.height });
  const meeting: Interactable = { kind: 'meeting', x: cp.x, z: cp.z, radius: 2.2 };
  t.userData.interact = meeting;
  kit.interactables.push(meeting);
  for (const def of plan.meeting) kit.desks.set(def.id, councilChair(kit, def));
  // A holo board on a stand behind the table, away from its head.
  const stand = new THREE.Group();
  stand.position.set(cp.x - Math.sin(cp.rotY) * COUNCIL.easel, 0, cp.z - Math.cos(cp.rotY) * COUNCIL.easel);
  stand.rotation.y = cp.rotY;
  for (const sx of [-1, 1]) stand.add(mesh(box(0.1, 3.0, 0.1), mats.steelDark, sx * 1.15, 1.5, 0));
  stand.add(mesh(box(0.12, 2.6, 0.1), mats.steelDark, 0, 1.2, -0.5));
  stand.add(mesh(box(2.7, 1.7, 0.1), mats.steelDark, 0, 2.0, 0));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.5), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  board.position.set(0, 2.0, 0.06);
  stand.add(board);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.34), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  sign.position.set(0, 0.9, 0.06);
  stand.add(mesh(box(1.3, 0.44, 0.08), mats.steelDark, 0, 0.9, 0));
  stand.add(sign);
  const title = textPlane('🤝 The war room', { bg: '#0a0c12', color: '#ffffff', size: 56 });
  title.scale.multiplyScalar(0.62);
  title.position.set(0, 3.08, 0.06);
  stand.add(title);
  tube(stand, -1.25, 2.9, 0.08, 1.25, 2.9, 0.08, 0.03, kit.mats.neon('#7fd4ff'));
  stand.userData.interact = meeting;
  kit.group.add(stand);
  const [minX, maxX, minZ, maxZ] = boxFootprint(stand.position.x, stand.position.z, 2.7, 0.6, cp.rotY);
  kit.colliders.push({ minX, maxX, minZ, maxZ, top: 99 });
  return { board, sign };
}

/** The four boards, in steel frames with neon labels, on the side walls. */
function buildBoards(kit: Kit, plan: MapPlan): Record<BoardKey, THREE.Mesh> {
  const faces = {} as Record<BoardKey, THREE.Mesh>;
  for (const k of BOARD_KEYS) {
    const bd = plan.boards[k];
    const nx = Math.sin(bd.rotY);
    const nz = Math.cos(bd.rotY);
    const g = new THREE.Group();
    g.position.set(bd.x + nx * 0.1, bd.y, bd.z + nz * 0.1);
    g.rotation.y = bd.rotY;
    g.add(mesh(box(bd.width + 0.4, bd.height + 0.4, 0.12), kit.mats.steelDark, 0, 0, 0));
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) g.add(mesh(box(0.26, 0.26, 0.06), kit.mats.steel, sx * (bd.width / 2 + 0.02), sy * (bd.height / 2 + 0.02), 0.08, false));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(bd.width, bd.height), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    face.position.z = 0.07;
    g.add(face);
    faces[k] = face;
    const label = textPlane(bd.label, { bg: '#0a0c12', color: '#ffffff', size: 64, border: '#2de2e6' });
    label.scale.multiplyScalar(1.1);
    label.position.set(0, bd.height / 2 + 0.55, 0.06);
    g.add(label);
    tube(g, -bd.width / 2 - 0.2, bd.height / 2 + 0.32, 0.08, bd.width / 2 + 0.2, bd.height / 2 + 0.32, 0.08, 0.03, kit.mats.neon(k === 'pulls' ? '#ff2c9c' : k === 'queue' ? '#ffd60a' : '#2de2e6'));
    const it: Interactable = { kind: k, x: bd.x + nx * 1.6, z: bd.z + nz * 1.6, radius: 2.4 };
    kit.interactables.push(it);
    g.userData.interact = it;
    kit.group.add(g);
  }
  return faces;
}

/** The Fixer: a long coat, shades, and a pin that glows, where the plan has them. */
function buildHerald(kit: Kit, plan: MapPlan): World['herald'] {
  const hd = plan.herald;
  if (!hd) return undefined;
  const person = new Person(hd.name, '#2a1f3d', { skin: 2, hair: 1, style: 0 });
  const y = kit.floorAt(hd.x, hd.z);
  person.root.position.set(hd.x, y, hd.z);
  person.root.rotation.y = hd.rotY;
  person.setLabel(hd.name, null);
  person.setDoing(hd.says);
  const coat = mesh(
    new THREE.LatheGeometry(
      [
        [0.37, 0.02],
        [0.32, 0.5],
        [0.28, 1.05],
      ].map(([r, yy]) => new THREE.Vector2(r, yy)),
      20,
    ),
    toon('#2a1f3d'),
  );
  person.root.add(coat);
  person.wear(mesh(box(0.5, 0.06, 0.08), toon('#ff2c9c'), 0, 1.05, 0.26, false), 'body');
  // Shades, and the pin of the office.
  person.wear(mesh(box(0.3, 0.07, 0.06), toon('#0a0c12'), 0, 0.76, 0.26, false), 'head');
  person.wear(mesh(box(0.07, 0.08, 0.03), kit.mats.neon('#2de2e6'), 0.13, 0.9, 0.25, false), 'body');
  kit.group.add(person.root);
  const interactable: Interactable = { kind: 'herald', x: hd.x + Math.sin(hd.rotY) * 0.9, y, z: hd.z + Math.cos(hd.rotY) * 0.9, radius: 1.9 };
  person.root.userData.interact = interactable;
  kit.interactables.push(interactable);
  kit.colliders.push({ minX: hd.x - 0.35, maxX: hd.x + 0.35, minZ: hd.z - 0.35, maxZ: hd.z + 0.35, top: 99 });
  return { person, interactable };
}

/** One of CorpSec (the map's escort): an armoured vest, a visor that glows, and a stun baton. */
function corpsSec(kit: Kit, name: string, color: string): Person {
  const person = new Person(name, color, { skin: 3, hair: 0, style: 6 });
  person.setLabel(name, null);
  const { steelDark, steel } = kit.mats;
  const helm = new THREE.Group();
  helm.add(mesh(new THREE.SphereGeometry(0.35, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.85), steelDark, 0, 0.03, -0.01));
  const visor = mesh(box(0.44, 0.1, 0.12), kit.mats.neon(color), 0, 0.05, 0.26, false);
  visor.rotation.x = -0.1;
  helm.add(visor);
  person.wear(helm, 'head');
  const vest = mesh(
    new THREE.LatheGeometry(
      [
        [0.34, 0.32],
        [0.32, 0.7],
        [0.3, 1.02],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      18,
    ),
    steelDark,
  );
  person.wear(vest, 'body');
  person.wear(mesh(box(0.3, 0.1, 0.04), toon(color), 0, 0.82, 0.29, false), 'body');
  const baton = new THREE.Group();
  baton.add(mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.7, 6), steel, 0, 0.1, 0));
  baton.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6), kit.mats.neon(color), 0, 0.5, 0, false));
  baton.position.set(0, -0.4, 0.02);
  baton.rotation.x = 0.1;
  person.wear(baton, 'offhand');
  return person;
}

/** The map's escort (MapPlan.sendHome), on watch at its post, and how to call out another. */
function buildEscort(kit: Kit, plan: MapPlan): World['escort'] {
  const e = plan.sendHome?.escort;
  if (!e) return undefined;
  const make = () => corpsSec(kit, e.name, e.color);
  const person = make();
  person.root.position.set(e.post.x, e.post.y, e.post.z);
  person.root.rotation.y = e.post.rotY;
  kit.group.add(person.root);
  return { post: e.post, guard: person, make };
}

/** Puts up the plaza in `plan` (a cyberpunk-style map). */
export function buildCyberpunk(plan: MapPlan): World {
  const c = plan.config!;
  const b = plan.bounds;
  const H = plan.height;
  const pal = { stone: '#2b323e', floor: '#1b1f28', trim: '#2de2e6', ...(c.palette ?? {}) };
  const group = new THREE.Group();
  const mats: CyberMats = {
    wall: toon(pal.stone),
    floor: toon(pal.floor),
    steel: toon('#5b6472'),
    steelDark: toon('#2c313b'),
    dark: toon('#1b1e26'),
    darkAlt: toon('#232733'),
    neon: neonMat,
    white: toon('#e9eef5'),
    gold: toon('#ffd60a'),
    seat: toon('#ff2c9c'),
  };
  const props = c.props ?? [];
  const kit: Kit = {
    group,
    still: new THREE.Group(),
    colliders: [],
    interactables: [],
    mats,
    height: H,
    bounds: b,
    ledColor: pal.trim,
    desks: new Map(),
    banners: [],
    holos: [],
    screens: [],
    neons: [],
    flames: [],
    pillars: props.filter((p) => p.kind === 'pillar').map((p) => ({ x: p.x, z: p.z })),
    floorAt(x, z) {
      let top = 0;
      for (const cc of kit.colliders) if (cc.top < 50 && !cc.fence && cc.top > top && x > cc.minX && x < cc.maxX && z > cc.minZ && z < cc.maxZ) top = cc.top;
      return top;
    },
  };
  kit.steam = new Steam(props.filter((p) => p.kind === 'vent').length * 14);
  const shell = buildShell(kit, plan, { floor: pal.floor, stone: pal.stone, trim: pal.trim });
  buildDais(kit, plan);
  for (const p of props) PROPS[p.kind as PropKind](kit, p);
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
  const escort = buildEscort(kit, plan);
  group.add(kit.steam.points);
  group.add(mergeByMaterial(kit.still));

  // Walking about: in through the doorway and out again, round what's in the way.
  const nav = new NavGrid(b, plan.obstacles!);
  const { doorAt, out, gate } = shell;
  const inside: Pt = [plan.door.x, plan.door.z];
  const threshold: Pt = [doorAt.x + out[0] * 0.2, doorAt.z + out[1] * 0.2];
  const beyond: Pt = [doorAt.x + out[0] * 3.5, doorAt.z + out[1] * 3.5];
  const gongAt = kit.gong?.top;

  // What setLook and setProjectName were last told, which the ad boards show.
  let name = '';
  let look: FloorPalette = { name: '', wall: pal.stone, trim: pal.trim, floor: pal.floor, floorAlt: pal.floor, seam: pal.floor };
  const repaint = () => {
    for (const bn of kit.banners) {
      paintAd(bn.tex.image.getContext('2d') as CanvasRenderingContext2D, bn.w, bn.h, look.trim || pal.trim, bn.great ? name : undefined);
      bn.tex.needsUpdate = true;
    }
  };

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
    rain: [{ area: b, top: () => H - 1.2 }],
    device: 'laptop',
    room: { wall: WALL, enclosed: true },
    acoustics: {
      gong: gongAt ? { x: gongAt.x, y: gongAt.y - 1.6, z: gongAt.z } : null,
      windows: [
        { x: 0, y: 4, z: b.maxZ - 0.5 },
        { x: -b.maxX + 0.5, y: 6, z: 0 },
        { x: b.maxX - 0.5, y: 6, z: 0 },
        { x: 0, y: 8, z: b.minZ + 0.5 },
      ],
    },
    escort,
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
      look = p;
      repaint();
    },
    setProjectName(n) {
      if (n === name) return;
      name = n;
      repaint();
    },
    update(t, dt, people) {
      // The neon flickers, the holograms turn, the ads scroll, the rain falls.
      for (const n of kit.neons) {
        const k = 0.86 + 0.1 * Math.sin(t * 5.5 + n.phase) + 0.04 * Math.sin(t * 27 + n.phase * 3);
        n.light.intensity = n.base * k * (Math.sin(t * 0.7 + n.phase) > -0.96 ? 1 : 0.25);
      }
      for (const f of kit.flames) {
        const k = 0.85 + 0.12 * Math.sin(t * 13 + f.phase) + 0.08 * Math.sin(t * 29 + f.phase * 2);
        f.group.scale.y = (f.size || 1) * k;
        f.group.rotation.y = t * 2 + f.phase;
        f.glow.material.opacity = 0.5 + 0.3 * k;
      }
      for (const h of kit.holos) {
        h.core.rotation.y = t * 0.6 + h.phase;
        h.core.position.y = h.baseY + Math.sin(t * 1.3 + h.phase) * 0.08;
        const k = 0.75 + 0.2 * Math.sin(t * 6 + h.phase) + (Math.sin(t * 0.43 + h.phase) > 0.985 ? -0.55 : 0);
        h.glow.material.opacity = Math.max(0.1, k);
        (h.cone.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.06 * k;
      }
      for (const s of kit.screens) {
        s.tex.offset.y = (s.tex.offset.y + dt * s.speed) % 1;
        s.base.opacity = 0.88 + 0.1 * Math.sin(t * 9 + s.speed * 100);
      }
      kit.steam?.update(t);
      const R = kit.rain;
      if (R) {
        for (let i = 0; i < R.n; i++) {
          const home = R.homes[i];
          const y = (((home[1] - t * home[3] * 26) % 46) + 46) % 46 - 6;
          R.pos[i * 6] = home[0];
          R.pos[i * 6 + 1] = y;
          R.pos[i * 6 + 2] = home[2];
          R.pos[i * 6 + 3] = home[0] + 0.06;
          R.pos[i * 6 + 4] = y - 1.3;
          R.pos[i * 6 + 5] = home[2];
        }
        R.lines.geometry.attributes.position.needsUpdate = true;
      }
      (gate.material as THREE.MeshBasicMaterial).opacity = 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(t * 1.7));
      for (const d of kit.desks.values()) {
        if (!d.vacancy.visible || !d.group.visible || d.def.station) continue;
        d.vacancy.position.y = d.vacancyY + Math.sin(t * 2 + d.def.x) * 0.06;
        d.vacancy.rotation.y = t * 1.2;
      }
      kit.gong?.update(dt);
      herald?.person.update(dt, t, false, false);
    },
    mood(lights, _daylight) {
      // Night, whatever the sky says: a violet haze, the city's glow, and the neon doing the lighting.
      lights.hemi.color.set('#2c1a4d');
      lights.hemi.groundColor.set('#161028');
      lights.hemi.intensity = 0.7;
      lights.ambient.color.set('#573272');
      lights.ambient.intensity = 0.62;
      lights.sun.intensity *= 0.16;
      const fog = lights.scene.fog as THREE.Fog | null;
      if (fog) {
        fog.color.set('#2a1240');
        fog.near = 30;
        fog.far = 300;
      }
    },
    dispose() {
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






