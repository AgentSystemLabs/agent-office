// The idle agents' moves: a greedy 1-ply that takes what's free, keeps its own pieces, likes the
// middle and never misses a mate in one. Enough for a lunch-break game in the lounge.

import { ChessGame, file, rank, type Move, type PieceType } from './engine';
import { store } from '../../state';

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 } as const;
const MATE = 100_000;

/** Shuffles in place with `rng`, so equally good moves don't always come out the same way. */
function shuffle<T>(xs: T[], rng: () => number): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs;
}

/** How the board looks for `me` once it has moved: material, the middle, and whether it's over. */
function score(g: ChessGame, me: 'w' | 'b'): number {
  const mat = material(g, me);
  const status = g.status();
  if (status.over) {
    if (status.reason === 'checkmate') return status.winner === me ? MATE + g.history.length : -MATE;
    // Winning and settling for a draw is throwing the game away.
    return mat > 200 ? -50_000 : 0;
  }
  // Material counted once above; here only the pull toward the middle.
  let n = mat;
  for (let sq = 0; sq < 64; sq++) {
    const p = g.pieces[sq];
    if (!p) continue;
    const v = center(p.t, sq);
    n += p.c === me ? v : -v;
  }
  // A check is worth a nudge: most checks here come with something behind them. (Off the end of
  // the game the opponent is the side to move; `winner` is only set on checkmate, above.)
  if (status.check && g.turn !== me) n += 30;
  return n;
}

/** A nudge toward the middle for the little pieces, so games don't all hug the edges. */
function center(t: PieceType, sq: number): number {
  if (t !== 'p' && t !== 'n') return 0;
  const d = Math.abs(3.5 - file(sq)) + Math.abs(3.5 - rank(sq));
  return (t === 'p' ? 6 : 10) * (7 - d);
}

function material(g: ChessGame, me: 'w' | 'b'): number {
  let n = 0;
  for (const p of g.pieces) {
    if (!p) continue;
    n += p.c === me ? VALUE[p.t] : -VALUE[p.t];
  }
  return n;
}

/** An idle agent (waiting for a first prompt) the chess window offers as an opponent, by name. */
export function idleOpponents(): { id: string; name: string }[] {
  return [...store.workers.values()]
    .filter((w) => w.status === 'idle' && w.kind === 'agent')
    .map((w) => ({ id: w.id, name: w.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The agent's move in `game` (it must be its turn), or undefined when the game is over. */
export function chooseMove(game: ChessGame, rng: () => number = Math.random): Move | undefined {
  const me = game.turn;
  const moves = shuffle(game.allMoves(), rng);
  if (!moves.length) return undefined;
  let best: Move | undefined;
  let bestScore = -Infinity;
  for (const m of moves) {
    const next = game.clone();
    next.play({ from: m.from, to: m.to, promo: m.promo ?? 'q' });
    // It always queens in the tactics below; queening for real is whoever's idea it was.
    const s = score(next, me) + rng() * 8;
    if (s > bestScore) {
      bestScore = s;
      best = m;
    }
  }
  return best;
}
