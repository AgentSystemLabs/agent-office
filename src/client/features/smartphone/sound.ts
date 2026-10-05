import type { AudioCore } from '../../sound/core';
import { biquad } from '../../sound/dsp';

// The smartphone's sounds, synthesized like the rest of the office: a double ring for placing a
// call, a swoosh for an SMS going out, and a blip for tapping through the phone. UI-local, like the
// worker dings: they come out of the alerts bus, not from anywhere in the room.

/** An old landline's two-tone ring (440 + 480 Hz), rung twice, for placing a call. */
export function phoneRing(a: AudioCore) {
  a.unlock();
  const ctx = a.ctx;
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  a.count('phone-ring');
  for (const at of [0, 0.9]) {
    const t0 = ctx.currentTime + at;
    for (const f of [440, 480]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      g.gain.setValueAtTime(0.22, t0 + 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.65);
      o.connect(g).connect(a.alerts);
      o.start(t0);
      o.stop(t0 + 0.7);
    }
  }
}

/** An SMS going out: a short whoosh upward. */
export function smsSwoosh(a: AudioCore) {
  a.unlock();
  const ctx = a.ctx;
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  a.count('sms-swoosh');
  const t0 = ctx.currentTime + 0.01;
  const noise = a.noise(a.buf.white);
  const bp = biquad(ctx, 'bandpass', 900, 1.4);
  bp.frequency.setValueAtTime(900, t0);
  bp.frequency.exponentialRampToValueAtTime(4200, t0 + 0.22);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
  noise.connect(bp).connect(g).connect(a.alerts);
  noise.start(t0);
  noise.stop(t0 + 0.3);
}

/** Tapping through the phone: one soft key blip. */
export function dialBlip(a: AudioCore) {
  a.unlock();
  const ctx = a.ctx;
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  a.count('dial-blip');
  const t0 = ctx.currentTime + 0.01;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = 1350;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.07);
  o.connect(g).connect(a.alerts);
  o.start(t0);
  o.stop(t0 + 0.1);
}
