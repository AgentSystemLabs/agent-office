/**
 * Coffee from the kitchen machine: a minute of quicker walking and higher jumps. Keep drinking
 * before the last cup wears off and you get the jitters for a few seconds.
 * Times are seconds, on whichever clock the caller passes in as `now`.
 */

/** How long one cup keeps you going. */
export const BUZZ_SECONDS = 60;
/** Walking and running speed while buzzed, as a multiple of normal. */
const SPEED = 1.4;
/** Jump speed while buzzed: about 45% higher jumps. */
const JUMP = 1.2;
/** The boost eases off over the last few seconds instead of stopping dead. */
const FADE_SECONDS = 4;
/** The cup in a row that brings on the jitters. */
const JITTERY_CUP = 3;
const JITTER_SECONDS = 4;

export class Caffeine {
  /** When the current buzz wears off. */
  private until = 0;
  private jitterUntil = 0;
  /** Cups in a row (cans of Diet Coke count as one), each drunk before the one before it wore off. */
  cups = 0;

  /**
   * Drinks a cup — or a can of Diet Coke off the fridge's shelf, which has the same caffeine in it —
   * which tops the buzz back up to a full minute. Returns whether it brought on the jitters.
   */
  drink(now: number): boolean {
    this.cups = this.buzzed(now) ? this.cups + 1 : 1;
    this.until = now + BUZZ_SECONDS;
    if (this.cups < JITTERY_CUP) return false;
    this.jitterUntil = now + JITTER_SECONDS;
    return true;
  }

  buzzed(now: number): boolean {
    return now < this.until;
  }

  /** Seconds of buzz left. */
  left(now: number): number {
    return Math.max(0, this.until - now);
  }

  /** Walking and running speed, as a multiple of normal. */
  speed(now: number): number {
    return 1 + (SPEED - 1) * this.strength(now);
  }

  /** Jump speed, as a multiple of normal. */
  jump(now: number): number {
    return 1 + (JUMP - 1) * this.strength(now);
  }

  /** 0 (steady) to 1 (the jitters), settling down over the last second. */
  jitter(now: number): number {
    return Math.min(1, Math.max(0, this.jitterUntil - now));
  }

  private strength(now: number): number {
    return Math.min(1, this.left(now) / FADE_SECONDS);
  }
}
