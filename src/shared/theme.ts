import type { Theme, ThemePick } from './protocol.js';

// Holiday themes: the whole building dresses up for Halloween or Christmas. The server keeps
// what's picked (server/theme.ts); every browser dresses its own scene up from that.

export const THEME_PICKS: readonly ThemePick[] = ['auto', 'halloween', 'christmas', 'off'];

/**
 * The holiday it is on the office's calendar, if any: Halloween all through October, Christmas all
 * through December. `utcOffset` is the office's clock in minutes east of UTC (see SkyState).
 */
export function calendarTheme(ms: number, utcOffset: number): Theme | null {
  const month = new Date(ms + utcOffset * 60_000).getUTCMonth();
  return month === 9 ? 'halloween' : month === 11 ? 'christmas' : null;
}

/** What a pick puts up at `ms` on the office's clock. */
export function activeTheme(pick: ThemePick, ms: number, utcOffset: number): Theme | null {
  return pick === 'auto' ? calendarTheme(ms, utcOffset) : pick === 'off' ? null : pick;
}

export function isThemePick(v: unknown): v is ThemePick {
  return typeof v === 'string' && (THEME_PICKS as readonly string[]).includes(v);
}
