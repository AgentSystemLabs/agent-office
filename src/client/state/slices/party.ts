import type { PartyState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** A /party on this floor (see features/party): until when, on the office's clock, and who started it; null with none. */
    party: PartyState | null;
  }
  interface Topics {
    party: true;
  }
}

export const party: Slice = {
  init(s) {
    s.party = null;
  },
  on: {
    party(s, m) {
      s.party = m.until ? { until: m.until, by: m.by } : null;
      return ['party'];
    },
  },
  enter(s, v) {
    s.party = v.party;
    return ['party'];
  },
};
