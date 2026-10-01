import { FLOOR, ROAD, WALL_T } from './layout.js';
import { STREET_END, onLoop } from './scenic.js';

// The Lambos and Ferraris in the garage, which anyone can drive: where they're parked, where you can
// take them (the garage, the lots round it, the street and the scenic loop off either end of it), and
// the arcade physics a driver's own page runs. Everyone else on the floor sees the car where its
// driver says it is.

export type CarKind = 'lambo' | 'ferrari';

/** A car's footprint (nose to tail along its length), and how high its body and its roof come up. */
export const CAR = { length: 4.6, width: 2, body: 0.82, roof: 1.12 } as const;

/** The building's footprint, walls included: the garage is under it. */
const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;

/** Somewhere flat on the ground, x and z. */
export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** The paved lot in front of the garage, out to the sidewalk, and the one down its east side. */
export const LOT: Box = { minX: -30, maxX: 30, minZ: B.maxZ, maxZ: 21 };
export const SIDE_LOT: Box = { minX: B.maxX, maxX: B.maxX + 12, minZ: B.minZ - 2, maxZ: B.maxZ + 4 };

/**
 * Where a car can go, besides the scenic loop (see shared/scenic.ts), which takes over from either
 * end of the street: the garage (inside its back and west walls, open to the south and east), the
 * lots round it, across the sidewalk and along the street. What stands on them (columns, lamps,
 * trees, the other cars) is the driver's page to bump into.
 */
export const PAVEMENT: Box[] = [
  { minX: FLOOR.minX, maxX: B.maxX, minZ: FLOOR.minZ, maxZ: B.maxZ },
  { ...LOT, maxZ: ROAD.minZ },
  SIDE_LOT,
  { minX: -STREET_END, maxX: STREET_END, minZ: ROAD.minZ, maxZ: ROAD.maxZ },
];

export interface CarDef {
  kind: CarKind;
  color: string;
  /** What the hint calls it: "Orange Lambo". */
  name: string;
  /** Its spot: where it's parked when the office starts, and which way its nose points (0 is +z). */
  x: number;
  z: number;
  rotY: number;
}

// Lambos nose-in along the back wall, Ferraris backed in facing the street, and one out front.
const BACK = B.minZ + WALL_T + 0.4 + CAR.length / 2;
const FRONT = B.maxZ - 0.5 - CAR.length / 2;
export const CARS: readonly CarDef[] = [
  { kind: 'lambo', color: '#8ac926', name: 'Lime Lambo', x: -14.4, z: BACK, rotY: Math.PI },
  { kind: 'lambo', color: '#ff7b00', name: 'Orange Lambo', x: -8, z: BACK, rotY: Math.PI },
  { kind: 'lambo', color: '#ffd000', name: 'Yellow Lambo', x: 1.6, z: BACK, rotY: Math.PI },
  { kind: 'lambo', color: '#7b2cbf', name: 'Purple Lambo', x: 11.2, z: BACK, rotY: Math.PI },
  { kind: 'ferrari', color: '#d90429', name: 'Red Ferrari', x: -14.4, z: FRONT, rotY: 0 },
  { kind: 'ferrari', color: '#d90429', name: 'Rosso Ferrari', x: -4.8, z: FRONT, rotY: 0 },
  { kind: 'ferrari', color: '#ffc300', name: 'Giallo Ferrari', x: 4.8, z: FRONT, rotY: 0 },
  { kind: 'ferrari', color: '#e5383b', name: 'Scarlet Ferrari', x: 14.4, z: FRONT, rotY: 0 },
  // Left out front, for everyone upstairs to look at.
  { kind: 'lambo', color: '#00b4d8', name: 'Blue Lambo', x: 9, z: 18.2, rotY: Math.PI / 2 },
];

export type CarSeat = 'driver' | 'passenger';

/**
 * Where the two of you sit, in the car's own frame (x across, +x on the driver's left side; z toward
 * the nose), and how high your hips are off the ground. Your head's up out of the top: with anyone
 * in it, the roof comes off.
 */
export const SEATS: Record<CarSeat, { x: number; z: number }> = { driver: { x: 0.42, z: -0.5 }, passenger: { x: -0.42, z: -0.5 } };
export const SEAT_HIPS = 0.45;

/** A car where it is and how it's going: `speed` in m/s along its nose (negative in reverse), `steer` the front wheels' angle (+ is left). */
export interface CarPose {
  x: number;
  z: number;
  rotY: number;
  speed: number;
  steer: number;
}

/** A car as the office has it: where it is, and who's in it (PeerInfo ids). */
export interface CarState extends CarPose {
  driver?: string;
  passenger?: string;
}

/** Every car in its spot, as the office starts. */
export function parked(): CarState[] {
  return CARS.map((c) => ({ x: c.x, z: c.z, rotY: c.rotY, speed: 0, steer: 0 }));
}

/** The pedals and the wheel: `gas` 1 forward, -1 back (braking first if you're going the other way), `turn` +1 hard left. */
export interface Pedals {
  gas: number;
  turn: number;
  brake: boolean;
}

export const DRIVE = {
  /** Flat out, forward and in reverse (m/s). */
  top: 20,
  reverse: 7,
  /** Speeding up, forward and back, and slowing down on the brake or rolling (m/s²). */
  accel: 8,
  reverseAccel: 5,
  brake: 20,
  coast: 2.5,
  /** Between the axles (m): how tight it turns. */
  wheelbase: 2.8,
  /** How far the front wheels turn at a crawl (radians): less the faster you go, so it doesn't spin out. */
  steer: 0.6,
  /** How fast they turn (radians a second). */
  steerRate: 2.8,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How far the front wheels can turn at `speed`. */
export function steerLimit(speed: number): number {
  return DRIVE.steer / (1 + Math.abs(speed) / 9);
}

/** The car `dt` seconds on, with these pedals: a bicycle model, no sliding. */
export function drive(p: CarPose, pedals: Pedals, dt: number): CarPose {
  const want = clamp(pedals.turn, -1, 1) * steerLimit(p.speed);
  const steer = p.steer + clamp(want - p.steer, -DRIVE.steerRate * dt, DRIVE.steerRate * dt);
  let v = p.speed;
  const toward = (target: number, rate: number) => (v += clamp(target - v, -rate * dt, rate * dt));
  const gas = clamp(pedals.gas, -1, 1);
  if (pedals.brake) toward(0, DRIVE.brake);
  else if (gas > 0) {
    if (v < 0) toward(0, DRIVE.brake);
    else v = Math.min(DRIVE.top, v + DRIVE.accel * gas * dt);
  } else if (gas < 0) {
    if (v > 0) toward(0, DRIVE.brake);
    else v = Math.max(-DRIVE.reverse, v + DRIVE.reverseAccel * gas * dt);
  } else toward(0, DRIVE.coast);
  const yaw = (v * Math.tan(steer)) / DRIVE.wheelbase;
  const mid = p.rotY + (yaw * dt) / 2;
  return {
    x: p.x + Math.sin(mid) * v * dt,
    z: p.z + Math.cos(mid) * v * dt,
    rotY: Math.atan2(Math.sin(p.rotY + yaw * dt), Math.cos(p.rotY + yaw * dt)),
    speed: v,
    steer,
  };
}

/** A point in the car's own frame (x across, +x left; z toward the nose), out in the world. */
export function carPoint(p: { x: number; z: number; rotY: number }, lx: number, lz: number): { x: number; z: number } {
  const s = Math.sin(p.rotY);
  const c = Math.cos(p.rotY);
  return { x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c };
}

/** Whether (x, z) is somewhere a car can be: the garage, the lots, the street or the loop. */
export function paved(x: number, z: number): boolean {
  return PAVEMENT.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) || onLoop(x, z);
}

/** Whether the whole car is on the pavement: its corners, and halfway along each side. */
export function onPavement(p: { x: number; z: number; rotY: number }): boolean {
  const w = CAR.width / 2;
  const l = CAR.length / 2;
  for (const [lx, lz] of [
    [w, l],
    [-w, l],
    [w, -l],
    [-w, -l],
    [w, 0],
    [-w, 0],
    [0, l],
    [0, -l],
  ]) {
    const at = carPoint(p, lx, lz);
    if (!paved(at.x, at.z)) return false;
  }
  return true;
}

/** Whether the car's footprint (a rectangle turned by rotY) overlaps box `b` (separating axes). */
export function overlaps(p: { x: number; z: number; rotY: number }, b: Box): boolean {
  const hx = CAR.width / 2;
  const hz = CAR.length / 2;
  const ex = (b.maxX - b.minX) / 2;
  const ez = (b.maxZ - b.minZ) / 2;
  const dx = (b.minX + b.maxX) / 2 - p.x;
  const dz = (b.minZ + b.maxZ) / 2 - p.z;
  const s = Math.abs(Math.sin(p.rotY));
  const c = Math.abs(Math.cos(p.rotY));
  if (Math.abs(dx) >= c * hx + s * hz + ex) return false;
  if (Math.abs(dz) >= s * hx + c * hz + ez) return false;
  const sn = Math.sin(p.rotY);
  const cs = Math.cos(p.rotY);
  // Across the car, and along it.
  if (Math.abs(dx * cs - dz * sn) >= hx + ex * c + ez * s) return false;
  if (Math.abs(dx * sn + dz * cs) >= hz + ex * s + ez * c) return false;
  return true;
}

/** Whether the car can be at `p`: on the pavement, clear of all of `solids`. */
export function carFits(p: { x: number; z: number; rotY: number }, solids: Iterable<Box>): boolean {
  if (!onPavement(p)) return false;
  for (const b of solids) if (overlaps(p, b)) return false;
  return true;
}
