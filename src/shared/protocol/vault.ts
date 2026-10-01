// The safe on every floor: the environment variables written into its workers' worktrees as .env.

/** A floor's safe, as one person may see it. */
export interface VaultState {
  /** The floor it's on. */
  floor: string;
  /** The names of the variables in it, in order. */
  keys: string[];
  /** The .env itself, for admins only: everyone else just sees the names. */
  text?: string;
  /** Whether they can open it and change what's in it. */
  canEdit: boolean;
  /** Who last changed it, and when. */
  by?: string;
  at?: number;
  /** How many worktrees (and the floor's own checkout) have it as their .env now. */
  stocked: number;
}

export type VaultClientMsg =
  /** Opening the safe: the office answers with a 'vault'. */
  | { t: 'vault.open' }
  /** An admin put a new .env in the safe (empty to clear it out). */
  | { t: 'vault.save'; text: string };

export type VaultServerMsg = { t: 'vault'; state: VaultState };
