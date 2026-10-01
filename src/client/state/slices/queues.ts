import type { QueueState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Every floor's queue, by floor id, while the queue's 🏢 All floors view follows them (see queue.watch). */
    queues: Map<string, QueueState>;
  }
  interface Topics {
    queues: true;
  }
}

export const queues: Slice = {
  init(s) {
    s.queues = new Map();
  },
  on: {
    queues(s, m) {
      s.queues = new Map(m.floors.map((f) => [f.floor, f.state]));
      return ['queues'];
    },
    'queue.floor'(s, m) {
      s.queues.set(m.floor, m.state);
      return ['queues'];
    },
  },
};
