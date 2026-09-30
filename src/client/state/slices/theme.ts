import type { ThemeState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The building's holiday decorations: the same on every floor. */
    theme: ThemeState;
  }
  interface Topics {
    theme: true;
  }
}

export const theme: Slice = {
  init(s) {
    s.theme = { pick: 'auto', active: null };
  },
  on: {
    welcome(s, m) {
      s.theme = m.theme;
      return ['theme'];
    },
    theme(s, m) {
      s.theme = m.state;
      return ['theme'];
    },
  },
};
