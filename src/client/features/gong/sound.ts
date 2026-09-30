import type { GongWhy } from '../../../shared/protocol';
import type { AudioCore } from '../../sound/core';
import { biquad, rand } from '../../sound/dsp';
import { GONG_AT } from '../../sound/places';

// ---- The gong ----------------------------------------------------------------------------------

/** A gong's overtones don't line up like a string's: [ratio to the lowest, loudness, seconds to die away]. */
const GONG_PARTIALS: [number, number, number][] = [
  [1, 0.8, 7],
  [1.51, 0.75, 5.5],
  [2.13, 0.65, 4.6],
  [2.66, 0.55, 3.8],
  [3.19, 0.45, 3.1],
  [3.84, 0.38, 2.5],
  [4.48, 0.3, 2],
  [5.27, 0.22, 1.6],
  [6.35, 0.16, 1.2],
  [7.61, 0.1, 0.9],
  [9.08, 0.07, 0.6],
];

/**
 * The gong by the PR board rings: someone hit it, a pull request merged (a harder stroke), or the
 * task queue emptied (three strokes, each bigger than the last). From where it hangs, so you hear
 * which way it is.
 */
export function gong(a: AudioCore, why: GongWhy) {
  a.unlock();
  const ctx = a.ctx;
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  a.count(`gong.${why}`);
  // Someone banging it is the room; a merge is news for the whole floor (and from another tab too,
  // like the dings), so it carries further.
  const at = a.hall ? (a.hall.gong ?? { x: a.listener.x, y: a.listener.y + 2, z: a.listener.z }) : GONG_AT;
  const out = why === 'hit' ? a.panner(at, 4, 0.6) : a.panner(at, 8, 0.45);
  out.connect(why === 'hit' ? a.ambience : a.alerts);
  const t0 = ctx.currentTime + 0.03;
  if (why === 'queue') [0.7, 0.85, 1.1].forEach((strength, i) => strike(a, out, t0 + i * 0.85, strength));
  else strike(a, out, t0, why === 'merged' ? 1 : rand(0.6, 0.8));
}

/** One stroke of the mallet: a felt thump, the metal ringing, and a bright wash that blooms after. */
function strike(a: AudioCore, out: AudioNode, t0: number, strength: number) {
  const ctx = a.ctx!;
  const f0 = 118 * rand(0.98, 1.02);
  const ring = ctx.createGain();
  ring.gain.value = 0.3 * strength;
  ring.connect(out);
  const long = 0.6 + 0.4 * strength;
  for (const [ratio, amp, decay] of GONG_PARTIALS) {
    const f = f0 * ratio;
    const end = t0 + decay * long;
    // Two of each a few cents apart, so the tone shimmers as it rings.
    for (const cents of [-1, 1]) {
      const o = ctx.createOscillator();
      // Struck hard, a gong starts a touch sharp and settles.
      o.frequency.setValueAtTime(f * (1 + 0.012 * strength), t0);
      o.frequency.exponentialRampToValueAtTime(f, t0 + 1.2);
      o.detune.value = cents * rand(2, 5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(amp * 0.5, t0 + 0.01 + ratio * 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      o.connect(g).connect(ring);
      o.start(t0);
      o.stop(end + 0.05);
    }
  }
  const thump = a.noise(a.buf.white);
  const thumpG = ctx.createGain();
  thumpG.gain.setValueAtTime(0.0001, t0);
  thumpG.gain.exponentialRampToValueAtTime(0.45 * strength, t0 + 0.005);
  thumpG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
  thump.connect(biquad(ctx, 'lowpass', 420, 0.8)).connect(thumpG).connect(out);
  thump.start(t0);
  thump.stop(t0 + 0.15);
  const wash = a.noise(a.buf.white, true);
  const washG = ctx.createGain();
  washG.gain.setValueAtTime(0, t0);
  washG.gain.linearRampToValueAtTime(0.03 * strength, t0 + 0.45);
  washG.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.5 * long);
  wash.connect(biquad(ctx, 'bandpass', 3200, 1.2)).connect(washG).connect(out);
  wash.start(t0);
  wash.stop(t0 + 3.5 * long + 0.05);
}
