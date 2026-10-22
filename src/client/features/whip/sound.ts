import type { AudioCore } from '../../sound/core';
import { biquad, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// ---- The whip -------------------------------------------------------------------------------------

/**
 * A whip cracking at `at` (where you are, without one), `delay` seconds from now: the swish of the
 * thong rolling out first (when there's time for one), then the crack as its tip breaks the sound
 * barrier, a few milliseconds of bright noise with a hard edge, and the room slapping it back.
 */
export function whip(a: AudioCore, at: Pos | undefined, delay: number) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('whip');
  const out = a.panner(at ?? { x: a.listener.x, y: a.listener.y, z: a.listener.z }, 3, 0.9);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.01;
  const tc = t0 + delay;
  const burst = (type: BiquadFilterType, freq: number, q: number, when: number, peak: number, len: number) => {
    const n = a.noise(a.buf.white);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, when + len);
    n.connect(biquad(ctx, type, freq, q)).connect(g).connect(out);
    n.start(when);
    n.stop(when + len + 0.02);
  };
  // The swish: a band of noise sweeping up as the thong goes out.
  if (delay > 0.08) {
    const n = a.noise(a.buf.white);
    const tone = biquad(ctx, 'bandpass', 400, 1.3);
    tone.frequency.setValueAtTime(350, t0);
    tone.frequency.exponentialRampToValueAtTime(rand(2600, 3400), tc);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.09, tc - 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, tc + 0.01);
    n.connect(tone).connect(g).connect(out);
    n.start(t0);
    n.stop(tc + 0.04);
  }
  // The crack itself, a snap of the leather under it, and the slap back off the walls.
  const f = rand(0.9, 1.1);
  burst('highpass', 2200 * f, 0.7, tc, 0.9, 0.035);
  burst('bandpass', 1100 * f, 1.8, tc, 0.45, 0.06);
  burst('lowpass', 2400, 0.6, tc + 0.014, 0.08, 0.2);
}
