import type { VisitorsState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Claude Code sessions the office didn't start, visiting your floor (see features/visitors). */
    visitors: VisitorsState;
  }
  interface Topics {
    visitors: true;
  }
}

export const visitors: Slice = {
  init(s) {
    s.visitors = { visitors: [] };
  },
  on: {
    visitors(s, m) {
      s.visitors = m.state;
      return ['visitors'];
    },
  },
  enter(s, v) {
    s.visitors = v.visitors ?? { visitors: [] };
    return ['visitors'];
  },
};
