import type { LeaveOnMergeState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Whether workers whose pull request merged go home by themselves (⚙️ Settings). */
    leaveOnMerge: LeaveOnMergeState;
  }
  interface Topics {
    leaveOnMerge: true;
  }
}

export const leaveOnMerge: Slice = {
  init(s) {
    s.leaveOnMerge = { on: false };
  },
  on: {
    welcome(s, m) {
      s.leaveOnMerge = m.leaveOnMerge ?? { on: false };
      return ['leaveOnMerge'];
    },
    leaveOnMerge(s, m) {
      s.leaveOnMerge = m.state;
      return ['leaveOnMerge'];
    },
  },
};
