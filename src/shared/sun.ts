// Where the sun is, for day and night outside the office. Shared: the server guesses where the
// office is, and every browser works out the sun from that and its own clock.

const RAD = Math.PI / 180;

/**
 * The sun's elevation above the horizon and its azimuth (clockwise from north, so east is +π/2),
 * both in radians, at `ms` (Unix time) seen from `lat`/`lon` in degrees. A low-precision fit
 * (good to about a degree), which is plenty for a sky.
 */
export function sunPosition(ms: number, lat: number, lon: number): { el: number; az: number } {
  const d = ms / 86_400_000 - 10_957.5; // days since noon on 1 January 2000, UTC
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = 18.697374558 + 24.06570982441908 * d; // hours
  const H = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  return { el, az };
}

/**
 * Where a machine probably is, from its clock: the middle of its time zone (standard time, so
 * summer time doesn't move noon), at 40° north, or 34° south where the clocks go forward in January.
 */
export function guessPlace(now = new Date()): { lat: number; lon: number } {
  const y = now.getFullYear();
  const jan = -new Date(y, 0, 1).getTimezoneOffset();
  const jul = -new Date(y, 6, 1).getTimezoneOffset();
  return { lat: jan > jul ? -34 : 40, lon: (Math.min(jan, jul) / 60) * 15 };
}
