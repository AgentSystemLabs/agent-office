import type { AudioCore } from '../../sound/core';
import { biquad, envelope, pick, rand } from '../../sound/dsp';

// The ladder and the fire poles: rungs, the hatch at the top, your head on the ceiling, and the slide down.

/** Your hand closing on a steel rung, or on the pole: a soft clank. */
export function rung(a: AudioCore, soft = false) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('rung');
  const t0 = ctx.currentTime + 0.005;
  const f = rand(820, 980) * (soft ? 0.7 : 1);
  a.blip(a.ambience, t0, f, 0.97, 0.12, soft ? 0.05 : 0.08);
  a.blip(a.ambience, t0, f * 2.71, 0.98, 0.06, 0.03);
  a.play(pick(a.buf.steps), { gain: 0.12, rate: rand(1.6, 1.9) });
}

/** A trapdoor at the ladder: creaking open, or banging shut. From where it is, so you hear it from across the room. */
export function hatch(a: AudioCore, at: { x: number; y: number; z: number }, open: boolean) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(open ? 'hatchOpen' : 'hatchShut');
  const out = a.panner(at, 2, 1.1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.01;
  if (open) {
    // A creaky hinge: a rough, wavering squeak.
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t0);
    o.frequency.linearRampToValueAtTime(640, t0 + 0.18);
    o.frequency.linearRampToValueAtTime(380, t0 + 0.36);
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 23;
    const depth = ctx.createGain();
    depth.gain.value = 40;
    wobble.connect(depth).connect(o.frequency);
    const g = ctx.createGain();
    envelope(g.gain, t0, [
      [0.04, 0.05],
      [0.3, 0.04],
      [0.4, 0],
    ]);
    o.connect(biquad(ctx, 'bandpass', 1400, 2.5)).connect(g).connect(out);
    for (const n of [o, wobble]) {
      n.start(t0);
      n.stop(t0 + 0.45);
    }
  } else a.play(pick(a.buf.steps), { gain: 0.5, rate: 0.62, dest: out });
}

/** Your head on the ceiling: the ladder doesn't go any higher. */
export function bonk(a: AudioCore) {
  if (!a.ctx) return;
  a.count('bonk');
  a.play(pick(a.buf.steps), { gain: 0.35, rate: 0.5 });
  a.blip(a.ambience, a.ctx.currentTime + 0.01, 180, 0.6, 0.18, 0.12);
}

/** Whoosh: the rush of air and the squeal of hands on brass, all the way down a fire pole. */
export function slide(a: AudioCore, seconds = 1.6) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('slide');
  const t0 = ctx.currentTime + 0.01;
  const end = t0 + seconds;
  const air = a.noise(a.buf.white, true);
  const tone = biquad(ctx, 'bandpass', 500, 0.9);
  tone.frequency.setValueAtTime(400, t0);
  tone.frequency.exponentialRampToValueAtTime(2200, end);
  const ag = ctx.createGain();
  envelope(ag.gain, t0, [
    [0.25, 0.22],
    [seconds * 0.85, 0.3],
    [seconds, 0],
  ]);
  air.connect(tone).connect(ag).connect(a.ambience);
  air.start(t0);
  air.stop(end + 0.05);
  // Palms squeaking on the brass, higher as you speed up.
  const squeal = ctx.createOscillator();
  squeal.type = 'triangle';
  squeal.frequency.setValueAtTime(1100, t0 + 0.1);
  squeal.frequency.exponentialRampToValueAtTime(1900, end);
  const vib = ctx.createOscillator();
  vib.frequency.value = 9;
  const vd = ctx.createGain();
  vd.gain.value = 35;
  vib.connect(vd).connect(squeal.frequency);
  const sg = ctx.createGain();
  envelope(sg.gain, t0, [
    [0.15, 0],
    [0.3, 0.035],
    [seconds * 0.8, 0.045],
    [seconds, 0],
  ]);
  squeal.connect(sg).connect(a.ambience);
  for (const n of [squeal, vib]) {
    n.start(t0);
    n.stop(end + 0.05);
  }
}

/** A little "wheee!" whistle, swinging round the pole. */
export function twirl(a: AudioCore) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('twirl');
  const t0 = ctx.currentTime + 0.01;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(600, t0);
  o.frequency.exponentialRampToValueAtTime(1500, t0 + 0.45);
  o.frequency.exponentialRampToValueAtTime(900, t0 + 1.0);
  const g = ctx.createGain();
  envelope(g.gain, t0, [
    [0.08, 0.09],
    [0.8, 0.07],
    [1.05, 0],
  ]);
  o.connect(g).connect(a.ambience);
  o.start(t0);
  o.stop(t0 + 1.1);
}

/**
 * Down the pole and onto the mat: a thump (harder the faster you came), and the firehouse bell,
 * ding-ding-ding. `at` is someone else landing; without it, it's you.
 */
export function poleLanding(a: AudioCore, speed: number, at?: { x: number; y: number; z: number }) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('poleLanding');
  const out = at ? a.panner(at, 2.5, 0.9) : ctx.createGain();
  out.connect(a.ambience);
  a.play(pick(a.buf.steps), { gain: Math.min(0.9, 0.35 + speed * 0.07), rate: 0.55, dest: out });
  const t0 = ctx.currentTime + 0.08;
  for (let i = 0; i < 3; i++) {
    const when = t0 + i * 0.16;
    // A bell: a bright strike, then partials that ring on.
    for (const [ratio, amp, len] of [
      [1, 0.16, 1.1],
      [2.76, 0.07, 0.6],
      [5.4, 0.035, 0.3],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = 1320 * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(amp, when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, when + len);
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + len + 0.02);
    }
  }
}
