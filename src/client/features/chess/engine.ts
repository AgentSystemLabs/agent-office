// The chess corner's rules: a complete little engine (legal moves with castling, en passant and
// promotion, check, checkmate, stalemate and the draws, with a SAN move list). Pure TypeScript with
// no imports, so the window (ui.ts), the idle-agent opponents (ai.ts) and the tests all share it.

export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export interface Piece {
  c: Color;
  t: PieceType;
}
/** A move: `promo` when a pawn reaches the last rank (always one of q/r/b/n there). */
export interface Move {
  from: number;
  to: number;
  promo?: Exclude<PieceType, 'p' | 'k'>;
}

export const other = (c: Color): Color => (c === 'w' ? 'b' : 'w');
/** Square 0 is a1, 63 is h8: file 0 is the a-file, rank 0 White's home rank. */
export const file = (sq: number): number => sq % 8;
export const rank = (sq: number): number => (sq / 8) | 0;
export const at = (f: number, r: number): number => r * 8 + f;
export const onBoard = (f: number, r: number): boolean => f >= 0 && f < 8 && r >= 0 && r < 8;
export const squareName = (sq: number): string => `${'abcdefgh'[file(sq)]}${rank(sq) + 1}`;

const KNIGHTS: readonly (readonly [number, number])[] = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KINGS: readonly (readonly [number, number])[] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const DIAGONALS: readonly (readonly [number, number])[] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const STRAIGHTS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const QUEEN_DIRS: readonly (readonly [number, number])[] = [...DIAGONALS, ...STRAIGHTS];
const PROMOS: readonly Exclude<PieceType, 'p' | 'k'>[] = ['q', 'r', 'b', 'n'];

/** Each home corner names its side's castling right: leaving it, or taken on it, takes it away. */
const RIGHTS_HOME: Readonly<Record<number, { right: 'K' | 'Q' | 'k' | 'q'; c: Color }>> = {
  7: { right: 'K', c: 'w' },
  0: { right: 'Q', c: 'w' },
  63: { right: 'k', c: 'b' },
  56: { right: 'q', c: 'b' },
};

/** Whether `sq` is attacked by `by` on `b`. */
function attacked(b: readonly (Piece | null)[], sq: number, by: Color): boolean {
  const f = file(sq);
  const r = rank(sq);
  // Pawns: a pawn of `by` one step behind the square, a file to either side.
  const pr = r + (by === 'w' ? -1 : 1);
  for (const df of [-1, 1]) {
    const p = onBoard(f + df, pr) ? b[at(f + df, pr)] : null;
    if (p && p.c === by && p.t === 'p') return true;
  }
  for (const [df, dr] of KNIGHTS) {
    const p = onBoard(f + df, r + dr) ? b[at(f + df, r + dr)] : null;
    if (p && p.c === by && p.t === 'n') return true;
  }
  for (const [df, dr] of KINGS) {
    const p = onBoard(f + df, r + dr) ? b[at(f + df, r + dr)] : null;
    if (p && p.c === by && p.t === 'k') return true;
  }
  for (const [dirs, kinds] of [[DIAGONALS, 'bq'], [STRAIGHTS, 'rq']] as const) {
    for (const [df, dr] of dirs) {
      let g = f + df;
      let h = r + dr;
      while (onBoard(g, h)) {
        const p = b[at(g, h)];
        if (p) {
          if (p.c === by && kinds.includes(p.t)) return true;
          break;
        }
        g += df;
        h += dr;
      }
    }
  }
  return false;
}

export interface GameStatus {
  over: boolean;
  /** Who won, when it's over with a winner. */
  winner?: Color;
  /** Why it's over. */
  reason?: 'checkmate' | 'stalemate' | 'fifty' | 'material' | 'repetition';
  /** The side to move is in check (true of checkmate too). */
  check: boolean;
}

interface HistoryEntry {
  move: Move;
  san: string;
  /** What came off the board, if anything. */
  captured: Piece | null;
  /** Who moved. */
  by: Color;
}

/** A game of chess, from the starting position. */
export class ChessGame {
  pieces: (Piece | null)[] = [];
  turn: Color = 'w';
  /** Castling still allowed: White/Black kingside/queenside. */
  castle = { K: true, Q: true, k: true, q: true };
  /** The square a pawn could take en passant, or -1. */
  ep = -1;
  half = 0;
  full = 1;
  history: HistoryEntry[] = [];
  private counts = new Map<string, number>();

  constructor() {
    this.reset();
  }

  reset(): void {
    const back: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    this.pieces = Array(64).fill(null);
    for (let f = 0; f < 8; f++) {
      this.pieces[at(f, 0)] = { c: 'w', t: back[f] };
      this.pieces[at(f, 1)] = { c: 'w', t: 'p' };
      this.pieces[at(f, 6)] = { c: 'b', t: 'p' };
      this.pieces[at(f, 7)] = { c: 'b', t: back[f] };
    }
    this.turn = 'w';
    this.castle = { K: true, Q: true, k: true, q: true };
    this.ep = -1;
    this.half = 0;
    this.full = 1;
    this.history = [];
    this.counts = new Map([[this.key(), 1]]);
  }

  /** A copy to try moves on (what the AI thinks with): filled directly, no reset to throw away. */
  clone(): ChessGame {
    const g = Object.create(ChessGame.prototype) as ChessGame;
    g.pieces = this.pieces.map((p) => (p ? { ...p } : null));
    g.turn = this.turn;
    g.castle = { ...this.castle };
    g.ep = this.ep;
    g.half = this.half;
    g.full = this.full;
    g.history = [...this.history];
    g.counts = new Map(this.counts);
    return g;
  }

  private kingSquare(b: readonly (Piece | null)[], c: Color): number {
    return b.findIndex((p) => p && p.c === c && p.t === 'k');
  }

  inCheck(c: Color = this.turn): boolean {
    return attacked(this.pieces, this.kingSquare(this.pieces, c), other(c));
  }

  /** Every legal move, or only the piece on `sq`'s. */
  allMoves(): Move[] {
    const out: Move[] = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = this.pieces[sq];
      if (p && p.c === this.turn) out.push(...this.legalFrom(sq));
    }
    return out;
  }

  movesFrom(sq: number): Move[] {
    const p = this.pieces[sq];
    return p && p.c === this.turn ? this.legalFrom(sq) : [];
  }

  /** The pseudo-legal moves of the piece on `sq`, tried and kept when the king stays safe. */
  private legalFrom(sq: number): Move[] {
    return this.pseudo(sq).filter((m) => {
      const b = this.pieces.map((p) => (p ? { ...p } : null));
      applyOn(b, m, this.ep);
      return !attacked(b, this.kingSquare(b, this.turn), other(this.turn));
    });
  }

  /** The moves of the piece on `sq` before checking what they leave the king in. */
  private pseudo(sq: number): Move[] {
    const p = this.pieces[sq];
    if (!p) return [];
    const f = file(sq);
    const r = rank(sq);
    const out: Move[] = [];
    const slide = (dirs: readonly (readonly [number, number])[]) => {
      for (const [df, dr] of dirs) {
        let g = f + df;
        let h = r + dr;
        while (onBoard(g, h)) {
          const q = this.pieces[at(g, h)];
          if (!q) out.push({ from: sq, to: at(g, h) });
          else {
            if (q.c !== p.c) out.push({ from: sq, to: at(g, h) });
            break;
          }
          g += df;
          h += dr;
        }
      }
    };
    if (p.t === 'p') {
      const dir = p.c === 'w' ? 1 : -1;
      const home = p.c === 'w' ? 1 : 6;
      const last = p.c === 'w' ? 7 : 0;
      if (onBoard(f, r + dir) && !this.pieces[at(f, r + dir)]) {
        const to = at(f, r + dir);
        if (r + dir === last) for (const promo of PROMOS) out.push({ from: sq, to, promo });
        else {
          out.push({ from: sq, to });
          if (r === home && !this.pieces[at(f, r + 2 * dir)]) out.push({ from: sq, to: at(f, r + 2 * dir) });
        }
      }
      for (const df of [-1, 1]) {
        if (!onBoard(f + df, r + dir)) continue;
        const to = at(f + df, r + dir);
        const q = this.pieces[to];
        if (q && q.c !== p.c) {
          if (r + dir === last) for (const promo of PROMOS) out.push({ from: sq, to, promo });
          else out.push({ from: sq, to });
        } else if (!q && to === this.ep) out.push({ from: sq, to });
      }
    } else if (p.t === 'n') {
      for (const [df, dr] of KNIGHTS) {
        if (!onBoard(f + df, r + dr)) continue;
        const q = this.pieces[at(f + df, r + dr)];
        if (!q || q.c !== p.c) out.push({ from: sq, to: at(f + df, r + dr) });
      }
    } else if (p.t === 'b') slide(DIAGONALS);
    else if (p.t === 'r') slide(STRAIGHTS);
    else if (p.t === 'q') slide(QUEEN_DIRS);
    else {
      for (const [df, dr] of KINGS) {
        if (!onBoard(f + df, r + dr)) continue;
        const q = this.pieces[at(f + df, r + dr)];
        if (!q || q.c !== p.c) out.push({ from: sq, to: at(f + df, r + dr) });
      }
      // Castling: the rights, a rook still on its corner, empty squares between, and the king
      // neither in check nor crossing it.
      const home = p.c === 'w' ? 0 : 7;
      const foe: Color = other(p.c);
      if (r === home && f === 4) {
        const kingside = p.c === 'w' ? this.castle.K : this.castle.k;
        const queenside = p.c === 'w' ? this.castle.Q : this.castle.q;
        const empty = (s: number) => !this.pieces[s];
        const rookAt = (f: number) => {
          const q = this.pieces[at(f, home)];
          return !!q && q.c === p.c && q.t === 'r';
        };
        if (kingside && rookAt(7) && empty(at(5, home)) && empty(at(6, home)) && !this.kingInCheckOn(this.pieces, p.c, [at(4, home), at(5, home), at(6, home)], foe))
          out.push({ from: sq, to: at(6, home) });
        if (queenside && rookAt(0) && empty(at(3, home)) && empty(at(2, home)) && empty(at(1, home)) && !this.kingInCheckOn(this.pieces, p.c, [at(4, home), at(3, home), at(2, home)], foe))
          out.push({ from: sq, to: at(2, home) });
      }
    }
    return out;
  }

  private kingInCheckOn(b: readonly (Piece | null)[], c: Color, squares: number[], by: Color): boolean {
    return squares.some((s) => attacked(b, s, by));
  }

  /** Plays a legal move, returning its SAN for the move list. Throws when it isn't legal. */
  play(move: Move): string {
    // One legal list for finding the move and naming it; one for the position it leaves.
    const legal = this.allMoves();
    const found = legal.find((m) => m.from === move.from && m.to === move.to && (m.promo ?? 'q') === (move.promo ?? 'q'));
    if (!found) throw new Error(`illegal move ${squareName(move.from)}${squareName(move.to)}`);
    const san = this.sanFor(found, legal);
    const by = this.turn;
    const captured = this.capturedByMove(found);
    const piece = this.pieces[found.from]!;
    applyOn(this.pieces, found, this.ep);
    if (piece.t === 'p' && found.promo) this.pieces[found.to] = { c: by, t: found.promo };
    // The castling rights the move (or the capture) takes away.
    this.rightsAfter(found, piece, captured);
    // The square a pawn could take en passant next: only after a double push, beside it.
    this.ep = piece.t === 'p' && Math.abs(rank(found.to) - rank(found.from)) === 2 ? at(file(found.from), (rank(found.from) + rank(found.to)) / 2) : -1;
    this.half = piece.t === 'p' || captured ? 0 : this.half + 1;
    if (by === 'b') this.full++;
    this.turn = other(by);
    this.history.push({ move: found, san, captured, by });
    const status = this.status(this.allMoves());
    const done = status.over && status.reason === 'checkmate' ? '#' : status.check ? '+' : '';
    const marked = `${san}${done}`;
    this.history[this.history.length - 1].san = marked;
    const n = (this.counts.get(this.key()) ?? 0) + 1;
    this.counts.set(this.key(), n);
    return marked;
  }

  /** What comes off the board for `move`: the piece there, or the pawn behind an en-passant to-square. */
  private capturedByMove(m: Move): Piece | null {
    const piece = this.pieces[m.from]!;
    if (piece.t === 'p' && m.to === this.ep && !this.pieces[m.to]) {
      return this.pieces[at(file(m.to), rank(m.from))];
    }
    return this.pieces[m.to];
  }

  private rightsAfter(m: Move, piece: Piece, captured: Piece | null): void {
    if (piece.t === 'k') {
      if (piece.c === 'w') this.castle.K = this.castle.Q = false;
      else this.castle.k = this.castle.q = false;
    }
    const from = RIGHTS_HOME[m.from];
    if (from && piece.t === 'r' && piece.c === from.c) this.castle[from.right] = false;
    const to = RIGHTS_HOME[m.to];
    if (to && captured?.t === 'r' && captured.c === to.c) this.castle[to.right] = false;
  }

  private sanFor(m: Move, legal?: Move[]): string {
    const piece = this.pieces[m.from]!;
    // Castling has its own name.
    if (piece.t === 'k' && Math.abs(file(m.to) - file(m.from)) === 2) return file(m.to) > file(m.from) ? 'O-O' : 'O-O-O';
    const dest = squareName(m.to);
    const takes = this.capturedByMove(m) ? 'x' : '';
    if (piece.t === 'p') {
      const prefix = takes ? `${'abcdefgh'[file(m.from)]}x` : '';
      const promo = m.promo ? `=${m.promo.toUpperCase()}` : '';
      return `${prefix}${dest}${promo}`;
    }
    const letter = piece.t === 'n' ? 'N' : piece.t.toUpperCase();
    // Two of them could go there: name the file, the rank, or both to tell them apart.
    const others = (legal ?? this.allMoves()).filter((o) => o.to === m.to && o.from !== m.from && this.pieces[o.from]?.t === piece.t);
    let between = '';
    if (others.length) {
      const sameFile = others.some((o) => file(o.from) === file(m.from));
      const sameRank = others.some((o) => rank(o.from) === rank(m.from));
      if (!sameFile) between = 'abcdefgh'[file(m.from)];
      else if (!sameRank) between = String(rank(m.from) + 1);
      else between = squareName(m.from);
    }
    return `${letter}${between}${takes}${dest}`;
  }

  status(legal?: Move[]): GameStatus {
    const check = this.inCheck();
    const moves = legal ?? this.allMoves();
    if (!moves.length) {
      if (check) return { over: true, winner: other(this.turn), reason: 'checkmate', check };
      return { over: true, reason: 'stalemate', check };
    }
    if (this.half >= 100) return { over: true, reason: 'fifty', check };
    if (bareKings(this.pieces)) return { over: true, reason: 'material', check };
    if ((this.counts.get(this.key()) ?? 0) >= 3) return { over: true, reason: 'repetition', check };
    return { over: false, check };
  }

  /** What each side has taken, for the window's captured rows. */
  capturedBy(c: Color): Piece[] {
    return this.history.filter((h) => h.by === c && h.captured).map((h) => h.captured!);
  }

  lastMove(): { from: number; to: number } | null {
    const h = this.history[this.history.length - 1];
    return h ? { from: h.move.from, to: h.move.to } : null;
  }

  moves(): string[] {
    return this.history.map((h) => h.san);
  }

  key(): string {
    const board = this.pieces.map((p) => (p ? `${p.c}${p.t}` : '..')).join('');
    const rights = `${this.castle.K ? 'K' : ''}${this.castle.Q ? 'Q' : ''}${this.castle.k ? 'k' : ''}${this.castle.q ? 'q' : ''}` || '-';
    return `${board}${this.turn}${rights}${this.epKey()}`;
  }

  /**
   * The en-passant square for repetition purposes: only a square some pawn of the side to move
   * could actually take matters (otherwise identical positions would hash differently and a real
   * threefold would be missed).
   */
  private epKey(): string {
    if (this.ep < 0) return '-';
    const f = file(this.ep);
    const r = rank(this.ep);
    const pr = r + (this.turn === 'w' ? -1 : 1);
    for (const df of [-1, 1]) {
      if (!onBoard(f + df, pr)) continue;
      const p = this.pieces[at(f + df, pr)];
      if (p && p.c === this.turn && p.t === 'p') return String(this.ep);
    }
    return '-';
  }
}

/** Whether neither side can possibly mate: bare kings, a lone minor, or bishops on one color each. */
function bareKings(b: readonly (Piece | null)[]): boolean {
  const rest = b.filter((p) => p && p.t !== 'k') as Piece[];
  if (!rest.length) return true;
  if (rest.length === 1 && (rest[0].t === 'b' || rest[0].t === 'n')) return true;
  if (rest.length === 2 && rest[0].c !== rest[1].c && rest[0].t === 'b' && rest[1].t === 'b') {
    const squares = b.flatMap((p, i) => (p && p.t === 'b' ? [i] : []));
    if ((file(squares[0]) + rank(squares[0])) % 2 === (file(squares[1]) + rank(squares[1])) % 2) return true;
  }
  return false;
}

/** Moves the piece on a board copy: plain moves, castling's rook, and en passant's pawn behind. */
function applyOn(b: (Piece | null)[], m: Move, ep: number): void {
  const piece = b[m.from]!;
  if (piece.t === 'k' && Math.abs(file(m.to) - file(m.from)) === 2) {
    const home = rank(m.from);
    const rookFrom = file(m.to) > file(m.from) ? at(7, home) : at(0, home);
    const rookTo = file(m.to) > file(m.from) ? at(5, home) : at(3, home);
    b[rookTo] = b[rookFrom];
    b[rookFrom] = null;
  }
  if (piece.t === 'p' && m.to === ep && !b[m.to]) b[at(file(m.to), rank(m.from))] = null;
  b[m.to] = b[m.from];
  b[m.from] = null;
}
