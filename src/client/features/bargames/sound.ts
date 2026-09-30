import type { AudioCore } from '../../sound/core';
import { biquad, envelope, pick, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// ---- Darts and axes at the rooftop bar -----------------------------------------------------------

export type TossSound = 'dart' | 'axe' | 'board' | 'wall' | 'thunk' | 'clank' | 'drop' | 'cheer';

/**
 * Throwing at the rooftop bar, heard from `at`: a dart leaving the hand (`dart`) or an axe going end
 * over end (`axe`), a dart going into the board (`board`) or the wood round it (`wall`), an axe
 * biting into the target (`thunk`) or bouncing off it (`clank`) and landing on the mat (`drop`),
 * and the crowd going up for a 180 or a killshot (`cheer`).
 */
export function toss(a: AudioCore, kind: TossSound, at: Pos) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`toss-${kind}`);
  const out = a.panner(at, 2, 1.1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;
  const air = (from: number, to: number, len: number, level: number, pulses = 0) => {
    const n = a.noise(a.buf.white);
    const tone = biquad(ctx, 'bandpass', from, 1.4);
    tone.frequency.setValueAtTime(from, t0);
    tone.frequency.linearRampToValueAtTime(to, t0 + len);
    const g = ctx.createGain();
    if (pulses) {
      // A blade going round: louder each time it cuts through the air edge on.
      g.gain.setValueAtTime(0, t0);
      for (let i = 0; i < pulses; i++) {
        const at = t0 + (i + 0.5) * (len / pulses);
        g.gain.linearRampToValueAtTime(level, at);
        g.gain.linearRampToValueAtTime(level * 0.15, at + len / pulses / 2);
      }
      g.gain.linearRampToValueAtTime(0, t0 + len + 0.05);
    } else
      envelope(g.gain, t0, [
        [len * 0.3, level],
        [len, 0],
      ]);
    n.connect(tone).connect(g).connect(out);
    n.start(t0);
    n.stop(t0 + len + 0.1);
  };
  switch (kind) {
    case 'dart':
      air(2600, 3600, 0.12, 0.05);
      break;
    case 'axe':
      air(500, 900, 0.6, 0.14, 3);
      break;
    case 'board':
      // Into the sisal: a short, dry thock.
      a.play(pick(a.buf.steps), { gain: 0.35, rate: 2.3, dest: out });
      a.blip(out, t0, 950, 0.7, 0.03, 0.05);
      break;
    case 'wall':
      a.play(pick(a.buf.steps), { gain: 0.3, rate: 1.7, dest: out });
      a.blip(out, t0, 430, 0.8, 0.06, 0.06);
      break;
    case 'thunk':
      // Steel biting into a wooden target, and the boards shuddering.
      a.play(pick(a.buf.steps), { gain: 0.8, rate: 0.85, dest: out });
      a.blip(out, t0, 160, 0.6, 0.18, 0.22);
      a.blip(out, t0 + 0.01, 310, 0.8, 0.09, 0.07, 'triangle');
      break;
    case 'clank':
      a.clink(out, t0, rand(1900, 2300), 0.12);
      a.play(pick(a.buf.steps), { gain: 0.45, rate: 1.4, dest: out });
      break;
    case 'drop':
      a.play(pick(a.buf.steps), { gain: 0.4, rate: 1.05, dest: out });
      a.clink(out, t0 + 0.02, rand(1300, 1500), 0.04);
      break;
    case 'cheer':
      // Ta-da-da-DAAA, as at the golf tee.
      [523, 659, 784, 1047].forEach((f, i) => {
        const when = t0 + 0.1 + i * 0.12;
        const len = i === 3 ? 0.8 : 0.18;
        a.blip(out, when, f, 1, len, 0.1, 'triangle');
        a.blip(out, when, f * 2, 1, len * 0.7, 0.03);
      });
      break;
  }
}
