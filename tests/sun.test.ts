import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_DAY_MS, skyTime, sunPosition } from '../src/shared/sun.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Hours since midnight in the office's time zone. */
const hourOfDay = (ms: number, utcOffset: number) => (((ms + utcOffset * 60_000) % DAY) + DAY) % DAY / HOUR;

test('the sky goes round a whole day every hour: midnight on the hour, noon at half past', () => {
  assert.equal(SKY_DAY_MS, HOUR);
  for (const utcOffset of [-420, 0, 60, 330]) {
    // 2:00 in the afternoon, on the office's clock, on 29 September 2026.
    const two = Date.UTC(2026, 8, 29, 14) - utcOffset * 60_000;
    assert.equal(hourOfDay(skyTime(two, utcOffset), utcOffset), 0);
    assert.equal(hourOfDay(skyTime(two + 15 * 60_000, utcOffset), utcOffset), 6);
    assert.equal(hourOfDay(skyTime(two + 30 * 60_000, utcOffset), utcOffset), 12);
    assert.equal(hourOfDay(skyTime(two + 45 * 60_000, utcOffset), utcOffset), 18);
    // An hour on, it's back where it was.
    assert.equal(skyTime(two + 20 * 60_000 + HOUR, utcOffset), skyTime(two + 20 * 60_000, utcOffset));
    // Still today's date, so the sun keeps the season's hours.
    assert.equal(Math.floor((skyTime(two + 50 * 60_000, utcOffset) + utcOffset * 60_000) / DAY), Math.floor((two + utcOffset * 60_000) / DAY));
  }
});

test("the sky's day runs on smoothly past the office's midnight", () => {
  const midnight = Date.UTC(2026, 8, 30) + 7 * HOUR; // midnight in Portland (UTC-7)
  const before = skyTime(midnight - 1000, -420);
  const after = skyTime(midnight, -420);
  assert.ok(after > before && after - before < 30_000, `${after - before} ms of sky between one second and the next`);
});

test('the sun is up at half past and down on the hour', () => {
  const lat = 40;
  const lon = -120; // the middle of UTC-8, with summer time on
  const noon = Date.UTC(2026, 8, 29, 17, 30); // 10:30 in Portland, half past the hour
  assert.ok(sunPosition(skyTime(noon, -420), lat, lon).el > 0.5);
  assert.ok(sunPosition(skyTime(noon - 30 * 60_000, -420), lat, lon).el < -0.5);
});
