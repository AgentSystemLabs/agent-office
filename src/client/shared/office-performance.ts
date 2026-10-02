import { DEFAULT_OFFICE_PERFORMANCE, type OfficePerformanceSettings } from '../../shared/performance';

/** Keeps rapid edits coherent until their latest full candidate is acknowledged; rejection/timeout clears it. */
export class OfficePerformanceEdits {
  private pending: OfficePerformanceSettings | undefined;

  constructor(private readonly current: () => OfficePerformanceSettings) {}

  value(): OfficePerformanceSettings { return this.pending ?? this.current(); }

  set<K extends keyof OfficePerformanceSettings>(key: K, value: OfficePerformanceSettings[K]): OfficePerformanceSettings {
    this.pending = { ...this.value(), [key]: value };
    return this.pending;
  }

  reset(): OfficePerformanceSettings {
    this.pending = { ...DEFAULT_OFFICE_PERFORMANCE };
    return this.pending;
  }

  acknowledge(settings: OfficePerformanceSettings): boolean {
    const pending = this.pending;
    if (!pending) return true;
    if ((Object.keys(DEFAULT_OFFICE_PERFORMANCE) as (keyof OfficePerformanceSettings)[]).some((key) => pending[key] !== settings[key])) return false;
    this.pending = undefined;
    return true;
  }

  recover() { this.pending = undefined; }
}
