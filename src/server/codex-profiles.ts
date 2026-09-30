import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Optional, local-only profile routing. The file contains paths, never credentials. */
export function codexProfiles(dataDir: string, workerId: string, workerName?: string): [string, string] | undefined {
  try {
    const config = JSON.parse(readFileSync(path.join(dataDir, 'codex-accounts.json'), 'utf8')) as { workers?: Record<string, unknown> };
    const homes = config.workers?.[workerId] ?? (workerName ? config.workers?.[workerName] : undefined);
    if (!Array.isArray(homes) || homes.length !== 2 || !homes.every((v) => typeof v === 'string' && path.isAbsolute(v))) return;
    const [first, second] = homes.map((v: string) => path.resolve(v));
    if (first === second) return;
    return [first, second];
  } catch {
    return;
  }
}

/** The secondary profile is deliberately file-backed so its sign-in is isolated and checkable. */
export function codexProfileReady(home: string): boolean {
  return existsSync(path.join(home, 'auth.json'));
}

/** An account may be retried after the rate-limit window resets. */
export function availableProfile(current: 0 | 1, blockedUntil: [number, number], now = Date.now()): 0 | 1 | undefined {
  const other = current === 0 ? 1 : 0;
  return blockedUntil[other] <= now ? other : undefined;
}
