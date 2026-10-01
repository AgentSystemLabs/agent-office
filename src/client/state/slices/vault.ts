import type { VaultState } from '../../../shared/vault';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The names in the vault of the floor you're on, once you've opened it (see ui/vault.ts). */
    vault: VaultState | null;
  }
  interface Topics {
    vault: true;
  }
}

export const vault: Slice = {
  init(s) {
    s.vault = null;
  },
  on: {
    vault(s, m) {
      s.vault = m.state;
      return ['vault'];
    },
  },
};
