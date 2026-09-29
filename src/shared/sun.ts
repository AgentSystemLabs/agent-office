// Where the office probably is. Shared: the server guesses it for the weather, and the browser
// starts from the same guess before the server has said.

/**
 * Where a machine probably is, from its clock: the middle of its time zone, at 40° north, or 34° south where the clocks go forward in January.
 */
export function guessPlace(now = new Date()): { lat: number; lon: number } {
  const y = now.getFullYear();
  const jan = -new Date(y, 0, 1).getTimezoneOffset();
  const jul = -new Date(y, 6, 1).getTimezoneOffset();
  return { lat: jan > jul ? -34 : 40, lon: (Math.min(jan, jul) / 60) * 15 };
}
