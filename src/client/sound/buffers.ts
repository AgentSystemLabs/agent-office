import { rand } from './dsp';

// ---- Sound samples, made once when audio starts -----------------------------------------------------

export interface Buffers {
  keys: AudioBuffer[];
  spaces: AudioBuffer[];
  mouse: AudioBuffer;
  /** Soft thuds. Footsteps have their own samples (see feet.ts). */
  steps: AudioBuffer[];
  rustle: AudioBuffer;
  /** A raindrop hitting the glass. */
  drop: AudioBuffer;
  brown: AudioBuffer;
  white: AudioBuffer;
  /** A slow, lumpy 0–1 signal for wobbling other sounds' volume. */
  gurgle: AudioBuffer;
}

export function makeBuffers(ctx: BaseAudioContext): Buffers {
  return {
    keys: [0, 1, 2, 3, 4, 5].map(() => keyClick(ctx, { body: rand(190, 300), bright: rand(0.7, 1), release: rand(0.06, 0.09), decay: 95, len: 0.12 })),
    spaces: [0, 1].map(() => keyClick(ctx, { body: rand(105, 130), bright: 0.55, release: rand(0.09, 0.12), decay: 55, len: 0.2 })),
    mouse: keyClick(ctx, { body: 900, bright: 1, release: 0.07, decay: 400, len: 0.1 }),
    steps: [0, 1, 2].map(() => footstep(ctx)),
    rustle: rustle(ctx),
    drop: sample(ctx, 0.06, (t) => (Math.sin(2 * Math.PI * 2400 * t * (1 - t * 5)) * 0.6 + (Math.random() * 2 - 1) * 0.4) * Math.exp(-t * 110), 0.9),
    brown: loopable(ctx, 6, brownNoise()),
    white: sample(ctx, 5, () => Math.random() * 2 - 1),
    gurgle: loopable(ctx, 4, lumpy(ctx.sampleRate, 0.03, 0.11)),
  };
}

/** `seconds` of whatever `next` gives for each moment, its loudest point brought to `peak` if there is one. */
export function sample(ctx: BaseAudioContext, seconds: number, next: (t: number) => number, peak?: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const b = ctx.createBuffer(1, Math.ceil(sr * seconds), sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = next(i / sr);
  if (peak) {
    let max = 0;
    for (const v of d) max = Math.max(max, Math.abs(v));
    if (max > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / max;
  }
  return b;
}

/** A buffer whose end runs smoothly into its start, so it loops without a click. */
function loopable(ctx: BaseAudioContext, seconds: number, next: () => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.ceil(sr * seconds);
  const fade = Math.floor(sr * 0.25);
  const raw = new Float32Array(n + fade);
  for (let i = 0; i < raw.length; i++) raw[i] = next();
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  d.set(raw.subarray(0, n));
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = raw[i] * Math.sqrt(k) + raw[n + i] * Math.sqrt(1 - k);
  }
  return b;
}

function brownNoise(): () => number {
  let last = 0;
  return () => {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    return last * 3.5;
  };
}

/** Wanders between random levels, holding each for `min`–`max` seconds. */
export function lumpy(sr: number, min: number, max: number): () => number {
  let level = 0;
  let target = 0;
  let hold = 0;
  return () => {
    if (--hold <= 0) {
      target = Math.random() ** 2;
      hold = Math.floor(rand(min, max) * sr);
    }
    level += (target - level) * (100 / sr);
    return level;
  };
}

/** A key bottoming out, a bright tick over a short woody thock, then a softer tick as it springs back. */
function keyClick(ctx: BaseAudioContext, o: { body: number; bright: number; release: number; decay: number; len: number }): AudioBuffer {
  let prev = 0;
  let hiss = 0;
  let low = 0;
  return sample(
    ctx,
    o.len,
    (t) => {
      const w = Math.random() * 2 - 1;
      hiss += (w - prev - hiss) * 0.5; // high-passed, then the harshest top taken off
      prev = w;
      low += (w - low) * 0.15;
      let v = hiss * Math.exp(-t * 700) * o.bright + (Math.sin(2 * Math.PI * o.body * t) * 0.5 + low) * Math.exp(-t * o.decay);
      const r = t - o.release;
      if (r > 0) v += hiss * Math.exp(-r * 900) * o.bright * 0.45;
      return v;
    },
    0.9,
  );
}

/** A muffled thud and a little scuff: something soft landing (a ball, a dart, a page), and the weight under a jump's landing. */
function footstep(ctx: BaseAudioContext): AudioBuffer {
  let low = 0;
  let prev = 0;
  const scuffAt = rand(0.025, 0.045);
  return sample(
    ctx,
    0.25,
    (t) => {
      const w = Math.random() * 2 - 1;
      low += (w - low) * 0.03;
      const attack = Math.min(1, t / 0.004);
      let v = (low * 3 + Math.sin(2 * Math.PI * 62 * t) * 0.5) * attack * Math.exp(-t * 30);
      const s = t - scuffAt;
      if (s > 0) v += (w - prev) * 0.06 * Math.exp(-s * 50);
      prev = w;
      return v;
    },
    0.9,
  );
}

/** Paper being shuffled: crackly mid-range noise in uneven bursts. */
function rustle(ctx: BaseAudioContext): AudioBuffer {
  const len = 0.8;
  let a = 0;
  let b = 0;
  let amp = 0;
  let target = 0;
  let hold = 0;
  const sr = ctx.sampleRate;
  return sample(
    ctx,
    len,
    (t) => {
      const w = Math.random() * 2 - 1;
      a += (w - a) * 0.5;
      b += (w - b) * 0.05;
      if (--hold <= 0) {
        target = Math.random() ** 3;
        hold = Math.floor(rand(0.008, 0.03) * sr);
      }
      amp += (target - amp) * 0.02;
      return (a - b) * amp * Math.sin((Math.PI * t) / len);
    },
    0.8,
  );
}
