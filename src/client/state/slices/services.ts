import type { ServicesState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The dev servers the floor's workers started, and the office's own port. */
    services: ServicesState;
  }
  interface Topics {
    services: true;
  }
}

export const services: Slice = {
  init(s) {
    s.services = { items: [], port: 4600 };
  },
  on: {
    services(s, m) {
      s.services = m.state;
      return ['services'];
    },
  },
  enter(s, v) {
    s.services = v.services;
    return ['services'];
  },
};
