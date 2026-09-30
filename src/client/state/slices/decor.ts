import type { Decoration } from '../../../shared/decor';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Pictures on the walls. */
    decor: Decoration[];
  }
  interface Topics {
    decor: true;
  }
}

export const decor: Slice = {
  init(s) {
    s.decor = [];
  },
  on: {
    decor(s, m) {
      s.decor = m.items;
      return ['decor'];
    },
  },
  enter(s, v) {
    s.decor = v.decor;
    return ['decor'];
  },
};
