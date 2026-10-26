import { readFileSync } from 'node:fs';
import path from 'node:path';

export function issueBoardLimits(dir: string): { open: number; closed: number } {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(readFileSync(path.join(dir, '.agent-office', 'issue-board-limits.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { open: 300, closed: 40 }; throw error; }
  const count = (key: string, fallback: number, maximum: number) => {
    const value = raw[key] ?? fallback;
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) throw new Error(`Invalid ${key} issue-board limit (1–${maximum})`);
    return value as number;
  };
  return { open: count('open', 300, 5000), closed: count('closed', 40, 1000) };
}
