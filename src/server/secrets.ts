import { timingSafeEqual } from 'node:crypto';

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * This lived twice, file-local and exported by neither: `workers.ts` and `ptyhost.ts` each had an
 * identical loop, and the floor-host registry would have been the third. Lifted here so there is one
 * of it (see docs/remote-agents-plan.md, finding 8).
 *
 * A length mismatch returns early. That leaks the length, which is not a secret — every token and hook
 * token this compares is a fixed-width hex string, so an attacker already knows the length.
 */
export function safeEq(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
