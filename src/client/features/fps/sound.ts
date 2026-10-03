import type { AudioCore } from '../../sound/core';
import { biquad, envelope, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';
export type FpsSound = 'shot' | 'reload' | 'hit' | 'headshot' | 'hurt' | 'metal' | 'wood' | 'stone';

export function fpsSound(a: AudioCore, kind: FpsSound, at?: Pos) {
  const ctx = a.ctx; if (!ctx) return;
  a.count(`fps-${kind}`);
  const out = at ? a.panner(at, 4, 1) : ctx.createGain(); out.connect(a.ambience);
  const t = ctx.currentTime + .005;
  const variation = rand(.94, 1.06);
  const noiseBurst = (frequency: number, level: number, length: number, type: BiquadFilterType = 'lowpass') => {
    const noise = a.noise(a.buf.white), gain = ctx.createGain();
    noise.playbackRate.value = variation;
    envelope(gain.gain, t, [[.002, level], [.018, level * .4], [length, 0]]);
    noise.connect(biquad(ctx, type, frequency * variation, .8)).connect(gain).connect(out);
    noise.start(t); noise.stop(t + length + .01);
  };
  if (kind === 'shot') {
    noiseBurst(4200, .22, .12);
    a.blip(out, t, 95 * variation, .2, .12, .32, 'triangle');
  } else if (kind === 'reload') {
    a.blip(out, t, 550, .3, .035, .1, 'square'); a.blip(out, t + 1.4, 800, .2, .05, .08, 'square');
  } else if (kind === 'hit' || kind === 'headshot') {
    noiseBurst(kind === 'headshot' ? 2400 : 1100, .2, .075, 'bandpass');
    a.blip(out, t, 170 * variation, .35, .065, .16, 'triangle');
    // A short confirmation tone distinguishes a confirmed hit from a nearby gunshot.
    a.blip(out, t, (kind === 'headshot' ? 2100 : 1350) * variation, .7, .035, .065);
    if (kind === 'headshot') a.blip(out, t + .025, 2800 * variation, .7, .035, .045);
  } else if (kind === 'hurt') {
    a.blip(out, t, 75 * variation, .5, .09, .12, 'triangle');
  } else if (kind === 'metal') {
    noiseBurst(6500, .13, .045, 'highpass');
    a.blip(out, t, 3200 * variation, .85, .065, .07);
    a.blip(out, t, 4700 * variation, .9, .045, .035);
  } else {
    noiseBurst(kind === 'wood' ? 900 : 2600, .13, .06, 'bandpass');
    a.blip(out, t, (kind === 'wood' ? 220 : 440) * variation, .4, .045, .06, 'triangle');
  }
}
