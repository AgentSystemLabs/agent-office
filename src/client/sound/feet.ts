import { lumpy, sample } from './buffers';
import { rand } from './dsp';

// What a footstep is made of. A foot comes down in two parts, the heel and then the ball of the foot,
// and what you hear of each is the ground: a plank knocks, concrete ticks, grass swishes, the castle's
// flagstones clack and the hall answers. So each kind of ground has a few samples of each part, no two
// alike, made the first time someone walks on it. steps.ts puts them together into steps.

/** What's underfoot. */
export type Ground = 'wood' | 'concrete' | 'grass' | 'stone';

/** The two parts of a step on one kind of ground, a few of each. */
export interface Footfalls {
  heel: AudioBuffer[];
  toe: AudioBuffer[];
}

/** A sound, as its level at each moment (seconds). */
type Voice = (t: number) => number;

/** How many of each part there are to pick from. */
const VARIANTS = 6;

const white = () => Math.random() * 2 - 1;

/** Noise with everything above `hz` taken off, about as loud whatever `hz` is. */
function dull(sr: number, hz: number): () => number {
  const k = 1 - Math.exp((-2 * Math.PI * hz) / sr);
  const norm = Math.sqrt((1.5 * sr) / hz);
  let a = 0;
  let b = 0;
  return () => {
    a += (white() - a) * k;
    b += (a - b) * k;
    return b * norm;
  };
}

/** `src` (noise, unless it's given) with only what's round `hz` left, `q` narrow, about as loud whatever they are. */
function band(sr: number, hz: number, q: number, src: () => number = white): () => number {
  const f = Math.min(0.9, 2 * Math.sin((Math.PI * hz) / sr));
  const norm = Math.sqrt(sr / (q * hz));
  let low = 0;
  let mid = 0;
  return () => {
    low += f * mid;
    mid += f * (src() - low - mid / q);
    return mid * norm;
  };
}

/** Grit under a sole: `rate` grains a second, each a tick. */
function grit(sr: number, hz: number, rate: number): () => number {
  const scale = Math.sqrt(sr / rate);
  return band(sr, hz, 1.5, () => (Math.random() < rate / sr ? white() * scale : 0));
}

/** Something knocked: it rings at `hz` and is gone in about `ms`. */
const ring =
  (hz: number, ms: number): Voice =>
  (t) =>
    Math.sin(2 * Math.PI * hz * t) * Math.exp((-t * 1000) / ms);

/** The shape of a blow: up in `rise` ms, then dying away over `fall` ms. */
const hit = (t: number, rise: number, fall: number) => (t <= 0 ? 0 : Math.min(1, (t * 1000) / rise) * Math.exp((-t * 1000) / fall));

interface Recipe {
  /** How long its samples are: as long as the longest thing in them takes to die away. */
  seconds: number;
  heel(sr: number): Voice;
  toe(sr: number): Voice;
}

const RECIPES: Record<Ground, Recipe> = {
  // A shoe on the office's planks: the heel's tick, the board it lands on knocking, and the floor's
  // thump under it; then the sole slapping down, with no weight behind it.
  wood: {
    seconds: 0.16,
    heel(sr) {
      const tick = band(sr, rand(1900, 2500), 1.2);
      const thump = dull(sr, 450);
      const f = rand(150, 195);
      const board = [ring(f, 18), ring(f * rand(2.1, 2.5), 12), ring(f * rand(4.3, 5.2), 7)];
      return (t) => tick() * hit(t, 0.3, 3) * 0.6 + thump() * hit(t, 1.5, 14) * 0.7 + board[0](t) * 0.8 + board[1](t) * 0.6 + board[2](t) * 0.45;
    },
    toe(sr) {
      const slap = band(sr, rand(1100, 1500), 0.9);
      const thump = dull(sr, 650);
      const board = ring(rand(240, 310), 11);
      return (t) => slap() * hit(t, 1, 8) * 0.6 + thump() * hit(t, 2, 11) * 0.5 + board(t) * 0.5;
    },
  },
  // Concrete and asphalt, in the garage and down on the street: nothing rings, so it's a hard tick, a
  // short dead thud and the grit under the sole.
  concrete: {
    seconds: 0.14,
    heel(sr) {
      const tick = band(sr, rand(2200, 3000), 0.8);
      const thud = dull(sr, 700);
      const under = ring(rand(95, 120), 10);
      const grains = grit(sr, rand(3600, 4400), 1400);
      return (t) => tick() * hit(t, 0.2, 2.5) * 0.5 + thud() * hit(t, 1, 10) * 0.7 + under(t) * 0.3 + grains() * hit(t, 4, 20) * 0.12;
    },
    toe(sr) {
      const slap = band(sr, rand(1900, 2600), 0.9);
      const thud = dull(sr, 600);
      const grains = grit(sr, rand(3400, 4600), 1800);
      return (t) => slap() * hit(t, 0.8, 6) * 0.45 + thud() * hit(t, 1.5, 9) * 0.6 + grains() * hit(t, 6, 28) * 0.2;
    },
  },
  // Grass, past the pavement: no tick at all, a soft thump in the turf and the blades swishing round
  // the shoe, unevenly.
  grass: {
    seconds: 0.26,
    heel(sr) {
      const thump = dull(sr, 300);
      const swish = band(sr, rand(1800, 2600), 0.9);
      const blades = lumpy(sr, 0.004, 0.012);
      return (t) => thump() * hit(t, 5, 26) * 0.7 + swish() * (0.25 + blades()) * hit(t, 9, 30) * 0.5;
    },
    toe(sr) {
      const thump = dull(sr, 420);
      const swish = band(sr, rand(2200, 3200), 0.9);
      const blades = lumpy(sr, 0.004, 0.012);
      return (t) => thump() * hit(t, 6, 20) * 0.4 + swish() * (0.25 + blades()) * hit(t, 14, 45) * 0.4;
    },
  },
  // The castle's flagstones: a hard clack, and the hall saying it back for a moment after.
  stone: {
    seconds: 0.5,
    heel(sr) {
      const tick = band(sr, rand(1700, 2300), 1.4);
      const thud = dull(sr, 300);
      const f = rand(520, 680);
      const flag = [ring(f, 9), ring(f * rand(2, 2.4), 5)];
      const hall = band(sr, rand(600, 900), 0.6, dull(sr, 2200));
      // The blow itself is over in a tenth of a second: after that there's only the hall to work out.
      const blow: Voice = (t) => (t > 0.1 ? 0 : tick() * hit(t, 0.2, 3) * 0.5 + thud() * hit(t, 1, 12) * 0.5 + flag[0](t) * 0.6 + flag[1](t) * 0.3);
      return (t) => blow(t) + hall() * hit(t - 0.018, 12, 150) * 0.016;
    },
    toe(sr) {
      const slap = band(sr, rand(1500, 2000), 1);
      const thud = dull(sr, 520);
      const hall = band(sr, rand(700, 1100), 0.6, dull(sr, 2200));
      const blow: Voice = (t) => (t > 0.1 ? 0 : slap() * hit(t, 0.8, 7) * 0.5 + thud() * hit(t, 1.5, 9) * 0.4);
      return (t) => blow(t) + hall() * hit(t - 0.018, 12, 130) * 0.014;
    },
  },
};

/** The samples of a step on `ground`. */
export function footfalls(ctx: BaseAudioContext, ground: Ground): Footfalls {
  const r = RECIPES[ground];
  const fade = r.seconds * 0.2;
  // Faded out at its end, so a sample that's still ringing doesn't stop with a click.
  const made = (voice: Voice) => sample(ctx, r.seconds, (t) => voice(t) * Math.min(1, (r.seconds - t) / fade), 0.9);
  const each = (part: (sr: number) => Voice) => Array.from({ length: VARIANTS }, () => made(part(ctx.sampleRate)));
  return { heel: each(r.heel), toe: each(r.toe) };
}
