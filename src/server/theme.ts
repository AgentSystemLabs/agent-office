import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ThemePick, ThemeState } from '../shared/protocol.js';
import { activeTheme, isThemePick } from '../shared/theme.js';

/** How often 'auto' looks at the calendar again, so October 1st turns the pumpkins on by itself. */
const CHECK_MS = 10 * 60_000;

interface Saved {
  pick: ThemePick;
  by: string;
  at: number;
}

/**
 * The building's holiday theme (Halloween, Christmas, none, or whichever the calendar says), picked
 * in ⚙️ Settings by anyone and kept in .agent-office/theme.json. Everyone sees the same one.
 */
export class Themes {
  private saved?: Saved;
  private path: string;
  private timer?: NodeJS.Timeout;
  private told = '';

  constructor(
    dataDir: string,
    /** The office's clock, in minutes east of UTC (the sky's), for what day it is there. */
    private utcOffset: () => number,
    private onState: (state: ThemeState) => void,
  ) {
    this.path = path.join(dataDir, 'theme.json');
    this.restore();
    this.told = JSON.stringify(this.state());
  }

  start() {
    this.timer = setInterval(() => this.emit(), CHECK_MS);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  state(): ThemeState {
    const pick = this.saved?.pick ?? 'auto';
    return { pick, active: activeTheme(pick, Date.now(), this.utcOffset()), ...(this.saved ? { by: this.saved.by, at: this.saved.at } : {}) };
  }

  set(pick: ThemePick, by: string) {
    this.saved = { pick, by, at: Date.now() };
    this.persist();
    this.emit();
  }

  /** Tells everyone, when something changed: the pick, or the calendar under 'auto' (or the office's clock moved it). */
  emit() {
    const state = this.state();
    const key = JSON.stringify(state);
    if (key === this.told) return;
    this.told = key;
    this.onState(state);
  }

  private restore() {
    try {
      const s = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<Saved>;
      if (isThemePick(s.pick)) this.saved = { pick: s.pick, by: typeof s.by === 'string' ? s.by : 'someone', at: typeof s.at === 'number' ? s.at : 0 };
    } catch {
      // never set: it follows the calendar
    }
  }

  private persist() {
    try {
      writeFileSync(this.path, JSON.stringify(this.saved ?? {}, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
