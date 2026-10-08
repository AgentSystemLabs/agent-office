// The chess tables on the rooftop: who's sitting at each, and the game they're playing.

import type { Color, Promo } from '../chess.js';

/** Who has a chair at a table. */
export interface ChessPlayer {
  id: string;
  name: string;
}

/** How a game ended: someone mated, resigned, or it's a draw. */
export interface ChessEnd {
  kind: 'checkmate' | 'resign' | 'stalemate' | 'insufficient' | 'fifty';
  /** Who won (not for a draw). */
  winner?: Color;
}

/** One table's game, as everyone up on the roof sees it. */
export interface ChessTable {
  /** The table's number, from 1 (see CHESS_TABLES). */
  n: number;
  /** The position, in FEN. */
  fen: string;
  w?: ChessPlayer;
  b?: ChessPlayer;
  /** Half moves played this game (so a page can tell one more move from a whole new game). */
  moves: number;
  /** The squares the last move went from and to. */
  last?: [number, number];
  /** What's been taken so far, as FEN letters (a "P" is a White pawn Black took), in order. */
  taken: string;
  end?: ChessEnd;
}

export type ChessClientMsg =
  /** On arriving up on the roof: send every table's game. */
  | { t: 'chess.sync' }
  /** You've sat in a table's chair (the chair is the side: White's or Black's). */
  | { t: 'chess.join'; table: number; side: Color }
  /** You've got up from it. */
  | { t: 'chess.leave' }
  /** Move a piece (squares count from 0 at a1, see shared/chess.ts); a pawn reaching the last rank becomes `promo`, a queen if it isn't said. */
  | { t: 'chess.move'; table: number; from: number; to: number; promo?: Promo }
  | { t: 'chess.resign'; table: number }
  /** Set the pieces up again, once the game's over (or nothing has been played, or the other chair is empty). */
  | { t: 'chess.new'; table: number };

export type ChessServerMsg =
  /** Every table (to whoever just asked, with chess.sync). */
  | { t: 'chess.tables'; tables: ChessTable[] }
  /** One table changed: someone sat or got up, moved, resigned or started again (to everyone on the roof). */
  | { t: 'chess.table'; table: ChessTable };
