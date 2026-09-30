import type { JailState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Workers sent home and locked up in this floor's dungeon, on a map that has one. */
    jail: JailState;
  }
  interface Topics {
    jail: true;
  }
}

export const jail: Slice = {
  init(s) {
    s.jail = { prisoners: [], bones: 0 };
  },
  on: {
    // The worker taken off its desk went to the dungeon.
    'worker.remove'(s, m) {
      if (m.jail) s.jail = m.jail;
      return m.jail ? ['jail'] : [];
    },
  },
  enter(s, v) {
    s.jail = v.jail ?? { prisoners: [], bones: 0 };
    return ['jail'];
  },
};
