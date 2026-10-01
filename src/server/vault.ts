import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VAULT_MAX, VAULT_VALUE_MAX, badVaultName, type VaultState } from '../shared/vault.js';

interface Saved {
  value: string;
  by: string;
  at: number;
}

/**
 * A floor's vault: environment variables every worker on the floor starts with (and so whatever it
 * runs: a dev server, its tests, the preview teammates open), kept in .agent-office/vault.json,
 * which only the office's user can read. Values go in and never come back out to a browser: the
 * window shows names, and putting one in again replaces it. A worker already running gets them the
 * next time it starts.
 */
export class Vault {
  private vars = new Map<string, Saved>();
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'vault.json');
    this.load();
  }

  state(floor: string): VaultState {
    const entries = [...this.vars].map(([name, v]) => ({ name, by: v.by, at: v.at })).sort((a, b) => a.name.localeCompare(b.name));
    return { floor, entries };
  }

  /** The variables, for a worker's environment. */
  env(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, v] of this.vars) env[name] = v.value;
    return env;
  }

  /** Puts `vars` in, all or none: the names it took, or why it took none. */
  set(vars: unknown, by: string): { names: string[] } | { error: string } {
    if (!Array.isArray(vars) || !vars.length) return { error: 'Nothing to put in the vault' };
    const next = new Map<string, string>();
    for (const v of vars) {
      const name = typeof v?.name === 'string' ? v.name.trim() : '';
      const value = v?.value;
      if (typeof value !== 'string') return { error: `No value for ${name || 'a variable'}` };
      const bad = badVaultName(name);
      if (bad) return { error: bad };
      if (value.length > VAULT_VALUE_MAX) return { error: `${name} is too long: the vault takes ${VAULT_VALUE_MAX / 1024} KB a value` };
      next.set(name, value);
    }
    const total = new Set([...this.vars.keys(), ...next.keys()]).size;
    if (total > VAULT_MAX) return { error: `The vault holds ${VAULT_MAX} variables` };
    const at = Date.now();
    for (const [name, value] of next) this.vars.set(name, { value, by, at });
    this.save();
    return { names: [...next.keys()] };
  }

  /** Takes `name` out; false when it wasn't in. */
  delete(name: string): boolean {
    if (!this.vars.delete(name)) return false;
    this.save();
    return true;
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, Partial<Saved>>;
      for (const [name, v] of Object.entries(raw)) {
        if (badVaultName(name) || typeof v?.value !== 'string') continue;
        this.vars.set(name, { value: v.value, by: typeof v.by === 'string' ? v.by : '', at: typeof v.at === 'number' ? v.at : 0 });
      }
    } catch (err) {
      console.warn(`agent-office: couldn't read ${this.file}, so the vault starts empty: ${(err as Error).message}`);
    }
  }

  private save() {
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.vars), null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
    } catch (err) {
      console.warn(`agent-office: couldn't save the vault to ${this.file}: ${(err as Error).message}`);
    }
  }
}
