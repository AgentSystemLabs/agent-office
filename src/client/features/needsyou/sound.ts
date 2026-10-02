import type { AudioCore } from '../../sound/core';

// The alarm for a worker that has stopped to ask you something.

/** The notes of the alarm, and of the reminder: [Hz, seconds in]. */
const ALARM: readonly (readonly [number, number])[] = [[784, 0], [1047, 0.13], [784, 0.42], [1175, 0.55]];
const AGAIN: readonly (readonly [number, number])[] = [[784, 0], [1047, 0.13]];

/**
 * Two rising pairs, brighter and louder than the ding for a worker that's done, so one is never taken
 * for the other. `again` is the reminder while it's still waiting: one pair, soft.
 */
export function needsYou(a: AudioCore, again = false) {
  a.unlock();
  const ctx = a.ctx;
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  a.count(again ? 'needs-you-again' : 'needs-you');
  const level = again ? 0.14 : 0.34;
  for (const [f, at] of again ? AGAIN : ALARM) {
    const t0 = ctx.currentTime + at;
    // A bell: the note, and a quieter one an octave up that dies away sooner.
    for (const [mult, amp, len] of [
      [1, level, 0.34],
      [2, level * 0.3, 0.16],
    ]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f * mult;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(amp, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      o.connect(g).connect(a.alerts);
      o.start(t0);
      o.stop(t0 + len + 0.05);
    }
  }
}
