import { DRIVE, parked, paved, type CarPose, type CarSeat, type CarState } from '../shared/garage.js';

/** How often one person can honk, at most (ms). */
const HONK_EVERY = 250;

/**
 * A floor's cars: who's in each one, and where its driver last said it is. Each driver's page drives
 * its own car (see shared/garage.ts) and the office passes it on. Nothing is saved: when the office
 * restarts, every car is back in its spot.
 */
export class Garage {
  private cars = parked();
  private honked = new Map<string, number>();

  constructor(private now = () => Date.now()) {}

  /** Every car as it is now, for the floor's pages. */
  state(): CarState[] {
    return this.cars.map((c) => ({ ...c }));
  }

  /** The car `id` is in, and which seat. */
  seatOf(id: string): { car: number; seat: CarSeat } | undefined {
    for (let i = 0; i < this.cars.length; i++) {
      if (this.cars[i].driver === id) return { car: i, seat: 'driver' };
      if (this.cars[i].passenger === id) return { car: i, seat: 'passenger' };
    }
    return undefined;
  }

  /** `id` gets into `seat` of car `car`, out of wherever they were: only if it's free. Says whether anything changed. */
  enter(id: string, car: number, seat: CarSeat): boolean {
    const c = this.cars[car];
    if (!c || (seat !== 'driver' && seat !== 'passenger') || c[seat]) return false;
    this.leave(id);
    c[seat] = id;
    return true;
  }

  /** `id` gets out (or left the floor, or the office). A car nobody's driving stops where it is. Says whether they were in one. */
  leave(id: string): boolean {
    this.honked.delete(id);
    const at = this.seatOf(id);
    if (!at) return false;
    const c = this.cars[at.car];
    delete c[at.seat];
    if (at.seat === 'driver') Object.assign(c, { speed: 0, steer: 0 });
    return true;
  }

  /**
   * The driver of car `car` says where it's got to: where the office has it now, to pass on. Nothing
   * from anyone else, or from off the pavement.
   */
  drive(id: string, car: number, pose: CarPose): CarPose | undefined {
    const c = this.cars[car];
    if (!c || c.driver !== id) return undefined;
    const { x, z, rotY, speed, steer } = pose;
    if (![x, z, rotY, speed, steer].every(Number.isFinite) || !paved(x, z)) return undefined;
    Object.assign(c, {
      x,
      z,
      rotY: Math.atan2(Math.sin(rotY), Math.cos(rotY)),
      speed: Math.min(DRIVE.top, Math.max(-DRIVE.reverse, speed)),
      steer: Math.min(DRIVE.steer, Math.max(-DRIVE.steer, steer)),
    });
    return { x: c.x, z: c.z, rotY: c.rotY, speed: c.speed, steer: c.steer };
  }

  /** `id` leans on the horn: the car they're in, unless they only just did. */
  honk(id: string): number | undefined {
    const at = this.seatOf(id);
    if (!at) return undefined;
    const now = this.now();
    if (now - (this.honked.get(id) ?? -Infinity) < HONK_EVERY) return undefined;
    this.honked.set(id, now);
    return at.car;
  }
}
