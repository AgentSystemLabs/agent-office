import type { PromptsState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The office's prompts as rewritten in ⚙️ Settings, and the worker everyone starts on: the same on every floor. */
    prompts: PromptsState;
  }
  interface Topics {
    prompts: true;
  }
}

export const prompts: Slice = {
  init(s) {
    s.prompts = { custom: {} };
  },
  on: {
    welcome(s, m) {
      s.prompts = m.prompts ?? { custom: {} };
      return ['prompts'];
    },
    prompts(s, m) {
      s.prompts = m.state;
      return ['prompts'];
    },
  },
};
