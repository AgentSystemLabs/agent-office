import { ROAD } from './layout.js';

// The scenic loop: a country road out of either end of the street that goes the long way round and
// back. Out of town to the east it passes a farm, turns south into the pines, then runs west along
// the foot of the mountains (through a tunnel under a spur of them), turns north up the coast past
// the beach and comes back into town from the west. The street in front of the office is the rest
// of the loop. Cars can drive all of it (see paved in shared/garage.ts); world/scenic.ts draws it and
// everything along it. It's all laid out here, as numbers, so the office and the tests agree on it.

/** Where the street stops and the loop takes over, either way along it (x). */
export const STREET_END = 110;
/** The middle of the street, which the loop leaves from and comes back to. */
export const STREET_Z = (ROAD.minZ + ROAD.maxZ) / 2;
/** The loop's asphalt either side of its middle (as wide as the street's). */
export const LOOP_HALF = (ROAD.maxZ - ROAD.minZ) / 2;
/** How far from its middle a car can go: onto the gravel shoulder, a little. */
export const LOOP_PAVED = LOOP_HALF + 0.7;

/** The bits of the loop, in the order you drive them (east out of town, round, back from the west). */
export type Place = 'farm' | 'forest' | 'mountains' | 'tunnel' | 'beach' | 'coast' | 'town';

export const PLACES: Record<Place, { name: string; icon: string }> = {
  farm: { name: 'Meadowbrook Farm', icon: '🌾' },
  forest: { name: 'Whispering Pines', icon: '🌲' },
  mountains: { name: 'Summit Pass', icon: '🏔️' },
  tunnel: { name: 'Granite Tunnel', icon: '🚇' },
  beach: { name: 'Sunset Beach', icon: '🏖️' },
  coast: { name: 'Lighthouse Point', icon: '🗼' },
  town: { name: 'Downtown', icon: '🏙️' },
};

/**
 * The road's middle, as knots a smooth curve runs through: the whole loop, clockwise seen from above
 * (east along the street, then south, west and back north). `place` marks where each bit starts.
 * The knots either side of each end of the street are in line with it, so the loop leaves it and
 * comes back onto it dead straight; so are the four round the tunnel.
 */
const KNOTS: { x: number; z: number; place?: Place }[] = [
  { x: -40, z: STREET_Z },
  { x: 0, z: STREET_Z },
  { x: 40, z: STREET_Z },
  { x: 80, z: STREET_Z },
  { x: STREET_END, z: STREET_Z, place: 'farm' },
  { x: 142, z: STREET_Z },
  { x: 172, z: 40 },
  { x: 190, z: 66 },
  { x: 200, z: 96, place: 'forest' },
  { x: 194, z: 128 },
  { x: 204, z: 160 },
  { x: 196, z: 192 },
  { x: 206, z: 222 },
  { x: 199, z: 252 },
  { x: 191, z: 280 },
  { x: 196, z: 306, place: 'mountains' },
  { x: 184, z: 334 },
  { x: 160, z: 352 },
  { x: 130, z: 360 },
  { x: 100, z: 354 },
  { x: 70, z: 366 },
  { x: 44, z: 372 },
  { x: 10, z: 372, place: 'tunnel' },
  { x: -50, z: 372, place: 'mountains' },
  { x: -84, z: 372 },
  { x: -114, z: 364 },
  { x: -144, z: 368 },
  { x: -172, z: 358 },
  { x: -196, z: 340, place: 'beach' },
  { x: -212, z: 314 },
  { x: -220, z: 284 },
  { x: -214, z: 254 },
  { x: -222, z: 224 },
  { x: -216, z: 194 },
  { x: -223, z: 164 },
  { x: -216, z: 134 },
  { x: -208, z: 104, place: 'coast' },
  { x: -196, z: 76 },
  { x: -180, z: 52 },
  { x: -162, z: 36 },
  { x: -142, z: STREET_Z },
  { x: -STREET_END, z: STREET_Z, place: 'town' },
  { x: -80, z: STREET_Z },
];

/** The tunnel: straight along the road (x) from `x0` west to `x1`, at `z`. */
export const TUNNEL = { x0: 10, x1: -50, z: 372, width: 10, wall: 4.4 } as const;

export interface RoadPoint {
  x: number;
  z: number;
  /** Meters along the loop from where it leaves the street's east end. */
  d: number;
  /** Which way the loop goes on from here (a unit vector). */
  tx: number;
  tz: number;
  place: Place;
}

/** A point `t` (0–1) of the way from p1 to p2 on a centripetal Catmull–Rom curve through p0..p3. */
function catmull(p0: { x: number; z: number }, p1: { x: number; z: number }, p2: { x: number; z: number }, p3: { x: number; z: number }, t: number) {
  const knot = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)) || 1e-6;
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a: { x: number; z: number }, b: { x: number; z: number }, ta: number, tb: number) => {
    const k = (u - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

/** How far apart the loop's points are (m). */
const SPACING = 2;

/**
 * The loop from the street's east end round to its west end (the street between is the town's), a
 * point every couple of meters.
 */
export const LOOP: RoadPoint[] = (() => {
  const n = KNOTS.length;
  const start = KNOTS.findIndex((k) => k.x === STREET_END && k.z === STREET_Z);
  const end = KNOTS.findIndex((k) => k.x === -STREET_END && k.z === STREET_Z);
  // Finely along each stretch between knots, from the east end round to the west end.
  const fine: { x: number; z: number; place: Place }[] = [];
  let place: Place = 'farm';
  for (let i = start; i !== end; i = (i + 1) % n) {
    place = KNOTS[i].place ?? place;
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((o) => KNOTS[(i + o + n) % n]);
    for (let s = 0; s < 40; s++) fine.push({ ...catmull(p0, p1, p2, p3, s / 40), place });
  }
  fine.push({ x: KNOTS[end].x, z: KNOTS[end].z, place: 'town' });
  // Then evenly, by distance along it.
  const out: RoadPoint[] = [];
  let d = 0;
  let next = 0;
  for (let i = 0; i < fine.length - 1; i++) {
    const a = fine[i];
    const b = fine[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    while (next <= d + len) {
      const k = (next - d) / len;
      out.push({ x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, d: next, tx: 0, tz: 0, place: a.place });
      next += SPACING;
    }
    d += len;
  }
  const last = fine[fine.length - 1];
  out.push({ x: last.x, z: last.z, d, tx: 0, tz: 0, place: 'town' });
  out.forEach((p, i) => {
    const a = out[Math.max(0, i - 1)];
    const b = out[Math.min(out.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    p.tx = (b.x - a.x) / len;
    p.tz = (b.z - a.z) / len;
  });
  return out;
})();

/** How long the loop is, from one end of the street round to the other (m). */
export const LOOP_LENGTH = LOOP[LOOP.length - 1].d;

/**
 * The loop and a few meters of the street before each end of it, which it's measured from (see
 * nearLoop): its shoulders carry on that far, so a car keeping to the edge doesn't catch a corner of
 * the street's narrower pavement where the two meet.
 */
const OVERLAP = 8;
const PATH: RoadPoint[] = [
  { x: STREET_END - OVERLAP, z: STREET_Z, d: -OVERLAP, tx: 1, tz: 0, place: 'farm' },
  ...LOOP,
  { x: -STREET_END + OVERLAP, z: STREET_Z, d: LOOP_LENGTH + OVERLAP, tx: 1, tz: 0, place: 'town' },
];

/** The loop's stretches (PATH[i] to PATH[i + 1]) sorted into squares of the map, to look up quickly. */
const CELL = 16;
const cells = new Map<string, number[]>();
for (let i = 0; i < PATH.length - 1; i++) {
  const a = PATH[i];
  const b = PATH[i + 1];
  const pad = LOOP_PAVED + 30;
  for (let cx = Math.floor((Math.min(a.x, b.x) - pad) / CELL); cx <= Math.floor((Math.max(a.x, b.x) + pad) / CELL); cx++) {
    for (let cz = Math.floor((Math.min(a.z, b.z) - pad) / CELL); cz <= Math.floor((Math.max(a.z, b.z) + pad) / CELL); cz++) {
      const k = `${cx},${cz}`;
      let list = cells.get(k);
      if (!list) cells.set(k, (list = []));
      list.push(i);
    }
  }
}

/** The nearest point on the loop's middle to somewhere: how far off it that is, which side (+ is left, going round), and the way along it there. */
export interface OnLoop {
  /** How far from the loop's middle (m). */
  off: number;
  /** Which side of it: +1 on the left going round (the outside of the loop), -1 on the right. */
  side: number;
  /** How far round the loop (see RoadPoint.d). */
  d: number;
  x: number;
  z: number;
  tx: number;
  tz: number;
  place: Place;
}

/** Where (x, z) is from the loop, if it's within 30 m or so of it (else null). */
export function nearLoop(x: number, z: number): OnLoop | null {
  const list = cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
  if (!list) return null;
  let best: OnLoop | null = null;
  let bestSq = Infinity;
  for (const i of list) {
    const a = PATH[i];
    const b = PATH[i + 1];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len2 = ex * ex + ez * ez || 1;
    const k = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / len2));
    const px = a.x + ex * k;
    const pz = a.z + ez * k;
    const sq = (x - px) ** 2 + (z - pz) ** 2;
    if (sq >= bestSq) continue;
    bestSq = sq;
    const len = Math.sqrt(len2);
    const tx = ex / len;
    const tz = ez / len;
    // Left of the way round, with +z toward you: the cross product's sign.
    const side = tx * (z - pz) - tz * (x - px) > 0 ? -1 : 1;
    best = { off: Math.sqrt(sq), side, d: a.d + (b.d - a.d) * k, x: px, z: pz, tx, tz, place: a.place };
  }
  return best;
}

/** Whether (x, z) is on the loop's road (its shoulder included). */
export function onLoop(x: number, z: number): boolean {
  const at = nearLoop(x, z);
  return !!at && at.off <= LOOP_PAVED;
}

/** Which bit of the loop (x, z) is by, or the town, if it's by the street; null anywhere else. */
export function placeAt(x: number, z: number): Place | null {
  const at = nearLoop(x, z);
  if (at && at.off < 25) return at.place;
  if (Math.abs(x) <= STREET_END && Math.abs(z - STREET_Z) < 25) return 'town';
  return null;
}

// ---- What's along it ---------------------------------------------------------------------------

/** The mountains to the south: [x, z, radius at the foot, height]. The far ones only show over the near. */
export const MOUNTAINS: [number, number, number, number][] = [
  [-270, 420, 75, 110],
  [-180, 455, 80, 140],
  [-90, 465, 75, 125],
  [5, 480, 90, 170],
  [100, 455, 72, 128],
  [200, 440, 75, 115],
  [290, 360, 62, 95],
  [-130, 590, 110, 200],
  [120, 600, 120, 215],
  [-340, 540, 95, 150],
  [340, 500, 100, 160],
  [0, 690, 130, 240],
];

/** Green foothills between the road and the mountains: [x, z, radius, height]. */
export const FOOTHILLS: [number, number, number, number][] = [
  [60, 412, 30, 30],
  [-130, 406, 26, 26],
  [176, 398, 28, 34],
  [-232, 382, 22, 22],
  [276, 262, 30, 30],
];

/** The spur of mountain the tunnel goes through: how far it reaches either side of the road (z), and how high its ridge gets. */
export const RIDGE = { north: 30, south: 40, height: 26 } as const;

/** The lake inside the loop, under the mountains: its middle and its two half-widths. */
export const LAKE = { x: 60, z: 306, rx: 38, rz: 17 } as const;

/** The creek through the pines, which the road crosses on a bridge: [x, z] along its middle, west to east. */
export const CREEK: [number, number][] = [
  [120, 176],
  [150, 186],
  [176, 180],
  [204, 194],
  [232, 188],
  [262, 202],
  [292, 196],
];

/** The farm by the road out of town to the east: the barn, the silo, the windmill, and its fields. */
export const FARM = {
  barn: { x: 96, z: 58, rotY: -0.25 },
  silo: { x: 110, z: 50 },
  windmill: { x: 128, z: -6 },
  fields: [
    { minX: 58, maxX: 132, minZ: 70, maxZ: 104 },
    { minX: 62, maxX: 150, minZ: -40, maxZ: 14 },
  ],
  /** The fenced field the cows are in, by the barn. */
  pasture: { minX: 48, maxX: 86, minZ: 38, maxZ: 62 },
} as const;

/**
 * The sea's edge, west of the beach: x at `z`. A few gentle bays, well clear of the road (which
 * keeps to the east of x ≈ -228 up the coast).
 */
export function shoreX(z: number): number {
  return -254 + 5 * Math.sin(z / 37) + 3 * Math.sin(z / 13 + 1);
}

/** The lighthouse, on its rocky point out into the sea, and the pier off the beach. */
export const LIGHTHOUSE = { x: -274, z: 18 } as const;
export const PIER = { z: 236, length: 44, width: 4 } as const;

/** Checkpoints round the loop, for timing a lap: a car has to pass each of them (see LapTimer). */
export const CHECKPOINTS = [0.15, 0.4, 0.65, 0.9].map((k) => k * LOOP_LENGTH);
