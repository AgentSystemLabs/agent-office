import type { LanguageState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The language the office speaks: its toasts and errors (⚙️ Settings, admins). */
    language: LanguageState;
  }
  interface Topics {
    language: true;
  }
}

export const language: Slice = {
  init(s) {
    s.language = { lang: 'en' };
  },
  on: {
    welcome(s, m) {
      s.language = m.language ?? { lang: 'en' };
      return ['language'];
    },
    language(s, m) {
      s.language = m.state;
      return ['language'];
    },
  },
};
