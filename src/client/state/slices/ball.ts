import type { BallState } from '../../../shared/hoop';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The basketball on this floor, as the office last said (see features/basketball/world.ts). */
    ball: BallState;
  }
  interface Topics {
    ball: true;
  }
}

export const ball: Slice = {
  init(s) {
    s.ball = {};
  },
  on: {
    ball(s, m) {
      s.ball = m.ball;
      return ['ball'];
    },
  },
  enter(s, v) {
    s.ball = v.ball ?? {};
    return ['ball'];
  },
};
