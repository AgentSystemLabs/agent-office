import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SCORES_KEPT, checkScore, type HighScore } from '../shared/cabinet.js';

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
   * A game's score as it stands. It goes on the table if it's good enough, and the same game again only
   * ever raises its own score (nobody else's). Says whether the table changed, and whether this game
   * just took first place from another one.
   */
  record(s: Omit<HighScore, 'at'>): { changed: boolean; first: boolean } {
    const no = { changed: false, first: false };
    const was = this.list.find((e) => e.game === s.game);
    if (s.score <= 0 || (was && (was.name !== s.name || s.score <= was.score))) return no;
    const leader = this.list[0];
    const next = [...this.list.filter((e) => e !== was), { ...s, at: Date.now() }].sort(byScore).slice(0, SCORES_KEPT);
    if (!next.some((e) => e.game === s.game)) return no;
    this.list = next;
    this.save();
    return { changed: true, first: next[0].game === s.game && leader?.game !== s.game };
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
