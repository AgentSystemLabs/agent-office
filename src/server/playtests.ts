import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Playtest, PlaytestInput, PlaytestState } from '../shared/playtests.js';

export class PlaytestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function text(value: unknown, max: number, name: string, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new PlaytestError(`Invalid ${name}`);
  return value.trim();
}

export function readPlaytest(value: unknown): PlaytestInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlaytestError('Expected a test object');
  const b = value as Record<string, unknown>;
  const source = text(b.source ?? '', 800, 'source');
  if (source) {
    let url: URL;
    try { url = new URL(source); } catch { throw new PlaytestError('Source must be an HTTPS URL'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new PlaytestError('Source must be an HTTPS URL');
  }
  return {
    title: text(b.title, 180, 'title', true), steps: text(b.steps, 6000, 'steps', true),
    expected: text(b.expected, 3000, 'expected result', true), category: text(b.category ?? 'General', 60, 'category', true), source,
  };
}

/** Synchronous, atomic saves serialize edits in the Office process. Failed saves never report success. */
export class Playtests {
  private items: Playtest[] = [];
  private file: string;
  constructor(private dataDir: string) {
    this.file = path.join(dataDir, 'playtests.json');
    if (!existsSync(this.file)) return;
    // Do not silently replace a damaged checklist with an empty one.
    const data = JSON.parse(readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')) as PlaytestState;
    if (!Array.isArray(data.items) || data.items.length > 2000) throw new Error('Invalid playtest checklist; restore its backup');
    const ids = new Set<string>();
    for (const t of data.items) {
      readPlaytest(t);
      if (typeof t.id !== 'string' || ids.has(t.id) || !Number.isSafeInteger(t.revision) || t.revision < 1 || typeof t.done !== 'boolean' || typeof t.notes !== 'string') throw new Error('Invalid playtest record');
      ids.add(t.id);
    }
    this.items = data.items;
  }
  state(): PlaytestState { return { items: this.items.map(t => ({ ...t })) }; }
  add(value: unknown, actor: string): Playtest {
    const input = readPlaytest(value);
    const key = (t: PlaytestInput) => `${t.source.replace(/\/$/, '').toLowerCase()}|${t.title.toLocaleLowerCase().replace(/\s+/g, ' ')}`;
    const existing = this.items.find(t => key(t) === key(input));
    if (existing) return { ...existing }; // Retried agent handoffs cannot reset a human's checkmarks or notes.
    if (this.items.length >= 2000) throw new PlaytestError('Checklist is full', 409);
    const item: Playtest = { ...input, id: randomUUID(), revision: 1, notes: '', done: false, createdAt: new Date().toISOString(), createdBy: actor };
    this.save([...this.items, item]);
    return { ...item };
  }
  update(value: unknown, actor: string): Playtest {
    if (!value || typeof value !== 'object') throw new PlaytestError('Expected an update');
    const b = value as Record<string, unknown>;
    const index = this.items.findIndex(t => t.id === b.id);
    if (index < 0) throw new PlaytestError('Test not found', 404);
    const old = this.items[index];
    if (b.revision !== old.revision) throw new PlaytestError('Someone changed this test. Refresh and try again.', 409);
    const next = { ...old, revision: old.revision + 1 };
    if ('notes' in b) next.notes = text(b.notes, 6000, 'notes');
    if ('done' in b) {
      if (typeof b.done !== 'boolean') throw new PlaytestError('Invalid checkmark');
      next.done = b.done;
      next.checkedAt = b.done ? new Date().toISOString() : undefined;
      next.checkedBy = b.done ? actor : undefined;
    }
    if ('test' in b) Object.assign(next, readPlaytest(b.test));
    const items = [...this.items]; items[index] = next; this.save(items);
    return { ...next };
  }
  private save(items: Playtest[]) {
    mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ items }, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
    this.items = items;
  }
}

const stores = new WeakMap<object, Playtests>();
export function floorPlaytests(floor: { dir: string }): Playtests {
  let store = stores.get(floor);
  if (!store) { store = new Playtests(path.join(floor.dir, '.agent-office')); stores.set(floor, store); }
  return store;
}
