import type { AudioCore } from './core';
import { biquad, envelope, pick, rand } from './dsp';

// Footsteps, yours and everyone else's, and paper: an issue card, a page of a book.

/** One of your own footsteps, or the thump of landing a jump. */
export function step(a: AudioCore, kind: 'walk' | 'land' = 'walk') {
  if (!a.ctx) return;
  if (kind === 'land') a.play(pick(a.buf.steps), { gain: 0.5, rate: 0.75 });
  else a.play(pick(a.buf.steps), { gain: rand(0.16, 0.21), rate: rand(0.9, 1.1) });
  a.count(kind === 'land' ? 'land' : 'step');
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

/** Someone else's footstep, on the office floor unless `y` says where else. */
export function stepAt(a: AudioCore, x: number, z: number, y = 0) {
  if (!a.ctx) return;
  a.play(pick(a.buf.steps), { at: { x, y: y + 0.1, z }, gain: rand(0.3, 0.38), rate: rand(0.9, 1.1), ref: 1.5, rolloff: 1.4 });
  a.count('peerStep');
}
