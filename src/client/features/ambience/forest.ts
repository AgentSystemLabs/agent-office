/** The thinking spot's forest: wind in the leaves, birds, crickets and the odd rustle. */
import { biquad, rand } from '../../sound/dsp';
import { birdCall, gap, loopNoise, pickSpecies, type Note, type Species } from './noise';
import { chain, noiseBuffer, Rig } from './rig';

const rnd = Math.random;

function gain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** A slow oscillator that moves `param` by up to `depth` either side of where it is. */
function drift(rig: Rig, param: AudioParam, hz: number, depth: number) {
  chain(rig.osc('sine', hz), gain(rig.ctx, depth)).connect(param);
}

/** A short, dark room for the birds to sound far off in: noise that dies away over a second and a half. */
function air(rig: Rig): ConvolverNode {
  const { ctx } = rig;
  const conv = ctx.createConvolver();
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(2, Math.floor(sr * 1.5), sr);
  for (let c = 0; c < 2; c++) {
    const d = loopNoise('white', buf.length, 0, rnd);
    for (let i = 0; i < d.length; i++) d[i] *= Math.exp((-3.2 * i) / sr) * 0.5;
    buf.copyToChannel(d, c);
  }
  conv.buffer = buf;
  const wet = gain(ctx, 0.6);
  chain(conv, biquad(ctx, 'lowpass', 4500, 0.5), wet, rig.bus);
  return conv;
}

/** One note of a bird's call, from somewhere off in the trees. */
function chirp(rig: Rig, n: Note, t: number, to: AudioNode, level: number) {
  const { ctx } = rig;
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(n.f0, t);
  o.frequency.exponentialRampToValueAtTime(n.f1, t + n.dur);
  const soft = n.f1 < 700;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(n.gain * level, t + (soft ? n.dur * 0.4 : Math.min(0.012, n.dur * 0.3)));
  g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
  chain(o, g, to);
  const end = t + n.dur + 0.05;
  if (n.fm) {
    const m = ctx.createOscillator();
    m.frequency.value = 90;
    chain(m, gain(ctx, n.fm * 3)).connect(o.frequency);
    m.start(t);
    m.stop(end);
  }
  o.start(t);
  o.stop(end);
}

/** A bird calls from one spot: panned, a little muffled by the distance, with some of it bounced off the trees. */
function call(rig: Rig, species: Species, t: number, verb: AudioNode): number {
  const { ctx } = rig;
  const notes = birdCall(species, rnd);
  const pan = ctx.createStereoPanner();
  pan.pan.value = rand(-0.85, 0.85);
  const far = biquad(ctx, 'lowpass', rand(5500, 9000), 0.4);
  const send = gain(ctx, 0.5);
  chain(pan, far, rig.bus);
  chain(far, send, verb);
  const level = (species === 'dove' ? 0.1 : 0.05) * rand(0.6, 1.2);
  for (const n of notes) chirp(rig, n, t + n.at, pan, level);
  const last = notes[notes.length - 1];
  return last.at + last.dur;
}

/** A cricket in the grass: three quick pulses of a high tone, over and over, for a while, then quiet for a while. */
function cricket(rig: Rig, startIn: number) {
  const { ctx } = rig;
  const f = rand(4300, 4900);
  const period = rand(0.45, 0.65);
  const pan = ctx.createStereoPanner();
  pan.pan.value = rand(-0.9, 0.9);
  pan.connect(rig.bus);
  let singing = false;
  let switchAt = 0;
  rig.events(startIn, (t) => {
    if (t >= switchAt) {
      singing = !singing;
      switchAt = t + (singing ? rand(7, 18) : rand(5, 16));
    }
    if (!singing) return switchAt - t;
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = 0;
    for (let k = 0; k < 3; k++) {
      const s = t + k * 0.045;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.014, s + 0.008);
      g.gain.linearRampToValueAtTime(0, s + 0.032);
    }
    chain(o, g, pan);
    o.start(t);
    o.stop(t + 0.2);
    return period * rand(0.9, 1.1);
  });
}

/** Something stirring in the leaves: a few soft crackles, and now and then a twig. */
function rustle(rig: Rig, t: number) {
  const { ctx } = rig;
  const pan = ctx.createStereoPanner();
  pan.pan.value = rand(-0.8, 0.8);
  pan.connect(rig.bus);
  const twig = rnd() < 0.12;
  let at = t;
  const bursts = twig ? 1 : 2 + Math.floor(rnd() * 4);
  for (let k = 0; k < bursts; k++) {
    const dur = twig ? 0.012 : rand(0.04, 0.09);
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx, 'white');
    const f = biquad(ctx, 'bandpass', twig ? 1500 : rand(3000, 6000), twig ? 4 : 1.2);
    const g = ctx.createGain();
    const peak = twig ? 0.2 : rand(0.04, 0.1);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    chain(s, f, g, pan);
    s.start(at, rand(0, 6), dur + 0.02);
    at += dur + rand(0.02, 0.12);
  }
}

export function forest(rig: Rig) {
  const { ctx } = rig;
  // Wind in the leaves: two bands of noise that come and go, slowly and out of step.
  const low = gain(ctx, 0.28);
  chain(rig.loop('pink'), biquad(ctx, 'bandpass', 600, 0.5), low, rig.bus);
  drift(rig, low.gain, 0.07, 0.16);
  const leaves = gain(ctx, 0.12);
  chain(rig.loop('pink'), biquad(ctx, 'bandpass', 1900, 0.8), leaves, rig.bus);
  drift(rig, leaves.gain, 0.13, 0.07);
  // Birds, now and then, sometimes answered by another.
  const verb = air(rig);
  rig.events(1.5, (t) => {
    const len = call(rig, pickSpecies(rnd), t, verb);
    if (rnd() < 0.3) call(rig, pickSpecies(rnd), t + len + rand(0.5, 1.5), verb);
    return len + gap(rnd, 2.5, 13);
  });
  for (let i = 0; i < 3; i++) cricket(rig, rand(0.5, 8));
  rig.events(6, (t) => {
    rustle(rig, t);
    return gap(rnd, 7, 22);
  });
}
