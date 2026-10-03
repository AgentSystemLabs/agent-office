// Chess, for the 'Merge Conflict' tables on the rooftop (features/chess, server/chess.ts): the board
// and its rules, as pure code the server judges every move with and the page uses to show where a
// piece may go. A position is a ChessState, which round-trips through FEN (toFen / parseFen).

export type Color = 'w' | 'b';
/** What a pawn becomes on the last rank. */
export type Promo = 'q' | 'r' | 'b' | 'n';

/**
 * A position. Squares count from 0 at a1 along each rank: 8 is a2, 63 is h8. `board` has a FEN letter
 * for each (capitals for White) or '' for an empty one, and `castling` the FEN rights ("KQkq", "-" for none).
 * `ep` is the square a pawn that just moved two could be taken on (-1 for none).
 */
export interface ChessState {
  board: string[];
  turn: Color;
  castling: string;
  ep: number;
  /** Moves since a pawn moved or something was taken (the fifty-move rule counts these). */
  halfmove: number;
  fullmove: number;
}

export interface Move {
  from: number;
  to: number;
  /** For a pawn reaching the last rank: what it becomes. */
  promo?: Promo;
}

export type Outcome =
  | { over: false }
  | { over: true; kind: 'checkmate'; winner: Color }
  | { over: true; kind: 'stalemate' | 'insufficient' | 'fifty' };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILES = 'abcdefgh';
export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => sq >> 3;
export const squareAt = (file: number, rank: number) => rank * 8 + file;
export const squareName = (sq: number) => `${FILES[fileOf(sq)]}${rankOf(sq) + 1}`;
/** "e4" is 28; -1 for anything that isn't a square. */
export function parseSquare(name: string): number {
  const m = /^([a-h])([1-8])$/.exec(name);
  return m ? squareAt(FILES.indexOf(m[1]), Number(m[2]) - 1) : -1;
}

/** Whose piece a FEN letter is (null for an empty square). */
export const colorOf = (piece: string): Color | null => (!piece ? null : piece === piece.toUpperCase() ? 'w' : 'b');
export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function parseFen(fen: string): ChessState | null {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const rows = parts[0].split('/');
  if (rows.length !== 8) return null;
  const board: string[] = new Array(64).fill('');
  for (let i = 0; i < 8; i++) {
    let file = 0;
    for (const ch of rows[i]) {
      if (/[1-8]/.test(ch)) file += Number(ch);
      else if (/[pnbrqkPNBRQK]/.test(ch) && file < 8) board[squareAt(file++, 7 - i)] = ch;
      else return null;
    }
    if (file !== 8) return null;
  }
  if (parts[1] !== 'w' && parts[1] !== 'b') return null;
  if (!/^(-|K?Q?k?q?)$/.test(parts[2])) return null;
  const ep = parts[3] === '-' ? -1 : parseSquare(parts[3]);
  if (parts[3] !== '-' && ep < 0) return null;
  const s: ChessState = { board, turn: parts[1], castling: parts[2], ep, halfmove: Number(parts[4] ?? 0) || 0, fullmove: Number(parts[5] ?? 1) || 1 };
  // One king each, or there is nothing to judge a move by.
  if (board.filter((p) => p === 'K').length !== 1 || board.filter((p) => p === 'k').length !== 1) return null;
  return s;
}

export function toFen(s: ChessState): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let gap = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.board[squareAt(f, r)];
      if (!p) gap++;
      else {
        if (gap) row += gap;
        gap = 0;
        row += p;
      }
    }
    rows.push(row + (gap || ''));
  }
  return `${rows.join('/')} ${s.turn} ${s.castling || '-'} ${s.ep < 0 ? '-' : squareName(s.ep)} ${s.halfmove} ${s.fullmove}`;
}

export const startState = (): ChessState => parseFen(START_FEN)!;

// ---- Attacks and moves -----------------------------------------------------------------------------

const KNIGHT: readonly (readonly [number, number])[] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const DIAGONAL: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const STRAIGHT: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const AROUND = [...DIAGONAL, ...STRAIGHT];
const PROMOS: readonly Promo[] = ['q', 'r', 'b', 'n'];

/** Whether any of `by`'s pieces attacks `sq`. */
function attacked(board: readonly string[], sq: number, by: Color): boolean {
  const f = fileOf(sq);
  const r = rankOf(sq);
  const own = (p: string, letter: string) => p === (by === 'w' ? letter.toUpperCase() : letter);
  const at = (df: number, dr: number) => {
    const nf = f + df;
    const nr = r + dr;
    return nf < 0 || nf > 7 || nr < 0 || nr > 7 ? undefined : board[squareAt(nf, nr)];
  };
  // A pawn attacks one rank on from itself, so it's one back from `sq` that it stands.
  const back = by === 'w' ? -1 : 1;
  for (const df of [-1, 1]) if (at(df, back) !== undefined && own(at(df, back)!, 'p')) return true;
  for (const [df, dr] of KNIGHT) if (at(df, dr) !== undefined && own(at(df, dr)!, 'n')) return true;
  for (const [df, dr] of AROUND) if (at(df, dr) !== undefined && own(at(df, dr)!, 'k')) return true;
  for (const [dirs, a, b] of [[DIAGONAL, 'b', 'q'], [STRAIGHT, 'r', 'q']] as const) {
    for (const [df, dr] of dirs) {
      for (let n = 1; ; n++) {
        const p = at(df * n, dr * n);
        if (p === undefined) break;
        if (!p) continue;
        if (own(p, a) || own(p, b)) return true;
        break;
      }
    }
  }
  return false;
}

export function kingSquare(s: ChessState, color: Color): number {
  return s.board.indexOf(color === 'w' ? 'K' : 'k');
}

/** Whether `color` (whoever's turn it is, by default) is in check. */
export function inCheck(s: ChessState, color: Color = s.turn): boolean {
  return attacked(s.board, kingSquare(s, color), other(color));
}

/** Every move the side to move could make if leaving its king in check were allowed (castling still can't pass through it). */
function pseudoMoves(s: ChessState, only?: number): Move[] {
  const out: Move[] = [];
  const me = s.turn;
  const enemy = other(me);
  const { board } = s;
  for (let from = 0; from < 64; from++) {
    if (only !== undefined && from !== only) continue;
    const piece = board[from];
    if (!piece || colorOf(piece) !== me) continue;
    const f = fileOf(from);
    const r = rankOf(from);
    const kind = piece.toLowerCase();
    const add = (to: number) => out.push({ from, to });
    // Onto an empty square or an enemy's: false once something's in the way, for sliders.
    const step = (df: number, dr: number): boolean => {
      const nf = f + df;
      const nr = r + dr;
      if (nf < 0 || nf > 7 || nr < 0 || nr > 7) return false;
      const to = squareAt(nf, nr);
      const there = board[to];
      if (there && colorOf(there) === me) return false;
      add(to);
      return !there;
    };
    if (kind === 'p') {
      const dir = me === 'w' ? 1 : -1;
      const last = me === 'w' ? 7 : 0;
      const push = (to: number) => {
        if (rankOf(to) === last) for (const promo of PROMOS) out.push({ from, to, promo });
        else add(to);
      };
      const ahead = squareAt(f, r + dir);
      if (!board[ahead]) {
        push(ahead);
        if (r === (me === 'w' ? 1 : 6) && !board[squareAt(f, r + 2 * dir)]) add(squareAt(f, r + 2 * dir));
      }
      for (const df of [-1, 1]) {
        if (f + df < 0 || f + df > 7) continue;
        const to = squareAt(f + df, r + dir);
        if ((board[to] && colorOf(board[to]) === enemy) || to === s.ep) push(to);
      }
    } else if (kind === 'n') {
      for (const [df, dr] of KNIGHT) step(df, dr);
    } else if (kind === 'k') {
      for (const [df, dr] of AROUND) step(df, dr);
      castles(s, from, add);
    } else {
      const dirs = kind === 'b' ? DIAGONAL : kind === 'r' ? STRAIGHT : AROUND;
      for (const [df, dr] of dirs) for (let n = 1; step(df * n, dr * n); n++);
    }
  }
  return out;
}

/** The king's castling moves, if he may: unmoved, not in check, nothing between him and the rook, and not through an attacked square. */
function castles(s: ChessState, from: number, add: (to: number) => void) {
  const me = s.turn;
  const home = me === 'w' ? 4 : 60;
  if (from !== home) return;
  const enemy = other(me);
  const { board } = s;
  const rook = me === 'w' ? 'R' : 'r';
  const rights = me === 'w' ? 'KQ' : 'kq';
  if (!rights.split('').some((c) => s.castling.includes(c)) || attacked(board, home, enemy)) return;
  if (s.castling.includes(rights[0]) && board[home + 3] === rook && !board[home + 1] && !board[home + 2] && !attacked(board, home + 1, enemy) && !attacked(board, home + 2, enemy)) add(home + 2);
  if (s.castling.includes(rights[1]) && board[home - 4] === rook && !board[home - 1] && !board[home - 2] && !board[home - 3] && !attacked(board, home - 1, enemy) && !attacked(board, home - 2, enemy)) add(home - 2);
}

/** What taking a move does to the castling rights: a king or rook moving, or a rook being taken, loses them. */
function rightsAfter(rights: string, from: number, to: number): string {
  let out = rights;
  for (const sq of [from, to]) {
    if (sq === 4) out = out.replace(/[KQ]/g, '');
    if (sq === 60) out = out.replace(/[kq]/g, '');
    if (sq === 0) out = out.replace('Q', '');
    if (sq === 7) out = out.replace('K', '');
    if (sq === 56) out = out.replace('q', '');
    if (sq === 63) out = out.replace('k', '');
  }
  return out || '-';
}

/** The position after `m`, which must be one of legalMoves (or at least a move the rules allow: nothing here checks). */
export function applyMove(s: ChessState, m: Move): ChessState {
  const board = s.board.slice();
  const piece = board[m.from];
  const kind = piece.toLowerCase();
  const me = s.turn;
  const taken = board[m.to];
  board[m.from] = '';
  board[m.to] = m.promo ? (me === 'w' ? m.promo.toUpperCase() : m.promo) : piece;
  let ep = -1;
  if (kind === 'p') {
    // Took en passant: the pawn it passed is a rank behind where this one lands.
    if (m.to === s.ep && !taken) board[squareAt(fileOf(m.to), rankOf(m.from))] = '';
    if (Math.abs(rankOf(m.to) - rankOf(m.from)) === 2) ep = (m.from + m.to) / 2;
  } else if (kind === 'k' && Math.abs(m.to - m.from) === 2) {
    // Castled: the rook hops over.
    const rank = rankOf(m.from) * 8;
    const long = m.to < m.from;
    board[rank + (long ? 3 : 5)] = board[rank + (long ? 0 : 7)];
    board[rank + (long ? 0 : 7)] = '';
  }
  return {
    board,
    turn: other(me),
    castling: rightsAfter(s.castling, m.from, m.to),
    ep,
    halfmove: kind === 'p' || taken ? 0 : s.halfmove + 1,
    fullmove: s.fullmove + (me === 'b' ? 1 : 0),
  };
}

/** Every legal move for the side to move, or just from `from`. A promotion comes once for each piece it may become. */
export function legalMoves(s: ChessState, from?: number): Move[] {
  const me = s.turn;
  return pseudoMoves(s, from).filter((m) => !attacked(applyMove(s, m).board, kingSquare(s, me) === m.from ? m.to : kingSquare(s, me), other(me)));
}

export interface Played {
  state: ChessState;
  move: Move;
  /** The FEN letter of what it took, or '' (an en passant capture counts). */
  captured: string;
}

/**
 * `from` to `to` if that's legal: the position after it, and what it took. A pawn that reaches the
 * last rank becomes `promo`, a queen if it isn't said.
 */
export function playMove(s: ChessState, from: number, to: number, promo?: Promo): Played | null {
  const moves = legalMoves(s, from).filter((m) => m.to === to);
  if (!moves.length) return null;
  const move = moves.find((m) => (m.promo ?? 'q') === (promo ?? 'q'));
  if (!move) return null;
  const passed = s.board[move.from].toLowerCase() === 'p' && move.to === s.ep && !s.board[move.to];
  return { state: applyMove(s, move), move, captured: passed ? (s.turn === 'w' ? 'p' : 'P') : s.board[move.to] };
}

// ---- How it ends -----------------------------------------------------------------------------------

/** No one could checkmate from what's left: bare kings, a king and one minor piece, or bishops all on one color of square. */
export function insufficientMaterial(s: ChessState): boolean {
  const rest = s.board.map((p, sq) => ({ kind: p.toLowerCase(), sq })).filter((p) => p.kind && p.kind !== 'k');
  if (rest.every((p) => p.kind === 'b' || p.kind === 'n') && rest.length <= 1) return true;
  return rest.length > 0 && rest.every((p) => p.kind === 'b') && new Set(rest.map((p) => (fileOf(p.sq) + rankOf(p.sq)) % 2)).size === 1;
}

export function outcome(s: ChessState): Outcome {
  if (!legalMoves(s).length) return inCheck(s) ? { over: true, kind: 'checkmate', winner: other(s.turn) } : { over: true, kind: 'stalemate' };
  if (insufficientMaterial(s)) return { over: true, kind: 'insufficient' };
  if (s.halfmove >= 100) return { over: true, kind: 'fifty' };
  return { over: false };
}

/** How many ways there are to play `depth` moves from `s` (a check on the move generator: the counts are well known). */
export function perft(s: ChessState, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(s);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(applyMove(s, m), depth - 1);
  return n;
}
