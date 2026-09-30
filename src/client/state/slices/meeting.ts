import type { MeetingState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The meeting room: the meeting at the table, and the ones before. */
    meeting: MeetingState;
  }
  interface Topics {
    meeting: true;
  }
}

export const meeting: Slice = {
  init(s) {
    s.meeting = { current: null, past: [] };
  },
  on: {
    meeting(s, m) {
      s.meeting = m.state;
      return ['meeting'];
    },
  },
  enter(s, v) {
    s.meeting = v.meeting;
    return ['meeting'];
  },
};
