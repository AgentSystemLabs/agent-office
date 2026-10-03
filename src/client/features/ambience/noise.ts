/**
 * The raw material of the thinking spot's sounds, with no Web Audio in it (so tests/ambience.test.ts can
 * run it): seamless loops of white, pink and brown noise, the swell of a wave, and the calls of the birds.
 */

export type NoiseKind = 'white' | 'pink' | 'brown';

/** How loud a noise loop is made (RMS), so every scene starts from the same level. */
const NOISE_RMS = 0.25;

/**
 * `length` samples of `kind` that loop with no click: it's made `fade` samples longer, and the extra
 * tail is faded into the start (equal power, as the two are unrelated) so the end runs on into the beginning.
 */
export function loopNoise(kind: NoiseKind, length: number, fade: number, rnd: () => number): Float32Array<ArrayBuffer> {
  const raw = new Float32Array(length + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = rnd() * 2 - 1;
    if (kind === 'white') raw[i] = w;
    else if (kind === 'brown') {
      brown = (brown + 0.02 * w) / 1.02;
      raw[i] = brown;
    } else {
      // Paul Kellet's pink filter: white noise tilted down 3 dB an octave.
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    }
  }
  const out = raw.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const x = (i / fade) * (Math.PI / 2);
    out[i] = raw[i] * Math.sin(x) + raw[length + i] * Math.cos(x);
  }
  let sum = 0;
  for (const v of out) sum += v * v;
  const k = NOISE_RMS / (Math.sqrt(sum / length) || 1);
  for (let i = 0; i < length; i++) out[i] = Math.max(-1, Math.min(1, out[i] * k));
  return out;
}

/**
 * A wave breaking and running back up the beach, `n` points from 0 to 1: a floor of wash, a swell to the
 * crest `peakAt` of the way through, and a long fall. It starts and ends on the floor, so waves run on
 * from one to the next.
 */
export function waveEnvelope(n: number, peakAt = 0.38, floor = 0.14): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const shape = x < peakAt ? Math.sin((Math.PI / 2) * (x / peakAt)) ** 2 : (0.5 + 0.5 * Math.cos((Math.PI * (x - peakAt)) / (1 - peakAt))) ** 1.6;
    out[i] = floor + (1 - floor) * shape;
  }
  return out;
}

/** Seconds to wait before the next of something, `min` to `max`, usually nearer `min`. */
export function gap(rnd: () => number, min: number, max: number): number {
  const r = rnd();
  return min + (max - min) * r * r;
}

// ---- Birds ------------------------------------------------------------------------------------

export type Species = 'robin' | 'dove' | 'tit' | 'warbler';

/** One note of a call: `at` seconds into it, gliding from `f0` to `f1` Hz over `dur` seconds. */
export interface Note {
  at: number;
  f0: number;
  f1: number;
  dur: number;
  gain: number;
  /** How hard a second oscillator bends the pitch (0 for a pure whistle), for the chirpier birds. */
  fm: number;
}

const between = (rnd: () => number, a: number, b: number) => a + (b - a) * rnd();

/** A call of `species`: the same bird says it a little differently every time. */
export function birdCall(species: Species, rnd: () => number): Note[] {
  const notes: Note[] = [];
  let at = 0;
  if (species === 'robin') {
    // A liquid phrase of high and low whistles, falling and rising.
    const count = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < count; i++) {
      const high = i % 2 === 0;
      const f = high ? between(rnd, 3000, 4200) : between(rnd, 2100, 2800);
      const up = rnd() < 0.5;
      const dur = between(rnd, 0.09, 0.2);
      notes.push({ at, f0: up ? f * 0.8 : f, f1: up ? f : f * 0.75, dur, gain: between(rnd, 0.6, 1), fm: 0 });
      at += dur + between(rnd, 0.04, 0.16);
    }
  } else if (species === 'dove') {
    // Soft low hoots: coo, COO, coo, coo.
    const count = 3 + Math.floor(rnd() * 3);
    const f = between(rnd, 380, 520);
    for (let i = 0; i < count; i++) {
      const dur = i === 1 ? 0.42 : 0.28;
      notes.push({ at, f0: f * 0.92, f1: f * (i === 1 ? 1.08 : 0.97), dur, gain: i === 1 ? 1 : 0.7, fm: 0 });
      at += dur + between(rnd, 0.1, 0.22);
    }
  } else if (species === 'tit') {
    // A tight run of bright "tsee"s.
    const count = 3 + Math.floor(rnd() * 4);
    const f = between(rnd, 5200, 6600);
    for (let i = 0; i < count; i++) {
      const dur = between(rnd, 0.05, 0.08);
      notes.push({ at, f0: f * 0.85, f1: f * between(rnd, 1.05, 1.2), dur, gain: between(rnd, 0.7, 1), fm: 80 });
      at += dur + between(rnd, 0.06, 0.11);
    }
  } else {
    // A fast trill that swaps between two pitches.
    const count = 10 + Math.floor(rnd() * 9);
    const f = between(rnd, 3300, 4600);
    for (let i = 0; i < count; i++) {
      const dur = between(rnd, 0.025, 0.04);
      const fr = i % 2 ? f * 1.12 : f;
      notes.push({ at, f0: fr, f1: fr * 0.97, dur, gain: 0.55 + 0.45 * Math.sin((Math.PI * i) / count), fm: 30 });
      at += dur + between(rnd, 0.015, 0.03);
    }
  }
  return notes;
}

/** Which bird calls next, the gentle ones more often than the sharp ones. */
export function pickSpecies(rnd: () => number): Species {
  const r = rnd();
  return r < 0.34 ? 'robin' : r < 0.58 ? 'dove' : r < 0.82 ? 'warbler' : 'tit';
}
