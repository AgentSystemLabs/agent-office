import type { AudioCore } from './core';

// ---- Alerts ----------------------------------------------------------------------------------

/** Two notes up when a worker is done, a three-note nudge when it needs input. */
export function ding(a: AudioCore, kind: 'done' | 'needs_input') {
  a.unlock();
  const ctx = a.ctx;
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  a.count(kind);
  const notes = kind === 'done' ? [660, 880] : [880, 660, 880];
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = f;
    const t0 = ctx.currentTime + i * 0.12;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
    o.connect(g).connect(a.alerts);
    o.start(t0);
    o.stop(t0 + 0.3);
  });
}
