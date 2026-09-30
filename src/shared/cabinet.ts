// The arcade cabinet in the lounge: what its screen shows while someone plays, shared by the browser
// that plays (which sends it), the office (which passes it on to everyone else on the floor) and the
// browsers that watch. And its high-score table, which is the whole building's (see server/cabinet.ts).

/** The game on the cabinet (see client/features/cabinet/blocks.ts). */
export const GAME = 'BLOCKFALL';
/** The well the blocks fall into: 10 wide, 20 deep. */
export const WELL_COLS = 10;
export const WELL_ROWS = 20;
/** How many games the high-score table keeps. */
export const SCORES_KEPT = 10;
const SCORE_MAX = 99_999_999;
/** Points for clearing 1–4 lines at once, times the level they're cleared on. */
export const CLEAR_POINTS = [0, 100, 300, 500, 800];

/** The level a game is on with `lines` cleared: up one every ten, to 99. */
export function levelFor(lines: number): number {
  return Math.min(99, 1 + Math.floor(lines / 10));
}

export type PlayState = 'play' | 'paused' | 'over';

/** One picture of the cabinet's screen while someone plays. */
export interface CabinetFrame {
  /** The well row by row from the top, a character per cell: '0' empty, '1'–'7' a block's color, '8' where the falling piece will land. */
  cells: string;
  /** The piece that comes next (1–7), and the one put on hold (0 for none). */
  next: number;
  hold: number;
  score: number;
  lines: number;
  level: number;
  /** Pieces landed this game: one more is a thud, for anyone watching. */
  pieces: number;
  state: PlayState;
}

/** A game on the high-score table. */
export interface HighScore {
  /** Which game: the office names each one as it starts (see Arcade in server/cabinet.ts), and its score only ever goes up. */
  game: string;
  name: string;
  color: string;
  score: number;
  lines: number;
  level: number;
  at: number;
}

/** Who's at the cabinet on your floor (and which game they're on), and the building's high scores. */
export interface CabinetState {
  player: { id: string; name: string; game: string } | null;
  scores: HighScore[];
}

/** The cabinet for someone walking onto the floor: its screen too, when a game's on. */
export interface CabinetView extends CabinetState {
  frame: CabinetFrame | null;
}

/** 12,400 */
export function scoreText(n: number): string {
  return n.toLocaleString('en-US');
}

const CELLS_RE = new RegExp(`^[0-8]{${WELL_COLS * WELL_ROWS}}$`);
const GAME_RE = /^[a-z0-9]{8,32}$/;

const int = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null);

/** A frame a browser sent, if it is one. */
export function checkFrame(raw: unknown): CabinetFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const cells = typeof f.cells === 'string' && CELLS_RE.test(f.cells) ? f.cells : null;
  const next = int(f.next, 1, 7);
  const hold = int(f.hold, 0, 7);
  const score = int(f.score, 0, SCORE_MAX);
  const lines = int(f.lines, 0, SCORE_MAX);
  const level = int(f.level, 1, 99);
  const pieces = int(f.pieces, 0, SCORE_MAX);
  const state = f.state === 'play' || f.state === 'paused' || f.state === 'over' ? f.state : null;
  if (cells === null || next === null || hold === null || score === null || lines === null || level === null || pieces === null || !state) return null;
  return { cells, next, hold, score, lines, level, pieces, state };
}

/** A score read back from disk, if it is one. */
export function checkScore(raw: { game?: unknown; score?: unknown; lines?: unknown; level?: unknown }): Pick<HighScore, 'game' | 'score' | 'lines' | 'level'> | null {
  const game = typeof raw.game === 'string' && GAME_RE.test(raw.game) ? raw.game : null;
  const score = int(raw.score, 0, SCORE_MAX);
  const lines = int(raw.lines, 0, SCORE_MAX);
  const level = int(raw.level, 1, 99);
  if (game === null || score === null || lines === null || level === null) return null;
  return { game, score, lines, level };
}
