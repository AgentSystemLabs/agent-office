/**
 * Drinks from the rooftop bar: each goes to your head over a few seconds, then wears off over a
 * minute or so. They add up, and the more you've had, the more the view sways, doubles and smears
 * (world/drunk.ts) and the more you stagger (see PlayerController.drunk). Water helps a little.
 * Times are seconds, on whichever clock the caller passes in as `now`.
 */
import { BOOZE_LIMIT, type Drink } from '../shared/rooftop';

/** A drink kicks in over about this long. */
const KICK_IN = 4;
/** And wears off at this much a second: a beer (0.28) in about half a minute, a shot (0.6) in a minute. */
const SOBER_RATE = 1 / 95;
/** You hold the glass for this long after it's poured, sipping. */
const GLASS_SECONDS = 45;

/** How it feels, from sober (0) up: tipsy, drunk, wasted. */
export type Stage = 0 | 1 | 2 | 3;
const STAGES = [0.2, 0.65, 1.15];

export class Booze {
  /** In your head so far, as of `at`. */
  private level = 0;
  private at = 0;
  /** Drunk but not felt yet: it soaks in over KICK_IN seconds. */
  private coming = 0;
  private glass: Drink | null = null;
  private glassUntil = 0;

  /** Drinks one: it starts to kick in, and you hold the glass for a while. */
  drink(d: Drink, now: number) {
    this.settle(now);
    if (d.strength < 0) this.level = Math.max(0, this.level + d.strength);
    else this.coming += d.strength;
    this.glass = d;
    this.glassUntil = now + GLASS_SECONDS;
  }

  /** Had enough: the bartender pours you a water instead. Counts what's still on its way. */
  cutOff(now: number): boolean {
    this.settle(now);
    return this.level + this.coming >= BOOZE_LIMIT;
  }

  /** How drunk you are now: 0 sober, about 0.3 tipsy, 1 properly drunk, up to BOOZE_LIMIT. */
  amount(now: number): number {
    this.settle(now);
    return this.level;
  }

  stage(now: number): Stage {
    const a = this.amount(now);
    return a >= STAGES[2] ? 3 : a >= STAGES[1] ? 2 : a >= STAGES[0] ? 1 : 0;
  }

  /** The glass in your hand, if you're still holding one. */
  holding(now: number): Drink | null {
    if (this.glass && now > this.glassUntil) this.glass = null;
    return this.glass;
  }

  /** Puts the glass down (leaving the roof: drinks stay at the bar). */
  putDown() {
    this.glass = null;
  }

  private settle(now: number) {
    const dt = Math.max(0, now - this.at);
    this.at = now;
    if (!dt) return;
    const soak = this.coming * (1 - Math.exp((-dt * 3) / KICK_IN));
    this.coming = this.coming - soak < 0.001 ? 0 : this.coming - soak;
    this.level = Math.max(0, this.level + soak - SOBER_RATE * dt);
  }
}
