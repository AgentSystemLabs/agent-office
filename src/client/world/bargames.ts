import * as THREE from 'three';
import { AXE_LANE, AXE_TARGET, DART, DARTBOARD, DART_NUMBERS, targetFrame, throwSpot, type BarGame, type Score, type Toss } from '../../shared/bargames';
import { FLOOR } from '../../shared/layout';
import type { Collider, Interactable } from './office';
import { bulb, type NightParts } from './outside';
import { disposeSprite, mergeByMaterial, mesh, textPlane, textSprite, toon } from './toon';

// The rooftop bar's games corner (see shared/bargames.ts): an axe-throwing booth against the north
// edge with its target on the back wall, and a dart board in a cabinet on the outside of the booth,
// each with a chalkboard for the round being thrown. The darts and axes flying at them, and stuck in
// them, are everyone's: whoever throws, every page up there flies it the same way to the same spot.

/** Seconds a dart takes to the board, and an axe to the target (a turn and a bit on the way). */
const DART_FLIGHT = 0.3;
const AXE_FLIGHT = 0.62;
/**
 * The axe, in its own frame: the handle up +y from where the hands hold it (0), the head at the top
 * with its edge forward (+z). `edge` is the middle of the edge, `mass` where it turns about in flight.
 */
const AXE = { edge: new THREE.Vector3(0, 0.365, 0.113), mass: new THREE.Vector3(0, 0.28, 0.02) } as const;
/** How far an axe that sticks is turned past upright (its handle's top toward the target), radians. */
const AXE_HIT = 0.42;

const WOOD = '#6b4428';
const WOOD_LIGHT = '#8a5a34';
const INK = '#2b2d42';
const CHALK = '#f1f1ea';

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

/** A toon material with a picture on it, banded like everything else. */
function toonMap(map: THREE.Texture): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** The dart board's face: the numbers' wedges, the treble and double rings, the bulls and the ring of numbers round it. */
function dartboardTexture(): THREE.CanvasTexture {
  const S = 1024;
  const px = S / 2 / DART.board;
  return canvasTexture(S, S, (g) => {
    const c = S / 2;
    g.fillStyle = '#141414';
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    const wedge = (r0: number, r1: number, a: number, color: string) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(c, c, r1 * px, a - Math.PI / 20, a + Math.PI / 20);
      g.arc(c, c, r0 * px, a + Math.PI / 20, a - Math.PI / 20, true);
      g.closePath();
      g.fill();
    };
    for (let i = 0; i < 20; i++) {
      // Clockwise from the top: on the canvas, y runs down, so that's clockwise from -π/2.
      const a = -Math.PI / 2 + (i * Math.PI) / 10;
      const dark = i % 2 === 0;
      wedge(DART.outer, DART.doubleOut, a, dark ? '#1b1b1b' : '#efe3c8');
      wedge(DART.trebleIn, DART.trebleOut, a, dark ? '#d62828' : '#2a9d4b');
      wedge(DART.doubleIn, DART.doubleOut, a, dark ? '#d62828' : '#2a9d4b');
    }
    g.fillStyle = '#2a9d4b';
    g.beginPath();
    g.arc(c, c, DART.outer * px, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d62828';
    g.beginPath();
    g.arc(c, c, DART.bull * px, 0, Math.PI * 2);
    g.fill();
    // The wire: round the rings, and out along the wedges' edges.
    g.strokeStyle = '#c9ccd3';
    g.lineWidth = 2.5;
    for (const r of [DART.outer, DART.trebleIn, DART.trebleOut, DART.doubleIn, DART.doubleOut]) {
      g.beginPath();
      g.arc(c, c, r * px, 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = 0; i < 20; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 10 - Math.PI / 20;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * DART.outer * px, c + Math.sin(a) * DART.outer * px);
      g.lineTo(c + Math.cos(a) * DART.doubleOut * px, c + Math.sin(a) * DART.doubleOut * px);
      g.stroke();
    }
    g.fillStyle = '#f5f5f5';
    g.font = '900 54px Nunito, ui-rounded, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const numbersAt = ((DART.doubleOut + DART.board) / 2) * px;
    DART_NUMBERS.forEach((n, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 10;
      g.fillText(String(n), c + Math.cos(a) * numbersAt, c + Math.sin(a) * numbersAt);
    });
  });
}

/** The axe target: rings painted on pale planks, a number in each, and the two blue killshot dots. */
function axeTargetTexture(): THREE.CanvasTexture {
  const px = 512;
  const W = Math.round(AXE_TARGET.width * px);
  const H = Math.round(AXE_TARGET.height * px);
  return canvasTexture(W, H, (g) => {
    // Upright planks, each its own shade, with a little grain.
    const planks = 5;
    for (let i = 0; i < planks; i++) {
      const x = (i * W) / planks;
      const tone = 0.9 + ((i * 7) % 5) * 0.035;
      g.fillStyle = `rgb(${Math.round(222 * tone)}, ${Math.round(186 * tone)}, ${Math.round(140 * tone)})`;
      g.fillRect(x, 0, W / planks, H);
      g.strokeStyle = 'rgba(110, 70, 35, 0.18)';
      g.lineWidth = 2;
      for (let k = 0; k < 9; k++) {
        const gx = x + 12 + ((k * 37 + i * 13) % (W / planks - 24));
        g.beginPath();
        g.moveTo(gx, 0);
        g.bezierCurveTo(gx + 6, H * 0.3, gx - 6, H * 0.6, gx + 3, H);
        g.stroke();
      }
      g.fillStyle = 'rgba(60, 35, 15, 0.45)';
      g.fillRect(x, 0, 3, H);
    }
    const cx = W / 2;
    const cy = H / 2;
    const rings = [...AXE_TARGET.rings].reverse();
    rings.forEach((ring, i) => {
      g.fillStyle = ring.points === 6 ? '#e63946' : i % 2 === 0 ? '#f7f3ea' : '#22223b';
      g.beginPath();
      g.arc(cx, cy, ring.r * px, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#111';
      g.lineWidth = 5;
      g.stroke();
    });
    g.font = '900 44px Nunito, ui-rounded, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    rings.forEach((ring, i) => {
      if (ring.points === 6) return;
      const inner = rings[i + 1]?.r ?? 0;
      g.fillStyle = i % 2 === 0 ? '#22223b' : '#f7f3ea';
      g.fillText(String(ring.points), cx, cy - ((ring.r + inner) / 2) * px);
    });
    g.fillStyle = '#fff';
    g.fillText('6', cx, cy + 2);
    const k = AXE_TARGET.kill;
    for (const s of [-1, 1]) {
      g.fillStyle = '#118ab2';
      g.beginPath();
      g.arc(cx + s * k.u * px, cy - k.v * px, k.r * px, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.stroke();
    }
  });
}

/** A toon material of its own, left out of the outlines (they'd swamp something as thin as a dart). */
function plain(color: string, side: THREE.Side = THREE.FrontSide): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color, side, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  m.userData.outlineParameters = { visible: false };
  return m;
}

let dartParts: { steel: THREE.Material; barrel: THREE.Material; shaft: THREE.Material; flights: Map<string, THREE.Material> } | null = null;

/**
 * A dart, its tip at the origin pointing +z: steel tip, tungsten barrel, shaft, and flights in
 * `color`. Half as big again as a real one, like everything here, so it shows from the oche.
 */
export function dartModel(color: string): THREE.Group {
  const m = (dartParts ??= { steel: plain('#dfe3ea'), barrel: plain('#4a4e69'), shaft: plain('#eaeaea'), flights: new Map() });
  let flight = m.flights.get(color);
  if (!flight) m.flights.set(color, (flight = plain(color, THREE.DoubleSide)));
  const g = new THREE.Group();
  const along = (geo: THREE.BufferGeometry) => geo.rotateX(Math.PI / 2);
  g.add(mesh(along(new THREE.ConeGeometry(0.004, 0.035, 6)).translate(0, 0, -0.0175), m.steel, 0, 0, 0, false));
  g.add(mesh(along(new THREE.CylinderGeometry(0.0075, 0.006, 0.055, 8)), m.barrel, 0, 0, -0.062, false));
  g.add(mesh(along(new THREE.CylinderGeometry(0.003, 0.003, 0.045, 6)), m.shaft, 0, 0, -0.11, false));
  for (const r of [0, Math.PI / 2]) {
    const fin = mesh(new THREE.BoxGeometry(0.004, 0.042, 0.045), flight, 0, 0, -0.14, false);
    fin.rotation.z = r;
    g.add(fin);
  }
  g.scale.setScalar(1.5);
  return g;
}

/** An axe (see AXE): a wooden handle with black tape round the grip, and a steel head with its edge forward. */
export function axeModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.46, 8), toon('#c68b59'), 0, 0.17, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 8), toon('#1d1d1d'), 0, -0.01, 0, false));
  // The head: a block round the top of the handle, the blade flaring out forward from it to the edge.
  const steel = toon('#8d99ae');
  g.add(mesh(new THREE.BoxGeometry(0.04, 0.08, 0.07), steel, 0, 0.365, 0, false));
  const blade = new THREE.Shape();
  blade.moveTo(0.02, 0.335);
  blade.lineTo(0.105, 0.3);
  blade.quadraticCurveTo(0.125, 0.365, 0.105, 0.43);
  blade.lineTo(0.02, 0.395);
  blade.closePath();
  const geo = new THREE.ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.006, 0, 0);
  g.add(mesh(geo, steel, 0, 0, 0, false));
  // A bright line along the edge, freshly sharpened.
  g.add(mesh(new THREE.BoxGeometry(0.014, 0.12, 0.012), toon('#e9ecef'), 0, 0.365, 0.112, false));
  return g;
}

/** Something flying at a target, or stuck in it, or lying where it fell. */
interface Thrown {
  game: BarGame;
  obj: THREE.Object3D;
  t: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** How high it arcs over the straight line, in the middle. */
  arc: number;
  stage: 'fly' | 'stuck' | 'fall' | 'lie';
  /** An axe: its turn over the handle at the start and at the target, and the way it's thrown. */
  a0: number;
  a1: number;
  yaw: THREE.Quaternion;
  stick: boolean;
  /** Falling off the target: how fast, and how fast it turns. */
  vel: THREE.Vector3;
  spin: number;
  land: () => void;
}

export interface BarGamesView {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  /** Where (u, v) on a game's target is, `into` meters into its face (out of it, if negative). */
  point(game: BarGame, u: number, v: number, out: THREE.Vector3, into?: number): THREE.Vector3;
  /**
   * A throw: it flies from `from` (an axe held turned `a0` over its handle, see AXE) to where `toss`
   * says on its target, and sticks there (an axe that doesn't bounces off and falls). `color` is the
   * thrower's, for the flights. `land` is called as it gets there.
   */
  launch(toss: Toss, from: THREE.Vector3, a0: number, color: string, land: () => void): void;
  /** Pulls the darts out of the board (or the axes out of the target and up off the floor). */
  clear(game: BarGame): void;
  /** The round being thrown on a game's chalkboard, or a blank one. */
  chalk(game: BarGame, round: { name: string; color: string; scores: Score[] } | null): void;
  /** Where you're aiming on a game's target, while you are (null: nowhere). */
  aim(game: BarGame | null, u?: number, v?: number): void;
  /** What a throw scored, floating up off its target and fading, on the thrower's color. */
  pop(game: BarGame, text: string, color: string): void;
  /** An axe that bounced off landed on the mat here. */
  onDrop: ((at: THREE.Vector3) => void) | null;
  update(dt: number, dark: number): void;
}

export function buildBarGames(night: NightParts): BarGamesView {
  const group = new THREE.Group();
  const statics = new THREE.Group();
  const colliders: Collider[] = [];
  const interactables: Interactable[] = [];
  const wood = toon(WOOD);
  const trim = toon(WOOD_LIGHT);
  const L = AXE_LANE;
  const back = FLOOR.minZ;
  const front = back + L.depth;

  // ---- The axe lane --------------------------------------------------------------------------------
  // The back wall, right across the booth, and a side wall either side, open to the south.
  const outerW = L.maxX - L.minX + 2 * L.wall;
  const midX = (L.minX + L.maxX) / 2;
  const backT = L.target.z - 0.1 - back;
  // The walls stand side-on to the sun much of the day, which speckles them with their own shadow:
  // they cast one, but don't take any.
  const walls = new THREE.Group();
  walls.add(mesh(new THREE.BoxGeometry(outerW, L.height, backT), wood, midX, L.height / 2, back + backT / 2));
  colliders.push({ minX: L.minX - L.wall, maxX: L.maxX + L.wall, minZ: back, maxZ: back + backT, top: 99 });
  for (const x of [L.minX - L.wall / 2, L.maxX + L.wall / 2]) {
    walls.add(mesh(new THREE.BoxGeometry(L.wall, L.height, L.depth), wood, x, L.height / 2, back + L.depth / 2));
    statics.add(mesh(new THREE.BoxGeometry(L.wall + 0.06, 0.08, L.depth + 0.06), trim, x, L.height + 0.04, back + L.depth / 2, false));
    colliders.push({ minX: x - L.wall / 2, maxX: x + L.wall / 2, minZ: back, maxZ: front, top: 99 });
  }
  statics.add(mesh(new THREE.BoxGeometry(outerW + 0.06, 0.08, backT + 0.06), trim, midX, L.height + 0.04, back + backT / 2, false));
  // The target, on planks bolted to the back wall.
  const t = L.target;
  const target = new THREE.Group();
  target.add(mesh(new THREE.BoxGeometry(AXE_TARGET.width, AXE_TARGET.height, 0.1), trim, t.x, t.y, t.z - 0.05));
  target.add(mesh(new THREE.PlaneGeometry(AXE_TARGET.width, AXE_TARGET.height), toonMap(axeTargetTexture()), t.x, t.y, t.z + 0.001, false));
  group.add(target);
  // A rubber mat down the lane, and the red line to throw from.
  statics.add(mesh(new THREE.PlaneGeometry(L.maxX - L.minX, L.line).rotateX(-Math.PI / 2), toon('#3a3d4f'), midX, 0.006, t.z + L.line / 2, false));
  statics.add(mesh(new THREE.PlaneGeometry(L.maxX - L.minX + 2 * L.wall + 0.3, 0.08).rotateX(-Math.PI / 2), toon('#e63946'), midX, 0.01, t.z + L.line, false));
  // Two spare axes on pegs on the inside of the east wall, by the front.
  for (const [i, z] of [-9.95, -10.35].entries()) {
    const spare = axeModel();
    spare.position.set(L.maxX - 0.03, 1.1 + i * 0.05, z);
    spare.rotation.set(0, -Math.PI / 2, 0.12);
    group.add(spare);
    statics.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6).rotateZ(Math.PI / 2), toon(INK), L.maxX - 0.03, 1.43 + i * 0.05, z, false));
  }
  // A lamp over the target, on an arm off the top of the back wall.
  const lampMat = bulb(night, '#fff1c9', 0.5);
  statics.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.7), toon(INK), t.x, L.height - 0.1, back + backT + 0.3, false));
  group.add(mesh(new THREE.ConeGeometry(0.22, 0.2, 16, 1, true), plain(INK, THREE.DoubleSide), t.x, L.height - 0.18, t.z + 0.6, false));
  statics.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), lampMat, t.x, L.height - 0.25, t.z + 0.6, false));
  // Its sign, standing on top of the back wall.
  const axeSign = textPlane('🪓 AXE THROWING', { bg: '#1d1d1d', color: '#ffd166', size: 64, border: '#ffd166' });
  axeSign.position.set(midX, L.height + 0.42, back + backT + 0.02);
  group.add(axeSign);

  const axeAt = throwSpot('axe');
  const axeIt: Interactable = { kind: 'axe', x: axeAt.x, z: axeAt.z, radius: 1.5 };
  interactables.push(axeIt);
  target.userData.interact = axeIt;

  // ---- The dart board ------------------------------------------------------------------------------
  // In a cabinet on the outside of the booth's east wall, its doors open flat either side.
  const D = DARTBOARD;
  const wallX = L.maxX + L.wall;
  const cabinet = new THREE.Group();
  cabinet.position.set(wallX, D.y, D.z);
  // Built facing +z, then turned to face +x like the board.
  cabinet.rotation.y = Math.PI / 2;
  cabinet.add(mesh(new THREE.BoxGeometry(0.66, 0.66, 0.035), wood, 0, 0, 0.0175));
  for (const s of [-1, 1]) {
    cabinet.add(mesh(new THREE.BoxGeometry(0.66, 0.035, 0.1), trim, 0, s * 0.33, 0.05));
    cabinet.add(mesh(new THREE.BoxGeometry(0.035, 0.66, 0.1), trim, s * 0.33, 0, 0.05));
    // A door, swung right round against the wall.
    cabinet.add(mesh(new THREE.BoxGeometry(0.33, 0.66, 0.025), wood, s * (0.33 + 0.18), 0, 0.0125));
  }
  // The board's face is D.x: as you face it, the picture's right is your right.
  const face = D.x - wallX;
  cabinet.add(mesh(new THREE.CylinderGeometry(DART.board + 0.005, DART.board + 0.005, 0.045, 48).rotateX(Math.PI / 2), toon('#141414'), 0, 0, face - 0.0235));
  cabinet.add(mesh(new THREE.CircleGeometry(DART.board, 64), toonMap(dartboardTexture()), 0, 0, face, false));
  // A ring of light round it.
  const ringMat = bulb(night, '#fff6e0', 0.35);
  cabinet.add(mesh(new THREE.TorusGeometry(0.29, 0.012, 6, 40), ringMat, 0, 0, 0.1, false));
  group.add(cabinet);
  colliders.push({ minX: wallX, maxX: wallX + 0.12, minZ: D.z - 0.7, maxZ: D.z + 0.7, top: 99 });
  // The oche: a raised strip on a mat running back from the board.
  const oche = D.x + D.oche;
  const matLen = D.oche + 0.5;
  statics.add(mesh(new THREE.PlaneGeometry(matLen, 0.7).rotateX(-Math.PI / 2), toon('#3a3d4f'), wallX + matLen / 2, 0.006, D.z, false));
  statics.add(mesh(new THREE.BoxGeometry(0.05, 0.035, 0.66), toon('#c0a062'), oche, 0.0175, D.z, false));
  const dartSign = textPlane('🎯 DARTS', { bg: '#1d1d1d', color: '#8ecae6', size: 64, border: '#8ecae6' });
  dartSign.position.set(wallX + 0.02, L.height + 0.3, D.z);
  dartSign.rotation.y = Math.PI / 2;
  group.add(dartSign);

  const dartAt = throwSpot('darts');
  const dartIt: Interactable = { kind: 'darts', x: dartAt.x, z: dartAt.z, radius: 1.3 };
  interactables.push(dartIt);
  cabinet.userData.interact = dartIt;

  // ---- The chalkboards -----------------------------------------------------------------------------
  const chalkboard = (w: number, h: number) => {
    const tex = canvasTexture(512, Math.round((512 * h) / w), () => {});
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.03), trim, 0, 0, 0.015));
    const face = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }), 0, 0, 0.032, false);
    (face.material as THREE.Material).userData.outlineParameters = { visible: false };
    g.add(face);
    return { g, tex };
  };
  // To the right of the dart board as you face it (north), and on the inside of the booth's west wall.
  const dartChalk = chalkboard(0.72, 0.82);
  dartChalk.g.position.set(wallX, 1.6, D.z - 1.12);
  dartChalk.g.rotation.y = Math.PI / 2;
  group.add(dartChalk.g);
  const axeChalk = chalkboard(0.9, 0.8);
  axeChalk.g.position.set(L.minX, 1.55, front - 0.75);
  axeChalk.g.rotation.y = Math.PI / 2;
  group.add(axeChalk.g);
  const boards: Record<BarGame, { tex: THREE.CanvasTexture; title: string }> = {
    darts: { tex: dartChalk.tex, title: '🎯 Darts' },
    axe: { tex: axeChalk.tex, title: '🪓 Axes' },
  };

  const drawChalk = (game: BarGame, round: { name: string; color: string; scores: Score[] } | null) => {
    const { tex, title } = boards[game];
    const c = tex.image as HTMLCanvasElement;
    const g = c.getContext('2d')!;
    const W = c.width;
    const H = c.height;
    g.fillStyle = '#26332d';
    g.fillRect(0, 0, W, H);
    const font = (px: number) => `800 ${px}px "Chalkboard SE", "Comic Sans MS", Nunito, ui-rounded, sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillStyle = CHALK;
    g.font = font(52);
    g.fillText(title, W / 2, 50);
    g.fillRect(40, 88, W - 80, 3);
    if (!round) {
      g.font = font(40);
      g.globalAlpha = 0.75;
      g.fillText('Step up and', W / 2, H / 2 - 10);
      g.fillText('press E!', W / 2, H / 2 + 42);
      g.globalAlpha = 1;
      tex.needsUpdate = true;
      return;
    }
    g.font = font(40);
    g.fillStyle = round.color;
    g.fillText(round.name.length > 16 ? `${round.name.slice(0, 15)}…` : round.name, W / 2, 132);
    g.fillStyle = CHALK;
    g.font = font(36);
    g.textAlign = 'left';
    const rows = game === 'darts' ? 3 : 5;
    const top = 190;
    const step = Math.min(58, (H - top - 90) / rows);
    for (let i = 0; i < rows; i++) {
      const s = round.scores[i];
      const y = top + i * step;
      g.globalAlpha = s ? 1 : 0.35;
      g.fillText(`${i + 1}.`, 60, y);
      g.fillText(s ? s.label : '—', 130, y);
      g.textAlign = 'right';
      if (s) g.fillText(String(s.points), W - 60, y);
      g.textAlign = 'left';
    }
    g.globalAlpha = 1;
    const total = round.scores.reduce((a, s) => a + s.points, 0);
    g.fillRect(40, H - 78, W - 80, 3);
    g.font = font(44);
    g.fillText('Total', 60, H - 40);
    g.textAlign = 'right';
    g.fillText(String(total), W - 60, H - 40);
    tex.needsUpdate = true;
  };
  drawChalk('darts', null);
  drawChalk('axe', null);

  // A warm light over the corner, once it's getting dark.
  const light = new THREE.PointLight('#ffd8a8', 0, 10, 1.2);
  light.position.set(wallX + 0.8, 2.9, D.z + 0.8);
  group.add(light);

  group.add(mergeByMaterial(statics));
  const wallMesh = mergeByMaterial(walls);
  wallMesh.traverse((o) => (o.receiveShadow = false));
  group.add(wallMesh);

  // ---- Aiming ----------------------------------------------------------------------------------------
  const reticle = (r: number) => {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.95 });
    const dot = new THREE.MeshBasicMaterial({ color: '#ff006e', depthTest: false, transparent: true, opacity: 0.95 });
    g.add(new THREE.Mesh(new THREE.RingGeometry(r * 0.72, r, 32), mat));
    g.add(new THREE.Mesh(new THREE.RingGeometry(r * 0.5, r * 0.72, 32), dot));
    g.add(new THREE.Mesh(new THREE.CircleGeometry(r * 0.16, 12), dot));
    g.traverse((o) => {
      o.renderOrder = 20;
      o.raycast = () => {};
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.userData.outlineParameters = { visible: false };
    });
    g.visible = false;
    group.add(g);
    return g;
  };
  const reticles: Record<BarGame, THREE.Group> = { darts: reticle(0.014), axe: reticle(0.045) };

  const point = (game: BarGame, u: number, v: number, out: THREE.Vector3, into = 0) => {
    const f = targetFrame(game);
    return out.set(f.x + f.right.x * u - f.out.x * into, f.y + v, f.z + f.right.z * u - f.out.z * into);
  };

  // ---- Throws ------------------------------------------------------------------------------------------
  const thrown: Thrown[] = [];
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  /** Where along its way a throw is: poseAxe has `tmp`. */
  const along = new THREE.Vector3();
  const FWD = new THREE.Vector3(0, 0, 1);
  const X = new THREE.Vector3(1, 0, 0);
  const turn = new THREE.Quaternion();

  /** An axe's pose `a` turned over its handle, with its middle at `mass`. */
  const poseAxe = (th: Thrown, a: number, mass: THREE.Vector3) => {
    th.obj.quaternion.copy(th.yaw).multiply(turn.setFromAxisAngle(X, a));
    th.obj.position.copy(mass).sub(tmp.copy(AXE.mass).applyQuaternion(th.obj.quaternion));
  };

  const launch = (toss: Toss, from: THREE.Vector3, a0: number, color: string, land: () => void) => {
    const { game } = toss;
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), throwSpot(game).facing);
    const th: Thrown = { game, obj: new THREE.Group(), t: 0, from: from.clone(), to: new THREE.Vector3(), arc: 0, stage: 'fly', a0, a1: 0, yaw, stick: toss.stick, vel: new THREE.Vector3(), spin: 0, land };
    if (game === 'darts') {
      th.obj = dartModel(color);
      point(game, toss.u, toss.v, th.to, 0.02);
      th.arc = 0.2;
    } else {
      th.obj = axeModel();
      // Where its middle is once its edge is in the target (or it's just hitting it), turned right for
      // sticking, or with the handle coming in first for bouncing off.
      th.a1 = Math.PI * 2 + (toss.stick ? AXE_HIT + (Math.random() - 0.5) * 0.25 : AXE_HIT + 1.9);
      const q = new THREE.Quaternion().copy(yaw).multiply(turn.setFromAxisAngle(X, th.a1));
      point(game, toss.u, toss.v, th.to, toss.stick ? 0.03 : -0.02).sub(tmp.copy(AXE.edge).sub(AXE.mass).applyQuaternion(q));
      // It leaves the hands turned a0 about where they hold it: its middle starts out from there.
      th.from.add(tmp.copy(AXE.mass).applyQuaternion(q.copy(yaw).multiply(turn.setFromAxisAngle(X, a0))));
      th.arc = 0.3;
    }
    // Nothing to use: looking at the board goes straight through it.
    th.obj.traverse((o) => (o.raycast = () => {}));
    group.add(th.obj);
    thrown.push(th);
    step(th, 0);
  };

  const step = (th: Thrown, dt: number) => {
    const T = th.game === 'darts' ? DART_FLIGHT : AXE_FLIGHT;
    if (th.stage === 'fly') {
      th.t += dt;
      const s = Math.min(1, th.t / T);
      const pos = along.lerpVectors(th.from, th.to, s);
      pos.y += th.arc * 4 * s * (1 - s);
      if (th.game === 'darts') {
        dir.subVectors(th.to, th.from);
        dir.y += th.arc * 4 * (1 - 2 * s);
        th.obj.position.copy(pos);
        th.obj.quaternion.setFromUnitVectors(FWD, dir.normalize());
      } else poseAxe(th, th.a0 + (th.a1 - th.a0) * s, pos);
      if (s < 1) return;
      th.land();
      if (th.game === 'darts' || th.stick) {
        th.stage = 'stuck';
        return;
      }
      // Off the target it bounces, turning back over, and drops to the mat.
      const f = targetFrame(th.game);
      th.stage = 'fall';
      th.t = 0;
      th.from.copy(pos);
      th.vel.set(f.out.x * 1.6 + (Math.random() - 0.5) * 0.6, 1.4, f.out.z * 1.6 + (Math.random() - 0.5) * 0.6);
      th.spin = -7;
      return;
    }
    if (th.stage === 'fall') {
      th.t += dt;
      th.vel.y -= 9.8 * dt;
      th.from.addScaledVector(th.vel, dt);
      th.a1 += th.spin * dt;
      if (th.from.y > 0.1) {
        poseAxe(th, th.a1, th.from);
        return;
      }
      // Lying on its side on the mat.
      th.stage = 'lie';
      view.onDrop?.(th.from.clone());
      th.obj.quaternion.copy(th.yaw).multiply(turn.setFromAxisAngle(FWD, Math.PI / 2)).multiply(new THREE.Quaternion().setFromAxisAngle(X, th.a1));
      th.obj.position.set(th.from.x, 0.03, th.from.z);
    }
  };

  const pops: { sprite: THREE.Sprite; t: number; y: number }[] = [];

  const dispose = (th: Thrown) => {
    group.remove(th.obj);
    th.obj.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  };

  const view: BarGamesView = {
    group,
    colliders,
    interactables,
    point,
    launch,
    onDrop: null,
    pop(game, text, color) {
      const sprite = textSprite(text, { bg: color, color: '#ffffff', size: 64, border: INK });
      // Over the target, out in front of it a little.
      const f = targetFrame(game);
      const y = f.y + (game === 'darts' ? 0.45 : 1.1);
      sprite.position.set(f.x + f.out.x * 0.3, y, f.z + f.out.z * 0.3);
      sprite.scale.multiplyScalar(game === 'darts' ? 0.6 : 0.9);
      sprite.raycast = () => {};
      group.add(sprite);
      pops.push({ sprite, t: 0, y });
    },
    clear(game) {
      for (let i = thrown.length - 1; i >= 0; i--) {
        const th = thrown[i];
        // One still on its way in lands first.
        if (th.game !== game || th.stage === 'fly') continue;
        dispose(th);
        thrown.splice(i, 1);
      }
    },
    chalk: drawChalk,
    aim(game, u = 0, v = 0) {
      for (const g of ['darts', 'axe'] as BarGame[]) {
        const r = reticles[g];
        r.visible = g === game;
        if (g !== game) continue;
        point(g, u, v, r.position, -0.012);
        const f = targetFrame(g);
        r.rotation.set(0, Math.atan2(f.out.x, f.out.z), 0);
      }
    },
    update(dt, dark) {
      for (const th of thrown) step(th, dt);
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i];
        p.t += dt;
        p.sprite.position.y = p.y + p.t * 0.3;
        p.sprite.material.opacity = Math.min(1, (1.8 - p.t) / 0.5);
        if (p.t < 1.8) continue;
        group.remove(p.sprite);
        disposeSprite(p.sprite);
        pops.splice(i, 1);
      }
      light.intensity = 0.3 + 2.4 * dark;
    },
  };
  return view;
}
