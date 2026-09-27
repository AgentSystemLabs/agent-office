import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WB_MAX_BYTES, WB_MAX_ELEMENTS, WB_MAX_ELEMENT_BYTES, WB_MAX_FILES_BYTES, byIndex, checkElement, checkFile, newer, type WbElement, type WbFile } from '../shared/whiteboard.js';

/** How long after the last stroke the drawing is written to disk. */
const SAVE_DELAY_MS = 2000;
/** Deleted elements are kept this long, so the deletion reaches anyone who still has them. */
const TOMBSTONE_MS = 7 * 24 * 3600_000;

/** What `apply` made of a batch of changes. */
export interface Applied {
  /** The changes that went in, to pass on to everyone else. */
  accepted: WbElement[];
  /** Why some didn't, when the board is full. */
  error?: string;
}

/**
 * A floor's whiteboard: the Excalidraw elements everyone drew, merged by version the way
 * Excalidraw's live collaboration merges them, and the pictures on it. Kept in the floor's
 * .agent-office/whiteboard folder: elements.json, and a file per picture under files/.
 */
export class Whiteboard {
  private elements = new Map<string, WbElement>();
  /** Each element's size as JSON, to keep the board under WB_MAX_BYTES. */
  private sizes = new Map<string, number>();
  private bytes = 0;
  /** Pictures on disk, by id, with their size. */
  private files = new Map<string, number>();
  private fileBytes = 0;
  private dir: string;
  private filesDir: string;
  private saveTimer?: NodeJS.Timeout;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'whiteboard');
    this.filesDir = path.join(this.dir, 'files');
    this.load();
  }

  /** Every element, deleted ones too, bottom of the stack first. */
  scene(): WbElement[] {
    return [...this.elements.values()].sort(byIndex);
  }

  /** Whether anything is drawn on it. */
  get empty(): boolean {
    for (const e of this.elements.values()) if (!e.isDeleted) return false;
    return true;
  }

  /** Takes in someone's changes: each element that's newer than the board's copy replaces it. */
  apply(raw: unknown): Applied {
    const accepted: WbElement[] = [];
    let error: string | undefined;
    for (const item of Array.isArray(raw) ? raw : []) {
      const el = checkElement(item);
      if (!el) continue;
      const had = this.elements.get(el.id);
      if (!newer(el, had)) continue;
      const size = JSON.stringify(el).length;
      if (size > WB_MAX_ELEMENT_BYTES) {
        error = 'That drawing is too big for the whiteboard. Try it in smaller pieces.';
        continue;
      }
      if (!had && this.elements.size >= WB_MAX_ELEMENTS) this.forgetDeleted(1);
      if (this.bytes - (this.sizes.get(el.id) ?? 0) + size > WB_MAX_BYTES) this.forgetDeleted(Infinity);
      if ((!had && this.elements.size >= WB_MAX_ELEMENTS) || this.bytes - (this.sizes.get(el.id) ?? 0) + size > WB_MAX_BYTES) {
        error = 'The whiteboard is full. Clear some of it to draw more.';
        continue;
      }
      this.put(el, size);
      accepted.push(el);
    }
    if (accepted.length) this.saveSoon();
    return { accepted, error };
  }

  /** A picture on the board, from disk. */
  file(id: string): WbFile | undefined {
    if (!this.files.has(id)) return undefined;
    try {
      const f = checkFile(JSON.parse(readFileSync(path.join(this.filesDir, `${id}.json`), 'utf8')));
      return typeof f === 'string' ? undefined : f;
    } catch {
      return undefined;
    }
  }

  /** Keeps a picture someone put on the board. A picture with the same id is already there: it's the same picture. */
  addFile(raw: unknown): string | undefined {
    const f = checkFile(raw);
    if (typeof f === 'string') return f;
    if (this.files.has(f.id)) return undefined;
    const json = JSON.stringify(f);
    if (this.fileBytes + json.length > WB_MAX_FILES_BYTES) this.forgetUnusedFiles();
    if (this.fileBytes + json.length > WB_MAX_FILES_BYTES) return 'The whiteboard has too many pictures on it. Delete some first.';
    try {
      mkdirSync(this.filesDir, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(this.filesDir, `${f.id}.json`), json, { mode: 0o600 });
    } catch {
      return "Couldn't save the picture on the office's machine";
    }
    this.files.set(f.id, json.length);
    this.fileBytes += json.length;
    return undefined;
  }

  /** Writes the drawing to disk now, if it has changed since. */
  flush() {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.save();
  }

  private put(el: WbElement, size: number) {
    this.bytes += size - (this.sizes.get(el.id) ?? 0);
    this.elements.set(el.id, el);
    this.sizes.set(el.id, size);
  }

  private drop(id: string) {
    this.bytes -= this.sizes.get(id) ?? 0;
    this.elements.delete(id);
    this.sizes.delete(id);
  }

  /** Makes room by forgetting up to `n` deleted elements, the longest-deleted first. */
  private forgetDeleted(n: number) {
    const gone = [...this.elements.values()].filter((e) => e.isDeleted).sort((a, b) => (a.updated ?? 0) - (b.updated ?? 0));
    for (const e of gone.slice(0, n)) this.drop(e.id);
  }

  /** Pictures that no element shows any more, deleted elements included (an undo can bring those back). */
  private forgetUnusedFiles() {
    const used = new Set<string>();
    for (const e of this.elements.values()) if (e.fileId) used.add(e.fileId);
    for (const [id, size] of this.files) {
      if (used.has(id)) continue;
      try {
        unlinkSync(path.join(this.filesDir, `${id}.json`));
      } catch {
        continue;
      }
      this.files.delete(id);
      this.fileBytes -= size;
    }
  }

  private saveSoon() {
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, SAVE_DELAY_MS);
  }

  private save() {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      // Written aside and moved into place, so a crash mid-write can't leave half a drawing.
      const file = path.join(this.dir, 'elements.json');
      writeFileSync(`${file}.tmp`, JSON.stringify(this.scene()), { mode: 0o600 });
      renameSync(`${file}.tmp`, file);
    } catch {
      // disk issues shouldn't take the office down
    }
  }

  private load() {
    const file = path.join(this.dir, 'elements.json');
    if (existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as unknown;
        const now = Date.now();
        for (const item of Array.isArray(saved) ? saved : []) {
          const el = checkElement(item);
          if (!el || (el.isDeleted && now - (el.updated ?? 0) > TOMBSTONE_MS)) continue;
          this.put(el, JSON.stringify(el).length);
        }
      } catch {
        // a broken file just means a clean board
      }
    }
    try {
      for (const name of readdirSync(this.filesDir)) {
        if (!name.endsWith('.json')) continue;
        const size = statSync(path.join(this.filesDir, name)).size;
        this.files.set(name.slice(0, -5), size);
        this.fileBytes += size;
      }
    } catch {
      // no pictures yet
    }
    this.forgetUnusedFiles();
  }
}
