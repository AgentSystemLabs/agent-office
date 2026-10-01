import type { UpgradeState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The office upgrading itself (deployed from git: see UpgradeState). */
    upgrade: UpgradeState;
  }
  interface Topics {
    upgrade: true;
  }
}

export const upgrade: Slice = {
  init(s) {
    s.upgrade = { available: false, phase: 'idle' };
  },
  on: {
    welcome(s, m) {
      s.upgrade = m.upgrade;
      return ['upgrade'];
    },
    upgrade(s, m) {
      s.upgrade = m.state;
      return ['upgrade'];
    },
  },
};
