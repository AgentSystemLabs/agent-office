import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** The name ending a picture dropped without one gets, so the agent can tell it's a picture. */
const PICTURE_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

/**
 * Files dropped or pasted into a worker's terminal from a browser (see shared/drops.ts), kept in
 * .agent-office/drops/<worker id>/ so the program there can open them by path. They go with the worker.
 */
export class DropStore {
  private dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'drops');
  }

  /** Keeps a file dropped into a worker's terminal; where it is now, or undefined if it couldn't be. */
  save(workerId: string, name: string, type: string, body: Buffer): string | undefined {
    const dir = this.folder(workerId);
    if (!dir) return undefined;
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `${randomBytes(4).toString('hex')}-${dropName(name, type)}`);
      writeFileSync(file, body, { mode: 0o600, flag: 'wx' });
      return file;
    } catch {
      return undefined;
    }
  }

  remove(workerId: string) {
    const dir = this.folder(workerId);
    try {
      if (dir) rmSync(dir, { recursive: true, force: true });
    } catch {
      // already gone
    }
  }

  /** Deletes what was dropped for workers that are no longer at a desk. */
  prune(keep: Set<string>) {
    try {
      for (const id of readdirSync(this.dir)) if (!keep.has(id)) this.remove(id);
    } catch {
      // no folder yet
    }
  }

  private folder(workerId: string): string | undefined {
    return /^[\w-]{1,64}$/.test(workerId) ? path.join(this.dir, workerId) : undefined;
  }
}

/**
 * A dropped file's name, safe to type into a terminal: its letters and digits kept, anything else a
 * dash, and a picture's name ending added when it came without one (a pasted screenshot can).
 */
export function dropName(name: string, type: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 12) : '';
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  return `${stem || 'file'}${ext.length > 1 ? ext : PICTURE_EXT[type.split(';')[0].trim().toLowerCase()] ?? ''}`;
}
