import * as THREE from 'three';
import { fileOf, parseFen, rankOf, squareAt } from '../../../shared/chess';
import type { ChessTable } from '../../../shared/protocol';
import { canvasTexture } from '../../world/texture';
import { PIECE_SQUARE, makePiece, pieceKind, woodMaterials } from './pieces';

// One table's board and men: the board inlaid in the table's top, the pieces standing on it (sliding
// from square to square as moves come in), the glows that show what you can do, the men taken laid out
// along the table's edges, and the little flag and coin to resign or start again. Local space: the
// table's middle at the origin, White's side toward +z, so files run along +x and ranks away from White along -z.

/** A square's side, in meters, and the whole board's. */
export const SQUARE = 0.085;
export const BOARD = SQUARE * 8;
/** The inlaid border round the squares. */
const BORDER = SQUARE / 4;
export const TABLE_SIZE = 1.0;
/** How high the table's top is, and so the board. */
export const TABLE_H = 0.75;
const TOP = TABLE_H + 0.0008;
/** The men are drawn for a smaller board (see pieces.ts). */
const SCALE = SQUARE / PIECE_SQUARE;
const TAKEN_SCALE = 0.62;

/** Where a square's middle is, on the table. */
export function squarePos(sq: number): { x: number; z: number } {
  return { x: (fileOf(sq) - 3.5) * SQUARE, z: (3.5 - rankOf(sq)) * SQUARE };
}

/** The square a point on the table (its local x, z) is over, or -1 off the squares. */
export function squareAtPoint(x: number, z: number): number {
  const file = Math.floor(x / SQUARE + 4);
  const rank = Math.floor(4 - z / SQUARE);
  return file < 0 || file > 7 || rank < 0 || rank > 7 ? -1 : squareAt(file, rank);
}

/** The board's top, drawn: light and dark squares of wood, a border with an inlaid line, the files and ranks lettered. */
function boardTexture(): THREE.CanvasTexture {
  const sq = 128;
  const b = sq / 4;
  const size = sq * 8 + b * 2;
  return canvasTexture(size, size, (g) => {
    g.fillStyle = '#4a2c19';
    g.fillRect(0, 0, size, size);
    g.strokeStyle = '#d9b97c';
    g.lineWidth = 2;
    g.strokeRect(b * 0.42, b * 0.42, size - b * 0.84, size - b * 0.84);
    g.fillStyle = '#d9b97c';
    g.font = `700 ${b * 0.5}px Nunito, ui-rounded, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let i = 0; i < 8; i++) {
      g.fillText('abcdefgh'[i], b + sq * (i + 0.5), size - b * 0.5);
      g.fillText(String(8 - i), b * 0.5, b + sq * (i + 0.5));
    }
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        // a1 is dark: the top row is rank 8, so a8 (row 0, column 0) is light.
        const light = (r + f) % 2 === 0;
        const x = b + f * sq;
        const y = b + r * sq;
        g.fillStyle = light ? '#e8d3a6' : '#7c5233';
        g.fillRect(x, y, sq, sq);
        g.strokeStyle = light ? 'rgba(150,105,55,0.22)' : 'rgba(30,15,5,0.3)';
        for (let k = 0; k < 7; k++) {
          const gx = x + ((k * 41 + r * 13 + f * 29) % sq);
          g.lineWidth = 0.7 + (k % 3) * 0.5;
          g.beginPath();
          g.moveTo(gx, y);
          g.bezierCurveTo(gx + 4, y + sq * 0.35, gx - 5, y + sq * 0.65, gx + 2, y + sq);
          g.stroke();
        }
      }
    }
  });
}

// ---- The glows ----------------------------------------------------------------------------------------

/** What a glow on a square says. */
export type MarkKind = 'last' | 'check' | 'hover' | 'select' | 'move' | 'take';

function glowTexture(draw: (g: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g) => draw(g, 128));
}

let marks: Record<MarkKind, THREE.MeshBasicMaterial> | null = null;
/** The glows' materials, made once: unlit, so they glow whatever the light. */
function markMaterials() {
  if (marks) return marks;
  const radial = (c0: string, c1: string, stop: number) =>
    glowTexture((g, s) => {
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, c0);
      grad.addColorStop(stop, c0);
      grad.addColorStop(Math.min(1, stop + 0.35), c1);
      grad.addColorStop(1, c1);
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    });
  const frame = (color: string, width: number, fill: string) =>
    glowTexture((g, s) => {
      g.fillStyle = fill;
      g.fillRect(0, 0, s, s);
      g.strokeStyle = color;
      g.lineWidth = width;
      g.shadowColor = color;
      g.shadowBlur = 14;
      g.strokeRect(width, width, s - width * 2, s - width * 2);
    });
  const mat = (map: THREE.Texture | null, color = '#ffffff', opacity = 1) => {
    const m = new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.toneMapped = false;
    m.userData.outlineParameters = { visible: false };
    return m;
  };
  marks = {
    last: mat(null, '#f2d45c', 0.38),
    check: mat(radial('rgba(255,50,40,0.95)', 'rgba(255,50,40,0)', 0.1)),
    hover: mat(frame('#ffffff', 7, 'rgba(255,255,255,0.14)')),
    select: mat(frame('#ffd23f', 10, 'rgba(255,210,63,0.34)')),
    move: mat(radial('rgba(72,255,140,0.95)', 'rgba(72,255,140,0)', 0.2)),
    take: mat(
      glowTexture((g, s) => {
        g.strokeStyle = 'rgba(72,255,140,0.95)';
        g.lineWidth = 11;
        g.shadowColor = '#48ff8c';
        g.shadowBlur = 14;
        g.beginPath();
        g.arc(s / 2, s / 2, s * 0.38, 0, Math.PI * 2);
        g.stroke();
      }),
    ),
  };
  return marks;
}
const MARK_Y: Record<MarkKind, number> = { last: 0.0002, check: 0.0006, hover: 0.001, select: 0.0014, move: 0.0018, take: 0.0018 };

/** What's lit up on the board. */
export interface Marks {
  /** The squares the last move went from and to. */
  last?: readonly number[];
  /** The king in check. */
  check?: number;
  /** The square under your aim, if it's yours to move. */
  hover?: number;
  selected?: number;
  /** Where the selected piece may go: onto an empty square, or taking. */
  moves?: readonly number[];
  takes?: readonly number[];
}

// ---- The men -------------------------------------------------------------------------------------------

interface Man {
  letter: string;
  group: THREE.Group;
  sq: number;
  /** Sliding from one square to another. */
  slide?: { fx: number; fz: number; t: number; dur: number; hop: number };
  /** Done sliding: what's still to happen (the man it took going off the board, a pawn turning into a queen). */
  arrive?: () => void;
  /** How far it's lifted off the board, for the one under your aim. */
  lift: number;
}

const VALUE = 'qrbnp';
export type Act = 'resign' | 'new';

/** What a click on the table landed on. */
export interface Picked {
  sq?: number;
  act?: Act;
}

export class ChessTableView {
  readonly group = new THREE.Group();
  /** The board's inlaid top: its square is what clicks aim at. */
  readonly top: THREE.Mesh;
  private readonly mats = woodMaterials();
  private readonly men = new Map<number, Man>();
  private readonly pieces = new THREE.Group();
  private readonly takenGroup = new THREE.Group();
  private readonly glow: THREE.Mesh[] = [];
  private glowUsed = 0;
  private lifted = -1;
  private tokens: Record<Act, THREE.Group[]>;
  private tokenLit: Act | null = null;
  private shownFen = '';
  private shownMoves = -1;
  private shownTaken = '';

  constructor(readonly n: number) {
    const mat = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.42, metalness: 0 });
    this.top = new THREE.Mesh(new THREE.PlaneGeometry(BOARD + BORDER * 2, BOARD + BORDER * 2).rotateX(-Math.PI / 2), mat);
    this.top.position.y = TOP;
    this.top.receiveShadow = true;
    this.group.add(this.top, this.pieces, this.takenGroup);
    this.tokens = { resign: [flag(1), flag(-1)], new: [coin(1), coin(-1)] };
    for (const t of [...this.tokens.resign, ...this.tokens.new]) {
      t.visible = false;
      this.group.add(t);
    }
  }

  /** The things a click can land on: the board, the men, the flag and the coin. */
  pickable(): THREE.Object3D[] {
    return [this.top, this.pieces, ...this.tokens.resign, ...this.tokens.new];
  }

  /** What the ray lands on: a square (over the board, or on a man standing on it), or one of the tokens. */
  pick(ray: THREE.Raycaster): Picked | null {
    for (const hit of ray.intersectObjects(this.pickable(), true)) {
      // (A ray doesn't skip what's hidden: the flag and the coin, when they're not out.)
      let shown = true;
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) if (!o.visible) shown = false;
      if (!shown) continue;
      if (hit.object === this.top) {
        const p = this.group.worldToLocal(hit.point.clone());
        const sq = squareAtPoint(p.x, p.z);
        return sq < 0 ? null : { sq };
      }
      for (let o: THREE.Object3D | null = hit.object; o && o !== this.group; o = o.parent) {
        if (typeof o.userData.chessSq === 'number') return { sq: o.userData.chessSq };
        if (o.userData.chessAct) return { act: o.userData.chessAct as Act };
      }
    }
    return null;
  }

  /** The table's game as it is now. A move on from what's shown slides; anything else is just set up. */
  show(t: ChessTable) {
    const state = parseFen(t.fen);
    if (!state) return;
    const board = state.board;
    const oneMore = t.moves === this.shownMoves + 1 && !!t.last && this.shownFen !== '';
    if (oneMore) this.slide(t.last![0], t.last![1], board);
    // Everything else comes to stand where the position says.
    for (let sq = 0; sq < 64; sq++) {
      const letter = board[sq];
      const man = this.men.get(sq);
      if (man && man.letter === letter) continue;
      if (man && letter && man.slide) {
        // A pawn on its way to the last rank: it turns into what it's becoming on arrival.
        const arrive = man.arrive;
        man.arrive = () => {
          arrive?.();
          this.replace(man, letter);
        };
      } else {
        if (man) this.remove(man);
        if (letter) this.put(letter, sq);
      }
    }
    this.shownFen = t.fen;
    this.shownMoves = t.moves;
    if (t.taken !== this.shownTaken) this.layOutTaken(t.taken);
    this.shownTaken = t.taken;
    const playing = t.moves > 0 && !t.end;
    for (const f of this.tokens.resign) f.visible = playing;
    for (const c of this.tokens.new) c.visible = !!t.end || (t.moves > 0 && !(t.w && t.b));
  }

  /** The man on `from` slides to `to` (taking what's there, castling, or taking en passant on the way). */
  private slide(from: number, to: number, after: readonly string[]) {
    const man = this.men.get(from);
    if (!man || after[from]) return;
    const prey: Man[] = [];
    const there = this.men.get(to);
    if (there) prey.push(there);
    else if (pieceKind(man.letter) === 'p' && fileOf(from) !== fileOf(to)) {
      const passed = this.men.get(squareAt(fileOf(to), rankOf(from)));
      if (passed) prey.push(passed);
    }
    this.men.delete(from);
    for (const p of prey) this.men.delete(p.sq);
    this.start(man, to, pieceKind(man.letter) === 'n' ? 0.05 : 0.014, () => prey.forEach((p) => this.remove(p, true)));
    if (pieceKind(man.letter) === 'k' && Math.abs(to - from) === 2) {
      const row = rankOf(from) * 8;
      const rook = this.men.get(row + (to > from ? 7 : 0));
      if (rook) {
        this.men.delete(rook.sq);
        this.start(rook, row + (to > from ? 5 : 3), 0.014);
      }
    }
  }

  private start(man: Man, to: number, hop: number, arrive?: () => void) {
    const here = this.at(man);
    const goes = squarePos(to);
    this.men.set(to, man);
    man.sq = to;
    man.group.userData.chessSq = to;
    const dist = Math.hypot(goes.x - here.x, goes.z - here.z);
    man.slide = { fx: here.x, fz: here.z, t: 0, dur: THREE.MathUtils.clamp(0.2 + dist * 0.7, 0.25, 0.6), hop };
    man.arrive = arrive;
  }

  /** Where a man is on the table now. */
  private at(man: Man): { x: number; z: number } {
    return { x: man.group.position.x, z: man.group.position.z };
  }

  private put(letter: string, sq: number) {
    const group = makePiece(letter, this.mats);
    group.scale.setScalar(SCALE);
    // A knight looks across the board.
    if (pieceKind(letter) === 'n') group.rotation.y = letter === letter.toUpperCase() ? Math.PI / 2 : -Math.PI / 2;
    const p = squarePos(sq);
    group.position.set(p.x, TOP, p.z);
    group.userData.chessSq = sq;
    this.pieces.add(group);
    this.men.set(sq, { letter, group, sq, lift: 0 });
  }

  private remove(man: Man, taken = false) {
    this.pieces.remove(man.group);
    if (!taken && this.men.get(man.sq) === man) this.men.delete(man.sq);
  }

  /** A man is something else now (a pawn made a queen). */
  private replace(man: Man, letter: string) {
    if (this.men.get(man.sq) !== man) return;
    this.pieces.remove(man.group);
    this.put(letter, man.sq);
  }

  /** The men taken, along the table's edges: White's on the west, Black's on the east, the big ones first. */
  private layOutTaken(taken: string) {
    this.takenGroup.clear();
    const order = (l: string) => VALUE.indexOf(l.toLowerCase());
    for (const white of [true, false]) {
      const mine = [...taken].filter((l) => (l === l.toUpperCase()) === white).sort((a, b) => order(a) - order(b));
      mine.forEach((letter, i) => {
        const g = makePiece(letter, this.mats);
        g.scale.setScalar(SCALE * TAKEN_SCALE);
        if (pieceKind(letter) === 'n') g.rotation.y = white ? Math.PI / 2 : -Math.PI / 2;
        const side = white ? -1 : 1;
        g.position.set(side * (BOARD / 2 + BORDER + 0.045 + (i % 2) * 0.04), TOP, 0.3 - Math.floor(i / 2) * 0.04);
        this.takenGroup.add(g);
      });
    }
  }

  // ---- What's lit ----------------------------------------------------------------------------------------

  /** The glows on the board, from scratch. */
  setMarks(m: Marks) {
    this.glowUsed = 0;
    const mats = markMaterials();
    const lay = (kind: MarkKind, sq: number | undefined) => {
      if (sq === undefined || sq < 0) return;
      let g = this.glow[this.glowUsed];
      if (!g) {
        g = new THREE.Mesh(GLOW_GEO, mats.last);
        g.renderOrder = 2;
        this.glow.push(g);
        this.group.add(g);
      }
      this.glowUsed++;
      const p = squarePos(sq);
      g.material = mats[kind];
      g.position.set(p.x, TOP + MARK_Y[kind], p.z);
      g.visible = true;
    };
    for (const sq of m.last ?? []) lay('last', sq);
    lay('check', m.check);
    for (const sq of m.moves ?? []) lay('move', sq);
    for (const sq of m.takes ?? []) lay('take', sq);
    lay('hover', m.hover);
    lay('select', m.selected);
    for (let i = this.glowUsed; i < this.glow.length; i++) this.glow[i].visible = false;
    // The man under your aim lifts a little off the board.
    this.lifted = m.hover ?? -1;
  }

  /** The flag or the coin under your aim (or none). */
  lightToken(act: Act | null) {
    if (act === this.tokenLit) return;
    this.tokenLit = act;
    for (const a of ['resign', 'new'] as const) for (const t of this.tokens[a]) t.scale.setScalar(a === act ? 1.25 : 1);
  }

  /** Slides the men and settles the lifted one. */
  update(dt: number) {
    for (const man of this.men.values()) {
      const target = man.sq === this.lifted && !man.slide ? 0.008 : 0;
      man.lift += (target - man.lift) * Math.min(1, dt * 14);
      const p = squarePos(man.sq);
      const s = man.slide;
      if (!s) {
        man.group.position.set(p.x, TOP + man.lift, p.z);
        continue;
      }
      s.t = Math.min(1, s.t + dt / s.dur);
      const e = s.t * s.t * (3 - 2 * s.t);
      man.group.position.set(s.fx + (p.x - s.fx) * e, TOP + Math.sin(Math.PI * s.t) * s.hop, s.fz + (p.z - s.fz) * e);
      if (s.t >= 1) {
        man.slide = undefined;
        const done = man.arrive;
        man.arrive = undefined;
        done?.();
      }
    }
  }
}

const GLOW_GEO = new THREE.PlaneGeometry(SQUARE, SQUARE).rotateX(-Math.PI / 2);

// ---- The flag and the coin ---------------------------------------------------------------------------------

const wood = () => new THREE.MeshStandardMaterial({ color: '#6b4328', roughness: 0.4 });

/** A little white flag on a stand: click it to resign. `side` is 1 on White's edge of the table, -1 on Black's. */
function flag(side: number): THREE.Group {
  const g = new THREE.Group();
  const w = wood();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.006, 20), w).translateY(0.003));
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.07, 8), w).translateY(0.04));
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.024, 0.0016), new THREE.MeshStandardMaterial({ color: '#f6f1e7', roughness: 0.8 }));
  cloth.position.set(0.019, 0.063, 0);
  g.add(cloth);
  for (const m of g.children) m.castShadow = true;
  g.position.set(side * 0.22, TOP, side * (BOARD / 2 + BORDER + 0.07));
  g.rotation.y = side > 0 ? 0 : Math.PI;
  g.userData.chessAct = 'resign';
  return g;
}

/** A gold coin with a circling arrow on it: click it to set the pieces up again. */
function coin(side: number): THREE.Group {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: '#d9a441', roughness: 0.35, metalness: 0.6 });
  const face = new THREE.MeshStandardMaterial({
    roughness: 0.35,
    metalness: 0.4,
    map: canvasTexture(128, 128, (c) => {
      c.fillStyle = '#d9a441';
      c.fillRect(0, 0, 128, 128);
      c.fillStyle = '#5a3a0c';
      c.font = '700 84px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('↻', 64, 68);
    }),
  });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.007, 28), [gold, face, gold]);
  disc.position.y = 0.0035;
  disc.castShadow = true;
  g.add(disc);
  g.position.set(side * -0.22, TOP, side * (BOARD / 2 + BORDER + 0.07));
  g.rotation.y = side > 0 ? 0 : Math.PI;
  g.userData.chessAct = 'new';
  return g;
}
