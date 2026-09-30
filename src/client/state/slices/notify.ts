import type { NotifyState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The office's Slack / Discord webhook. */
    notify: NotifyState;
  }
  interface Topics {
    notify: true;
  }
}

export const notify: Slice = {
  init(s) {
    s.notify = {};
  },
  on: {
    welcome(s, m) {
      s.notify = m.notify;
      return ['notify'];
    },
    notify(s, m) {
      s.notify = m.state;
      return ['notify'];
    },
  },
};
