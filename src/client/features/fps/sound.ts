import type { AudioCore } from '../../sound/core';
import { biquad, envelope } from '../../sound/dsp';
import type { Pos } from '../../sound/places';
export type FpsSound = 'shot' | 'reload' | 'hit';

export function fpsSound(a: AudioCore, kind: FpsSound, at?: Pos) {
  const ctx = a.ctx; if (!ctx) return;
  a.count(`fps-${kind}`);
  const out = at ? a.panner(at, 4, 1) : ctx.createGain(); out.connect(a.ambience);
  const t = ctx.currentTime + .005;
  if (kind === 'shot') {
    const noise = a.noise(a.buf.white), gain = ctx.createGain();
    envelope(gain.gain, t, [[.002, .22], [.025, .1], [.12, 0]]);
    noise.connect(biquad(ctx, 'lowpass', 4200, .8)).connect(gain).connect(out); noise.start(t); noise.stop(t + .13);
    a.blip(out, t, 95, .2, .12, .32, 'triangle');
  } else if (kind === 'reload') {
    a.blip(out, t, 550, .3, .035, .1, 'square'); a.blip(out, t + 1.4, 800, .2, .05, .08, 'square');
  } else a.blip(out, t, 1400, .6, .045, .06, 'sine');
}
