// The basketball hoop on every floor, and its ball. The office keeps who has the ball and how it
// was last thrown (see server/court.ts); every page works out the rest itself, flying and bouncing it
// the same way from that throw (simulate below), so everyone on the floor sees the same shot.

import { BALCONY, FLOOR, LOFT, WALL_HEIGHT } from './layout.js';

/**
 * The hoop, on the west wall between the exit door and the kitchen, facing into the room (+x).
 * `face` is the backboard's front, `rim` the middle of the ring (`r` to the middle of its tube).
 */
const HOOP_Z = 10.1;
const HOOP_FACE = FLOOR.minX + 0.62;
export const HOOP = {
  z: HOOP_Z,
  face: HOOP_FACE,
  board: { width: 1.4, bottom: 2.88, top: 3.93, thick: 0.05 },
  rim: { x: HOOP_FACE + 0.4, y: 3.05, z: HOOP_Z, r: 0.25, tube: 0.018 },
  /** How far the net hangs below the ring, and how wide it is at the bottom. */
  net: { depth: 0.42, r: 0.15 },
  /** The free-throw line, this far out from the backboard. */
  line: 4.6,
} as const;

export const BALL = {
  r: 0.12,
  /**
   * Where the ball waits when nobody has it (and where it comes back to): on the floor by the hoop,
   * on the side away from the coffee machine, so walking up to it doesn't pour you a coffee.
   */
  home: { x: HOOP.face + 0.7, z: HOOP.z - 0.8 },
  /** The fastest anyone throws it, in m/s. */
  maxSpeed: 16,
} as const;

/** A throw: where the ball left someone's hands, how fast, who threw it, and how long ago (ms) as the office sent it. */
export interface BallShot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  by: string;
  elapsed: number;
}

/**
 * The ball on a floor: in someone's hands (`holder`, a PeerInfo id), or loose where `shot` left it
 * (flying, bouncing or lying still by now), or neither: waiting under the hoop.
 */
export interface BallState {
  holder?: string;
  shot?: BallShot;
}

/** Whether a throw from the page is one the office passes on: from somewhere on the floor, no faster than anyone throws. */
export function throwOk(s: { x: number; y: number; z: number; vx: number; vy: number; vz: number }): boolean {
  const n = [s.x, s.y, s.z, s.vx, s.vy, s.vz];
  if (!n.every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  if (Math.hypot(s.vx, s.vy, s.vz) > BALL.maxSpeed + 1e-6) return false;
  return inBounds(s.x, s.y, s.z, 1);
}

/** Inside the office (or out on the balcony), under the ceiling, give or take `slack` meters. */
function inBounds(x: number, y: number, z: number, slack = 0): boolean {
  if (y < -0.5 - slack || y > WALL_HEIGHT + slack) return false;
  const room = x > FLOOR.minX - slack && x < FLOOR.maxX + slack && z > FLOOR.minZ - slack && z < FLOOR.maxZ + slack;
  const balcony = x > BALCONY.minX - slack && x < BALCONY.maxX + slack && z > BALCONY.minZ - 1 - slack && z < BALCONY.maxZ + slack;
  return room || balcony;
}

// ---- Flying it --------------------------------------------------------------------------------------

/** Something solid the ball bounces off: a box from `bottom` (0 if missing) to `top`. The office's colliders are these. */
export interface Solid {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
  bottom?: number;
  /** The backboard, which the ball bounces off harder and which makes a bank shot. */
  board?: boolean;
}

/** What the ball hit on a step, for the sounds and the net. `speed` is how hard, in m/s. */
export interface BallHit {
  kind: 'bounce' | 'rim' | 'board' | 'score';
  speed: number;
}

/** The ball in flight, as `simulate` steps it along. */
export interface BallSim {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds since it was let go of. */
  t: number;
  /** Lying still: nothing moves it any more. */
  still: boolean;
  /** It fell through the ceiling of the floor below (or out of the building): back under the hoop it goes. */
  lost: boolean;
  /** It went in (at most once a throw), and what it touched on the way: the rim, the backboard. */
  scored: boolean;
  touched: { rim: boolean; board: boolean };
  /** It came up through the ring from underneath, which doesn't count when it drops back through. */
  under: boolean;
}

/** Steps a second is cut into: every page cuts it the same way, so every page sees the same bounces. */
export const STEP = 1 / 120;
const GRAVITY = 9.8;
/** How long a throw can bounce about before it's let lie wherever it is. */
const MAX_TIME = 25;
/** The part of the speed into a surface the ball keeps, bouncing back off it. */
const BOUNCE = { floor: 0.7, rim: 0.55, board: 0.62, other: 0.58 } as const;

export function launch(s: { x: number; y: number; z: number; vx: number; vy: number; vz: number }): BallSim {
  return { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, t: 0, still: false, lost: false, scored: false, touched: { rim: false, board: false }, under: false };
}

/** The solids near enough to the floor for the ball to reach; the rest of the building (the street, other floors) can't be. */
export function nearSolids(all: readonly Solid[]): Solid[] {
  return all.filter((c) => c.maxX > FLOOR.minX - 2 && c.minX < FLOOR.maxX + 2 && c.maxZ > FLOOR.minZ - 2 && c.minZ < BALCONY.maxZ + 2 && c.top > -1 && (c.bottom ?? 0) < WALL_HEIGHT + 1);
}

/** The backboard, as the ball meets it (the office's colliders have it too, for walking into). */
export function backboard(): Solid {
  const b = HOOP.board;
  return { minX: HOOP.face - b.thick, maxX: HOOP.face, minZ: HOOP.z - b.width / 2, maxZ: HOOP.z + b.width / 2, bottom: b.bottom, top: b.top, board: true };
}

/** Moves the ball on by one STEP, bouncing it off `solids` and the rim. Hits go in `hits`, if given. */
export function step(s: BallSim, solids: readonly Solid[], hits?: BallHit[]) {
  if (s.still || s.lost) return;
  const y0 = s.y;
  // Exactly as it falls (not a step behind), so a throw at idealSpeed goes where it should.
  s.x += s.vx * STEP;
  s.y += s.vy * STEP - 0.5 * GRAVITY * STEP * STEP;
  s.z += s.vz * STEP;
  s.vy -= GRAVITY * STEP;
  s.t += STEP;

  // Through the ring? Its middle has to cross the rim's height inside it, on the way down.
  const rim = HOOP.rim;
  const off = Math.hypot(s.x - rim.x, s.z - rim.z);
  if (off < rim.r - 0.03) {
    if (y0 >= rim.y && s.y < rim.y && !s.under && !s.scored) {
      s.scored = true;
      hits?.push({ kind: 'score', speed: -s.vy });
      // The net catches it and lets it drop.
      s.vx *= 0.3;
      s.vz *= 0.3;
      s.vy *= 0.55;
    } else if (y0 < rim.y && s.y >= rim.y) s.under = true;
  }
  // In the net it's steered down its middle.
  if (s.scored && s.y < rim.y && s.y > rim.y - HOOP.net.depth && off < rim.r) {
    s.vx += (rim.x - s.x) * 30 * STEP;
    s.vz += (rim.z - s.z) * 30 * STEP;
  }

  hitRim(s, hits);
  let grounded = false;
  for (const c of solids) {
    const up = hitBox(s, c, hits);
    if (up) grounded = true;
  }
  if (grounded) {
    // Rolling along the floor (or a desk) it slows down, and stops.
    const k = Math.max(0, 1 - 1.8 * STEP);
    s.vx *= k;
    s.vz *= k;
    if (Math.hypot(s.vx, s.vz) < 0.06 && Math.abs(s.vy) < 0.3) {
      s.vx = s.vy = s.vz = 0;
      s.still = true;
    }
  }
  if (s.t > MAX_TIME) s.still = true;
  if (!inBounds(s.x, s.y, s.z, 0.5)) s.lost = true;
}

/** Bounces the ball off the ring: a hoop of tube round the rim's middle. */
function hitRim(s: BallSim, hits?: BallHit[]) {
  const rim = HOOP.rim;
  const dx0 = s.x - rim.x;
  const dz0 = s.z - rim.z;
  const h = Math.hypot(dx0, dz0);
  // The nearest point of the ring.
  const kx = h > 1e-9 ? rim.x + (dx0 / h) * rim.r : rim.x + rim.r;
  const kz = h > 1e-9 ? rim.z + (dz0 / h) * rim.r : rim.z;
  const dx = s.x - kx;
  const dy = s.y - rim.y;
  const dz = s.z - kz;
  const d = Math.hypot(dx, dy, dz);
  const min = BALL.r + rim.tube;
  if (d >= min || d < 1e-9) return;
  const nx = dx / d;
  const ny = dy / d;
  const nz = dz / d;
  s.x += nx * (min - d);
  s.y += ny * (min - d);
  s.z += nz * (min - d);
  const speed = bounce(s, nx, ny, nz, BOUNCE.rim);
  if (speed > 0) {
    s.touched.rim = true;
    hits?.push({ kind: 'rim', speed });
  }
}

/** Bounces the ball off a box. True when it's resting on its top (or rolling along it). */
function hitBox(s: BallSim, c: Solid, hits?: BallHit[]): boolean {
  const r = BALL.r;
  const minY = c.bottom ?? 0;
  if (s.x < c.minX - r || s.x > c.maxX + r || s.z < c.minZ - r || s.z > c.maxZ + r || s.y < minY - r || s.y > c.top + r) return false;
  const cx = Math.min(Math.max(s.x, c.minX), c.maxX);
  const cy = Math.min(Math.max(s.y, minY), c.top);
  const cz = Math.min(Math.max(s.z, c.minZ), c.maxZ);
  let nx = s.x - cx;
  let ny = s.y - cy;
  let nz = s.z - cz;
  const d2 = nx * nx + ny * ny + nz * nz;
  let depth: number;
  if (d2 >= r * r) return false;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    nx /= d;
    ny /= d;
    nz /= d;
    depth = r - d;
  } else {
    // Its middle got inside: out through the nearest face.
    const faces: [number, number, number, number][] = [
      [s.x - c.minX, -1, 0, 0],
      [c.maxX - s.x, 1, 0, 0],
      [s.y - minY, 0, -1, 0],
      [c.top - s.y, 0, 1, 0],
      [s.z - c.minZ, 0, 0, -1],
      [c.maxZ - s.z, 0, 0, 1],
    ];
    let best = faces[0];
    for (const f of faces) if (f[0] < best[0]) best = f;
    [, nx, ny, nz] = best;
    depth = best[0] + r;
  }
  s.x += nx * depth;
  s.y += ny * depth;
  s.z += nz * depth;
  const board = !!c.board;
  const speed = bounce(s, nx, ny, nz, board ? BOUNCE.board : ny > 0.7 ? BOUNCE.floor : BOUNCE.other);
  if (speed > 0.25) {
    if (board) s.touched.board = true;
    hits?.push({ kind: board ? 'board' : 'bounce', speed });
  }
  return ny > 0.7;
}

/** Sends the ball back off a surface facing (nx, ny, nz): returns how fast it was going into it. */
function bounce(s: BallSim, nx: number, ny: number, nz: number, keep: number): number {
  const vn = s.vx * nx + s.vy * ny + s.vz * nz;
  if (vn >= 0) return 0;
  // Barely moving into it (rolling along, or coming to rest), it doesn't bounce at all: it settles.
  const soft = -vn < 0.5;
  const e = soft ? 0 : keep;
  // A little grip along the surface when it lands (rolling slows down by itself, see step).
  const grip = soft ? 0 : 0.15;
  const tx = s.vx - vn * nx;
  const ty = s.vy - vn * ny;
  const tz = s.vz - vn * nz;
  s.vx = tx * (1 - grip) - e * vn * nx;
  s.vy = ty * (1 - grip) - e * vn * ny;
  s.vz = tz * (1 - grip) - e * vn * nz;
  return -vn;
}

/** Steps a throw on until `seconds` after it was let go of (or it's lying still). */
export function simulate(s: BallSim, seconds: number, solids: readonly Solid[], hits?: BallHit[]) {
  while (s.t + STEP <= seconds && !s.still && !s.lost) step(s, solids, hits);
}

/**
 * Where a ball lying still can't be picked up from: too high up (on the whiteboard, or the loft's
 * roof), unless it's up in the loft. It goes back under the hoop, and so does a lost one.
 */
export function outOfReach(s: { x: number; y: number; z: number }): boolean {
  const y = s.y - BALL.r;
  const inLoft = s.x > LOFT.minX && s.x < LOFT.maxX && s.z > LOFT.minZ && s.z < LOFT.maxZ;
  if (inLoft && y > LOFT.y - 0.1 && y < LOFT.y + 1.3) return false;
  return y > 2.3;
}

/** How long after it stops somewhere out of reach (or goes missing) the ball turns up back under the hoop. */
export const RETURN_AFTER = 3;

// ---- Shooting ---------------------------------------------------------------------------------------

/**
 * How fast to throw from `from`, `pitch` radians up from level, to drop through the middle of the
 * ring: null if no speed does it at that angle (or it's too far to throw).
 */
export function idealSpeed(from: { x: number; y: number; z: number }, pitch: number): number | null {
  const dx = Math.hypot(HOOP.rim.x - from.x, HOOP.rim.z - from.z);
  const dy = HOOP.rim.y - from.y;
  const c = Math.cos(pitch);
  const lift = dx * Math.tan(pitch) - dy;
  if (c <= 0 || lift <= 0) return null;
  const v = Math.sqrt((GRAVITY * dx * dx) / (2 * c * c * lift));
  return v <= BALL.maxSpeed ? v : null;
}

/**
 * How steeply to throw, looking `look` radians up from level: level ahead is 45° up, and looking
 * straight at the rim is the angle that drops the ball into it at 45°, steep enough to clear the
 * front of the ring.
 */
export function throwPitch(look: number): number {
  return Math.min(1.4, Math.max(-0.3, Math.atan(1 + 2 * Math.tan(Math.min(1.2, Math.max(-1.2, look))))));
}

/** Looking from `from` straight at the middle of the ring: how far up (radians). */
export function lookAtRim(from: { x: number; y: number; z: number }): number {
  return Math.atan2(HOOP.rim.y - from.y, Math.hypot(HOOP.rim.x - from.x, HOOP.rim.z - from.z));
}

/**
 * A shot at the hoop thrown at `pitch` from `from`, flattened as much as it takes (and no more) for
 * its arc to stay under the office's ceiling: from far out, the steep one would hit it.
 */
export function underCeiling(from: { x: number; y: number; z: number }, pitch: number): number {
  let p = pitch;
  while (p > 0.5) {
    const v = idealSpeed(from, p);
    if (v !== null && from.y + (v * Math.sin(p)) ** 2 / (2 * GRAVITY) <= WALL_HEIGHT - BALL.r - 0.3) return p;
    p -= 0.02;
  }
  return p;
}

/** Where on the wind-up meter a shot goes in (0 is a lob, 1 as hard as you throw), and how wide that sweet spot is, all told. */
export const SWEET = { at: 0.78, width: 0.08 } as const;
/**
 * How much slower (or faster) than the ideal a shot goes, for every whole meter it's let go of short
 * of (or past) the sweet spot. Past it the shot goes long quickly: a little late banks in off the
 * glass, and as hard as you throw (where the meter turns back, so it's easy to hit) misses.
 */
const SWEET_SLOPE = { short: 0.25, long: 0.8 } as const;
/** The wind-up meter goes up in this long, then back down, and so on until you let go. */
export const WIND_UP = 1.05;

/** Where the meter is `held` seconds into the wind-up: up to 1, back down to 0, up again… */
export function meter(held: number): number {
  const u = (held / WIND_UP) % 2;
  return u <= 1 ? u : 2 - u;
}

/** A shot at the hoop let go of at `power` on the meter: the ideal speed for its angle, give or take how far off the sweet spot it was. */
export function shotSpeed(ideal: number, power: number): number {
  const off = power - SWEET.at;
  return Math.min(BALL.maxSpeed, ideal * (1 + off * (off < 0 ? SWEET_SLOPE.short : SWEET_SLOPE.long)));
}

/** A toss at nothing in particular: from a soft lob up to a good hard throw. */
export function tossSpeed(power: number): number {
  return 2.5 + power * 8.5;
}

/** How far from the hoop (m, along the floor) a basket is worth three, as far out as the three-point line on a real court. */
export const THREE_POINT = 6.75;
