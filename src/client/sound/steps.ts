import { PAVEMENT, type Box } from '../../shared/garage';
import { BALCONY, FLOOR, ROAD, inWing } from '../../shared/layout';
import type { AudioCore } from './core';
import { biquad, envelope, pick, rand } from './dsp';
import { footfalls, type Footfalls, type Ground } from './feet';
import type { Pos } from './places';

// Footsteps, yours and everyone else's, and paper: an issue card, a page of a book.

/** How loud a footfall on each kind of ground plays, so a step is about as loud to the ear on all of them. */
const LEVEL: Record<Ground, number> = { wood: 0.34, concrete: 0.31, grass: 0.22, stone: 0.31 };

/**
 * What's underfoot where someone's feet are: the planks of the office (its loft, its balcony and the
 * roof's deck too), the flagstones of a hall on a map of its own, and down below, the concrete of the
 * garage, the lots and the street, with grass past them.
 */
export function groundAt(a: AudioCore, feet: Pos): Ground {
  if (a.outdoors) return 'wood';
  if (a.hall) return 'stone';
  const { x, y, z } = feet;
  const on = (b: Box) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
  // Up on the floor, whatever isn't the office is the landing outside its door, and the steps down from it.
  if (y > -0.5) return on(FLOOR) || on(BALCONY) || inWing(x, z, a.wing) ? 'wood' : 'concrete';
  // The sidewalks run the length of the street, either side of the road.
  return PAVEMENT.some(on) || (z > ROAD.minZ - 2 && z < ROAD.maxZ + 2) ? 'concrete' : 'grass';
}

/**
 * Everyone's footsteps. A step is a heel and then the ball of the foot (see feet.ts), never the same
 * pair twice running, on whatever the ground is there; at a run the two land almost together, harder
 * and brighter.
 */
export class Footsteps {
  private readonly made = new Map<Ground, Footfalls>();
  /** The sample each list gave last, so the next one's another. */
  private readonly last = new Map<AudioBuffer[], AudioBuffer>();
  /** Which of your feet is coming down: -1 your left, 1 your right. */
  private foot = 1;
  /** The way out to the room for each of your feet (see side). */
  private readonly sides = new Map<number, AudioNode>();

  constructor(private readonly a: AudioCore) {}

  /** One of your own footsteps, with your feet at `feet`. `pace` is 0 at a walk, 1 at a run. */
  step(feet: Pos, pace = 0) {
    if (!this.a.ctx) return;
    this.foot = -this.foot;
    // Your left foot a little to your left, and a touch lower than your right: no two shoes sound the same.
    this.fall(groundAt(this.a, feet), pace, 1, { dest: this.side(this.foot * 0.14) }, this.a.ctx.currentTime, 1 + this.foot * 0.015);
    this.a.count('step');
  }

  /** Landing a jump on both feet, `hard` from 0 (a hop) to 1 (off the loft). */
  land(feet: Pos, hard = 0.5) {
    const ctx = this.a.ctx;
    if (!ctx) return;
    const ground = groundAt(this.a, feet);
    const now = ctx.currentTime;
    const gap = rand(0.012, 0.03);
    this.fall(ground, 0.4, 0.9 + hard * 0.6, { dest: this.side(-0.14) }, now, 0.88);
    this.fall(ground, 0.4, 0.9 + hard * 0.6, { dest: this.side(0.14) }, now + gap, 0.84);
    // Your weight coming down on them.
    this.a.play(pick(this.a.buf.steps), { gain: 0.12 + hard * 0.2, rate: 0.75 });
    this.a.count('land');
  }

  /** Someone else's footstep, where their feet are. */
  stepAt(feet: Pos, pace = 0) {
    if (!this.a.ctx) return;
    this.fall(groundAt(this.a, feet), pace, 1.8, { at: { x: feet.x, y: feet.y + 0.1, z: feet.z }, ref: 1.5, rolloff: 1.4 }, this.a.ctx.currentTime, 1);
    this.a.count('peerStep');
  }

  /** A foot coming down at `when`: the heel, then the ball of the foot, sooner and harder the faster they're going. */
  private fall(ground: Ground, pace: number, gain: number, out: { dest?: AudioNode; at?: Pos; ref?: number; rolloff?: number }, when: number, pitch: number) {
    const f = this.falls(ground);
    const level = LEVEL[ground] * gain * rand(0.8, 1.1) * (1 + 0.3 * pace);
    const rate = pitch * rand(0.94, 1.06) * (1 + 0.08 * pace);
    this.a.play(this.another(f.heel), { ...out, when, gain: level, rate });
    this.a.play(this.another(f.toe), { ...out, when: when + rand(0.045, 0.06) * (1 - 0.6 * pace), gain: level * (0.6 + 0.3 * pace), rate: rate * rand(0.97, 1.03) });
  }

  private falls(ground: Ground): Footfalls {
    let f = this.made.get(ground);
    if (!f) this.made.set(ground, (f = footfalls(this.a.ctx!, ground)));
    return f;
  }

  /** One of `xs` that isn't the one it gave last time. */
  private another(xs: AudioBuffer[]): AudioBuffer {
    const last = this.last.get(xs);
    let x = pick(xs);
    while (x === last && xs.length > 1) x = pick(xs);
    this.last.set(xs, x);
    return x;
  }

  /** Out to the room from `pan` to one side of you (-1 hard left, 1 hard right). */
  private side(pan: number): AudioNode {
    let p = this.sides.get(pan);
    if (!p) {
      const node = this.a.ctx!.createStereoPanner();
      node.pan.value = pan;
      node.connect(this.a.ambience);
      this.sides.set(pan, (p = node));
    }
    return p;
  }
}

/** An issue card in your hands: taken off the board, or put down on a desk. */
export function paper(a: AudioCore) {
  if (!a.ctx) return;
  a.play(a.buf.rustle, { gain: 0.5, rate: rand(1.1, 1.3) });
  a.count('paper');
}

/**
 * A page of the book in your hands turning over, at the bookshelf: a soft swish that rises as the
 * page sweeps through the air and falls as it settles, then a light pat as it lands. Quiet, since
 * it comes every screenful you scroll.
 */
export function pageTurn(a: AudioCore) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('pageTurn');
  const t0 = ctx.currentTime + 0.005;
  const len = rand(0.24, 0.32);
  const swish = a.noise(a.buf.white);
  const band = biquad(ctx, 'bandpass', 1000, 0.8);
  band.frequency.setValueAtTime(rand(800, 1100), t0);
  band.frequency.exponentialRampToValueAtTime(rand(2400, 3000), t0 + len * 0.6);
  band.frequency.exponentialRampToValueAtTime(1400, t0 + len);
  const g = ctx.createGain();
  envelope(g.gain, t0, [
    [len * 0.3, 0.075],
    [len * 0.6, 0.13],
    [len, 0],
  ]);
  swish.connect(band).connect(biquad(ctx, 'lowpass', 4500, 0.7)).connect(g).connect(a.ambience);
  swish.start(t0, rand(0, 4.5));
  swish.stop(t0 + len + 0.02);
  a.play(pick(a.buf.steps), { gain: 0.08, rate: rand(2.4, 2.8), when: t0 + len * 0.85 });
}
