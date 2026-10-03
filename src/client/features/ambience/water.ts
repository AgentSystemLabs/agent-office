/** The thinking spot's ocean and rain, made from noise (see noise.ts) and a few oscillators. */
import { biquad, rand } from '../../sound/dsp';
import { gap, waveEnvelope } from './noise';
import { chain, Rig } from './rig';

const rnd = Math.random;
const POINTS = 160;

/** One stretch of surf, off to one side: waves that swell, break and run back, each 8 to 14 s, never quite alike. */
function surf(rig: Rig, pan: number, level: number) {
  const { ctx } = rig;
  const lp = biquad(ctx, 'lowpass', 220, 0.6);
  const body = ctx.createGain();
  const hiss = ctx.createGain();
  const out = ctx.createStereoPanner();
  out.pan.value = pan;
  chain(rig.loop('pink'), lp, body, out);
  // The faint high hiss on the crest, as the foam breaks.
  chain(rig.loop('white'), biquad(ctx, 'highpass', 4200, 0.5), hiss, out);
  out.connect(rig.bus);
  const floor = waveEnvelope(2)[0];
  body.gain.value = floor * level;
  lp.frequency.value = 220 * 8 ** floor;
  hiss.gain.value = 0;
  const bodyCurve = new Float32Array(POINTS);
  const lpCurve = new Float32Array(POINTS);
  const hissCurve = new Float32Array(POINTS);
  rig.events(rand(0.1, 4), (t) => {
    const period = rand(8, 14);
    const env = waveEnvelope(POINTS, rand(0.3, 0.46));
    for (let i = 0; i < POINTS; i++) {
      bodyCurve[i] = env[i] * level;
      lpCurve[i] = 220 * 8 ** env[i];
      hissCurve[i] = env[i] ** 5 * 0.09 * level;
    }
    body.gain.setValueCurveAtTime(bodyCurve, t, period);
    lp.frequency.setValueCurveAtTime(lpCurve, t, period);
    hiss.gain.setValueCurveAtTime(hissCurve, t, period);
    return period + 0.05;
  });
}

export function ocean(rig: Rig) {
  const { ctx } = rig;
  surf(rig, -0.55, 1.5);
  surf(rig, 0.55, 1.5);
  // The sea beyond the waves: a low steady wash.
  chain(rig.loop('brown'), biquad(ctx, 'lowpass', 260, 0.5), gain(ctx, 0.5), rig.bus);
}

function gain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** A drop landing on a leaf: a quick tick whose pitch falls (or, now and then, a fatter one that bubbles up). */
function drip(rig: Rig, t: number) {
  const { ctx } = rig;
  const big = rnd() < 0.12;
  const o = ctx.createOscillator();
  const f = big ? rand(700, 1300) : rand(1800, 4800);
  const dur = big ? 0.07 : rand(0.015, 0.04);
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(big ? f * 1.7 : f * 0.45, t + dur);
  const g = ctx.createGain();
  const peak = big ? rand(0.03, 0.06) : rand(0.02, 0.07);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const pan = ctx.createStereoPanner();
  pan.pan.value = rand(-0.9, 0.9);
  chain(o, g, pan, rig.bus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function rain(rig: Rig) {
  const { ctx } = rig;
  // The steady fall: pink noise with its mud taken off and the top lifted, so it hisses softly rather than roars.
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 3000;
  shelf.gain.value = 6;
  chain(rig.loop('pink'), biquad(ctx, 'highpass', 300, 0.5), shelf, biquad(ctx, 'lowpass', 9000, 0.5), gain(ctx, 0.55), rig.bus);
  // Drops on the leaves around you, the density rising and falling slowly.
  const patter = gain(ctx, 0.1);
  chain(rig.loop('white'), biquad(ctx, 'bandpass', 5500, 0.6), patter, rig.bus);
  const lfo = chain(rig.osc('sine', 0.11), gain(ctx, 0.04));
  lfo.connect(patter.gain);
  // Single drops, sparse and unevenly spaced.
  rig.events(0.2, (t) => {
    drip(rig, t);
    return gap(rnd, 0.06, 0.55);
  });
  // Thunder a long way off: a low rumble that swells and fades by itself.
  const rumble = gain(ctx, 0.1);
  chain(rig.loop('brown'), biquad(ctx, 'lowpass', 140, 0.7), rumble, rig.bus);
  rig.events(1, (t) => {
    rumble.gain.setTargetAtTime(rand(0.08, 0.55), t, rand(2.5, 5));
    return rand(7, 20);
  });
}
