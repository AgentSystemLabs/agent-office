import type { AudioCore } from '../../sound/core';
import { biquad, envelope, pick, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// ---- The basketball -----------------------------------------------------------------------------

export type BallSound = 'bounce' | 'rim' | 'board' | 'score';

/**
 * The ball, from where it is, `speed` m/s into what it hit: a hollow bounce off the floor (or a
 * desk, a wall), a clank off the rim, a thud off the backboard, or the swish of the net.
 */
export function ball(a: AudioCore, kind: BallSound, at: Pos, speed: number) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`ball-${kind}`);
  const loud = Math.min(1, speed / 7);
  const out = a.panner(at, 2, 1.1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;
  if (kind === 'bounce') {
    // The pong of the air inside, over a slap on the floor.
    a.blip(out, t0, rand(150, 175), 0.7, 0.16, 0.05 + 0.3 * loud);
    a.play(pick(a.buf.steps), { gain: 0.15 + 0.5 * loud, rate: rand(1.25, 1.4), dest: out });
  } else if (kind === 'rim') {
    // Steel ringing, a little out of tune with itself.
    const f = rand(520, 600);
    for (const [ratio, amp, len] of [
      [1, 0.1, 0.5],
      [2.43, 0.06, 0.35],
      [4.1, 0.03, 0.2],
    ] as const) a.blip(out, t0, f * ratio, 0.99, len, amp * (0.3 + loud));
    a.play(pick(a.buf.steps), { gain: 0.2 * loud, rate: 1.9, dest: out });
  } else if (kind === 'board') {
    a.play(pick(a.buf.steps), { gain: 0.25 + 0.5 * loud, rate: 0.8, dest: out });
    a.blip(out, t0, 240, 0.8, 0.12, 0.05 + 0.1 * loud);
  } else {
    // Swish: a breath of noise through the net, brightening as it goes.
    const n = a.noise(a.buf.white);
    const tone = biquad(ctx, 'bandpass', 2400, 1.2);
    tone.frequency.setValueAtTime(1800, t0);
    tone.frequency.linearRampToValueAtTime(4200, t0 + 0.28);
    const g = ctx.createGain();
    envelope(g.gain, t0, [
      [0.03, 0.22],
      [0.18, 0.14],
      [0.34, 0],
    ]);
    n.connect(tone).connect(g).connect(out);
    n.start(t0);
    n.stop(t0 + 0.4);
  }
}
