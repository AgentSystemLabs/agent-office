import type { AccountsState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Everyone's accounts; only admins get these. */
    accounts: AccountsState | null;
  }
  interface Topics {
    accounts: true;
  }
}

export const accounts: Slice = {
  init(s) {
    s.accounts = null;
  },
  on: {
    accounts(s, m) {
      s.accounts = m.state;
      return ['accounts'];
    },
  },
};
