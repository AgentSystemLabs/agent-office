import type { AudioCore } from '../../sound/core';
import { biquad, rand } from '../../sound/dsp';

// ---- The dog ----------------------------------------------------------------------------------

/** A few gruff woofs from where the dog is. */
export function bark(a: AudioCore, x: number, z: number, times: number) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('bark');
  const out = a.panner({ x, y: 0.5, z }, 2, 1);
  out.connect(a.ambience);
  let t = ctx.currentTime + 0.03;
  const pitch = rand(0.95, 1.05);
  for (let i = 0; i < times; i++) {
    woof(a, out, t, 300 * pitch * rand(0.95, 1.05), 0.17, 0.55);
    t += rand(0.3, 0.42);
  }
}

/** A short, high, happy yip: someone petted the dog. */
export function yip(a: AudioCore, x: number, z: number) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('yip');
  const out = a.panner({ x, y: 0.5, z }, 1.5, 1);
  out.connect(a.ambience);
  woof(a, out, ctx.currentTime + 0.02, 620, 0.09, 0.3);
}

/** One bark: a buzzy voice that leaps up in pitch and falls away, shaped into a "wuh", with a breathy rasp. */
function woof(a: AudioCore, out: AudioNode, t: number, f: number, len: number, gain: number) {
  const ctx = a.ctx!;
  const voice = ctx.createOscillator();
  voice.type = 'sawtooth';
  voice.frequency.setValueAtTime(f * 0.75, t);
  voice.frequency.exponentialRampToValueAtTime(f * 1.45, t + len * 0.22);
  voice.frequency.exponentialRampToValueAtTime(f * 0.6, t + len);
  const mouth = biquad(ctx, 'bandpass', 950, 1.1);
  mouth.frequency.setValueAtTime(700, t);
  mouth.frequency.linearRampToValueAtTime(1300, t + len * 0.3);
  mouth.frequency.linearRampToValueAtTime(600, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(gain * 0.45, t + len * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  voice.connect(mouth).connect(g).connect(out);
  const breath = a.noise(a.buf.white);
  const rasp = ctx.createGain();
  rasp.gain.value = 0.35;
  breath.connect(biquad(ctx, 'bandpass', 1800, 0.8)).connect(rasp).connect(g);
  voice.start(t);
  voice.stop(t + len + 0.02);
  breath.start(t, rand(0, 4));
  breath.stop(t + len + 0.02);
}

// ---- The cat ----------------------------------------------------------------------------------

/** A meow or a few from where the cat is. */
export function meow(a: AudioCore, x: number, z: number, times: number) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('meow');
  const out = a.panner({ x, y: 0.4, z }, 2, 1);
  out.connect(a.ambience);
  let t = ctx.currentTime + 0.03;
  const pitch = rand(0.95, 1.08);
  for (let i = 0; i < Math.max(1, times); i++) {
    mew(ctx, out, t, 560 * pitch * rand(0.96, 1.04), rand(0.5, 0.62));
    t += rand(0.75, 0.95);
  }
}

/** One "mi-aow": a reedy voice that rises and falls, the mouth opening from "ee" to "ah" and closing to "oo". */
function mew(ctx: AudioContext, out: AudioNode, t: number, f: number, len: number) {
  const voice = ctx.createOscillator();
  voice.type = 'sawtooth';
  voice.frequency.setValueAtTime(f * 0.85, t);
  voice.frequency.exponentialRampToValueAtTime(f * 1.3, t + len * 0.35);
  voice.frequency.exponentialRampToValueAtTime(f * 0.8, t + len);
  const mouth = biquad(ctx, 'bandpass', 1800, 3);
  mouth.frequency.setValueAtTime(2600, t);
  mouth.frequency.exponentialRampToValueAtTime(1500, t + len * 0.45);
  mouth.frequency.exponentialRampToValueAtTime(800, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.4, t + 0.06);
  g.gain.setValueAtTime(0.4, t + len * 0.55);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  voice.connect(mouth).connect(g).connect(out);
  voice.start(t);
  voice.stop(t + len + 0.02);
}

/** A purr: a low rumble pulsing about 25 times a second, louder breathing out than in. */
export function purr(a: AudioCore, x: number, z: number) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('purr');
  const out = a.panner({ x, y: 0.3, z }, 1.2, 1);
  out.connect(a.ambience);
  const t = ctx.currentTime + 0.02;
  const len = 2.2;
  const rumble = a.noise(a.buf.white, true);
  const g = ctx.createGain();
  g.gain.value = 0;
  // The pulse: a low tone sets the level of the rumble, up and down.
  const pulse = ctx.createOscillator();
  pulse.frequency.value = rand(23, 27);
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  pulse.connect(depth).connect(g.gain);
  // Two breaths: out (louder), in, out.
  const level = ctx.createGain();
  level.gain.setValueAtTime(0.0001, t);
  for (const [at, v] of [[0.1, 0.9], [0.75, 0.35], [0.95, 0.35], [1.6, 0.9], [len, 0.0001]] as const) {
    level.gain.exponentialRampToValueAtTime(v, t + at);
  }
  rumble.connect(biquad(ctx, 'lowpass', 260, 0.9)).connect(g).connect(level).connect(out);
  rumble.start(t, rand(0, 4));
  rumble.stop(t + len + 0.05);
  pulse.start(t);
  pulse.stop(t + len + 0.05);
}
