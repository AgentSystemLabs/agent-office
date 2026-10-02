import type { OfficePerformanceSettings } from '../performance.js';

export interface PerformanceState {
  settings: OfficePerformanceSettings;
  by?: string;
  at?: number;
}
export type PerformanceClientMsg =
  | { t: 'performance.set'; settings: OfficePerformanceSettings | null }
  /** Visible 3D clients subscribe; raw terminal viewers stream independently. */
  | { t: 'screen.watch'; on: boolean };
export type PerformanceServerMsg = { t: 'performance'; state: PerformanceState };
