import * as THREE from 'three';
import { EXIT, RING, caption, chairAt, inGame, ringRadius, ringSpot, type ChairsState } from '../../shared/chairs';
import type { ChairFrame } from '../chairstune';
import type { NavGrid, Pt } from '../../shared/nav';
import type { Stage, Worker } from './character';
import type { DeskView } from './office';
import { mesh, toon, toonUnique } from './toon';

/*
 * Musical chairs, in the open floor south of the desks (see shared/chairs.ts): the ring of chairs, the
 * board over it, the discoball hanging above, and `ChairGame`, which takes the workers off their seats
 * and plays them through the game — out to the ring while the PA calls it, dancing round the chairs
 * while the music plays, in for a chair the moment it stops, and whoever's left over falling about and
 * going back to its desk in a huff.
 *
 * The office decides the rounds (see server/chairs.ts) and every page plays out the same one, so the
 * music stops in everyone's ears together and the same worker wins on every screen.
 */

/** Where the chairs are stacked out of the way, west of the ring: they come from there, and go back. */
const STORE = EXIT;
/** The board over the ring, north of it and facing the chairs. */
const BOARD = { x: RING.x, y: 1.5, z: RING.z - 4.3, width: 2.8, height: 1.25 };
/** How high the discoball hangs over the middle of the ring. */
const BALL_Y = 3.3;
/** Seconds a chair takes to fly from the store to its place in the ring, or back again. */
const FLIGHT = 0.55;
/** Walking pace (m/s), and the run for the scramble when the music stops. */
const WALK = 2.3;
const RUN = 4.4;
/** Seconds hopping down off a seat, up onto a chair, or back into a seat at the end. */
const HOP = 0.45;
/** A worker's feet are this far above its origin (see leaving.ts). */
const FEET = 0.07;
/** A dance goes on this long before it's asked for again, so nobody hops down in the middle of one. */
const DANCE_AGAIN = 4.15;
/** How long the leftover worker springs about before it goes off, and how long it waits out of the way. */
const ACT = 1.3;
const WAIT = 0.6;

const CHAIR_COLORS = ['#ef476f', '#ffd166', '#06d6a0', '#4f86f7', '#ff8a5b', '#9d4edd', '#00b4d8', '#f77f00', '#8ecae6', '#f4978e'];
/** What a worker says on its way out to the ring, and on the chair it managed to get. */
const CHEERS = ['finally!', 'my chair!', 'no way', 'bring it on', 'watch this', '🕺'] as const;
/** What it says when there's no chair for it. */
const GLOOM = ['😵 out!', '💀', '😤 so unfair', '👋 later!'] as const;

/** What the game needs from the office round it: the sounds it makes, the PA, and confetti. */
export interface ChairSfx {
  /** The chairs being dragged out and set in the ring. */
  clatter(n: number): void;
  /** The PA reads a line out over the room. */
  announce(text: string): void;
  /** The worker that got left out. */
  loser(): void;
  /** The last worker on the last chair. */
  win(): void;
  step(x: number, y: number, z: number): void;
  burst(x: number, y: number, z: number, n: number): void;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const ease = (t: number) => t * t * (3 - 2 * t);

/** A game chair: brighter and a little bigger than a desk's, so it shows from across the room. */
function gameChair(color: string): THREE.Group {
  const g = new THREE.Group();
  const seat = toon(color);
  const legs = toon('#8d99ae');
  const back = mesh(new THREE.BoxGeometry(0.68, 0.64, 0.09), seat, 0, 0.84, 0.28);
  back.rotation.x = 0.12;
  g.add(back);
  g.add(mesh(new THREE.BoxGeometry(0.68, 0.12, 0.62), seat, 0, 0.45, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), legs, 0, 0.23, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = mesh(new THREE.BoxGeometry(0.06, 0.05, 0.42), legs, Math.sin(a) * 0.16, 0.05, Math.cos(a) * 0.16);
    leg.rotation.y = a;
    g.add(leg);
  }
  // A pale stripe along the top of the back: the ring reads as a ring of party chairs.
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.1, 0.11), toon('#fff3bf'), 0, 1.1, 0.3, false));
  return g;
}

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

/** The mat under the ring: a dance floor with a dashed rim and a few notes printed on it. */
function danceMat(): THREE.Mesh {
  const map = canvasTexture(512, 512, (g) => {
    g.fillStyle = '#f7a8c4';
    g.beginPath();
    g.arc(256, 256, 256, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffd9e6';
    g.beginPath();
    g.arc(256, 256, 214, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#2b2d42';
    g.lineWidth = 12;
    g.setLineDash([30, 20]);
    g.beginPath();
    g.arc(256, 256, 236, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(43, 45, 66, 0.18)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [x, y, r, note] of [
      [150, 160, 0.9, '♪'],
      [370, 200, 1.1, '♫'],
      [210, 390, 1, '♬'],
      [400, 410, 0.8, '♪'],
    ] as const) {
      g.save();
      g.translate(x, y);
      g.rotate(r);
      g.font = `${90 * r}px Nunito, ui-rounded, system-ui, sans-serif`;
      g.fillText(note, 0, 0);
      g.restore();
    }
  });
  const mat = new THREE.MeshToonMaterial({ map, transparent: true });
  mat.userData.outlineParameters = { visible: false };
  return new THREE.Mesh(new THREE.CircleGeometry(ringRadius(RING.most) + 1.5, 48).rotateX(-Math.PI / 2), mat);
}

/** The board over the ring, with what the PA is saying on it, for anyone who can't hear the room. */
class CaptionBoard {
  readonly group = new THREE.Group();
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private text = '';

  constructor() {
    const tex = (this.tex = canvasTexture(1024, 448, () => {}));
    this.g = this.tex.image!.getContext('2d')!;
    this.group.add(mesh(new THREE.BoxGeometry(BOARD.width + 0.18, BOARD.height + 0.18, 0.08), toon('#2b2d42'), 0, 0, 0));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.width, BOARD.height), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.z = 0.05;
    face.userData.outlineParameters = { visible: false };
    this.group.add(face);
    // On two posts, under a little lamp.
    for (const sx of [-1, 1]) this.group.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, BOARD.y, 8), toon('#2b2d42'), sx * (BOARD.width / 2 - 0.2), -BOARD.y / 2, 0));
    this.group.add(mesh(new THREE.BoxGeometry(0.5, 0.1, 0.26), toon('#ffd166'), 0, BOARD.height / 2 + 0.18, 0.12, false));
    this.group.position.set(BOARD.x, BOARD.y, BOARD.z);
    this.say('');
  }

  /** What it says now, in as many lines as it takes. */
  say(text: string) {
    if (text === this.text) return;
    this.text = text;
    const g = this.g;
    const W = g.canvas.width;
    g.fillStyle = '#1b1d2e';
    g.fillRect(0, 0, W, g.canvas.height);
    g.strokeStyle = '#ffd166';
    g.lineWidth = 8;
    g.strokeRect(16, 16, W - 32, g.canvas.height - 32);
    g.fillStyle = '#ffd166';
    g.font = '900 52px Nunito, ui-rounded, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText('🪑 MUSICAL CHAIRS', W / 2, 38);
    g.fillStyle = '#f1f1ea';
    g.font = '800 40px Nunito, ui-rounded, system-ui, sans-serif';
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && g.measureText(next).width > W - 90) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    lines.slice(0, 5).forEach((l, i) => g.fillText(l, W / 2, 122 + i * 54));
    this.tex.needsUpdate = true;
  }
}

/** The discoball over the ring, and the light it throws about on the beat. */
function discoBall(): { group: THREE.Group; update(dt: number, f: ChairFrame, on: boolean): void } {
  const group = new THREE.Group();
  group.position.set(RING.x, BALL_Y, RING.z);
  group.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.2, 6), toon('#2b2d42'), 0, 1.1, 0, false));
  const map = canvasTexture(128, 64, (g) => {
    g.fillStyle = '#cfd8dc';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#8d99ae';
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) if ((x + y) % 2) g.fillRect(x * 16, y * 16, 16, 16);
  });
  const mat = toonUnique('#ffffff');
  mat.map = map;
  const ball = mesh(new THREE.SphereGeometry(0.3, 20, 16), mat, 0, 0, 0, false);
  group.add(ball);
  const glow = new THREE.PointLight('#ffd166', 0, 10, 1.4);
  group.add(glow);
  group.visible = false;
  return {
    group,
    update(dt: number, f: ChairFrame, on: boolean) {
      group.visible = on;
      if (!on) return;
      ball.rotation.y += dt * 1.4;
      ball.rotation.x = Math.sin(performance.now() / 900) * 0.2;
      glow.intensity = 0.5 + 3.2 * f.beat + 2.2 * f.kick;
      glow.color.setHSL(f.hue, 0.75, 0.6);
    },
  };
}

// ---- The ring ---------------------------------------------------------------------------------------

/** One chair, and where it's going: out of the store, round to its place in the ring, or back again. */
interface Chair {
  obj: THREE.Group;
  pos: THREE.Vector3;
  from: THREE.Vector3;
  /** Seconds of flight left, -1 for standing still. */
  left: number;
  /** Seconds to wait its turn before it sets off, so the ring fills in a spin. */
  wait: number;
  /** Turning as it flies: 1 to a place in the ring, -1 back to the store. */
  spin: number;
  /** Where it belongs: a place in the ring, or null for the store. */
  want: { x: number; z: number; rotY: number } | null;
}

export interface ChairRingView {
  group: THREE.Group;
  /** The colliders of the chairs that are out, so nobody walks through one. */
  readonly colliders: { minX: number; maxX: number; minZ: number; maxZ: number; top: number }[];
  /** How many chairs are in the ring. */
  readonly count: number;
  /** Puts `n` chairs in the ring, one after another, and takes the rest back to the store. */
  arrange(n: number): void;
  /** Takes every chair away again. */
  clear(): void;
  /** Where chair `i` stands, for the worker sitting down on it. */
  spot(i: number): { x: number; y: number; z: number; rotY: number };
  /** What the board over the ring says (the same words the PA is saying, see caption). */
  say(text: string): void;
  /** The chairs, the ball and the board, moving to the music. */
  update(dt: number, f: ChairFrame, on: boolean): void;
  /** The middle of the ring, for the confetti and the light. */
  readonly top: THREE.Vector3;
}

export function buildChairRing(sfx: ChairSfx): ChairRingView {
  const group = new THREE.Group();
  const chairs: Chair[] = [];
  const colliders: { minX: number; maxX: number; minZ: number; maxZ: number; top: number }[] = [];
  for (let i = 0; i < RING.most; i++) {
    const obj = gameChair(CHAIR_COLORS[i % CHAIR_COLORS.length]);
    obj.position.set(STORE.x, 0, STORE.z);
    obj.visible = false;
    obj.traverse((o) => (o.raycast = () => {}));
    group.add(obj);
    chairs.push({ obj, pos: new THREE.Vector3(STORE.x, 0, STORE.z), from: new THREE.Vector3(STORE.x, 0, STORE.z), left: -1, wait: 0, spin: 0, want: null });
  }
  group.add(danceMat());
  const board = new CaptionBoard();
  group.add(board.group);
  const ball = discoBall();
  group.add(ball.group);
  const store = new THREE.Vector3(STORE.x, 0, STORE.z);
  const to = new THREE.Vector3();
  const top = new THREE.Vector3(RING.x, 2.4, RING.z);
  let count = 0;

  const view: ChairRingView = {
    group,
    colliders,
    get count() {
      return count;
    },
    top,
    arrange(n: number) {
      const wanted = Math.max(0, Math.min(RING.most, n));
      if (wanted === count) return;
      count = wanted;
      for (const [i, c] of chairs.entries()) {
        // Where this one belongs: a place in the ring, or back in the store with the rest.
        const seat = i < count ? chairAt(i, count) : null;
        if (seat && c.want && Math.abs(c.want.x - seat.x) < 0.001 && Math.abs(c.want.z - seat.z) < 0.001) continue;
        if (!seat && !c.want) continue;
        c.from.copy(c.pos);
        c.want = seat;
        c.spin = seat ? 1 : -1;
        // Each chair sets off a beat after the one before, so the ring fills in a spin.
        c.wait = (seat ? i : Math.max(0, count - 1 - i)) * 0.13;
        c.left = FLIGHT;
        c.obj.visible = true;
      }
      if (count) sfx.clatter(count);
    },
    clear: () => view.arrange(0),
    spot(i: number) {
      const c = chairAt(i, count || 1);
      return { x: c.x, y: RING.seatY, z: c.z, rotY: c.rotY };
    },
    say: (text: string) => board.say(text),
    update(dt: number, f: ChairFrame, on: boolean) {
      const now = performance.now();
      let n = 0;
      for (const [i, c] of chairs.entries()) {
        if (c.left >= 0) {
          // Its turn hasn't come, or it's on its way: up off the floor and over in an arc, turning.
          if (c.wait > 0) {
            c.wait -= dt;
            c.obj.position.copy(c.from);
          } else {
            c.left -= dt;
            const u = Math.min(1, Math.max(0, 1 - c.left / FLIGHT));
            to.set(c.want ? c.want.x : store.x, 0, c.want ? c.want.z : store.z);
            c.pos.lerpVectors(c.from, to, ease(u));
            c.obj.position.set(c.pos.x, Math.sin(u * Math.PI) * 0.6, c.pos.z);
            c.obj.rotation.y += c.spin * dt * 8;
            if (c.left > 0) continue;
          }
          c.left = -1;
          if (!c.want) {
            c.obj.visible = false;
            continue;
          }
        }
        if (!c.want) continue;
        // Standing in the ring: a hop and a sway of its own on every beat.
        c.obj.position.set(c.want.x, f.beat * 0.07 + f.kick * 0.05, c.want.z);
        c.obj.rotation.set(Math.sin(now / 520 + i * 1.7) * 0.04 * f.beat, c.want.rotY + Math.sin(now / 800 + i) * 0.08, Math.sin(now / 640 + i * 2.3) * 0.03 * f.beat);
        // The collider it needs, so nobody walks through a chair that's out.
        const box = (colliders[n] ??= { minX: 0, maxX: 0, minZ: 0, maxZ: 0, top: 0.95 });
        box.minX = c.want.x - 0.36;
        box.maxX = c.want.x + 0.36;
        box.minZ = c.want.z - 0.36;
        box.maxZ = c.want.z + 0.36;
        n++;
      }
      colliders.length = n;
      ball.update(dt, f, on && n > 0);
    },
  };
  return view;
}

// ---- The game ---------------------------------------------------------------------------------------

/** Where a worker in the game is headed: back to its seat, out on the ring, in for a chair, or off. */
type Go = 'seat' | 'ring' | 'chair' | 'act' | 'away';

interface Dancer {
  id: string;
  model: Worker;
  desk: DeskView;
  /** In its seat; hopping down; walking somewhere; hopping up; sitting on a chair; or on the ring. */
  state: 'seated' | 'down' | 'walk' | 'up' | 'sit' | 'ring';
  go: Go;
  /** The way to where it's going, and how far along it is. */
  way: Pt[];
  next: number;
  /** The goal `way` was worked out for, so a change of plan in mid-walk gets a new way. */
  planned: Go;
  /** Seconds into a hop, and the spot it hopped from. */
  hop: number;
  /** The hop is straight down off a chair, rather than over to somewhere else. */
  drop: boolean;
  from: THREE.Vector3;
  heading: number;
  stepIn: number;
  /** m/s, before its age slows it down. */
  pace: number;
  /** Its place in the ring, and the chair it went for. */
  index: number;
  chair: number | null;
  /** How far round the ring it has drifted while dancing, in places. */
  drift: number;
  /** The round it was knocked out in, or 0 while it is still playing. */
  out: number;
  /** The stage it dances on, and when it last started dancing. */
  stage: Stage;
  danced: number;
  /** Seconds into whatever it's doing now, and whether it's already said its piece. */
  act: number;
  said: boolean;
}

/** The worker at `id` and the desk it belongs to, as this page has it. */
export type ChairSeat = { model: Worker; desk: DeskView; deskId: string };

/** Musical chairs, played out on this page with the workers on it. */
export class ChairGame {
  private readonly dancers = new Map<string, Dancer>();
  private state: ChairsState | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly seatTmp = new THREE.Vector3();
  private phase = '';
  private winner = '';

  constructor(
    /** The scene the workers are moved out into while they're up (like Court). */
    private readonly parent: THREE.Object3D,
    private readonly ring: ChairRingView,
    private readonly nav: NavGrid,
    /** The top of whatever is underfoot at (x, z) for feet at `y`. */
    private readonly ground: (x: number, z: number, y: number) => number,
    private readonly sfx: ChairSfx,
  ) {}

  /** Whether `id` is up off its seat playing. */
  away(id: string): boolean {
    const d = this.dancers.get(id);
    return !!d && d.state !== 'seated';
  }

  /** Everyone playing, for the doors to open (the same list each frame, to save making one). */
  positions(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const d of this.dancers.values()) if (d.state !== 'seated') out.push(d.model.root.position);
    return out;
  }

  /**
   * The office has said where the game has got to. `seat` is the worker at that id and the desk it
   * belongs to, or nothing for one that isn't on this floor's seats any more.
   */
  sync(state: ChairsState, seat: (id: string) => ChairSeat | undefined) {
    this.state = state;
    // A worker the office has taken off the floor, or one whose model is a new one now (you changed
    // floors or maps), is not ours to move: let it go, and the new one joins when it is next told.
    for (const [id, d] of this.dancers) if (seat(id)?.model !== d.model) this.forget(d);
    if (state.phase !== this.phase) {
      // A new part of the game: the board over the ring says what's happening, and the PA says it out
      // loud. The music is left to itself, and the caption on the board keeps everyone in the know.
      const line = caption(state);
      this.phase = state.phase;
      this.ring.say(line);
      if (line && state.phase !== 'music') this.sfx.announce(line);
    }
    if (state.phase === 'idle') {
      // It's over: the chairs go back to the store and everyone goes back to its desk.
      this.ring.arrange(0);
      for (const d of this.dancers.values()) this.send(d, 'seat');
      return;
    }
    this.ring.arrange(state.chairs);
    // Once the music stops, everyone is after a chair — and whoever didn't get one is out of the round.
    const rushing = state.phase === 'scramble' || state.phase === 'react' || state.phase === 'over';
    const playing = inGame(state);
    for (const p of state.players) {
      const d = this.dancers.get(p.id);
      if (p.outIn !== undefined) {
        // Left out of this round: it finds out about it where it stands, then goes home in a huff —
        // once. On the rounds after it, it's on its way back to its desk and is left to it.
        if (d && d.out !== p.outIn) {
          d.out = p.outIn;
          d.chair = null;
          this.send(d, 'act');
        }
        continue;
      }
      d && (d.out = 0);
      const at = seat(p.id);
      if (!at) continue;
      const index = playing.indexOf(p);
      if (!d) {
        this.join(p.id, at.model, at.desk, index, p.chair);
        continue;
      }
      d.index = index < 0 ? 0 : index;
      d.chair = p.chair;
      this.send(d, rushing && p.chair !== null ? 'chair' : 'ring');
      if (state.phase === 'over' && p.id === state.winner) this.won(p.id);
    }
  }

  /** A worker starts playing: down off its seat and out to the ring. */
  private join(id: string, model: Worker, desk: DeskView, index: number, chair: number | null) {
    const d: Dancer = {
      id,
      model,
      desk,
      state: 'seated',
      go: 'ring',
      way: [],
      next: 0,
      planned: 'seat',
      hop: 0,
      drop: false,
      from: new THREE.Vector3(),
      heading: 0,
      stepIn: 0,
      pace: WALK,
      index,
      chair,
      drift: 0,
      out: 0,
      stage: { pos: new THREE.Vector3(), yaw: 0 },
      danced: 0,
      act: 0,
      said: false,
    };
    this.dancers.set(id, d);
    this.send(d, 'ring');
  }

  /** The model is on its way out with the office (killed, or sent home): leave it where it is. */
  private forget(d: Dancer) {
    d.model.stopDancing();
    this.dancers.delete(d.id);
  }

  /** Sends it off to do `go` next, from wherever it is. */
  private send(d: Dancer, go: Go) {
    if (d.go === go) return;
    d.go = go;
    d.said = false;
    d.act = 0;
    d.model.stopDancing();
    d.pace = go === 'chair' ? RUN : WALK;
  }

  /** The last worker on the last chair: up on it, dancing, with the confetti going up. */
  private won(id: string) {
    if (this.winner === id) return;
    this.winner = id;
    this.sfx.win();
    this.sfx.burst(this.ring.top.x, this.ring.top.y, this.ring.top.z, 240);
  }

  update(dt: number, t: number) {
    for (const d of [...this.dancers.values()]) this.step(d, dt, t);
    // Anyone back in its seat has finished with the game.
    for (const [id, d] of this.dancers) if (d.state === 'seated') this.dancers.delete(id);
    if (!this.dancers.size && this.phase === 'idle') {
      this.phase = '';
      this.winner = '';
    }
  }

  /** How many chairs the ring has this round, or the ones the first round will have while they gather. */
  private chairsNow(): number {
    const s = this.state;
    return Math.max(1, s ? s.chairs || inGame(s).length - 1 : 1);
  }

  /** Where a worker is meant to be right now: its chair, its place on the ring, off the ring, or its seat. */
  private target(d: Dancer, out: THREE.Vector3): number {
    const s = this.state;
    if (d.go === 'seat') {
      d.desk.seatAnchor.getWorldPosition(this.seatTmp);
      return out.set(this.seatTmp.x, this.seatTmp.y, this.seatTmp.z), 0;
    }
    if (d.go === 'away') return out.set(EXIT.x, 0, EXIT.z), 0;
    if (d.go === 'chair' && d.chair !== null && s) {
      const c = chairAt(d.chair, s.chairs || 1);
      return out.set(c.x, RING.seatY, c.z), c.rotY;
    }
    const ring = ringSpot(d.index, Math.max(1, s ? inGame(s).length : 1), this.chairsNow());
    return out.set(ring.x, 0, ring.z), ring.rotY;
  }

  /**
   * Works out the way to where it's going: round the furniture to the ring and back to the desk, and
   * straight there for a chair or the spot out of the ring, which are both on open floor.
   */
  private route(d: Dancer, at: THREE.Vector3) {
    const pos = d.model.root.position;
    const here: Pt = [pos.x, pos.z];
    const there: Pt = [at.x, at.z];
    d.planned = d.go;
    if (d.go === 'seat') d.way = this.nav.wayTo(here, d.desk.def);
    else if (d.go === 'ring') d.way = [...this.nav.route(here, there), there];
    else d.way = this.nav.clearLine(here, there) ? [there] : [...this.nav.route(here, there), there];
    d.next = 1;
  }

  private step(d: Dancer, dt: number, t: number) {
    const model = d.model;
    const root = model.root;
    const pos = root.position;
    const at = this.tmp;
    const rotY = this.target(d, at);
    let walking = false;
    if (d.state === 'seated') {
      if (d.go === 'seat') return;
      // Out of its seat and into the room, keeping where it was standing in it.
      root.getWorldPosition(this.seatTmp);
      this.parent.add(root);
      root.position.copy(this.seatTmp);
      root.scale.setScalar(1);
      d.heading = new THREE.Euler().setFromQuaternion(root.quaternion, 'YXZ').y;
      root.rotation.set(0, d.heading, 0);
      d.state = 'down';
      d.hop = 0;
      d.from.copy(pos);
    } else if (d.state === 'sit' && d.go !== 'chair') {
      // The next round: down off the chair it's on, and then out on the ring with the rest.
      d.state = 'down';
      d.hop = 0;
      d.drop = true;
      d.heading = root.rotation.y;
      d.from.copy(pos);
    }

    // Down off the seat, up onto a chair or back into the seat: a hop in a little arc.
    if (d.state === 'down' || d.state === 'up') {
      // Off a chair, it drops to the floor under it first and walks from there.
      if (d.drop) at.set(d.from.x, 0, d.from.z);
      d.hop = Math.min(1, d.hop + dt / HOP);
      const e = ease(d.hop);
      pos.set(THREE.MathUtils.lerp(d.from.x, at.x, e), THREE.MathUtils.lerp(d.from.y, at.y, e) + Math.sin(d.hop * Math.PI) * 0.32, THREE.MathUtils.lerp(d.from.z, at.z, e));
      this.face(d, rotY, dt, 8);
      if (d.hop < 1) return;
      d.drop = false;
      if (d.go === 'chair') {
        d.state = 'sit';
        this.sitOn(d, rotY);
      } else if (d.go === 'seat') {
        d.state = 'seated';
        this.backInSeat(d);
      } else {
        d.state = 'walk';
        this.route(d, at);
      }
      return;
    }

    if (d.state === 'walk') {
      walking = true;
      if (d.planned !== d.go) this.route(d, at);
      let move = d.pace * model.pace * dt;
      while (move > 0 && d.next < d.way.length) {
        const [x, z] = d.way[d.next];
        const dx = x - pos.x;
        const dz = z - pos.z;
        const d0 = Math.hypot(dx, dz);
        if (d0 > 1e-4) d.heading = Math.atan2(dx, dz);
        if (d0 <= move) {
          pos.x = x;
          pos.z = z;
          move -= d0;
          d.next++;
        } else {
          pos.x += (dx / d0) * move;
          pos.z += (dz / d0) * move;
          move = 0;
        }
      }
      model.walking = d.next < d.way.length;
      model.gait = d.pace / WALK;
      if (model.walking) {
        d.stepIn -= dt;
        if (d.stepIn <= 0) {
          d.stepIn += Math.PI / (9 * model.pace * model.gait);
          this.sfx.step(pos.x, pos.y, pos.z);
        }
      } else {
        // There: up onto the chair it's after, or back into its seat.
        model.walking = false;
        model.gait = 1;
        if (d.go === 'chair' || d.go === 'seat') {
          d.state = 'up';
          d.hop = 0;
          d.from.copy(pos);
          return;
        }
        d.state = 'ring';
        d.danced = 0;
        d.act = 0;
        d.drift = 0;
      }
      this.face(d, d.heading, dt, 8);
      return;
    }

    if (d.state === 'ring') {
      if (d.go === 'away') {
        // Out of the ring and out of the way for a moment, and then home to its desk.
        d.act += dt;
        if (d.act > WAIT) this.send(d, 'seat');
        return;
      }
      if (d.go === 'act') {
        // The leftover: a hop straight up, turning, and a face that says it.
        d.act += dt;
        model.cheer(0.4);
        pos.y = this.ground(pos.x, pos.z, pos.y + FEET) - FEET + Math.abs(Math.sin(d.act * 7)) * 0.9;
        root.rotation.y = d.heading + d.act * 9;
        if (!d.said) {
          d.said = true;
          model.say(GLOOM[d.index % GLOOM.length]);
          this.sfx.loser();
        }
        if (d.act > ACT) this.send(d, 'away');
        return;
      }
      // Out on the ring, turning to face the middle of it and drifting round the chairs to the music:
      // a slow parade, one way for half of them and the other way for the rest, weaving on the beat.
      const music = this.musicOn();
      if (music) d.drift += dt * (d.index % 2 ? 0.05 : -0.05);
      const spot = ringSpot(d.index + d.drift + (music ? Math.sin(t * 2.2 + d.index * 1.7) * 0.02 : 0), Math.max(1, this.state ? inGame(this.state).length : 1), this.chairsNow());
      d.stage.pos.set(spot.x, 0, spot.z);
      d.stage.yaw = spot.rotY + (music ? Math.sin(t * 1.7 + d.index * 2) * 0.22 : 0);
      if (music && (!d.danced || t - d.danced > DANCE_AGAIN)) {
        d.danced = t;
        model.dance(d.stage);
      } else if (!music) model.stopDancing();
      if (!d.said) {
        d.said = true;
        model.say(CHEERS[d.index % CHEERS.length]);
      }
    }

    if (d.state === 'sit') {
      // On its chair: it sits, it cheers, and it looks pleased with itself. At the end, up on the
      // chair it dances on the spot, and the confetti goes up round it.
      d.act += dt;
      if (d.act < 0.3) return;
      d.act = 0;
      if (this.phase === 'over') {
        pos.y = RING.seatY + 0.3 + Math.abs(Math.sin(t * 6)) * 0.12;
        root.rotation.y = t * 2.4;
        model.cheer(0.4);
      } else {
        pos.y = RING.seatY;
        model.cheer(1.2);
      }
      return;
    }

    // Round the ring and over the floor, always the right way up. On the ring, on a chair or in the
    // air, the dance and the hops have it.
    if (walking) {
      const g = this.ground(pos.x, pos.z, pos.y + FEET + 0.3) - FEET;
      pos.y += (g - pos.y) * Math.min(1, dt * 14);
    }
  }

  /** It hops onto the chair it got, and turns to face out of the ring. */
  private sitOn(d: Dancer, rotY: number) {
    const root = d.model.root;
    d.model.walking = false;
    d.model.gait = 1;
    d.model.say('🪑 mine!');
    root.rotation.set(0, rotY, 0);
    d.heading = rotY;
    d.act = 0;
  }

  /** Back in its seat: from here on it's where every worker sits. */
  private backInSeat(d: Dancer) {
    const root = d.model.root;
    d.model.walking = false;
    d.model.gait = 1;
    d.model.say('💤 back to it');
    d.desk.seatAnchor.add(root);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
  }

  private face(d: Dancer, to: number, dt: number, k: number) {
    const root = d.model.root;
    root.rotation.set(0, root.rotation.y + wrap(to - root.rotation.y) * Math.min(1, dt * k), 0);
  }

  /** Whether the music is playing, which is what the dancing goes by. */
  private musicOn(): boolean {
    const p = this.state?.phase;
    return p === 'gathering' || p === 'music';
  }
}
