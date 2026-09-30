/**
 * Fainting: when your energy runs right out, or the stress gets the better of you (see vitals.ts),
 * you keel over where you stand, the lights go out, and you come round out on the street in front of
 * the building with both meters full. Nothing you press moves you while you're down.
 *
 * The caller drives this from its frame loop and does the world's part as each phase comes round:
 * `falling` (stop whatever you were doing, go down), then `out` (the lights are out), then `wake`
 * (put them outside and top the meters up) — and clears it once they're on their feet again.
 */

/** How long you take to go down, and how long the lights stay out once you're flat. */
export const FALL_SECONDS = 0.9;
export const OUT_SECONDS = 4;

export type FaintPhase = 'up' | 'falling' | 'out' | 'wake';

export class Faint {
  /** Seconds since you went down, or -1 while you're on your feet. */
  private t = -1;

  /**
   * Every frame: `dt` seconds further on, and whether the meters have run out (see Vitals.spent).
   * The phase it ends the frame in is what the caller acts on.
   */
  update(dt: number, spent: boolean): FaintPhase {
    if (this.t < 0) {
      if (spent) this.t = 0;
    } else this.t += dt;
    return this.phase;
  }

  get phase(): FaintPhase {
    if (this.t < 0) return 'up';
    if (this.t < FALL_SECONDS) return 'falling';
    return this.t < FALL_SECONDS + OUT_SECONDS ? 'out' : 'wake';
  }

  /** Whether you're down: keeling over, or out cold. */
  get down(): boolean {
    return this.t >= 0;
  }

  /** 0 on your feet … 1 flat out: how far over you are, for the camera and the body (see PlayerController.prone). */
  get fall(): number {
    return this.t < 0 ? 0 : Math.min(1, this.t / FALL_SECONDS);
  }

  /** On your feet again, wherever the caller has just put you. */
  clear() {
    this.t = -1;
  }
}