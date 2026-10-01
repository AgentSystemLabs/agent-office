import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isSlot, sanitizeFurnishings, variantOf, type FurnishVariant, type Furnishings } from '../shared/furnishings.js';

/** What a floor's furnishings look like (swapped at the wardrobe), saved in .agent-office/furnishings.json. */
export class FurnishingsStore {
  private current: Furnishings;
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'furnishings.json');
    this.current = sanitizeFurnishings(this.load());
  }

  get(): Furnishings {
    return { ...this.current };
  }

  /** Gives `slot` variant `id`: the variant, if that changed anything; a reason, if it can't. */
  set(slot: unknown, id: unknown): FurnishVariant | string | null {
    if (!isSlot(slot)) return "The wardrobe doesn't have that";
    const v = variantOf(slot, id);
    if (!v) return "The wardrobe doesn't have that";
    if (this.current[slot] === v.id) return null;
    this.current[slot] = v.id;
    this.save();
    return v;
  }

  private load(): unknown {
    if (!existsSync(this.file)) return undefined;
    try {
      return JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      // a broken file just means the office as it always was
      return undefined;
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify(this.current, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
