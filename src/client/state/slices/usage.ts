import type { CodexPlanLimits, PlanLimits, Usage, UsageState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    usage: UsageState;
    /** The Claude plan's 5-hour and weekly limits. */
    limits: PlanLimits;
    /** The signed-in Codex plan allowance from the Codex app server. */
    codexLimits: CodexPlanLimits;
  }
  interface Topics {
    usage: true;
    limits: true;
    codexLimits: true;
  }
}

const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 });

/** What the workers have spent, and how much of the plan's limits is left. */
export const usage: Slice = {
  init(s) {
    s.usage = { total: zeroUsage(), today: zeroUsage(), day: '', pauseHiring: false };
    s.limits = { windows: [], at: 0 };
    s.codexLimits = { windows: [], at: 0, checkedAt: 0, status: 'checking' };
  },
  on: {
    welcome(s, m) {
      s.usage = m.usage;
      s.limits = m.limits;
      s.codexLimits = m.codexLimits;
      return ['usage', 'limits', 'codexLimits'];
    },
    usage(s, m) {
      s.usage = m.state;
      return ['usage'];
    },
    limits(s, m) {
      s.limits = m.state;
      return ['limits'];
    },
    'codex-limits'(s, m) {
      s.codexLimits = m.state;
      return ['codexLimits'];
    },
  },
};
