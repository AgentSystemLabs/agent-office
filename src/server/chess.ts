// The rooftop's chess tables (see shared/chess-seats.ts): who sits at each, and the game they play.
// Kept in memory, per office: a table goes back to the start when everyone's left it. Every move is
// judged by the shared rules, so a page can only play what's legal, and only on its own turn.
import { START_FEN, outcome, parseFen, playMove, toFen, other, type Color, type Promo } from '../shared/chess.js';
import { CHESS_TABLES } from '../shared/chess-seats.js';
import type { ChessEnd, ChessPlayer, ChessTable } from '../shared/protocol.js';

interface Game {
  fen: string;
  w?: ChessPlayer;
  b?: ChessPlayer;
  moves: number;
  last?: [number, number];
  taken: string;
  end?: ChessEnd;
}

const fresh = (): Game => ({ fen: START_FEN, moves: 0, taken: '' });

export class ChessTables {
  private readonly games = new Map<number, Game>(CHESS_TABLES.map((t) => [t.n, fresh()]));

  has(table: number): boolean {
    return this.games.has(table);
  }

  view(table: number): ChessTable {
    const g = this.games.get(table)!;
    return { n: table, ...g };
  }

  all(): ChessTable[] {
    return [...this.games.keys()].map((n) => this.view(n));
  }

  /** The table and side `id` is sitting at, if they're at one. */
  seatOf(id: string): { table: number; side: Color } | undefined {
    for (const [table, g] of this.games) for (const side of ['w', 'b'] as const) if (g[side]?.id === id) return { table, side };
  }

  /** Takes a chair. Returns what's wrong, or undefined when it's theirs; the tables that changed are in `changed`. */
  join(table: number, side: Color, who: ChessPlayer, changed: Set<number>): string | undefined {
    const g = this.games.get(table);
    if (!g) return 'There is no such table';
    if (g[side] && g[side]!.id !== who.id) return `${g[side]!.name} is sitting there`;
    if (g[side]?.id === who.id) return undefined;
    // One chair at a time.
    this.leave(who.id, changed);
    g[side] = who;
    changed.add(table);
    return undefined;
  }

  /** Gets up from whichever chair `id` is in. The game stays as it is for whoever sits there next, unless the table's empty. */
  leave(id: string, changed: Set<number>) {
    const at = this.seatOf(id);
    if (!at) return;
    const g = this.games.get(at.table)!;
    delete g[at.side];
    if (!g.w && !g.b) this.games.set(at.table, fresh());
    changed.add(at.table);
  }

  /** `id` plays `from` to `to` at `table`. Returns what's wrong, or undefined once it's played. */
  move(id: string, table: number, from: number, to: number, promo: Promo | undefined): string | undefined {
    const at = this.seatOf(id);
    const g = this.games.get(table);
    if (!g || at?.table !== table) return "You aren't playing at that table";
    if (g.end) return 'The game is over';
    if (!g.w || !g.b) return 'Waiting for an opponent';
    const state = parseFen(g.fen)!;
    if (state.turn !== at.side) return "It isn't your move";
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 63 || to < 0 || to > 63) return 'That move is not allowed';
    const played = playMove(state, from, to, promo);
    if (!played) return 'That move is not allowed';
    g.fen = toFen(played.state);
    g.moves++;
    g.last = [from, to];
    g.taken += played.captured;
    const done = outcome(played.state);
    if (done.over) g.end = done.kind === 'checkmate' ? { kind: 'checkmate', winner: done.winner } : { kind: done.kind };
    return undefined;
  }

  resign(id: string, table: number): string | undefined {
    const at = this.seatOf(id);
    const g = this.games.get(table);
    if (!g || at?.table !== table) return "You aren't playing at that table";
    if (g.end || !g.moves) return 'There is no game to resign';
    g.end = { kind: 'resign', winner: other(at.side) };
    return undefined;
  }

  /** Sets the pieces up again: once the game's over, before anything's been played, or with nobody in the other chair. */
  newGame(id: string, table: number): string | undefined {
    const at = this.seatOf(id);
    const g = this.games.get(table);
    if (!g || at?.table !== table) return "You aren't playing at that table";
    if (!g.end && g.moves && g.w && g.b) return 'Finish the game first (or resign)';
    this.games.set(table, { ...fresh(), w: g.w, b: g.b });
    return undefined;
  }
}
