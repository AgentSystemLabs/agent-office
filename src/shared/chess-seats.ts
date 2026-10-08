// Where the rooftop's three chess tables stand, and the two chairs at each: the 'Merge Conflict' games
// corner, in the old DJ stage's spot (see features/chess). Add CHESS_SEATS to SEATING in layout.ts:
// the server only lets someone sit on a seat it knows of, and the chess table seats whoever sits there.
import type { SeatDef } from './layout.js';
import type { Color } from './chess.js';

/** The tables, numbered from 1, each standing at (x, z) with White's chair on its south side and Black's on its north. */
export const CHESS_TABLES: readonly { n: number; x: number; z: number }[] = [
  { n: 1, x: -7, z: -7.5 },
  { n: 2, x: -4, z: -7.5 },
  { n: 3, x: -1, z: -7.5 },
];
/** How far a chair stands from its table's middle. */
export const CHESS_CHAIR = 0.78;

export const chessSeatId = (table: number, side: Color) => `roof-chess-${table}-${side}`;
/** What a peer's `seat` says while they're in that chair (see SeatPlace.key). */
export const chessSeatKey = (table: number, side: Color) => `${chessSeatId(table, side)}:0`;
/** Which table and side a seat id is, if it's one of the chess chairs. */
export function chessSeatOf(seatId: string | undefined): { table: number; side: Color } | undefined {
  const m = /^roof-chess-(\d+)-([wb])$/.exec(seatId ?? '');
  return m ? { table: Number(m[1]), side: m[2] as Color } : undefined;
}

/** The chairs, in the shape of SEATING's entries: White faces north at the table's south side, Black faces south. */
export const CHESS_SEATS: SeatDef[] = CHESS_TABLES.flatMap(({ n, x, z }) =>
  (['w', 'b'] as const).map((side) => ({
    id: chessSeatId(n, side),
    label: side === 'w' ? '♟️ Chess chair (White)' : '♟️ Chess chair (Black)',
    x,
    y: 0,
    z: z + (side === 'w' ? CHESS_CHAIR : -CHESS_CHAIR),
    rotY: side === 'w' ? Math.PI : 0,
    places: [0],
    hips: 0.5,
    depth: 0,
    out: -0.8,
    roof: true,
  })),
);
