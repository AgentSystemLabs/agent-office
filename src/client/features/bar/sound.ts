import type { AudioCore } from '../../sound/core';
import { biquad, envelope } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// The rooftop café: a drink made and slid over the counter, or a plate set down.

/** The barista's machine: a burst of steam, then (for a drink) the pour and a clink of china; a plate is just set down. */
export function serve(a: AudioCore, at: Pos, drink: boolean) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('serve');
  const out = a.panner(at, 1.2, 1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.05;
  if (drink) {
    // Steam from the wand: a soft hiss that rises and fades.
    const hiss = a.noise(a.buf.white);
    const tone = biquad(ctx, 'highpass', 3600, 0.7);
    const hg = ctx.createGain();
    envelope(hg.gain, t0, [
      [0.25, 0.05],
      [0.8, 0.04],
      [1.0, 0],
    ]);
    hiss.connect(tone).connect(hg).connect(out);
    hiss.start(t0);
    hiss.stop(t0 + 1.1);
    // Poured into the cup: filtered noise that rises in pitch as it fills.
    const pour = a.noise(a.buf.white);
    const band = biquad(ctx, 'bandpass', 700, 1.4);
    band.frequency.setValueAtTime(700, t0 + 0.35);
    band.frequency.linearRampToValueAtTime(1500, t0 + 1.15);
    const g = ctx.createGain();
    envelope(g.gain, t0 + 0.35, [
      [0.06, 0.07],
      [0.7, 0.06],
      [0.85, 0],
    ]);
    const wobble = a.noise(a.buf.gurgle, true);
    wobble.playbackRate.value = 4;
    const amp = ctx.createGain();
    amp.gain.value = 0.6;
    wobble.connect(amp.gain);
    pour.connect(band).connect(amp).connect(g).connect(out);
    pour.start(t0 + 0.35);
    pour.stop(t0 + 1.3);
    wobble.start(t0 + 0.35);
    wobble.stop(t0 + 1.3);
  }
  // Slid across the counter to you: china on wood.
  a.clink(out, t0 + 1.45, drink ? 3100 : 2200, 0.07);
  if (!drink) a.clink(out, t0 + 1.52, 1800, 0.04);
}
