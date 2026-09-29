import * as THREE from 'three';
import { FLOOR } from '../../shared/layout';
import { BALL, HOOP, RETURN_AFTER, THREE_POINT, backboard, launch, nearSolids, outOfReach, simulate, type BallHit, type BallShot, type BallSim, type BallState, type Solid } from '../../shared/hoop';
import type { Collider, Interactable } from './office';
import { mergeByMaterial, mesh, toon, toonUnique } from './toon';

const ORANGE = '#ff6b1a';
const INK = '#2b2d42';

export interface HoopView {
  group: THREE.Group;
  /** The backboard and the arms holding it up, to walk (and jump) into. */
  colliders: Collider[];
  /** The net swings as a ball drops through it. */
  swish(): void;
  update(dt: number): void;
}

/**
 * The hoop on the west wall: a backboard on arms off the wall, an orange rim and a white net, over a
 * painted key on the floor with its free-throw circle.
 */
export function buildHoop(): HoopView {
  const group = new THREE.Group();
  const parts = new THREE.Group();
  const { z, face, board, rim } = HOOP;
  const ink = toon(INK);
  const back = face - board.thick;
  const midY = (board.bottom + board.top) / 2;

  // The board: white, with an orange border and the shooter's square over the rim.
  parts.add(mesh(new THREE.BoxGeometry(board.thick, board.top - board.bottom, board.width), toon('#f8f9fa'), face - board.thick / 2, midY, z));
  const orange = toon(ORANGE);
  const line = (w: number, h: number, y: number, dz: number) => parts.add(mesh(new THREE.BoxGeometry(0.012, h, w), orange, face + 0.006, y, z + dz, false));
  const e = 0.05;
  line(board.width, e, board.top - e / 2, 0);
  line(board.width, e, board.bottom + e / 2, 0);
  for (const s of [-1, 1]) line(e, board.top - board.bottom, midY, s * (board.width / 2 - e / 2));
  const sq = { w: 0.59, h: 0.45, t: 0.035, y: rim.y + 0.02 };
  line(sq.w, sq.t, sq.y + sq.t / 2, 0);
  line(sq.w, sq.t, sq.y + sq.h - sq.t / 2, 0);
  for (const s of [-1, 1]) line(sq.t, sq.h, sq.y + sq.h / 2, s * (sq.w / 2 - sq.t / 2));

  // Arms from a plate on the wall out to the back of the board, and a brace under them.
  parts.add(mesh(new THREE.BoxGeometry(0.04, 0.8, 0.9), ink, FLOOR.minX + 0.02, midY - 0.15, z));
  const reach = back - FLOOR.minX;
  for (const dz of [-0.32, 0.32]) {
    for (const y of [midY - 0.25, midY + 0.25]) parts.add(mesh(new THREE.BoxGeometry(reach, 0.05, 0.05), ink, FLOOR.minX + reach / 2, y, z + dz));
    const brace = mesh(new THREE.CylinderGeometry(0.022, 0.022, Math.hypot(reach, 0.55), 6), ink, FLOOR.minX + reach / 2, midY - 0.52, z + dz);
    brace.rotation.z = -Math.atan2(reach, 0.55);
    parts.add(brace);
  }

  // The rim, and the bracket bolting it to the board.
  const ring = mesh(new THREE.TorusGeometry(rim.r, rim.tube, 8, 36), orange, rim.x, rim.y, rim.z);
  ring.rotation.x = Math.PI / 2;
  parts.add(ring);
  const gap = rim.x - rim.r - face;
  parts.add(mesh(new THREE.BoxGeometry(gap + 0.02, 0.03, 0.16), orange, face + gap / 2, rim.y - 0.01, z));
  parts.add(mesh(new THREE.BoxGeometry(0.02, 0.16, 0.2), orange, face + 0.01, rim.y - 0.06, z, false));
  group.add(mergeByMaterial(parts));

  // The net: a wireframe cone of diamonds, hanging from the rim.
  const netMat = toonUnique('#ffffff');
  netMat.wireframe = true;
  const net = new THREE.Mesh(new THREE.CylinderGeometry(rim.r - 0.01, HOOP.net.r, HOOP.net.depth, 14, 3, true), netMat);
  net.geometry.translate(0, -HOOP.net.depth / 2, 0);
  net.position.set(rim.x, rim.y, rim.z);
  group.add(net);

  // The key painted on the floor, out to the free-throw line, and the circle round the line.
  const lineX = face + HOOP.line;
  const keyW = 2.6;
  const paint = (geo: THREE.BufferGeometry, color: string, y: number) => {
    // Lit like the floor it's on (and not outlined: it's flat on it), and drawn over the planks.
    const mat = toonUnique(color);
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.userData.outlineParameters = { visible: false };
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    m.receiveShadow = true;
    m.renderOrder = 1;
    group.add(m);
    return m;
  };
  const keyLen = lineX - FLOOR.minX;
  const key = paint(new THREE.PlaneGeometry(keyLen, keyW), '#ee9a5d', 0.013);
  key.position.set(FLOOR.minX + keyLen / 2, key.position.y, z);
  const w = 0.06;
  const stripe = (len: number, x: number, sz: number, alongZ: boolean) => {
    const s = paint(new THREE.PlaneGeometry(alongZ ? w : len, alongZ ? len : w), '#ffffff', 0.015);
    s.position.set(x, s.position.y, sz);
  };
  stripe(keyLen, FLOOR.minX + keyLen / 2, z - keyW / 2, false);
  stripe(keyLen, FLOOR.minX + keyLen / 2, z + keyW / 2, false);
  stripe(keyW, lineX, z, true);
  // Half a circle, out past the line.
  const arc = paint(new THREE.RingGeometry(keyW / 2 - w, keyW / 2, 40, 1, -Math.PI / 2, Math.PI), '#ffffff', 0.015);
  arc.position.set(lineX, arc.position.y, z);

  const colliders: Collider[] = [backboard(), { minX: FLOOR.minX, maxX: back, minZ: z - 0.45, maxZ: z + 0.45, bottom: midY - 0.8, top: midY + 0.3 }];

  // The net's swing: stretched down as the ball goes through, springing back.
  let stretch = 0;
  let speed = 0;
  return {
    group,
    colliders,
    swish() {
      speed -= 5;
    },
    update(dt) {
      // A damped spring.
      speed += (-60 * stretch - 7 * speed) * dt;
      stretch += speed * dt;
      net.scale.set(1 + stretch * 0.25, 1 - stretch * 0.9, 1 + stretch * 0.25);
    },
  };
}

// ---- The ball ------------------------------------------------------------------------------------------

let ballTexture: THREE.CanvasTexture | null = null;
/** Orange leather with the black seams: round its middle, over the top, and the two curves either side. */
function texture(): THREE.CanvasTexture {
  if (ballTexture) return ballTexture;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8742a';
  g.fillRect(0, 0, 256, 128);
  // A little pebbling.
  for (let i = 0; i < 900; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
    g.fillRect(Math.random() * 256, Math.random() * 128, 2, 2);
  }
  g.strokeStyle = '#1d1d1d';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, 64);
  g.lineTo(256, 64);
  for (const x of [2, 128]) {
    g.moveTo(x, 0);
    g.lineTo(x, 128);
  }
  g.stroke();
  g.beginPath();
  for (const [x0, dir] of [
    [64, 1],
    [192, -1],
  ]) {
    for (let v = 0; v <= 128; v += 4) {
      const x = x0 + dir * 30 * Math.sin((Math.PI * v) / 128);
      if (v === 0) g.moveTo(x, v);
      else g.lineTo(x, v);
    }
  }
  g.stroke();
  ballTexture = new THREE.CanvasTexture(c);
  ballTexture.colorSpace = THREE.SRGBColorSpace;
  ballTexture.anisotropy = 4;
  return ballTexture;
}

/** A basketball, `r` meters round (its own size unless given): in the room, or in your hands. */
export function ballMesh(r: number = BALL.r): THREE.Mesh {
  const mat = new THREE.MeshToonMaterial({ map: texture(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  const m = mesh(new THREE.SphereGeometry(r, 20, 14), mat);
  m.rotation.z = 0.4;
  return m;
}

/** How a basket went in: who threw it, from how far, and whether it touched anything on the way. */
export interface Basket {
  by: string;
  distance: number;
  swish: boolean;
  bank: boolean;
  three: boolean;
}

/** Where the ball sits between someone's hands, in their character's own space (forward is +z). */
export const IN_HANDS = new THREE.Vector3(0, 0.95, 0.42);

const tmp = new THREE.Vector3();
const axis = new THREE.Vector3();
const spin = new THREE.Quaternion();

/**
 * The floor's basketball, as everyone on the floor sees it: in someone's hands, flying from a throw
 * (worked out the same way on every page, from the throw the office passed on), or lying where it
 * stopped. `set` takes the office's word for it; `throwNow` is your own throw, before the office hears.
 */
export class Basketball {
  readonly group = new THREE.Group();
  readonly interactable: Interactable = { kind: 'ball', x: BALL.home.x, y: 0, z: BALL.home.z, radius: 1.4 };
  readonly interactables = [this.interactable];
  /** Who has it (a peer id), or null while it's loose. */
  holder: string | null = null;
  private ball: THREE.Mesh;
  /** What rays pick it by: off while it's in someone's hands. */
  private pick: THREE.Mesh;
  private sim: BallSim | null = null;
  private shot: BallShot | null = null;
  /** performance.now() when the throw left their hands, on this page's clock. */
  private t0 = 0;
  private solids: Solid[] = [];
  /** The throw's end has been told about (a basket or a miss). */
  private settled = false;
  private last = new THREE.Vector3(BALL.home.x, BALL.r, BALL.home.z);
  /** It bounced off something (for the sounds). */
  onHit: ((hit: BallHit, at: THREE.Vector3) => void) | null = null;
  /** Someone threw it (not you: yours you know about): their character's arms go up. */
  onThrow: ((by: string) => void) | null = null;
  onBasket: ((b: Basket) => void) | null = null;
  /** A throw of `by`'s came to nothing: it stopped, or somebody took it, without going in. */
  onMiss: ((by: string) => void) | null = null;

  constructor(private colliders: () => readonly Solid[]) {
    this.ball = ballMesh();
    // Rays pick the ball by a bigger, invisible ball round it, so it's easy to point at.
    this.ball.raycast = () => {};
    const pick = (this.pick = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), new THREE.MeshBasicMaterial({ visible: false })));
    pick.userData.interact = this.interactable;
    this.group.add(this.ball, pick);
    this.group.position.copy(this.last);
  }

  /** Where the ball is now, flying or lying (not in anyone's hands). */
  get at(): THREE.Vector3 {
    return this.group.position;
  }

  /** Loose and not flying about any more. */
  get still(): boolean {
    return !this.holder && (!this.sim || this.sim.still);
  }

  /** The office's word on where the ball is, as of `now` (performance.now()). */
  set(state: BallState, now: number) {
    if (state.holder) {
      if (this.holder === state.holder) return;
      this.endThrow();
      this.holder = state.holder;
      this.sim = null;
      return;
    }
    this.holder = null;
    const s = state.shot;
    if (!s) {
      this.endThrow();
      this.sim = null;
      return;
    }
    // A throw that's already flying here (your own, back from the office).
    if (this.shot && same(this.shot, s)) return;
    this.endThrow();
    this.start(s, now - s.elapsed);
    // Catch up with it quietly: what it hit before you saw it is over and done with.
    simulate(this.sim!, (now - this.t0) / 1000, this.solids);
    if (this.sim!.t < 0.3) this.onThrow?.(s.by);
    this.settled = this.sim!.scored || this.sim!.still || this.sim!.lost;
  }

  /** You throw it (or drop it): it's out of your hands now, whatever the office says in a moment. */
  throwNow(s: Omit<BallShot, 'elapsed'>, now: number) {
    this.endThrow();
    this.holder = null;
    this.start({ ...s, elapsed: 0 }, now);
  }

  /** You (`id`) take it, before the office says so. */
  takeNow(id: string) {
    this.endThrow();
    this.holder = id;
    this.sim = null;
  }

  private start(s: BallShot, t0: number) {
    this.shot = s;
    this.t0 = t0;
    this.solids = nearSolids(this.colliders());
    this.sim = launch(s);
    this.settled = false;
  }

  /** A throw is over (someone took it, or threw again): if it hadn't gone in, that's a miss. */
  private endThrow() {
    if (this.shot && !this.settled && !this.sim?.scored) this.onMiss?.(this.shot.by);
    this.settled = true;
    this.shot = null;
  }

  /**
   * Moves the ball on to `now`: flying or rolling along, or in the hands of whoever has it
   * (`handsOf` says where those are, or null when they're not in view).
   */
  update(now: number, handsOf: (id: string, out: THREE.Vector3) => THREE.Vector3 | null) {
    const it = this.interactable;
    const pos = this.group.position;
    if (this.holder) {
      const at = handsOf(this.holder, tmp);
      this.group.visible = !!at;
      if (at) pos.copy(at);
      it.off = true;
      this.pick.visible = false;
      this.last.copy(pos);
      return;
    }
    const s = this.sim;
    if (s) {
      const hits: BallHit[] = [];
      const was = s.scored;
      simulate(s, (now - this.t0) / 1000, this.solids, hits);
      pos.set(s.x, s.y, s.z);
      for (const h of hits) this.onHit?.(h, pos);
      if (s.scored && !was && this.shot) {
        this.settled = true;
        const distance = Math.hypot(this.shot.x - HOOP.rim.x, this.shot.z - HOOP.rim.z);
        this.onBasket?.({ by: this.shot.by, distance, swish: !s.touched.rim && !s.touched.board, bank: s.touched.board, three: distance > THREE_POINT });
      }
      const gone = s.lost || (s.still && outOfReach(s));
      if ((s.still || s.lost) && !this.settled) {
        this.settled = true;
        if (this.shot) this.onMiss?.(this.shot.by);
      }
      // Out of reach (or out of the building) for a moment, it turns up back under the hoop.
      if (gone && (now - this.t0) / 1000 > s.t + RETURN_AFTER) {
        this.sim = null;
        this.shot = null;
      }
      this.group.visible = !s.lost;
    }
    if (!this.sim) {
      pos.set(BALL.home.x, BALL.r, BALL.home.z);
      this.group.visible = true;
    }
    // It rolls round the way it goes.
    tmp.subVectors(pos, this.last);
    const d = Math.hypot(tmp.x, tmp.z);
    if (d > 1e-5 && d < 2) {
      axis.set(tmp.z, 0, -tmp.x).normalize();
      this.ball.quaternion.premultiply(spin.setFromAxisAngle(axis, d / BALL.r));
    }
    this.last.copy(pos);
    it.off = !this.group.visible;
    this.pick.visible = true;
    it.x = pos.x;
    it.z = pos.z;
    // Caught about chest high: the floor it's over is a meter under it.
    it.y = Math.max(0, pos.y - 1);
  }
}

function same(a: BallShot, b: BallShot): boolean {
  return a.by === b.by && a.x === b.x && a.y === b.y && a.z === b.z && a.vx === b.vx && a.vy === b.vy && a.vz === b.vz;
}
