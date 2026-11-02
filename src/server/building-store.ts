// Floors.json: what the building keeps on disk, and how it is put back.
//
// The building keeps its floors there so a restart is the same office; the shape on disk can be
// anything (people edit it, older offices wrote it), so it is checked on the way in and rewritten in
// the office's own shape on the way out.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeRepo } from '../shared/floors.js';
import type { FloorDef } from './building.js';

/** Reads floors.json, skipping anything that isn't a floor this office can use. */
export function loadFloors(file: string): FloorDef[] {
  if (!existsSync(file)) return [];
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<FloorDef>[];
    const ids = new Set<string>();
    const out: FloorDef[] = [];
    for (const s of Array.isArray(saved) ? saved : []) {
      if (typeof s.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(s.id) || ids.has(s.id) || typeof s.dir !== 'string' || !path.isAbsolute(s.dir)) continue;
      ids.add(s.id);
      out.push({
        id: s.id,
        name: typeof s.name === 'string' && s.name ? s.name.slice(0, 100) : path.basename(s.dir),
        repo: normalizeRepo(s.repo),
        dir: s.dir,
        palette: Number.isInteger(s.palette) && (s.palette as number) >= 0 ? (s.palette as number) : 0,
        addedBy: typeof s.addedBy === 'string' ? s.addedBy : '?',
        addedAt: typeof s.addedAt === 'number' ? s.addedAt : Date.now(),
        ...(typeof s.externalId === 'string' ? { externalId: s.externalId } : {}),
        ...(typeof s.url === 'string' ? { url: s.url } : {}),
      });
    }
    return out;
  } catch (err) {
    console.error(`agent-office: ${file} couldn't be read, so the building starts empty: ${(err as Error).message}`);
    return [];
  }
}

/** Writes floors.json, so the next office opens the same floors. */
export function saveFloors(file: string, floors: FloorDef[]): void {
  try {
    writeFileSync(file, JSON.stringify(floors, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error(`agent-office: couldn't save the floors: ${(err as Error).message}`);
  }
}
