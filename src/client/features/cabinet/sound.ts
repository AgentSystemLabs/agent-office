import type { AudioCore } from '../../sound/core';
import { CABINET_AT } from '../../sound/places';

// ---- The arcade -------------------------------------------------------------------------------

/** The arcade cabinet's chip bleeps: a piece landing, lines clearing (a longer run up for more at once), the game ending. */
export function arcade(a: AudioCore, kind: 'land' | 'clear' | 'over', lines = 1) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`arcade.${kind}`);
  const out = a.panner(CABINET_AT, 1.5, 1.2);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.02;
  if (kind === 'land') a.blip(out, t0, 160, 0.55, 0.07, 0.1, 'square');
  else if (kind === 'clear') [523, 659, 784, 1047, 1319].slice(0, lines + 1).forEach((f, i) => a.blip(out, t0 + i * 0.07, f, 1.02, 0.1, 0.09, 'square'));
  else [392, 330, 262, 196].forEach((f, i) => a.blip(out, t0 + i * 0.18, f, 0.97, 0.17, 0.14, 'triangle'));
}
