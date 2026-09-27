import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CLEAR_POINTS, SCORES_KEPT, WELL_ROWS, checkScore, levelFor, type CabinetFrame, type HighScore } from '../shared/cabinet.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Best first; of two the same, the one that got there first. */
const byScore = (a: HighScore, b: HighScore) => b.score - a.score || a.at - b.at;

/**
 * The arcade's high-score table: one for the whole building, on every floor's cabinet, saved in the
 * office's .agent-office/arcade.json so it's still there after a restart.
 */
export class HighScores {
  private list: HighScore[] = [];
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'arcade.json');
    this.load();
  }

  top(): HighScore[] {
    return this.list;
  }

  /**
   * Games' scores as they stand, saved together. Each goes on the table if it's good enough, and the
   * same game again only ever raises its own score (nobody else's). Says whether the table changed,
   * and which game just took first place from another one, if one did.
   */
  record(...scores: Omit<HighScore, 'at'>[]): { changed: boolean; first: HighScore | null } {
    const leader = this.list[0];
    let next = this.list;
    for (const s of scores) {
      const was = next.find((e) => e.game === s.game);
      if (s.score <= 0 || (was && (was.name !== s.name || s.score <= was.score))) continue;
      const after = [...next.filter((e) => e !== was), { ...s, at: Date.now() }].sort(byScore).slice(0, SCORES_KEPT);
      if (after.some((e) => e.game === s.game)) next = after;
    }
    if (next === this.list) return { changed: false, first: null };
    this.list = next;
    this.save();
    const first = next[0].game !== leader?.game && scores.some((s) => s.game === next[0].game) ? next[0] : null;
    return { changed: true, first };
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      if (!Array.isArray(saved)) return;
      for (const e of saved as Partial<HighScore>[]) {
        const s = e && typeof e === 'object' ? checkScore(e) : null;
        if (!s || typeof e.name !== 'string' || !e.name || typeof e.at !== 'number' || !Number.isFinite(e.at)) continue;
        this.list.push({ ...s, name: e.name.slice(0, 24), color: typeof e.color === 'string' && COLOR_RE.test(e.color) ? e.color : '#4f86f7', at: e.at });
      }
      this.list = this.list.sort(byScore).slice(0, SCORES_KEPT);
    } catch {
      // a broken file just means a fresh table
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.list, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}

/**
 * The fastest a player lands pieces, per second, over all their games: about as fast as anyone keeps
 * it up on these keys (a line a second, if every one went in a four-line clear). And how many more
 * they can land in a burst on top of that.
 */
export const PIECES_PER_SECOND = 2.5;
export const PIECE_BURST = 10;
/** New games a player can start in a row that go on the table, and how often (ms) another one can after that. */
export const GAME_BURST = 3;
export const GAME_EVERY = 20_000;
/**
 * The most a piece scores on its way down: the one before it soft-dropped the whole well (a point a
 * row) and then held, and this one hard-dropped the whole well (2 a row).
 */
export const DROP_POINTS = 3 * (WELL_ROWS + 2);
/** The high-score table changes (arcade.json written, every floor told) at most this often, in ms. */
export const RECORD_EVERY = 2000;
/** Games kept waiting for their players to come back to them, at most. */
const GAMES_KEPT = 100;
/** Players an Allowance keeps track of before it forgets the ones back to a full allowance. */
const PLAYERS_KEPT = 256;

/** Whose game it is (an account, or a name on the shared password) and how it shows on the table. */
export interface Player {
  owner: string;
  name: string;
  color: string;
  /** The connection it's played over: a new name on it is the same player to the office. */
  connection?: string;
}

/**
 * The most `lines` lines can score, cleared by `pieces` pieces landing after `before` lines: each
 * landing clears up to four at once, for their CLEAR_POINTS times the level it's on then. -Infinity
 * if that many pieces can't clear that many lines.
 */
export function clearPoints(before: number, lines: number, pieces: number): number {
  if (!lines) return 0;
  if (lines > pieces * 4) return -Infinity;
  // most[n]: the most the first n of the lines score, cleared in `landings` landings exactly.
  let most = [0, ...new Array<number>(lines).fill(-Infinity)];
  let best = -Infinity;
  for (let landings = 1; landings <= Math.min(pieces, lines); landings++) {
    const was = most;
    most = was.map((_, n) => {
      let m = -Infinity;
      for (let k = 1; k <= Math.min(4, n); k++) m = Math.max(m, was[n - k] + CLEAR_POINTS[k] * levelFor(before + n - k));
      return m;
    });
    best = Math.max(best, most[lines]);
  }
  return best;
}

/**
 * Something a player can only do so often: `burst` times in a row, and then again as it comes back
 * at `perSecond`. It's kept under each thing they go by (their account or name, and their
 * connection), so a new game, a new name or a new connection doesn't start them over.
 */
class Allowance {
  private readonly used = new Map<string, { left: number; at: number }>();

  constructor(
    private readonly burst: number,
    private readonly perSecond: number,
  ) {}

  /** What's left for the player going by `keys`: the least under any of them. */
  left(keys: readonly string[]): number {
    const now = Date.now();
    return Math.min(...keys.map((k) => this.leftAt(k, now)));
  }

  take(keys: readonly string[], n: number) {
    if (!n) return;
    const now = Date.now();
    for (const k of keys) this.used.set(k, { left: this.leftAt(k, now) - n, at: now });
    // Anyone back to a full allowance is the same as someone never seen.
    if (this.used.size > PLAYERS_KEPT) for (const k of [...this.used.keys()]) if (this.leftAt(k, now) >= this.burst) this.used.delete(k);
  }

  private leftAt(key: string, now: number): number {
    const u = this.used.get(key);
    return u ? Math.min(this.burst, u.left + ((now - u.at) / 1000) * this.perSecond) : this.burst;
  }
}

interface Game extends Player {
  id: string;
  /** What its player goes by, for their allowances. */
  keys: string[];
  /** From its last frame that added up. */
  score: number;
  lines: number;
  level: number;
  pieces: number;
  /** The most its cleared lines could have scored between them. */
  clears: number;
  /** Someone's at it; otherwise it waits for its player to come back to it. */
  playing: boolean;
  /** One too many new games in a row: it's followed like any other, but it never goes on the table. */
  counts: boolean;
  /** The score last put up for the table. */
  offered: number;
}

/** What the office made of a frame: it added up, it didn't (and its game is off the table for good), or there's no game of theirs to follow. */
export type Verdict = 'ok' | 'void' | 'none';

/**
 * The office's side of the arcade. It starts every game, follows each one frame by frame and puts
 * the scores on the high-score table itself, so a browser can't post a score it didn't play for.
 *
 * A frame adds up when nothing in it went down, its level is the one its lines make, it hasn't
 * cleared more lines than its pieces could fill or scored more than they (and the lines, cleared
 * the best way they could have been) could, and its player has landed no more pieces than
 * PIECES_PER_SECOND lets them, give or take a PIECE_BURST, across all their games. A game with a
 * frame that doesn't add up never goes on the table again, and nor does one started after GAME_BURST
 * others in a row. However many games end at once, the table changes at most every RECORD_EVERY ms.
 */
export class Arcade {
  private readonly games = new Map<string, Game>();
  /** Scores waiting to go on the table, by game, with the floor each was played on. */
  private readonly pending = new Map<string, { score: Omit<HighScore, 'at'>; floor: string }>();
  private readonly pieces = new Allowance(PIECE_BURST, PIECES_PER_SECOND);
  private readonly starts = new Allowance(GAME_BURST, 1000 / GAME_EVERY);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recordedAt = -Infinity;

  constructor(
    private readonly table: HighScores,
    /** The table changed. `first` is a game that just took first place, and the floor it was played on. */
    private readonly changed: (first: { score: HighScore; floor: string } | null) => void,
  ) {}

  /** `player` steps up to the cabinet: back to game `resume` if it's theirs and waiting for them, else a new game. Says which. */
  start(player: Player, resume?: unknown): string {
    const keys = [player.owner, ...(player.connection ? [`connection:${player.connection}`] : [])];
    const was = typeof resume === 'string' ? this.games.get(resume) : undefined;
    if (was && was.owner === player.owner && !was.playing) {
      was.playing = true;
      was.keys = keys;
      // Played again: the last to go when there are too many.
      this.games.delete(was.id);
      this.games.set(was.id, was);
      return was.id;
    }
    this.prune();
    const id = randomBytes(8).toString('hex');
    const counts = this.starts.left(keys) >= 1;
    if (counts) this.starts.take(keys, 1);
    this.games.set(id, { ...player, id, keys, score: 0, lines: 0, level: 1, pieces: 0, clears: 0, playing: true, counts, offered: 0 });
    return id;
  }

  /** Whether game `id` can go on the table: false for one started after too many others in a row (and one that's gone). */
  counts(id: string | undefined): boolean {
    return !!(id && this.games.get(id)?.counts);
  }

  /** A frame from the player of game `id`, on `floor`. A game's last frame puts its score up for the table. */
  frame(id: string | undefined, f: CabinetFrame, floor: string): Verdict {
    const g = id === undefined ? undefined : this.games.get(id);
    if (!g || !g.playing) return 'none';
    const pieces = f.pieces - g.pieces;
    const lines = f.lines - g.lines;
    const adds =
      pieces >= 0 &&
      lines >= 0 &&
      f.score >= g.score &&
      pieces <= this.pieces.left(g.keys) &&
      f.lines * 10 <= f.pieces * 4 &&
      f.level === levelFor(f.lines);
    const clears = adds ? g.clears + clearPoints(g.lines, lines, pieces) : -Infinity;
    if (!adds || f.score > DROP_POINTS * (f.pieces + 1) + clears) {
      this.games.delete(g.id);
      return 'void';
    }
    this.pieces.take(g.keys, pieces);
    Object.assign(g, { score: f.score, lines: f.lines, level: f.level, pieces: f.pieces, clears });
    if (f.state === 'over') {
      this.offer(g, floor);
      this.games.delete(g.id);
    }
    return 'ok';
  }

  /** The player of game `id` stepped away from it on `floor` (or left the office): it waits for them, with its score so far up for the table. */
  leave(id: string | undefined, floor: string) {
    const g = id === undefined ? undefined : this.games.get(id);
    if (!g || !g.playing) return;
    g.playing = false;
    this.offer(g, floor);
  }

  /** Puts the scores waiting on the table now. */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.pending.size) return;
    this.recordedAt = Date.now();
    const waiting = [...this.pending.values()];
    this.pending.clear();
    const { changed, first } = this.table.record(...waiting.map((w) => w.score));
    if (changed) this.changed(first && { score: first, floor: waiting.find((w) => w.score.game === first.game)!.floor });
  }

  private offer(g: Game, floor: string) {
    if (!g.counts || g.score <= g.offered) return;
    g.offered = g.score;
    this.pending.set(g.id, { score: { game: g.id, name: g.name, color: g.color, score: g.score, lines: g.lines, level: g.level }, floor });
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), Math.max(0, this.recordedAt + RECORD_EVERY - Date.now()));
    this.timer.unref?.();
  }

  /** Makes room for a new game, by dropping the ones left waiting longest. */
  private prune() {
    for (const g of this.games.values()) {
      if (this.games.size < GAMES_KEPT) return;
      if (!g.playing) this.games.delete(g.id);
    }
  }
}
