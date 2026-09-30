/**
 * How you're doing: how much energy you've got left in you and how wound up you are. Both drift
 * away slowly while you're in the office — energy over ENERGY_SECONDS, and the stress building over
 * STRESS_SECONDS — and what you drink is what puts them back: a cup from the kitchen's coffee
 * machine (or a cask of ale on the castle) puts energy back, a drink from the rooftop bar takes the
 * stress off, each drink saying how much of each it does in shared/rooftop.ts. Running low, your
 * legs get heavy; wound up past half, your hands and the view shake. Run one right out and you keel
 * over where you stand (see faint.ts), and come round outside the building with both meters full.
 * They're yours alone, like your coffee buzz (caffeine.ts) and how drunk you are (booze.ts).
 * Times are seconds, on whichever clock the caller passes in as `now`.
 */

/** What a drink does for you: energy put back, and stress taken off. */
export interface Remedy {
  /** 0–1 of energy put back. */
  energy: number;
  /** 0–1 of stress taken off. */
  calm: number;
}

/** A cup from a coffee machine: it is the thing that puts your energy back. */
export const CUP: Remedy = { energy: 0.35, calm: 0.05 };

/** How long a full bar of energy lasts if you never touch coffee: ten minutes. */
export const ENERGY_SECONDS = 10 * 60;
export const ENERGY_DRAIN = 1 / ENERGY_SECONDS;
/** And how long it takes, doing nothing in particular, to wind right up: a quarter of an hour. */
export const STRESS_SECONDS = 15 * 60;
export const STRESS_DRAIN = 1 / STRESS_SECONDS;

/** At or under this your legs get heavy, and the office says so. */
export const LOW_ENERGY = 0.25;
/** At or over this your hands shake, and the office says so too. */
export const HIGH_STRESS = 0.75;

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export class Vitals {
  private energy = 1;
  private stress = 0;
  /** What they were last brought up to; null until the first call, so the first one doesn't drain. */
  private at: number | null = null;

  /** How much energy is left in you, 0–1, as of `now`. */
  energyLeft(now: number): number {
    this.settle(now);
    return this.energy;
  }

  /** How wound up you are, 0 (calm) to 1, as of `now`. */
  strain(now: number): number {
    this.settle(now);
    return this.stress;
  }

  /** Drinks something: energy goes back and stress comes off, never past full or past nothing. */
  drink(r: Remedy, now: number) {
    this.settle(now);
    this.energy = clamp(this.energy + r.energy);
    this.stress = clamp(this.stress - r.calm);
  }

  /**
   * The meters run out on you: your energy is all gone, or the stress has got the better of you.
   * That's when you keel over (see faint.ts).
   */
  spent(now: number): boolean {
    return this.energyLeft(now) <= 0 || this.strain(now) >= 1;
  }

  /** Both meters full and calm again, as of `now`: on joining, and on coming round after a faint. */
  reset(now: number) {
    this.energy = 1;
    this.stress = 0;
    this.at = now;
  }

  /** How your legs feel, as a multiple of your walking speed: 1 with energy in hand, 0.75 flat out. */
  legs(now: number): number {
    return 1 - 0.25 * (1 - this.energyLeft(now));
  }

  /** 0 (steady) to 0.45: how hard your hands and the view shake, from halfway wound up on. */
  nerves(now: number): number {
    const s = this.strain(now);
    return s <= 0.5 ? 0 : Math.min(1, (s - 0.5) * 2) * 0.45;
  }

  private settle(now: number) {
    if (this.at === null) {
      this.at = now;
      return;
    }
    const dt = Math.max(0, now - this.at);
    this.at = now;
    if (!dt) return;
    this.energy = clamp(this.energy - ENERGY_DRAIN * dt);
    this.stress = clamp(this.stress + STRESS_DRAIN * dt);
  }
}