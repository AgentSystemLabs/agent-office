import type { AudioCore } from '../../sound/core';
import type { Pos } from '../../sound/places';
import { pick, rand } from '../../sound/dsp';

// ---- The vault's safe ----------------------------------------------------------------------------

/**
 * The safe: opening, the dial clicks round and the bolts draw back with a clunk; shutting, the heavy
 * door thuds home. From where it stands.
 */
export function safe(a: AudioCore, at: Pos, open: boolean) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(open ? 'safe.open' : 'safe.shut');
  const out = a.panner(at, 2, 1.1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.01;
  if (open) {
    // The combination: a run of little ticks, then the bolts.
    for (let i = 0; i < 7; i++) a.blip(out, t0 + i * 0.055 + rand(0, 0.01), rand(2600, 3400), 0.6, 0.012, 0.05, 'square');
    a.blip(out, t0 + 0.45, 180, 0.5, 0.12, 0.35);
    a.blip(out, t0 + 0.46, 900, 0.7, 0.05, 0.06, 'triangle');
  } else {
    a.play(pick(a.buf.steps), { gain: 0.7, rate: 0.45, dest: out, when: t0 + 0.4 });
    a.blip(out, t0 + 0.4, 95, 0.5, 0.25, 0.45);
    a.blip(out, t0 + 0.47, 700, 0.8, 0.06, 0.05, 'triangle');
  }
}
