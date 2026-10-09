import type { AudioCore } from '../../sound/core';
import { biquad } from '../../sound/dsp';

// The smartphone's sounds, synthesized like the rest of the office: a double ring for placing a
// call, a swoosh for an SMS going out, and a blip for tapping through the phone. UI-local, like the
// worker dings: they come out of the alerts bus, not from anywhere in the room.

/** The audio context unlocked and counted, or null before the browser allows audio. */
function ready(a: AudioCore, name: string): AudioContext | null {
  a.unlock();
  const ctx = a.ctx;
  if (!ctx) return null;
  if (ctx.state === 'suspended') void ctx.resume();
  a.count(name);
  return ctx;
}

/**
 * An old landline's two-tone ring (440 + 480 Hz), rung twice, for placing a call. Returns a stop
 * handle: hanging up mid-dial silences the scheduled rings instead of playing them out with no
 * call attached (safe to call after the ring ended on its own).
 */
export function phoneRing(a: AudioCore): () => void {
  const ctx = ready(a, 'phone-ring');
  if (!ctx) return () => {};
  const voices: { o: OscillatorNode; g: GainNode }[] = [];
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
      voices.push({ o, g });
    }
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    for (const { o, g } of voices) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0.0001, now, 0.02);
        o.stop(now + 0.15);
      } catch {
        // Already ended on its own: nothing to silence.
      }
    }
  };
}

/** An SMS going out: a short whoosh upward. */
export function smsSwoosh(a: AudioCore) {
  const ctx = ready(a, 'sms-swoosh');
  if (!ctx) return;
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
  const ctx = ready(a, 'dial-blip');
  if (!ctx) return;
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
