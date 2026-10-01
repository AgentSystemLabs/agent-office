// The vault on every floor: environment variables for its workers (see shared/vault.ts).

import type { VaultState } from '../vault.js';

export type VaultClientMsg =
  /** The names in your floor's vault; the office answers with `vault`. */
  | { t: 'vault.get' }
  /** Put variables in (or change them): typed one at a time, or a whole .env file pasted. Admins only. */
  | { t: 'vault.set'; vars: { name: string; value: string }[] }
  /** Take a variable out. Admins only. */
  | { t: 'vault.delete'; name: string };

export type VaultServerMsg =
  /** What's in the vault of the floor you're on: sent when you ask, and to the floor whenever it changes. */
  { t: 'vault'; state: VaultState };
