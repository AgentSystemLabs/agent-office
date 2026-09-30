import type { AudioCore } from '../../sound/core';
import { biquad, envelope, rand } from '../../sound/dsp';
import { COFFEE_MACHINE } from '../../sound/places';

// ---- The coffee machine -------------------------------------------------------------------------

/** Grind, gurgle and drip. */
export function coffee(a: AudioCore) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('coffee');
  // In a hall of its own it's ale drawn from a cask, where you're standing: no grinder, just the pour.
  const cask = !!a.hall;
  const out = a.panner(cask ? { x: a.listener.x, y: a.listener.y + 0.2, z: a.listener.z } : COFFEE_MACHINE, 1.2, 1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.05;
  // The grinder first (not at a cask), then the pour.
  const grinder: AudioScheduledSourceNode[] = [];
  if (!cask) {

    // Grinder: a buzzing motor with beans crunching in it.
    const motor = ctx.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.setValueAtTime(70, t0);
    motor.frequency.linearRampToValueAtTime(118, t0 + 0.25);
    motor.frequency.setValueAtTime(118, t0 + 1.2);
    motor.frequency.linearRampToValueAtTime(60, t0 + 1.5);
    const motorTone = biquad(ctx, 'lowpass', 1100, 0.8);
    const crunch = a.noise(a.buf.white);
    const crunchTone = biquad(ctx, 'bandpass', 2600, 1.2);
    const grind = ctx.createGain();
    envelope(grind.gain, t0, [
      [0.08, 0.13],
      [1.25, 0.13],
      [1.5, 0],
    ]);
    const crunchAmp = ctx.createGain();
    crunchAmp.gain.value = 0.5;
    const rattle = a.noise(a.buf.gurgle, true);
    rattle.playbackRate.value = 3;
    rattle.connect(crunchAmp.gain);
    motor.connect(motorTone).connect(grind);
    crunch.connect(crunchTone).connect(crunchAmp).connect(grind);
    grind.connect(out);
    grinder.push(motor, crunch, rattle);
  }

  // Brewing: a hissing, gurgling pour with bubbles popping.
  const t1 = t0 + (cask ? 0 : 1.8);
  const pour = a.noise(a.buf.white);
  const pourTone = biquad(ctx, 'bandpass', 850, 0.9);
  const gurgle = ctx.createGain();
  gurgle.gain.value = 0.25;
  const wobble = a.noise(a.buf.gurgle, true);
  wobble.connect(gurgle.gain);
  const brew = ctx.createGain();
  envelope(brew.gain, t1, [
    [0.2, 0.3],
    [2.4, 0.26],
    [3, 0],
  ]);
  pour.connect(pourTone).connect(gurgle).connect(brew).connect(out);
  for (let i = 0; i < 14; i++) a.blip(out, t1 + rand(0.2, 2.6), rand(350, 800), rand(1.6, 2.4), 0.05, 0.1);

  // The last few drips into the cup.
  for (const dt of [3.3, 3.9, 4.7]) a.blip(out, t1 + dt + rand(-0.1, 0.1), rand(1100, 1400), 0.55, 0.05, 0.11);

  const end = t1 + 3.2;
  for (const s of grinder) {
    s.start(t0);
    s.stop(t0 + 1.6);
  }
  for (const s of [pour, wobble]) {
    s.start(t1);
    s.stop(end);
  }
}
