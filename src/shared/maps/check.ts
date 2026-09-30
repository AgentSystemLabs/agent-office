/*
 * Checking what a map's file says (see planMap in ./index.ts): nothing in it is taken on trust, and
 * whatever's wrong is said in words for Settings.
 */

/** A map that can't be used: why, in words for Settings. */
export class MapError extends Error {}

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function num(v: unknown, what: string, min = -1e4, max = 1e4): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new MapError(`${what} should be a number`);
  if (v < min || v > max) throw new MapError(`${what} should be between ${min} and ${max}`);
  return v;
}

export function str(v: unknown, what: string, max = 80): string {
  if (typeof v !== 'string' || !v.trim()) throw new MapError(`${what} should be some text`);
  return v.trim().slice(0, max);
}
