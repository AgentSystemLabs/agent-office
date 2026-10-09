import type { AudioCore } from '../../sound/core';
import { CHESS_AT } from '../../sound/places';

// ---- The chess corner ---------------------------------------------------------------------------

export type ChessSound = 'select' | 'move' | 'capture' | 'check' | 'win' | 'lose' | 'draw';

/** Wooden knocks and little chimes from the chess table behind the couch, so you hear which way it is. */
export function chess(a: AudioCore, kind: ChessSound) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count(`chess.${kind}`);
  const out = a.panner(CHESS_AT, 2.5, 0.9);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.02;
  if (kind === 'select') a.blip(out, t0, 660, 1.02, 0.05, 0.06, 'sine');
  else if (kind === 'move') {
    // A piece set down: a soft wooden knock.
    a.blip(out, t0, 220, 0.6, 0.08, 0.16, 'triangle');
    a.blip(out, t0 + 0.03, 440, 1.01, 0.06, 0.05, 'sine');
  } else if (kind === 'capture') {
    a.blip(out, t0, 180, 0.55, 0.1, 0.2, 'triangle');
    a.blip(out, t0 + 0.06, 330, 0.8, 0.09, 0.12, 'triangle');
  } else if (kind === 'check') [880, 1175].forEach((f, i) => a.blip(out, t0 + i * 0.09, f, 1.0, 0.1, 0.09, 'sine'));
  else if (kind === 'win') [523, 659, 784, 1047].forEach((f, i) => a.blip(out, t0 + i * 0.11, f, 1.0, 0.14, 0.1, 'triangle'));
  else if (kind === 'lose') [392, 330, 262].forEach((f, i) => a.blip(out, t0 + i * 0.16, f, 0.97, 0.16, 0.1, 'triangle'));
  else [440, 440].forEach((f, i) => a.blip(out, t0 + i * 0.18, f, 1.0, 0.14, 0.09, 'sine'));
}
