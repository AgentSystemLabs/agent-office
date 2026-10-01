import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { JailState, Prisoner, WorkerInfo } from '../shared/protocol.js';

/** How many prisoners are kept by name: the ones from before them are only a count, bones on the heap. */
export const MAX_PRISONERS = 200;

/**
 * A floor's dungeon (see MapPlan.sendHome): every worker sent home on a map that locks them up, kept
 * there for good, first to last. The map works out how far each has wasted away from when it was
 * locked up; this only remembers who and when. Saved in .agent-office/jail.json.
 */
export class Jail {
  private prisoners: Prisoner[] = [];
  private bones = 0;
  private file: string;

  constructor(
    dataDir: string,
    private now = () => Date.now(),
  ) {
    this.file = path.join(dataDir, 'jail.json');
    this.load();
  }

  state(): JailState {
    return { prisoners: [...this.prisoners], bones: this.bones };
  }

  /** Locks `w` up, as of now. */
  add(w: Pick<WorkerInfo, 'id' | 'name' | 'color' | 'workedMs'>): JailState {
    this.prisoners = this.prisoners.filter((p) => p.id !== w.id);
    this.prisoners.push({ id: w.id, name: w.name, color: w.color, at: this.now(), ...(w.workedMs ? { workedMs: w.workedMs } : {}) });
    const over = this.prisoners.length - MAX_PRISONERS;
    if (over > 0) {
      this.prisoners.splice(0, over);
      this.bones += over;
    }
    this.save();
    return this.state();
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<JailState>;
      const ok = (p: unknown): p is Prisoner => {
        const q = p as Prisoner;
        return !!q && typeof q.id === 'string' && typeof q.name === 'string' && typeof q.color === 'string' && typeof q.at === 'number' && Number.isFinite(q.at);
      };
      this.prisoners = (Array.isArray(s.prisoners) ? s.prisoners.filter(ok) : []).slice(-MAX_PRISONERS).map((p) => ({
        id: p.id.slice(0, 64),
        name: p.name.slice(0, 64),
        color: p.color.slice(0, 32),
        at: p.at,
        ...(typeof p.workedMs === 'number' && Number.isFinite(p.workedMs) && p.workedMs > 0 ? { workedMs: p.workedMs } : {}),
      }));
      this.bones = typeof s.bones === 'number' && Number.isInteger(s.bones) && s.bones > 0 ? s.bones : 0;
    } catch {
      // a broken file just means an empty dungeon
    }
  }

  private save() {
    try {
      writeFileSync(this.file, JSON.stringify({ prisoners: this.prisoners, bones: this.bones }, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
