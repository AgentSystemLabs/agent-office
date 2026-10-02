import { hatch } from '../climbing/sound';
import type { AudioCore } from '../../sound/core';
import { biquad, envelope, pick, rand } from '../../sound/dsp';

// The castle's dungeon: its cell doors, and whoever's thrown down on the straw. And the station's
// airlock: its doors, its alarm, and the air going out of it with someone.

/**
 * A cell door in the dungeon: its hinges groaning open, or slamming shut on someone with a clang of
 * iron that rings on round the vault.
 */
export function cellDoor(a: AudioCore, at: { x: number; y: number; z: number }, open: boolean) {
  const ctx = a.ctx;
  if (!ctx) return;
  if (open) return hatch(a, at, true);
  a.count('cellDoor');
  const out = a.panner(at, 3, 1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;
  a.play(pick(a.buf.steps), { gain: 0.9, rate: 0.45, dest: out });
  a.blip(out, t0, 95, 0.6, 0.25, 0.22);
  // The bars ringing: a few out-of-tune partials, dying away slowly.
  for (const [f, amp, len] of [
    [310, 0.07, 1.4],
    [742, 0.05, 1.1],
    [1270, 0.035, 0.8],
    [2115, 0.02, 0.5],
  ]) {
    a.blip(out, t0, f * rand(0.97, 1.03), 0.995, len, amp, 'triangle');
  }
  a.clink(out, t0 + 0.02, rand(1600, 1900), 0.06);
}

/** Someone thrown down on the straw. */
export function thud(a: AudioCore, at: { x: number; y: number; z: number }) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('thud');
  const out = a.panner(at, 2, 1.1);
  out.connect(a.ambience);
  a.play(pick(a.buf.steps), { gain: 0.7, rate: 0.5, dest: out });
  a.blip(out, ctx.currentTime + 0.005, 120, 0.5, 0.16, 0.14);
}

/**
 * A station's airlock: one of its doors sliding (a hiss and a clunk), its alarm (three rising
 * whoops), or the outer hatch blowing: a bang, and the air rushing out and thinning to nothing.
 */
export function airlock(a: AudioCore, at: { x: number; y: number; z: number }, what: 'door' | 'alarm' | 'blow') {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`airlock.${what}`);
  const out = a.panner(at, 3, 1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;
  if (what === 'alarm') {
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(520, t0 + i * 0.55);
      o.frequency.linearRampToValueAtTime(880, t0 + i * 0.55 + 0.4);
      const g = ctx.createGain();
      envelope(g.gain, t0 + i * 0.55, [
        [0.03, 0.05],
        [0.38, 0.05],
        [0.45, 0],
      ]);
      o.connect(biquad(ctx, 'lowpass', 1800, 0.7)).connect(g).connect(out);
      o.start(t0 + i * 0.55);
      o.stop(t0 + i * 0.55 + 0.5);
    }
    return;
  }
  const air = a.noise(a.buf.white, true);
  const tone = biquad(ctx, 'bandpass', what === 'blow' ? 900 : 2600, 0.8);
  const g = ctx.createGain();
  if (what === 'door') {
    // Pneumatics: a short hiss, and the door home with a clunk.
    envelope(g.gain, t0, [
      [0.03, 0.09],
      [0.3, 0.04],
      [0.42, 0],
    ]);
    a.play(pick(a.buf.steps), { when: t0 + 0.38, gain: 0.45, rate: 0.5, dest: out });
    a.blip(out, t0 + 0.38, 140, 0.6, 0.14, 0.1);
  } else {
    // The bang of the hatch, then everything in the chamber leaving at once.
    tone.frequency.setValueAtTime(700, t0);
    tone.frequency.exponentialRampToValueAtTime(3200, t0 + 0.5);
    tone.frequency.exponentialRampToValueAtTime(500, t0 + 2.6);
    envelope(g.gain, t0, [
      [0.03, 0.5],
      [0.5, 0.3],
      [2.8, 0],
    ]);
    a.play(pick(a.buf.steps), { when: t0, gain: 0.9, rate: 0.4, dest: out });
    a.blip(out, t0, 80, 0.5, 0.35, 0.3);
  }
  air.connect(tone).connect(g).connect(out);
  air.start(t0);
  air.stop(t0 + (what === 'blow' ? 3 : 0.5));
}
