import type { AudioCore } from '../../sound/core';
import { biquad, envelope, pick, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// ---- Golf off the balcony ------------------------------------------------------------------------

export type GolfSound = 'hit' | 'bounce' | 'thud' | 'rail' | 'wall' | 'cup' | 'cheer';

/**
 * A golf ball: the club through it (`hit`), coming down on grass or the road (`bounce`, `speed`
 * in m/s) or dying in sand or rough (`thud`), off the railing's glass (`rail`) or a wall, rattling
 * into the cup, and a fanfare for a hole in one. `at` is where, for someone else's ball; your own
 * you hear wherever it is, since the camera's following it.
 */
export function golf(a: AudioCore, kind: GolfSound, at?: Pos, speed = 5) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`golf-${kind}`);
  const out = at ? a.panner(at, 3, 1) : ctx.createGain();
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;
  const hard = Math.min(1, speed / 15);
  switch (kind) {
    case 'hit':
      // A crisp tock, and the swish of the club on through.
      a.blip(out, t0, 1900, 0.55, 0.06, 0.3, 'triangle');
      a.play(pick(a.buf.steps), { gain: 0.45, rate: 2.6, dest: out });
      {
        const swish = a.noise(a.buf.white);
        const g = ctx.createGain();
        envelope(g.gain, t0, [
          [0.03, 0.06],
          [0.16, 0],
        ]);
        swish.connect(biquad(ctx, 'bandpass', 2400, 1.2)).connect(g).connect(out);
        swish.start(t0);
        swish.stop(t0 + 0.2);
      }
      break;
    case 'bounce':
      a.play(pick(a.buf.steps), { gain: 0.08 + hard * 0.3, rate: rand(1.7, 2), dest: out });
      a.blip(out, t0, rand(620, 700), 0.7, 0.05, 0.03 + hard * 0.06);
      break;
    case 'thud':
      a.play(pick(a.buf.steps), { gain: 0.08 + hard * 0.2, rate: rand(1.1, 1.3), dest: out });
      break;
    case 'rail':
      // A knock on the glass.
      a.clink(out, t0, rand(1250, 1400), 0.05 + hard * 0.08);
      a.play(pick(a.buf.steps), { gain: 0.25, rate: 2.2, dest: out });
      break;
    case 'wall':
      a.play(pick(a.buf.steps), { gain: 0.15 + hard * 0.3, rate: 1.9, dest: out });
      break;
    case 'cup':
      // Plunk, and a rattle round the bottom.
      a.blip(out, t0, 520, 0.6, 0.12, 0.14, 'triangle');
      for (let i = 1; i <= 3; i++) a.blip(out, t0 + 0.08 + i * 0.06, 900 - i * 90, 0.8, 0.04, 0.05 / i);
      break;
    case 'cheer':
      // Ta-da-da-DAAA.
      [523, 659, 784, 1047].forEach((f, i) => {
        const when = t0 + 0.25 + i * 0.13;
        const len = i === 3 ? 0.9 : 0.2;
        a.blip(out, when, f, 1, len, 0.1, 'triangle');
        a.blip(out, when, f * 2, 1, len * 0.7, 0.03);
      });
      break;
  }
}
