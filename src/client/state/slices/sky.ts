import type { SkyState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Outside the windows; null until the server says. */
    sky: SkyState | null;
  }
  interface Topics {
    sky: true;
  }
}

export const sky: Slice = {
  init(s) {
    s.sky = null;
  },
  on: {
    welcome(s, m) {
      s.sky = m.sky;
      return ['sky'];
    },
    sky(s, m) {
      s.sky = m.state;
      return ['sky'];
    },
  },
};
