import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_PICKS, activeTheme, calendarTheme, isThemePick } from '../src/shared/theme.js';

// The building's look (see shared/theme.ts): the holiday themes, the modern office, and by the
// calendar, which only ever puts up Halloween or Christmas.

const HALLOWEEN = Date.UTC(2026, 9, 15);
const CHRISTMAS = Date.UTC(2026, 11, 15);
const JANUARY = Date.UTC(2026, 0, 15);

test('every pick is one the server accepts, and nothing else is', () => {
  for (const pick of THEME_PICKS) assert.ok(isThemePick(pick), `${pick} is a pick`);
  assert.deepEqual([...THEME_PICKS].sort(), ['auto', 'christmas', 'halloween', 'modern', 'off']);
  for (const bad of ['halloween ', 'Halloween', 'gothic', '', null, 1, undefined]) assert.ok(!isThemePick(bad), `${String(bad)} isn't a pick`);
});

test('the modern office is a pick of its own, up whatever the date', () => {
  for (const ms of [JANUARY, HALLOWEEN, CHRISTMAS]) {
    assert.equal(activeTheme('modern', ms, 0), 'modern', `modern at ${new Date(ms).toISOString().slice(0, 10)}`);
  }
  // It follows the office's clock, like the holidays do: the same instant a day either side is still modern.
  assert.equal(activeTheme('modern', JANUARY, 330), 'modern');
});

test('by the calendar it is still only Halloween or Christmas, never the modern office', () => {
  assert.equal(calendarTheme(HALLOWEEN, 0), 'halloween');
  assert.equal(calendarTheme(CHRISTMAS, 0), 'christmas');
  assert.equal(calendarTheme(JANUARY, 0), null);
  assert.equal(activeTheme('auto', JANUARY, 0), null);
  // The office's clock decides which month it is there, not UTC.
  const endOfSeptemberUTC = Date.UTC(2026, 9, 1, 2);
  assert.equal(calendarTheme(endOfSeptemberUTC, 0), 'halloween');
  assert.equal(calendarTheme(Date.UTC(2026, 8, 30, 23), 120), 'halloween', 'October where the office is');
});

test('off takes everything down, whatever the calendar says', () => {
  for (const ms of [JANUARY, HALLOWEEN, CHRISTMAS]) assert.equal(activeTheme('off', ms, 0), null);
});
