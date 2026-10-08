import { EMPTY_COORDINATOR } from '../../../shared/coordinator';
import type { CoordinatorState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The floor's coordinator board: the phase plan its checkout's `plans/` folder holds. */
    coordinator: CoordinatorState;
  }
  interface Topics {
    coordinator: true;
  }
}

export const coordinator: Slice = {
  init(s) {
    s.coordinator = { ...EMPTY_COORDINATOR };
  },
  on: {
    coordinator(s, m) {
      s.coordinator = m.state;
      return ['coordinator'];
    },
  },
  enter(s, v) {
    s.coordinator = v.coordinator;
    return ['coordinator'];
  },
};
