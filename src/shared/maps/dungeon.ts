import type { Bounds, NavGrid, Pt, Rect } from '../nav.js';
import { MapError, isObj, num } from './check.js';
import { boxFootprint } from './props.js';
import type { AirlockPlan, CellPlan, DungeonConfig, DungeonPlan, SendHomeConfig, SendHomePlace, SendHomePlan, SendHomeStep, Spot } from './types.js';

/*
 * The dungeon under a hall, and what happens to a worker sent home (MapConfig.dungeon and .sendHome).
 * The dungeon is a vault dug out under the hall's floor, stairs down into it through a hole in that
 * floor, and cells along its walls. A map's `sendHome` is a little script: steps a worker (and the
 * escort that comes for it) go through one after another, say, the castle's Kingsguard running up
 * from the dungeon, marching it down there and throwing it into a cell. A worker that's jailed is kept
 * there for good (the server remembers it, see server/jail.ts), and wastes away: thinner and thinner
 * until it starves to death, then it rots down to bare bones. On a station it's the airlock instead
 * (./airlock.ts): a worker that's ejected is kept the same way, adrift outside.
 *
 * Everything here is worked out from plain numbers, so another map's dungeon, or its own way of
 * seeing workers off, is just other numbers and other steps (docs/maps.md). The client acts the
 * steps out (features/workers/sendhome.ts); new kinds of step go in SEND_HOME_STEPS and there.
 */

/** How thick the hall's floor is over the vault: its ceiling is this far under the hall's floor. */
export const DUNGEON_SLAB = 0.4;
/** Each stair down: at most this high, and this deep. */
const RISE = 0.24;
const TREAD = 0.34;
/** How wide the stairs are when the map doesn't say. */
const STAIRS_WIDTH = 2.2;
/** The rail round the hole in the hall's floor, this thick. */
const RAIL = 0.2;
/** A pillar down there, and the heap of bones. */
export const DUNGEON_PILLAR = 0.9;
export const OSSUARY_RADIUS = 1.1;
/** How far apart prisoners sit, and how far off the walls. */
const SEAT_GAP = 1.15;
const OFF_WALL = 0.45;
/** Where a worker is thrown in from (just outside the door), and where the escort stands to do it. */
const THRESHOLD = 0.35;
const OUTSIDE = 1.0;
export const DUNGEON_LIMITS = { cells: 40, pillars: 40, torches: 40, steps: 30 } as const;

/** The kinds of step a send-home script can have (see SendHomeStep), and what each does. */
export const SEND_HOME_STEPS = {
  pack: 'It packs its things into a box at its seat, and its laptop (or tome) shuts',
  fetch: 'The escort comes from its post to the worker',
  say: 'The worker (or, with "who": "escort", its escort) says something',
  walk: 'The worker walks somewhere, the escort holding on to it if it has fetched it',
  jail: 'It is thrown into a cell and locked in: it stays there for good',
  eject: 'It is shoved into the airlock and blown out into space: it stays out there for good',
  leave: 'It is gone, shrinking away wherever it is',
  wait: 'A pause, "seconds" long',
  return: 'The escort goes back to its post',
} as const;
export type SendHomeStepKind = keyof typeof SEND_HOME_STEPS;
const PLACES = ['door', 'stairs', 'dungeon', 'cell', 'airlock', 'post'] as const;

/** Whether `a` is a multiple of a quarter turn: the stairs and the cells run along the walls. */
function quarter(a: number, what: string): number {
  const k = Math.round(a / (Math.PI / 2));
  if (Math.abs(a - (k * Math.PI) / 2) > 0.01) throw new MapError(`${what} should be a quarter turn: 0, 1.5708 (π/2), 3.1416 (π) or -1.5708`);
  return (k * Math.PI) / 2;
}

const within = (b: Bounds, x: number, z: number, m = 0) => x > b.minX + m && x < b.maxX - m && z > b.minZ + m && z < b.maxZ - m;
const rectIn = (b: Bounds, [x0, x1, z0, z1]: Rect, m = 0) => x0 >= b.minX + m - 1e-6 && x1 <= b.maxX - m + 1e-6 && z0 >= b.minZ + m - 1e-6 && z1 <= b.maxZ - m + 1e-6;
/** Whether two rects overlap by more than a sliver (touching is fine). */
export const overlaps = (a: Rect, b: Rect) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0.02 && Math.min(a[3], b[3]) - Math.max(a[2], b[2]) > 0.02;
const grow = ([x0, x1, z0, z1]: Rect, m: number): Rect => [x0 - m, x1 + m, z0 - m, z1 + m];
const inRect = ([x0, x1, z0, z1]: Rect, x: number, z: number, m = 0) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m;

/** The places in a cell its prisoners sit, the ones along its back wall first (the middle one first), then down its sides. */
function cellSpots(c: { x: number; z: number; rotY: number; width: number; depth: number }, floor: number): Spot[] {
  // The cell's own frame: `out` through its bars into the vault, `across` along them.
  const out = [Math.sin(c.rotY), Math.cos(c.rotY)];
  const across = [Math.cos(c.rotY), -Math.sin(c.rotY)];
  const at = (u: number, v: number, rotY: number): Spot => ({ x: c.x + across[0] * u - out[0] * v, y: floor, z: c.z + across[1] * u - out[1] * v, rotY });
  const spots: Spot[] = [];
  // Along the back wall, facing out through the bars.
  const back = Math.max(1, Math.floor((c.width - 2 * OFF_WALL) / SEAT_GAP) + 1);
  const span = Math.min(c.width - 2 * OFF_WALL, (back - 1) * SEAT_GAP);
  const us = Array.from({ length: back }, (_, i) => (back === 1 ? 0 : -span / 2 + (span * i) / (back - 1))).sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
  for (const u of us) spots.push(at(u, c.depth - OFF_WALL, c.rotY));
  // Down each side wall, facing across the cell, clear of the ones at the back and of the door.
  const sides: number[] = [];
  for (let v = c.depth - OFF_WALL - SEAT_GAP; v >= 1.1; v -= SEAT_GAP) sides.push(v);
  if (c.width >= 2 * OFF_WALL + 1.3) {
    for (const v of sides) {
      for (const s of [-1, 1]) spots.push(at(s * (c.width / 2 - OFF_WALL), v, c.rotY + (s < 0 ? -Math.PI / 2 : Math.PI / 2) + Math.PI));
    }
  }
  return spots;
}

/**
 * Checks a map's dungeon and works out where everything in it is. `hall` is the hall above it: the
 * vault has to be under it (the hall's walls are its walls' tops), and so do the stairs' tops.
 */
export function planDungeon(input: unknown, hall: Bounds): DungeonPlan {
  if (!isObj(input)) throw new MapError('dungeon should be { x, z, width, length, depth, stairs, cells }');
  const d = input as unknown as DungeonConfig;
  const x = num(d.x, 'dungeon.x');
  const z = num(d.z, 'dungeon.z');
  const width = num(d.width, 'dungeon.width', 4, 110);
  const length = num(d.length, 'dungeon.length', 4, 110);
  const depth = num(d.depth, 'dungeon.depth', 2.6, 20);
  const bounds: Bounds = { minX: x - width / 2, maxX: x + width / 2, minZ: z - length / 2, maxZ: z + length / 2 };
  if (!rectIn(hall, [bounds.minX, bounds.maxX, bounds.minZ, bounds.maxZ], 0.2)) throw new MapError('the dungeon should be under the hall, at least 0.2 m in from its walls');
  const floor = -depth;
  const ceiling = -DUNGEON_SLAB;

  // The stairs: straight down from the hole in the hall's floor to the vault's.
  if (!isObj(d.stairs)) throw new MapError('dungeon.stairs should be { x, z, rotY, width }');
  const sx = num(d.stairs.x, 'dungeon.stairs.x');
  const sz = num(d.stairs.z, 'dungeon.stairs.z');
  const rotY = quarter(num(d.stairs.rotY ?? 0, 'dungeon.stairs.rotY'), 'dungeon.stairs.rotY');
  const sw = d.stairs.width === undefined ? STAIRS_WIDTH : num(d.stairs.width, 'dungeon.stairs.width', 1.2, 6);
  const along: Pt = [Math.round(Math.sin(rotY)), Math.round(Math.cos(rotY))];
  const n = Math.ceil(depth / RISE);
  const rise = depth / n;
  const run = n * TREAD;
  const steps = Array.from({ length: n }, (_, i) => ({
    top: -(i + 1) * rise,
    rect: boxFootprint(sx + along[0] * (i + 0.5) * TREAD, sz + along[1] * (i + 0.5) * TREAD, sw, TREAD, rotY),
  }));
  const opening = boxFootprint(sx + (along[0] * run) / 2, sz + (along[1] * run) / 2, sw, run, rotY);
  const rails = grow(opening, RAIL);
  const start: Pt = [sx, sz];
  const end: Pt = [sx + along[0] * run, sz + along[1] * run];
  const top: Pt = [sx - along[0] * 0.75, sz - along[1] * 0.75];
  const foot: Pt = [end[0] + along[0] * 0.7, end[1] + along[1] * 0.7];
  if (!rectIn(bounds, opening)) throw new MapError(`the dungeon's stairs (${n} steps, ${run.toFixed(1)} m long) should go down inside it: move them, or make the dungeon bigger`);
  if (!rectIn(hall, rails, 0.2)) throw new MapError('the top of the dungeon stairs should be in the hall');
  if (!within(hall, top[0], top[1], 0.3)) throw new MapError('there should be room in the hall to walk up to the dungeon stairs');
  if (!within(bounds, foot[0], foot[1], 0.3)) throw new MapError('there should be room at the foot of the dungeon stairs: they run into the dungeon’s wall');

  // The cells, along the walls.
  if (!Array.isArray(d.cells) || !d.cells.length) throw new MapError('dungeon.cells should be a list of cells, { x, z, rotY, width, depth }');
  if (d.cells.length > DUNGEON_LIMITS.cells) throw new MapError(`the dungeon has ${d.cells.length} cells, and it can have ${DUNGEON_LIMITS.cells}`);
  const rects: Rect[] = [opening];
  const circles: [number, number, number][] = [];
  const cells: CellPlan[] = d.cells.map((c, i) => {
    const what = `dungeon.cells[${i}]`;
    if (!isObj(c)) throw new MapError(`${what} should be { x, z, rotY, width, depth }`);
    const cell = {
      x: num(c.x, `${what}.x`),
      z: num(c.z, `${what}.z`),
      rotY: quarter(num(c.rotY ?? 0, `${what}.rotY`), `${what}.rotY`),
      width: num(c.width, `${what}.width`, 2, 12),
      depth: num(c.depth, `${what}.depth`, 1.8, 10),
    };
    const out: Pt = [Math.sin(cell.rotY), Math.cos(cell.rotY)];
    const rect = boxFootprint(cell.x - (out[0] * cell.depth) / 2, cell.z - (out[1] * cell.depth) / 2, cell.width, cell.depth, cell.rotY);
    if (!rectIn(bounds, rect)) throw new MapError(`${what} should be inside the dungeon`);
    for (const [j, other] of rects.entries()) if (overlaps(rect, other)) throw new MapError(`${what} runs into ${j === 0 ? 'the stairs' : `dungeon.cells[${j - 1}]`}`);
    rects.push(rect);
    const outside: Pt = [cell.x + out[0] * OUTSIDE, cell.z + out[1] * OUTSIDE];
    if (!within(bounds, outside[0], outside[1], 0.3)) throw new MapError(`${what}'s door should open into the dungeon, with room in front of it`);
    return { ...cell, outside, threshold: [cell.x + out[0] * THRESHOLD, cell.z + out[1] * THRESHOLD], spots: cellSpots(cell, floor) };
  });
  const most = Math.max(...cells.map((c) => c.spots.length));
  const seats: DungeonPlan['seats'] = [];
  for (let k = 0; k < most; k++) cells.forEach((c, i) => k < c.spots.length && seats.push({ cell: i, spot: c.spots[k] }));

  const list = <T>(v: unknown, what: string, max: number, each: (o: Record<string, unknown>, what: string) => T): T[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) throw new MapError(`${what} should be a list`);
    if (v.length > max) throw new MapError(`${what} has ${v.length}, and it can have ${max}`);
    return v.map((o, i) => {
      if (!isObj(o)) throw new MapError(`${what}[${i}] should be { x, z }`);
      return each(o, `${what}[${i}]`);
    });
  };
  const pillars = list(d.pillars, 'dungeon.pillars', DUNGEON_LIMITS.pillars, (o, what): Pt => {
    const p: Pt = [num(o.x, `${what}.x`), num(o.z, `${what}.z`)];
    if (!within(bounds, p[0], p[1], DUNGEON_PILLAR / 2)) throw new MapError(`${what} should be inside the dungeon`);
    if (rects.some((r) => inRect(r, p[0], p[1], DUNGEON_PILLAR / 2))) throw new MapError(`${what} is in a cell, or on the stairs`);
    circles.push([p[0], p[1], DUNGEON_PILLAR / 2 + 0.05]);
    return p;
  });
  const torches = list(d.torches, 'dungeon.torches', DUNGEON_LIMITS.torches, (o, what) => {
    const t = { x: num(o.x, `${what}.x`), z: num(o.z, `${what}.z`), rotY: num(o.rotY ?? 0, `${what}.rotY`) };
    if (!(t.x >= bounds.minX - 0.01 && t.x <= bounds.maxX + 0.01 && t.z >= bounds.minZ - 0.01 && t.z <= bounds.maxZ + 0.01)) throw new MapError(`${what} should be on the dungeon's walls, or inside it`);
    return t;
  });
  let ossuary: Pt | null = null;
  if (d.ossuary != null) {
    if (!isObj(d.ossuary)) throw new MapError('dungeon.ossuary should be { x, z }');
    ossuary = [num(d.ossuary.x, 'dungeon.ossuary.x'), num(d.ossuary.z, 'dungeon.ossuary.z')];
    if (!within(bounds, ossuary[0], ossuary[1], OSSUARY_RADIUS)) throw new MapError('dungeon.ossuary should be inside the dungeon, with room for the heap');
    if (rects.some((r) => inRect(r, ossuary![0], ossuary![1], OSSUARY_RADIUS))) throw new MapError('dungeon.ossuary is in a cell, or on the stairs');
    circles.push([ossuary[0], ossuary[1], OSSUARY_RADIUS]);
  }
  const plan: DungeonPlan = {
    bounds,
    floor,
    ceiling,
    opening,
    rails,
    steps,
    stairs: { rotY, width: sw, top, start, end, foot },
    cells,
    seats,
    pillars,
    torches,
    ossuary,
    obstacles: { rects, circles },
  };
  // Where the escort stands and walkers go has to be clear.
  const blocked = (px: number, pz: number) => rects.some((r) => inRect(r, px, pz, 0.25)) || circles.some(([cx, cz, r]) => Math.hypot(px - cx, pz - cz) < r + 0.25);
  if (blocked(foot[0], foot[1])) throw new MapError('the foot of the dungeon stairs runs into a cell, a pillar or the bones');
  cells.forEach((c, i) => {
    if (blocked(c.outside[0], c.outside[1])) throw new MapError(`something's in the way of dungeon.cells[${i}]'s door`);
  });
  return plan;
}

/** Whether (x, z) is clear to stand in, down in the dungeon. */
export function dungeonClear(d: DungeonPlan, x: number, z: number): boolean {
  return within(d.bounds, x, z, 0.3) && !d.obstacles.rects.some((r) => inRect(r, x, z, 0.25)) && !d.obstacles.circles.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r + 0.25);
}

// ---- Sending workers home ---------------------------------------------------------------------

/** Without a word from the map, it takes a day to starve down there, and half a day more to rot to the bone. */
export const STARVE_HOURS = 24;
export const ROT_HOURS = 12;

function place(v: unknown, what: string): SendHomePlace {
  if (typeof v === 'string') {
    if (!(PLACES as readonly string[]).includes(v)) throw new MapError(`${what} should be one of ${PLACES.map((p) => `"${p}"`).join(', ')}, or { x, z }`);
    return v as SendHomePlace;
  }
  if (!isObj(v)) throw new MapError(`${what} should be one of ${PLACES.map((p) => `"${p}"`).join(', ')}, or { x, z }`);
  if (v.below !== undefined && typeof v.below !== 'boolean') throw new MapError(`${what}.below should be true or false`);
  return { x: num(v.x, `${what}.x`), z: num(v.z, `${what}.z`), ...(v.below ? { below: true } : {}) };
}

/**
 * Checks a map's `sendHome` against its hall (`hall`, what's in its way `clear`), its dungeon and its
 * airlock, and fills in what it leaves out. Undefined when there's none: a worker just walks out of the door.
 */
export function planSendHome(input: unknown, hall: Bounds, hallClear: (x: number, z: number) => boolean, dungeon: DungeonPlan | undefined, airlock?: AirlockPlan): SendHomePlan | undefined {
  if (input == null) return undefined;
  if (!isObj(input)) throw new MapError('sendHome should be { escort, steps }');
  const c = input as unknown as SendHomeConfig;
  const needDungeon = (what: string) => {
    if (!dungeon) throw new MapError(`sendHome ${what}, and the map has no dungeon`);
  };
  const needAirlock = (what: string) => {
    if (!airlock) throw new MapError(`sendHome ${what}, and the map has no airlock`);
  };
  /** A spot someone can stand in: in the hall, or with `below`, down in the dungeon. */
  const standing = (x: number, z: number, below: boolean, what: string) => {
    if (below) {
      needDungeon(`has ${what} down in the dungeon`);
      if (!dungeonClear(dungeon!, x, z)) throw new MapError(`${what} (${x.toFixed(1)}, ${z.toFixed(1)}) should be somewhere clear in the dungeon`);
    } else if (!within(hall, x, z, 0.3) || !hallClear(x, z)) throw new MapError(`${what} (${x.toFixed(1)}, ${z.toFixed(1)}) should be somewhere clear in the hall`);
  };

  let escort: SendHomePlan['escort'];
  if (c.escort != null) {
    if (!isObj(c.escort) || !isObj(c.escort.post)) throw new MapError('sendHome.escort should be { name, post: { x, z, rotY, below } }');
    const p = c.escort.post;
    const below = p.below === true;
    const post = { x: num(p.x, 'sendHome.escort.post.x'), z: num(p.z, 'sendHome.escort.post.z'), rotY: num(p.rotY ?? 0, 'sendHome.escort.post.rotY'), below };
    standing(post.x, post.z, below, 'sendHome.escort.post');
    const name = typeof c.escort.name === 'string' && c.escort.name.trim() ? c.escort.name.trim().slice(0, 40) : 'Guard';
    const color = typeof c.escort.color === 'string' && c.escort.color.length <= 40 ? c.escort.color : '#8e1b1b';
    escort = { name, color, post: { ...post, y: below ? dungeon!.floor : 0 } };
  }
  const needEscort = (what: string) => {
    if (!escort) throw new MapError(`sendHome has ${what}, and no escort`);
  };

  if (!Array.isArray(c.steps) || !c.steps.length) throw new MapError('sendHome.steps should be a list of steps, like [{ "do": "pack" }, { "do": "walk", "to": "door" }]');
  if (c.steps.length > DUNGEON_LIMITS.steps) throw new MapError(`sendHome has ${c.steps.length} steps, and it can have ${DUNGEON_LIMITS.steps}`);
  /** Once it's jailed or gone, only the escort has anything left to do. */
  let done = '';
  const steps: SendHomeStep[] = (c.steps as unknown[]).map((s, i): SendHomeStep => {
    const what = `sendHome.steps[${i}]`;
    if (!isObj(s) || typeof s.do !== 'string') throw new MapError(`${what} should be { "do": … }`);
    if (!Object.hasOwn(SEND_HOME_STEPS, s.do)) throw new MapError(`${what} does "${s.do}", which isn't a step there is (${Object.keys(SEND_HOME_STEPS).join(', ')})`);
    const kind = s.do as SendHomeStepKind;
    const worker = kind === 'pack' || kind === 'walk' || kind === 'jail' || kind === 'eject' || kind === 'leave' || kind === 'fetch' || (kind === 'say' && s.who !== 'escort');
    if (worker && done) throw new MapError(`${what}: the worker's ${done} by then, so only its escort can do anything more`);
    switch (kind) {
      case 'pack':
      case 'leave':
        if (kind === 'leave') done = 'gone';
        return { do: kind };
      case 'jail':
        needDungeon('jails workers');
        done = 'locked up';
        return { do: 'jail' };
      case 'eject':
        needAirlock('ejects workers');
        done = 'out of the airlock';
        return { do: 'eject' };
      case 'fetch':
        needEscort('an escort fetching the worker');
        return { do: 'fetch', ...(s.run === false ? { run: false } : {}) };
      case 'return':
        needEscort('an escort going back to its post');
        return { do: 'return' };
      case 'wait':
        return { do: 'wait', seconds: num(s.seconds, `${what}.seconds`, 0, 30) };
      case 'say': {
        const who = s.who === 'escort' ? 'escort' : 'worker';
        if (s.who !== undefined && s.who !== 'worker' && s.who !== 'escort') throw new MapError(`${what}.who should be "worker" or "escort"`);
        if (who === 'escort') needEscort('its escort saying something');
        const lines = typeof s.text === 'string' ? [s.text] : Array.isArray(s.text) ? s.text : null;
        if (!lines?.length || lines.length > 20 || lines.some((l: unknown) => typeof l !== 'string' || !l.trim())) throw new MapError(`${what}.text should be something to say, or a list of things (one's picked at random)`);
        return { do: 'say', who, text: lines.map((l: unknown) => String(l).trim().slice(0, 80)) };
      }
      case 'walk': {
        const to = place(s.to, `${what}.to`);
        if (to === 'stairs' || to === 'dungeon' || to === 'cell') needDungeon(`walks workers to the ${to === 'cell' ? 'cells' : to}`);
        if (to === 'airlock') needAirlock('walks workers to the airlock');
        if (to === 'post') needEscort('a walk to the escort’s post');
        if (typeof to === 'object') standing(to.x, to.z, !!to.below, `${what}.to`);
        return { do: 'walk', to, ...(s.run === true ? { run: true } : {}) };
      }
    }
  });
  const hours = (v: unknown, what: string, dflt: number) => (v === undefined ? dflt : num(v, what, 0, 100000));
  const starve = hours(c.starveHours, 'sendHome.starveHours', STARVE_HOURS);
  const rot = hours(c.rotHours, 'sendHome.rotHours', ROT_HOURS);
  return { escort, steps, keeps: steps.some((s) => s.do === 'jail' || s.do === 'eject'), starveMs: Math.max(1000, starve * 3_600_000), rotMs: Math.max(1000, rot * 3_600_000) };
}

// ---- Wasting away ------------------------------------------------------------------------------

/** How far gone someone locked up at `at` is by `now`: how thin (0–1), whether they've starved to death, and how far they've rotted since (0–1). */
export function wasting(at: number, now: number, p: Pick<SendHomePlan, 'starveMs' | 'rotMs'>): { thin: number; dead: boolean; rot: number } {
  const t = Math.max(0, now - at);
  const thin = Math.min(1, t / p.starveMs);
  const dead = t >= p.starveMs;
  const rot = dead ? Math.min(1, (t - p.starveMs) / p.rotMs) : 0;
  return { thin, dead, rot };
}

/**
 * Where the `k`th prisoner ever (0 the first) sits, of `total`: the latest ones fill the cells' seats
 * in turn, so everyone stays where they were thrown; the ones from before them, once every seat's
 * been taken, are only bones on the heap (null).
 */
export function prisonSeat(d: DungeonPlan, k: number, total: number): DungeonPlan['seats'][number] | null {
  const n = d.seats.length;
  if (!n || k < total - n) return null;
  return d.seats[k % n];
}

// ---- Walking between the hall and the dungeon --------------------------------------------------

/**
 * The way from `from` to `to`, up or down the dungeon stairs if one of them is down in the dungeon
 * (`below`) and the other isn't: round the hall on `hall`'s grid, round the dungeon on `vault`'s.
 */
export function levelRoute(d: DungeonPlan, hall: NavGrid, vault: NavGrid, from: Pt, fromBelow: boolean, to: Pt, toBelow: boolean): Pt[] {
  if (fromBelow === toBelow) return (fromBelow ? vault : hall).route(from, to);
  const { top, start, end, foot } = d.stairs;
  if (!fromBelow) return [...hall.route(from, top), start, end, ...vault.route(foot, to)];
  return [...vault.route(from, foot), end, start, ...hall.route(top, to)];
}
