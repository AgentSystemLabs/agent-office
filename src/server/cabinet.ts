import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SCORES_KEPT, WELL_ROWS, checkScore, type CabinetFrame, type HighScore } from '../shared/cabinet.js';

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

/** The fastest a game lands pieces, per second of play, and how many it can land in a burst on top of that. */
export const PIECES_PER_SECOND = 6;
export const PIECE_BURST = 15;
/**
 * The most a piece scores on its way down: the one before it soft-dropped the whole well (a point a
 * row) and then held, and this one hard-dropped the whole well (2 a row).
 */
export const DROP_POINTS = 3 * (WELL_ROWS + 2);
/** The most a cleared line scores, times the level: four at once is 800. */
export const LINE_POINTS = 200;
/** The high-score table changes (arcade.json written, every floor told) at most this often, in ms. */
export const RECORD_EVERY = 2000;
/** Games kept waiting for their players to come back to them, at most. */
const GAMES_KEPT = 100;

/** Whose game it is (an account, or a name on the shared password) and how it shows on the table. */
export interface Player {
  owner: string;
  name: string;
  color: string;
}

interface Game extends Player {
  id: string;
  /** From its last frame that added up. */
  score: number;
  lines: number;
  level: number;
  pieces: number;
  /** The most its cleared lines could have scored between them. */
  clears: number;
  /** Pieces it can still land: this refills at PIECES_PER_SECOND while it's played, up to PIECE_BURST. */
  budget: number;
  /** When `budget` was last topped up, while it's being played; null while it waits for its player. */
  since: number | null;
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
 * cleared more lines than its pieces could fill or scored more than they (and the lines) could, and
 * its pieces came no faster than PIECES_PER_SECOND of play, give or take a PIECE_BURST. A game with a
 * frame that doesn't add up never goes on the table again. However many games end at once, the table
 * changes at most every RECORD_EVERY ms.
 */
export class Arcade {
  private readonly games = new Map<string, Game>();
  /** Scores waiting to go on the table, by game, with the floor each was played on. */
  private readonly pending = new Map<string, { score: Omit<HighScore, 'at'>; floor: string }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private recordedAt = -Infinity;

  constructor(
    private readonly table: HighScores,
    /** The table changed. `first` is a game that just took first place, and the floor it was played on. */
    private readonly changed: (first: { score: HighScore; floor: string } | null) => void,
  ) {}

  /** `player` steps up to the cabinet: back to game `resume` if it's theirs and waiting for them, else a new game. Says which. */
  start(player: Player, resume?: unknown): string {
    const now = Date.now();
    const was = typeof resume === 'string' ? this.games.get(resume) : undefined;
    if (was && was.owner === player.owner && was.since === null) {
      was.since = now;
      // Played again: the last to go when there are too many.
      this.games.delete(was.id);
      this.games.set(was.id, was);
      return was.id;
    }
    this.prune();
    const id = randomBytes(8).toString('hex');
    this.games.set(id, { ...player, id, score: 0, lines: 0, level: 1, pieces: 0, clears: 0, budget: PIECE_BURST, since: now, offered: 0 });
    return id;
  }

  /** A frame from the player of game `id`, on `floor`. A game's last frame puts its score up for the table. */
  frame(id: string | undefined, f: CabinetFrame, floor: string): Verdict {
    const g = id === undefined ? undefined : this.games.get(id);
    if (!g || g.since === null) return 'none';
    this.refill(g);
    const pieces = f.pieces - g.pieces;
    const lines = f.lines - g.lines;
    const clears = g.clears + lines * LINE_POINTS * f.level;
    const adds =
      pieces >= 0 &&
      lines >= 0 &&
      f.score >= g.score &&
      pieces <= g.budget &&
      lines <= pieces * 4 &&
      f.lines * 10 <= f.pieces * 4 &&
      f.level === Math.min(99, 1 + Math.floor(f.lines / 10)) &&
      f.score <= DROP_POINTS * (f.pieces + 1) + clears;
    if (!adds) {
      this.games.delete(g.id);
      return 'void';
    }
    Object.assign(g, { score: f.score, lines: f.lines, level: f.level, pieces: f.pieces, clears, budget: g.budget - pieces });
    if (f.state === 'over') {
      this.offer(g, floor);
      this.games.delete(g.id);
    }
    return 'ok';
  }

  /** The player of game `id` stepped away from it on `floor` (or left the office): it waits for them, with its score so far up for the table. */
  leave(id: string | undefined, floor: string) {
    const g = id === undefined ? undefined : this.games.get(id);
    if (!g || g.since === null) return;
    this.refill(g);
    g.since = null;
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

  private refill(g: Game) {
    if (g.since === null) return;
    const now = Date.now();
    g.budget = Math.min(PIECE_BURST, g.budget + ((now - g.since) / 1000) * PIECES_PER_SECOND);
    g.since = now;
  }

  private offer(g: Game, floor: string) {
    if (g.score <= g.offered) return;
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
      if (g.since === null) this.games.delete(g.id);
    }
  }
}
