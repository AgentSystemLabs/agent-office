// The games in the rooftop bar's north-west corner: an axe-throwing lane and a dart board. You step
// up to the line (or the oche) and throw. Your page works out where it lands; the office passes that
// on to everyone else up there (see the client's throwing.ts), and every page scores it the same way
// from here. Shared by the server (which checks a throw is one anyone could make) and the client.

import { FLOOR } from './layout.js';

export type BarGame = 'darts' | 'axe';

export function isBarGame(v: unknown): v is BarGame {
  return v === 'darts' || v === 'axe';
}

/** Throws in a round: a visit to the oche is three darts, a round at the lane five axes. */
export const ROUND: Record<BarGame, number> = { darts: 3, axe: 5 };

/**
 * The axe lane: a wooden booth in the corner, against the roof's north edge, open to the south. The
 * target hangs on its back wall facing into it (+z). `minX`..`maxX` is the lane between the side
 * walls (`wall` thick, `depth` out from the back, `height` tall, like the back wall). You throw from
 * behind the red line, `line` (twelve feet) from the target: one turn of the axe, done right.
 */
export const AXE_LANE = {
  minX: FLOOR.minX + 0.15,
  maxX: FLOOR.minX + 2.95,
  wall: 0.15,
  depth: 3.4,
  height: 2.6,
  /** The middle of the target's face. */
  target: { x: FLOOR.minX + 1.55, y: 1.5, z: FLOOR.minZ + 0.25 },
  line: 3.66,
} as const;

/**
 * The dart board, on the outside of the axe lane's east wall, facing east (+x) over the deck. `oche`
 * is how far back the throwing line is from its face (seven feet nine and a quarter inches).
 */
export const DARTBOARD = { x: AXE_LANE.maxX + AXE_LANE.wall + 0.08, y: 1.73, z: FLOOR.minZ + 1.8, oche: 2.37 } as const;

/**
 * Where you stand to throw, just behind the line, and which way you face (a heading: 0 is +z,
 * turning toward +x). On the target, `u` runs to your right and `v` up, in meters from its middle.
 */
export function throwSpot(game: BarGame): { x: number; z: number; facing: number } {
  if (game === 'darts') return { x: DARTBOARD.x + DARTBOARD.oche + 0.28, z: DARTBOARD.z, facing: -Math.PI / 2 };
  return { x: AXE_LANE.target.x, z: AXE_LANE.target.z + AXE_LANE.line + 0.3, facing: Math.PI };
}

/** Where (u, v) on a game's target is: its middle, and which ways your right (`right`) and out of its face toward you (`out`) are. */
export function targetFrame(game: BarGame): { x: number; y: number; z: number; right: { x: number; z: number }; out: { x: number; z: number } } {
  if (game === 'darts') return { x: DARTBOARD.x, y: DARTBOARD.y, z: DARTBOARD.z, right: { x: 0, z: -1 }, out: { x: 1, z: 0 } };
  const t = AXE_LANE.target;
  return { x: t.x, y: t.y, z: t.z, right: { x: 1, z: 0 }, out: { x: 0, z: 1 } };
}

export interface Score {
  points: number;
  /** What the chalkboard says: "T20", "Bull", "Killshot", "Miss"… */
  label: string;
}

// ---- Darts ----------------------------------------------------------------------------------------

/**
 * A regulation board, in meters out from the middle: the bull, the outer bull, the treble and
 * double rings, and the board itself (the ring of numbers round the outside scores nothing).
 */
export const DART = { bull: 0.00635, outer: 0.0159, trebleIn: 0.099, trebleOut: 0.107, doubleIn: 0.162, doubleOut: 0.17, board: 0.2255 } as const;
/** The numbers round the board, clockwise from the top. */
export const DART_NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] as const;

/** What a dart at (u, v) on the board scores. */
export function dartScore(u: number, v: number): Score {
  const r = Math.hypot(u, v);
  if (r <= DART.bull) return { points: 50, label: 'Bull' };
  if (r <= DART.outer) return { points: 25, label: '25' };
  if (r > DART.doubleOut) return { points: 0, label: r <= DART.board ? 'Out' : 'Miss' };
  // Clockwise from straight up, each number's wedge centered on it.
  const a = Math.atan2(u, v);
  const seg = Math.floor(((a + Math.PI / 20 + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 10)) % 20;
  const n = DART_NUMBERS[seg];
  if (r > DART.trebleIn && r <= DART.trebleOut) return { points: n * 3, label: `T${n}` };
  if (r > DART.doubleIn) return { points: n * 2, label: `D${n}` };
  return { points: n, label: String(n) };
}

// ---- Axes -----------------------------------------------------------------------------------------

/**
 * The axe target, painted on planks `width` by `height`: rings out from the bull, and a blue
 * killshot dot up in each top corner. `blade` is how long the axe's edge is: it scores wherever
 * along it is best, so an axe on a line takes the higher ring.
 */
export const AXE_TARGET = {
  rings: [
    { r: 0.075, points: 6 },
    { r: 0.17, points: 4 },
    { r: 0.27, points: 3 },
    { r: 0.37, points: 2 },
    { r: 0.47, points: 1 },
  ],
  kill: { u: 0.52, v: 0.55, r: 0.05, points: 8 },
  width: 1.5,
  height: 1.9,
  blade: 0.1,
} as const;

/** Whether an axe hitting (u, v) is on the back wall, where it can stick: not the side walls, the floor or over the top. */
export function onBackWall(u: number, v: number): boolean {
  const half = (AXE_LANE.maxX - AXE_LANE.minX) / 2 - 0.12;
  return Math.abs(u) < half && v > 0.15 - AXE_LANE.target.y && v < AXE_LANE.height - 0.12 - AXE_LANE.target.y;
}

/** What an axe at (u, v) scores: nothing unless it `stuck` there. */
export function axeScore(u: number, v: number, stuck: boolean): Score {
  if (!stuck) return { points: 0, label: 'Drop' };
  const half = AXE_TARGET.blade / 2;
  // How far the edge (upright, `half` either side of v) comes to a point.
  const near = (pu: number, pv: number) => Math.hypot(u - pu, Math.max(0, Math.abs(v - pv) - half));
  const k = AXE_TARGET.kill;
  if (near(-k.u, k.v) <= k.r || near(k.u, k.v) <= k.r) return { points: k.points, label: 'Killshot' };
  const r = near(0, 0);
  for (const ring of AXE_TARGET.rings) if (r <= ring.r) return { points: ring.points, label: ring.points === 6 ? 'Bull' : String(ring.points) };
  const board = Math.abs(u) <= AXE_TARGET.width / 2 && Math.abs(v) <= AXE_TARGET.height / 2;
  return { points: 0, label: board ? 'Board' : 'Wall' };
}

/** What a throw scores, whichever the game. */
export function score(game: BarGame, u: number, v: number, stuck: boolean): Score {
  return game === 'darts' ? dartScore(u, v) : axeScore(u, v, stuck);
}

/** The most a round can score: three treble twenties, or five killshots. */
export const BEST_ROUND: Record<BarGame, number> = { darts: 180, axe: 5 * AXE_TARGET.kill.points };

// ---- Throwing ---------------------------------------------------------------------------------------

/**
 * Drawing back runs a meter up and down; let go in its green (`at`, `width` wide) and a dart flies
 * true, an axe turns round just right to stick.
 */
export const GREEN: Record<BarGame, { at: number; width: number }> = { darts: { at: 0.7, width: 0.12 }, axe: { at: 0.66, width: 0.12 } };
/** How far past the green's edge (either way, as a part of the meter) an axe still turns near enough to stick. */
const AXE_GRACE = 0.015;

/** The meter `secs` into drawing back: up to full over `period`, back down, and up again. */
export function meterAt(secs: number, period: number): number {
  const p = (secs / period) % 2;
  return p > 1 ? 2 - p : p;
}

/**
 * Where a throw aimed at (u, v) goes for how hard it was thrown (`power`, 0–1 on the meter). How far
 * off the green that is sends a dart low or high (only a little inside it), and an axe that's off it
 * doesn't come round right to stick. `jitter` (−1 to 1 each way) is the hand's own little miss.
 */
export function landing(game: BarGame, u: number, v: number, power: number, jitter: [number, number] = [0, 0]): Omit<Toss, 'n'> {
  const g = GREEN[game];
  const off = power - g.at;
  const half = g.width / 2;
  if (game === 'darts') {
    const drop = Math.abs(off) <= half ? off * 0.25 : Math.sign(off) * (half * 0.25 + (Math.abs(off) - half) * 1.1);
    return { game, u: u + jitter[0] * 0.006, v: v + drop + jitter[1] * 0.006, stick: true };
  }
  const lu = u + jitter[0] * 0.02;
  const lv = v + off * 0.35 + jitter[1] * 0.02;
  return { game, u: lu, v: lv, stick: Math.abs(off) <= half + AXE_GRACE && onBackWall(lu, lv) };
}

// ---- Throws, as the office passes them on ---------------------------------------------------------

/** A throw: which game, where on the target (u, v), whether an axe stuck there, and which throw of the round (from 1). */
export interface Toss {
  game: BarGame;
  u: number;
  v: number;
  stick: boolean;
  n: number;
}

/** Whether a throw from a page is one the office passes on: somewhere near the target, and a throw of the round. */
export function tossOk(t: { game: unknown; u: unknown; v: unknown; n: unknown }): t is Omit<Toss, 'stick'> {
  if (!isBarGame(t.game)) return false;
  const { u, v, n } = t;
  if (typeof u !== 'number' || typeof v !== 'number' || !Number.isFinite(u) || !Number.isFinite(v)) return false;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > ROUND[t.game]) return false;
  return Math.abs(u) <= 3 && Math.abs(v) <= 3;
}
