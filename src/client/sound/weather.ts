import type { AudioCore } from './core';
import { biquad, envelope, pick, rand } from './dsp';

// The weather outside: rain, muffled indoors, pattering on the windows or all round you, and thunder.

/** Rain: a hiss that eases up and down with it, and drops. */
export class Rain {
  private rainNodes: { gain: GainNode; tone: BiquadFilterNode } | null = null;
  private nextRain = 0;
  private nextDrip = 0;

  constructor(private readonly a: AudioCore) {}

  /** Rain: a hiss that's muffled indoors, and drops pattering on the windows or all around you. */
  tickRain(now: number) {
    const rain = this.a.weather.rain;
    if (rain < 0.01 && !this.rainNodes) return;
    const ctx = this.a.ctx!;
    const where = this.a.where();
    if (!this.rainNodes) {
      const src = this.a.noise(this.a.buf.white, true);
      const tone = biquad(ctx, 'lowpass', 1300, 0.5);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(biquad(ctx, 'highpass', 450, 0.5)).connect(tone).connect(gain).connect(this.a.ambience);
      src.start();
      this.rainNodes = { gain, tone };
    }
    if (now >= this.nextRain) {
      // A few updates a second; its level eases anyway.
      this.nextRain = now + 0.25;
      const level = rain < 0.01 ? 0 : (where === 'out' ? 0.16 : where === 'garage' ? 0.11 : 0.06) * rain ** 0.8;
      this.rainNodes.gain.gain.setTargetAtTime(level, now, 0.6);
      this.rainNodes.tone.frequency.setTargetAtTime(where === 'out' ? 6500 : where === 'garage' ? 2600 : 1300, now, 0.3);
    }
    if (rain > 0.05 && now >= this.nextDrip) {
      this.nextDrip = now + rand(0.03, 0.2) / rain;
      const l = this.a.listener;
      const at = where === 'office' ? pick(this.a.windows()) : { x: l.x + rand(-4, 4), y: l.y - 1.2, z: l.z + rand(-4, 4) };
      this.a.play(this.a.buf.drop, { at, gain: rand(0.05, 0.14), rate: rand(0.7, 1.4), ref: 1.5, rolloff: 1.3 });
      this.a.count('drip');
    }
  }

}

/** Thunder, `delay` seconds after the flash: a crack when it's close, then a long low rumble. */
export function thunder(a: AudioCore, delay: number, loud: number) {
  const ctx = a.ctx;
  if (!ctx || ctx.state !== 'running') return;
  a.count('thunder');
  const t0 = ctx.currentTime + delay;
  const peak = 0.45 * loud * (a.where() === 'office' ? 0.6 : 1);
  const src = a.noise(a.buf.brown, true);
  const tone = biquad(ctx, 'lowpass', 700, 0.7);
  tone.frequency.setValueAtTime(700, t0);
  tone.frequency.exponentialRampToValueAtTime(110, t0 + 3.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.08 + (1 - loud) * 0.5);
  g.gain.exponentialRampToValueAtTime(peak * 0.35, t0 + 1.3);
  g.gain.exponentialRampToValueAtTime(peak * 0.6, t0 + 1.9);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 4 + loud * 2.5);
  src.connect(tone).connect(g).connect(a.ambience);
  src.start(t0, rand(0, 5));
  src.stop(t0 + 7);
  if (delay < 1) {
    const crack = a.noise(a.buf.white);
    const cg = ctx.createGain();
    envelope(cg.gain, t0, [
      [0.01, peak * 0.5],
      [0.25, 0],
    ]);
    crack.connect(biquad(ctx, 'bandpass', 1800, 0.6)).connect(cg).connect(a.ambience);
    crack.start(t0);
    crack.stop(t0 + 0.3);
  }
}
