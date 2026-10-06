import type { TriageResult, TriageState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** What triage made of your floor's issues (see server/triage/). */
    triage: TriageState;
    /** Triage's result for an issue on your floor, if it has one. */
    triageFor(issue: number): TriageResult | undefined;
  }
  interface Topics {
    triage: true;
  }
}

const OFF: TriageState = { enabled: false, results: [], stats: { day: '', triaged: 0, queued: 0, cap: 0, spend: 0 } };

export const triage: Slice = {
  init(s) {
    s.triage = OFF;
  },
  methods: {
    triageFor(issue: number) {
      return this.triage.results.find((r) => r.number === issue);
    },
  },
  on: {
    triage(s, m) {
      s.triage = m.state;
      return ['triage'];
    },
    'triage.result'(s, m) {
      s.triage = { ...s.triage, results: [...s.triage.results.filter((r) => r.number !== m.result.number), m.result], stats: m.stats };
      return ['triage'];
    },
  },
  enter(s, v) {
    s.triage = v.triage ?? OFF;
    return ['triage'];
  },
};
