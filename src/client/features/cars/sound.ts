import type { AudioCore } from '../../sound/core';
import { biquad, envelope, pick, place, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// ---- The cars in the garage ------------------------------------------------------------------------

/** A car's engine note: a sawtooth and a square an octave under it, through a filter that opens as it revs. */
interface Motor {
  saw: OscillatorNode;
  sub: OscillatorNode;
  tone: BiquadFilterNode;
  gain: GainNode;
  pan: PannerNode;
  /** When it started (the AudioContext's clock). */
  born: number;
}

/** A car somebody's driving: where it is, how fast it's going and how hard it's pushed. */
export interface Engine {
  car: number;
  at: Pos;
  speed: number;
  gas: number;
}

/** The engines of the cars being driven. */
export class Motors {
  /** The engines of the cars being driven, by car. */
  private motors = new Map<number, Motor>();

  constructor(private readonly a: AudioCore) {}

  /**
   * The engines running: one for each car somebody's driving, where it is, how fast it's going and
   * how hard it's pushed. One that's dropped off the list dies away.
   */
  setEngines(running: Engine[]) {
    const ctx = this.a.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const on = new Set<number>();
    for (const e of running) {
      on.add(e.car);
      let m = this.motors.get(e.car);
      if (!m) {
        m = this.startMotor(e.at);
        this.motors.set(e.car, m);
      }
      place(m.pan, e.at.x, e.at.y, e.at.z);
      // Still catching, with its rev.
      if (now - m.born < 0.7) continue;
      const v = Math.abs(e.speed);
      const push = Math.abs(e.gas);
      // Up through the gears: the revs climb in each one and drop back as it shifts up.
      const gear = Math.min(3, Math.floor(v / 5.5));
      const f = 44 + gear * 7 + Math.min(1.5, (v - gear * 5.5) / 5.5) * 46 + push * 5;
      m.saw.frequency.setTargetAtTime(f, now, 0.06);
      m.sub.frequency.setTargetAtTime(f / 2, now, 0.06);
      m.tone.frequency.setTargetAtTime(240 + f * 5 + push * 450, now, 0.08);
      m.gain.gain.setTargetAtTime(0.035 + 0.04 * push + 0.025 * Math.min(1, v / 20), now, 0.1);
    }
    for (const [car, m] of this.motors) {
      if (on.has(car)) continue;
      this.motors.delete(car);
      m.gain.gain.cancelScheduledValues(now);
      m.gain.gain.setTargetAtTime(0, now, 0.12);
      m.saw.stop(now + 0.8);
      m.sub.stop(now + 0.8);
    }
  }

  /** An engine turning over: it catches with a rev and settles to a burble. */
  private startMotor(at: Pos): Motor {
    const ctx = this.a.ctx!;
    this.a.count('engine');
    const now = ctx.currentTime;
    const pan = this.a.panner(at, 3, 1);
    pan.connect(this.a.ambience);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.11, now + 0.12);
    gain.gain.setTargetAtTime(0.035, now + 0.45, 0.15);
    const tone = biquad(ctx, 'lowpass', 900, 2);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    const sub = ctx.createOscillator();
    sub.type = 'square';
    for (const [o, k] of [
      [saw, 1],
      [sub, 0.5],
    ] as const) {
      o.frequency.setValueAtTime(30 * k, now);
      o.frequency.linearRampToValueAtTime(115 * k, now + 0.3);
      o.frequency.setTargetAtTime(44 * k, now + 0.35, 0.12);
    }
    const low = ctx.createGain();
    low.gain.value = 0.5;
    saw.connect(tone);
    sub.connect(low).connect(tone);
    tone.connect(gain).connect(pan);
    saw.start(now);
    sub.start(now);
    return { saw, sub, tone, gain, pan, born: now };
  }

}

/** A car's horn: two notes a third apart, a Lambo's higher than a Ferrari's. */
export function honk(a: AudioCore, at: Pos, high: boolean) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('honk');
  const out = a.panner(at, 4, 0.9);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;
  const g = ctx.createGain();
  envelope(g.gain, t0, [
    [0.02, 0.09],
    [0.42, 0.08],
    [0.5, 0],
  ]);
  const tone = biquad(ctx, 'lowpass', 2200, 0.7);
  tone.connect(g).connect(out);
  for (const f of high ? [440, 554] : [392, 494]) {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(tone);
    o.start(t0);
    o.stop(t0 + 0.55);
  }
}

/** A car door shutting behind someone getting in or out. */
export function carDoor(a: AudioCore, at: Pos) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('car-door');
  const out = a.panner(at, 2, 1.1);
  out.connect(a.ambience);
  a.play(pick(a.buf.steps), { gain: 0.6, rate: 0.55, dest: out });
  a.blip(out, ctx.currentTime + 0.005, 120, 0.6, 0.09, 0.12);
}

/** A car running into something `speed` m/s: a thump, and the panels clanging. */
export function crash(a: AudioCore, at: Pos, speed: number) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('crash');
  const loud = Math.min(1, speed / 12);
  const out = a.panner(at, 3, 1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.005;
  a.play(pick(a.buf.steps), { gain: 0.4 + 0.8 * loud, rate: 0.4, dest: out });
  a.blip(out, t0, 90, 0.5, 0.3, 0.1 + 0.25 * loud);
  for (const [f, amp] of [
    [520, 0.05],
    [1270, 0.03],
  ]) {
    a.blip(out, t0, f * rand(0.9, 1.1), 0.98, 0.25, amp * loud, 'triangle');
  }
}
