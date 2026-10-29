import { createHash, randomUUID } from 'node:crypto';

export const id = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '')}`;
export const now = (): string => new Date().toISOString();
export const hashText = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
export const hashBytes = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

export function json(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => (typeof nested === 'bigint' ? nested.toString() : nested));
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
