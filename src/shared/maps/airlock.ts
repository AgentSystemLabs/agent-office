import type { Bounds, Pt } from '../nav.js';
import { MapError, isObj, num } from './check.js';
import type { AirlockConfig, AirlockPlan, MapConfig, WallOpening, WallSide } from './types.js';

/*
 * A station's walls, and what's cut through them (a station-style map, see ./station.ts): the hatch
 * workers come in and go home through, the windows out into space (its `viewport` props), and the
 * airlock (MapConfig.airlock), whose chamber sticks out of the hull beyond one wall. A worker sent
 * home on a map whose script ejects it (see ./dungeon.ts) is shoved into that chamber and blown out
 * of the outer hatch, and is kept out there for good, adrift: `adrift` says where each one has got
 * to, from when it was blown out, the same in every browser.
 *
 * It's all worked out from plain numbers, like the dungeon, so another station is other numbers.
 */

/** How thick a station's hull is. */
export const HULL = 0.5;
/** The hatch workers come in through: across and high. */
export const HATCH = { width: 3.2, height: 3.1 } as const;
/**
 * The airlock: its inner door (across and high), the chamber beyond the wall (across, and out from
 * the wall's outside face), and how far in front of the inner door a worker's brought.
 */
export const AIRLOCK = { door: 2, height: 2.7, width: 3.4, depth: 3.6, front: 1.5 } as const;
/** What a `viewport` is when its map doesn't say: its sill, across and high. */
export const VIEWPORT = { y: 1.1, width: 5, height: 3.6 } as const;
/** How far short of a wall's ends and top an opening has to stop, and how far apart two have to be. */
const MARGIN = 0.6;

const SIDES: readonly WallSide[] = ['west', 'east', 'north', 'south'];

/** Which wall (x, z) is nearest, and how far off it is. */
export function nearestWall(b: Bounds, x: number, z: number): { wall: WallSide; gap: number } {
  const gaps: Record<WallSide, number> = { west: x - b.minX, east: b.maxX - x, north: z - b.minZ, south: b.maxZ - z };
  const wall = SIDES.reduce((a, k) => (gaps[k] < gaps[a] ? k : a), 'south' as WallSide);
  return { wall, gap: gaps[wall] };
}

/** The way out through `wall`: a step along x or z. */
export const wallOut = (wall: WallSide): Pt => (wall === 'west' ? [-1, 0] : wall === 'east' ? [1, 0] : wall === 'north' ? [0, -1] : [0, 1]);

/** The point `u` along `wall`, on its inside face. */
export function wallPoint(b: Bounds, wall: WallSide, u: number): Pt {
  return wall === 'west' ? [b.minX, u] : wall === 'east' ? [b.maxX, u] : wall === 'north' ? [u, b.minZ] : [u, b.maxZ];
}

/** Where `wall` starts and ends, along itself. */
const wallSpan = (b: Bounds, wall: WallSide): [number, number] => (wall === 'north' || wall === 'south' ? [b.minX, b.maxX] : [b.minZ, b.maxZ]);

/** How far along its wall (x, z) is. */
const along = (wall: WallSide, x: number, z: number) => (wall === 'north' || wall === 'south' ? x : z);

/** Checks a map's airlock, and works out where its door, its chamber and its outer hatch are. */
export function planAirlock(input: unknown, hall: Bounds): AirlockPlan {
  if (!isObj(input)) throw new MapError('airlock should be { x, z }: just inside its inner door');
  const a = input as unknown as AirlockConfig;
  const x = num(a.x, 'airlock.x');
  const z = num(a.z, 'airlock.z');
  if (x < hall.minX || x > hall.maxX || z < hall.minZ || z > hall.maxZ) throw new MapError(`airlock (${x.toFixed(1)}, ${z.toFixed(1)}) is outside the hall`);
  const { wall } = nearestWall(hall, x, z);
  const out = wallOut(wall);
  const door = wallPoint(hall, wall, along(wall, x, z));
  const at = (d: number): Pt => [door[0] + out[0] * d, door[1] + out[1] * d];
  return { wall, out, door, front: at(-AIRLOCK.front), chamber: at(HULL + AIRLOCK.depth * 0.45), hatch: at(HULL + AIRLOCK.depth) };
}

/**
 * Everything cut through a station's walls: the hatch in the wall nearest its `door`, its airlock's
 * inner door, and a window for each `viewport` prop, in the wall it's on. None may run into another,
 * or off the end or the top of its wall.
 */
export function wallOpenings(c: MapConfig, hall: Bounds, height: number, airlock: AirlockPlan | undefined): WallOpening[] {
  const out: WallOpening[] = [];
  const add = (o: WallOpening, what: string) => {
    const [lo, hi] = wallSpan(hall, o.wall);
    if (o.u - o.width / 2 < lo + MARGIN || o.u + o.width / 2 > hi - MARGIN) throw new MapError(`${what} runs off the end of the ${o.wall} wall: move it along, or make it narrower`);
    if (o.y + o.height > height - MARGIN) throw new MapError(`${what} reaches ${(o.y + o.height).toFixed(1)} m up, and the hall's walls are ${height} m: it needs ${MARGIN} m of wall over it`);
    const hit = out.find((p) => p.wall === o.wall && Math.abs(p.u - o.u) < (p.width + o.width) / 2 + MARGIN);
    if (hit) throw new MapError(`${what} runs into ${hit.kind === 'door' ? 'the way in' : hit.kind === 'airlock' ? 'the airlock' : 'another viewport'} in the ${o.wall} wall`);
    out.push(o);
  };
  const d = nearestWall(hall, c.door.x, c.door.z);
  add({ wall: d.wall, kind: 'door', u: along(d.wall, c.door.x, c.door.z), y: 0, width: HATCH.width, height: HATCH.height }, 'the way in (door)');
  if (airlock) add({ wall: airlock.wall, kind: 'airlock', u: along(airlock.wall, airlock.door[0], airlock.door[1]), y: 0, width: AIRLOCK.door, height: AIRLOCK.height }, 'the airlock');
  (c.props ?? []).forEach((p, i) => {
    if (p.kind !== 'viewport') return;
    const { wall, gap } = nearestWall(hall, p.x, p.z);
    if (gap > 1) throw new MapError(`props[${i}] (a viewport) should be on a wall: it's ${gap.toFixed(1)} m from the nearest`);
    add({ wall, kind: 'viewport', u: along(wall, p.x, p.z), y: p.y ?? VIEWPORT.y, width: p.width ?? VIEWPORT.width, height: p.height ?? VIEWPORT.height }, `props[${i}] (a viewport)`);
  });
  return out;
}

// ---- Adrift ------------------------------------------------------------------------------------

/**
 * Whoever's been blown out of the airlock: how many of them are still to be seen out there (the
 * latest ones); how far from the outer hatch one starts (m), how much further it gets in its first
 * couple of minutes (`soon`, while you watch it go), and how far off it ends up (`far`), which
 * takes it `hours` to get most of the way to.
 */
export const ADRIFT = { shown: 30, near: 5, soon: 9, far: 42, hours: 6 } as const;

/** Where someone adrift is, their middle, and how they've tumbled round to (radians, about x, y and z). */
export interface Drift {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

/** A few numbers in [0, 1) that are `id`'s own, so everyone sees it drift the same way. */
function own(id: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return Array.from({ length: 9 }, () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  });
}

/**
 * Where `id` is, `age` ms after it was blown out of `a`: off on a heading of its own, out from the
 * hatch and well to one side of it or the other (so it shows from the window that side of the
 * airlock, clear of the chamber), quickly at first and ever slower, turning over and over as it goes.
 * The same for everyone, whenever they look.
 */
export function adrift(a: AirlockPlan, id: string, age: number): Drift {
  const [u1, u2, u3, u4, u5, u6, u7, u8, u9] = own(id);
  const secs = Math.max(0, age) / 1000;
  const yaw = (u1 < 0.5 ? -1 : 1) * (0.35 + 0.6 * Math.abs(u1 - 0.5) * 2);
  const pitch = -0.1 + u2 * 0.46;
  const dist = ADRIFT.near + ADRIFT.soon * (1 - Math.exp(-secs / 75)) + (ADRIFT.far - ADRIFT.near - ADRIFT.soon) * (0.7 + 0.3 * u3) * (1 - Math.exp(-secs / 3600 / ADRIFT.hours));
  const fwd = dist * Math.cos(pitch) * Math.cos(yaw);
  const side = dist * Math.cos(pitch) * Math.sin(yaw) + Math.sin(secs / 23 + u4 * 6.3) * 0.5;
  const [ox, oz] = a.out;
  /** How fast it turns about an axis (rad/s): slowly, one way or the other. */
  const spin = (u: number) => (u < 0.5 ? -1 : 1) * (0.07 + 0.25 * Math.abs(u - 0.5) * 2);
  return {
    x: a.hatch[0] + ox * fwd - oz * side,
    y: 1.3 + dist * Math.sin(pitch) + Math.sin(secs / 31 + u5 * 6.3) * 0.4,
    z: a.hatch[1] + oz * fwd + ox * side,
    rx: u6 * 6.3 + secs * spin(u7),
    ry: u7 * 6.3 + secs * spin(u8),
    rz: u8 * 6.3 + secs * spin(u9),
  };
}

/** Which of `n` kept (the first to go first) are still to be seen adrift: the latest ADRIFT.shown of them. */
export const adriftFrom = (n: number) => Math.max(0, n - ADRIFT.shown);
