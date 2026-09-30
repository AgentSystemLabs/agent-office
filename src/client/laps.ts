import { ROAD } from '../shared/layout';
import { CHECKPOINTS, nearLoop } from '../shared/scenic';

/**
 * Timing laps of the scenic loop (see shared/scenic.ts): from the chequered line across the street in
 * front of the office, all the way round the loop (either way) past each of its checkpoints, and back
 * over the line. Crossing it without having been round just starts the clock again.
 */
export class LapTimer {
  /** Your fastest lap so far (seconds), if you've done one. */
  best: number | null;
  /** The last lap you finished: how long it took, whether it was your best, and when (the timer's clock). */
  done: { time: number; best: boolean; at: number } | null = null;
  /** When the lap you're on started, if you've crossed the line. */
  private start: number | null = null;
  private passed = new Set<number>();
  private last: { x: number; z: number } | null = null;

  constructor(best: number | null = null) {
    this.best = best;
  }

  /** The car's got to (x, z) at `now` (seconds). Returns the lap's time if that finished one. */
  update(x: number, z: number, now: number): number | null {
    const was = this.last;
    this.last = { x, z };
    if (!was) return null;
    const at = nearLoop(x, z);
    if (at && at.off < 8) CHECKPOINTS.forEach((d, i) => Math.abs(at.d - d) < 12 && this.passed.add(i));
    // Over the line, on the street, one way or the other (not jumped across it).
    const street = z > ROAD.minZ - 1 && z < ROAD.maxZ + 1;
    if (!street || was.x < 0 === x < 0 || Math.abs(x - was.x) > 10) return null;
    let lap: number | null = null;
    if (this.start !== null && this.passed.size === CHECKPOINTS.length) {
      lap = now - this.start;
      const best = this.best === null || lap < this.best;
      if (best) this.best = lap;
      this.done = { time: lap, best, at: now };
    }
    this.start = now;
    this.passed.clear();
    return lap;
  }

  /** How long you've been on this lap, once you're out on the loop (null till then). */
  running(now: number): number | null {
    return this.start !== null && this.passed.size > 0 ? now - this.start : null;
  }

  /** Out of the car: the lap you were on doesn't count. */
  reset() {
    this.start = null;
    this.passed.clear();
    this.last = null;
  }
}

/** A lap's time as m:ss.t. */
export function lapTime(s: number): string {
  const tenths = Math.round(s * 10);
  const m = Math.floor(tenths / 600);
  const rest = (tenths - m * 600) / 10;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}
