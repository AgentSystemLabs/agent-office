import type { FloorInfo } from '../../../shared/protocol';
import type { PocketSnapshot } from './wire';

export interface PocketFloor {
  id: number;
  title: string;
  cwd: string;
  busy: boolean;
  archived: boolean;
}

export function pocketFloorId(source: number): string { return `chat-${source}`; }
export function pocketFloorSource(id: string): number | null {
  if (!/^chat-[1-9]\d*$/.test(id)) return null;
  const source = Number(id.slice(5));
  return Number.isSafeInteger(source) ? source : null;
}

/** Only the public parent response supplies the catalog. Children are not synthesized from workers. */
export function parsePocketFloors(value: unknown): PocketFloor[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error('Invalid Pocket floor list');
  const ids = new Set<number>();
  return value.map(f => {
    if (!f || typeof f !== 'object' || !Number.isSafeInteger(f.id) || f.id <= 0 || ids.has(f.id)
      || typeof f.title !== 'string' || typeof f.cwd !== 'string' || typeof f.busy !== 'boolean'
      || typeof f.archived !== 'boolean') throw new Error('Invalid Pocket floor');
    ids.add(f.id);
    return { id: f.id, title: f.title, cwd: f.cwd, busy: f.busy, archived: f.archived };
  }).filter(f => !f.archived);
}

export function pocketFloorViews(floors: PocketFloor[], current: PocketSnapshot): FloorInfo[] {
  return floors.map(f => ({
    id: pocketFloorId(f.id), name: f.title, dir: f.cwd, palette: f.id, wing: 0,
    addedBy: 'Pocket', addedAt: 0,
    // A root's busy flag is not a count of its workers. Only this floor's snapshot supplies counts.
    workers: f.id === current.source ? current.workers.length : 0,
    busy: f.id === current.source ? current.workers.filter(w => w.status === 'working').length : 0,
    people: f.id === current.source ? current.peers.length : 0, waiting: 0,
  }));
}
