import { NowAndThen, type AudioCore } from './core';
import { biquad, pick, rand, randInt } from './dsp';
import { FRIDGE } from './places';

// ---- Around the room --------------------------------------------------------------------------

export function startRoomTone(a: AudioCore) {
  const ctx = a.ctx!;
  // A low rumble of building and traffic...
  const rumble = a.noise(a.buf.brown, true);
  const rumbleG = ctx.createGain();
  rumbleG.gain.value = 0.07;
  rumble.connect(biquad(ctx, 'lowpass', 300, 0.7)).connect(rumbleG).connect(a.indoors);
  // ...and the air vents, swelling slowly.
  const air = a.noise(a.buf.white, true);
  const airG = ctx.createGain();
  airG.gain.value = 0.009;
  const swell = ctx.createOscillator();
  swell.frequency.value = 0.06;
  const swellDepth = ctx.createGain();
  swellDepth.gain.value = 0.004;
  swell.connect(swellDepth).connect(airG.gain);
  air.connect(biquad(ctx, 'bandpass', 650, 0.5)).connect(airG).connect(a.indoors);
  rumble.start();
  air.start();
  swell.start();
}

/** The kitchen's fridge, humming away (not in a castle). */
export class Fridge {
  private fridge: { gain: GainNode; on: boolean; next: number } | null = null;

  constructor(private readonly a: AudioCore) {}

  startFridge() {
    const ctx = this.a.ctx!;
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 50;
    const whine = ctx.createOscillator();
    whine.frequency.value = 120;
    const whineG = ctx.createGain();
    whineG.gain.value = 0.3;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const tone = biquad(ctx, 'lowpass', 220, 0.7);
    hum.connect(tone);
    whine.connect(whineG).connect(tone);
    const out = this.a.panner(FRIDGE, 1, 1.6);
    tone.connect(gain).connect(out).connect(this.a.indoors);
    hum.start();
    whine.start();
    this.fridge = { gain, on: false, next: ctx.currentTime + rand(3, 12) };
  }

  /** The compressor kicks on for a while, then clunks off. */
  tickFridge(now: number) {
    const f = this.fridge;
    if (!f || now < f.next) return;
    // No fridge in a castle: it goes quiet, and doesn't clunk.
    if (this.a.hall) {
      f.on = false;
      f.gain.gain.setTargetAtTime(0, now, 0.3);
      f.next = now + 20;
      return;
    }
    f.on = !f.on;
    f.gain.gain.setTargetAtTime(f.on ? 0.06 : 0, now, f.on ? 0.6 : 0.3);
    f.next = now + (f.on ? rand(25, 50) : rand(20, 45));
    this.a.play(pick(this.a.buf.steps), { at: FRIDGE, gain: 0.25, rate: 0.6, ref: 1, rolloff: 1.6, dest: this.a.indoors });
    this.a.count(f.on ? 'fridgeOn' : 'fridgeOff');
  }

}

/** A few chirps from outside one of the windows. */
function birds(a: AudioCore, now: number) {
  const ctx = a.ctx!;
  a.count('birds');
  const out = a.panner(pick(a.windows()), 2, 1.2);
  // Heard through the glass.
  out.connect(biquad(ctx, 'lowpass', 5000, 0.7)).connect(a.ambience);
  const base = rand(2400, 4200);
  const shape = Math.random();
  let t = now + 0.05;
  for (let i = randInt(2, 6); i > 0; i--) {
    const len = rand(0.06, 0.14);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(base * rand(0.9, 1.05), t);
    if (shape < 0.5) {
      o.frequency.exponentialRampToValueAtTime(base * rand(1.25, 1.6), t + len * 0.6);
      o.frequency.exponentialRampToValueAtTime(base * rand(0.8, 1), t + len);
    } else o.frequency.exponentialRampToValueAtTime(base * rand(0.6, 0.75), t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + len + 0.02);
    t += len + rand(0.04, 0.2);
  }
}

/** A cricket just outside a window, chirping away for a few seconds. */
function crickets(a: AudioCore, now: number) {
  const ctx = a.ctx!;
  a.count('crickets');
  const out = a.panner(pick(a.windows()), 2, 1.2);
  out.connect(biquad(ctx, 'lowpass', 6000, 0.7)).connect(a.ambience);
  const freq = rand(4200, 5200);
  let t = now + 0.05;
  for (let c = randInt(4, 9); c > 0; c--) {
    for (let p = 0; p < 3; p++) {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.022, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.03);
      t += 0.035;
    }
    t += rand(0.35, 0.6);
  }
}

/** Birds by day, and not in the rain: every so often, and sometimes another answers from a different window. */
export function birdsong(a: AudioCore): NowAndThen {
  return new NowAndThen(
    () => rand(5, 15),
    // Sometimes another bird answers from a different window.
    () => (Math.random() < 0.35 ? rand(1.5, 4) : rand(12, 35)),
    (now) => {
      const { rain, night } = a.weather;
      // Birds sing by day, and not in the rain (or out in space).
      if (night < 0.5 && rain < 0.1 && !a.hall?.vacuum) birds(a, now);
    },
  );
}

/** A cricket at night, when it's dry. */
export function nightCrickets(a: AudioCore): NowAndThen {
  return new NowAndThen(
    () => rand(2, 6),
    () => rand(3, 8),
    (now) => {
      const { rain, night } = a.weather;
      if (night > 0.6 && rain < 0.05 && !a.hall?.vacuum) crickets(a, now);
    },
  );
}

// ---- The roof ---------------------------------------------------------------------------------

export function startWind(a: AudioCore) {
  const ctx = a.ctx!;
  // Traffic, far below…
  const city = a.noise(a.buf.brown, true);
  const cityG = ctx.createGain();
  cityG.gain.value = 0.08;
  city.connect(biquad(ctx, 'lowpass', 420, 0.6)).connect(cityG).connect(a.outside);
  // …and the wind, gusting and dropping, whistling higher as it picks up.
  const wind = a.noise(a.buf.white, true);
  const tone = biquad(ctx, 'bandpass', 520, 0.8);
  const windG = ctx.createGain();
  windG.gain.value = 0.012;
  const gust = ctx.createOscillator();
  gust.frequency.value = 0.08;
  const gustDepth = ctx.createGain();
  gustDepth.gain.value = 0.009;
  gust.connect(gustDepth).connect(windG.gain);
  const pitch = ctx.createGain();
  pitch.gain.value = 220;
  gust.connect(pitch).connect(tone.frequency);
  wind.connect(tone).connect(windG).connect(a.outside);
  city.start();
  wind.start();
  gust.start();
}
