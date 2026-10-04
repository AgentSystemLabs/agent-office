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

/** Intercom alert sound: subtle two-tone PA broadcast chime (C5 then E5) when broadcasting prompts. */
export function intercom(a: AudioCore) {
  a.unlock();
  const ctx = a.ctx;
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  a.count('intercom');
  const notes = [523.25, 659.25]; // C5 -> E5
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const t0 = ctx.currentTime + i * 0.15;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
    o.connect(g).connect(a.alerts);
    o.start(t0);
    o.stop(t0 + 0.32);
  });
}

/** Fallback intercom chime player when full OfficeSound context is not directly attached. */
export function playIntercomSound(sound?: { intercom?: () => void } | (() => { intercom?: () => void } | undefined)) {
  const s = typeof sound === 'function' ? sound() : sound;
  if (s && typeof s.intercom === 'function') {
    s.intercom();
    return;
  }
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [523.25, 659.25];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.15;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.32);
    });
  } catch {
    // AudioContext blocked or unavailable
  }
}

