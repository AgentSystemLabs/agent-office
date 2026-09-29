// Telling when the 3D office is too much for this computer, to offer the 2D view (/lite) instead.

export interface SlowFramesOptions {
  /** A frame this long or longer on average (ms) is slow: 50 is under 20 frames a second. */
  slowMs: number;
  /** How long frames have to stay that slow (ms of drawing) before it counts. */
  spanMs: number;
  /** Not counted at first (ms from the first frame), while the office loads and its shaders compile. */
  warmupMs: number;
  /** A frame longer than this (ms) is a gap, not a slow frame: a hidden tab, a stall. It starts the span over. */
  gapMs: number;
}

export const SLOW_FRAMES: SlowFramesOptions = { slowMs: 50, spanMs: 10_000, warmupMs: 8_000, gapMs: 1_000 };

/**
 * Watches how long frames take. Once the office has warmed up, frames averaging `slowMs` or more
 * through a whole `spanMs` say the 3D is too slow here, once.
 */
export class SlowFrames {
  private warmUntil: number | null = null;
  private start: number | null = null;
  private total = 0;
  private count = 0;
  private said = false;

  constructor(private opts: SlowFramesOptions = SLOW_FRAMES) {}

  /** A frame drawn at `now`, `dt` ms after the one before. True the first time frames have been slow for a whole span. */
  frame(now: number, dt: number): boolean {
    if (this.said) return false;
    this.warmUntil ??= now + this.opts.warmupMs;
    if (now < this.warmUntil) return false;
    if (dt >= this.opts.gapMs) {
      this.start = null;
      return false;
    }
    if (this.start === null) {
      this.start = now;
      this.total = 0;
      this.count = 0;
    }
    this.total += dt;
    this.count++;
    if (now - this.start < this.opts.spanMs) return false;
    const slow = this.total / this.count >= this.opts.slowMs;
    this.start = null;
    this.said = slow;
    return slow;
  }
}
