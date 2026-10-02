import { DEFAULT_OFFICE_PERFORMANCE } from '../../../shared/performance';
import type { PerformanceState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store { performance: PerformanceState; }
  interface Topics { performance: true; }
}
export const performance: Slice = {
  init(s) { s.performance = { settings: { ...DEFAULT_OFFICE_PERFORMANCE } }; },
  on: {
    welcome(s, m) { s.performance = m.performance ?? { settings: { ...DEFAULT_OFFICE_PERFORMANCE } }; return ['performance']; },
    performance(s, m) { s.performance = m.state; return ['performance']; },
  },
};
