import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_OFFICE_PERFORMANCE, isOfficePerformanceSettings } from '../shared/performance.js';
import type { PerformanceState } from '../shared/protocol.js';

/** Persist before applying, so a refused write cannot partially reschedule office work. */
export class Performance {
  private current: PerformanceState = { settings: { ...DEFAULT_OFFICE_PERFORMANCE } };
  private file: string;
  constructor(dataDir: string, private onState: (state: PerformanceState) => void) {
    this.file = path.join(dataDir, 'performance.json');
    try {
      const saved: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (saved && typeof saved === 'object' && 'settings' in saved && isOfficePerformanceSettings(saved.settings)) {
        this.current = { settings: { ...saved.settings },
          ...('by' in saved && typeof saved.by === 'string' ? { by: saved.by } : {}),
          ...('at' in saved && typeof saved.at === 'number' && Number.isFinite(saved.at) ? { at: saved.at } : {}) };
      }
    } catch { /* Missing or invalid storage uses validated defaults. */ }
  }
  state(): PerformanceState { return { ...this.current, settings: { ...this.current.settings } }; }
  set(value: unknown, by: string): string | undefined {
    if (value !== null && !isOfficePerformanceSettings(value)) return 'Invalid performance settings';
    const next: PerformanceState = value === null
      ? { settings: { ...DEFAULT_OFFICE_PERFORMANCE } }
      : { settings: { ...value }, by, at: Date.now() };
    if (JSON.stringify(next.settings) === JSON.stringify(this.current.settings) && value !== null) return;
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
      renameSync(`${this.file}.tmp`, this.file);
    } catch { return 'Could not save performance settings'; }
    this.current = next;
    this.onState(this.state());
  }
}
