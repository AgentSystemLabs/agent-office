// The vault on every floor: environment variables (API keys, read tokens, a database URL) that the
// floor's workers start with, so the services they run (and their previews) work in any worktree.
// The office keeps the values (see server/vault.ts); browsers only ever see their names.

/** How many variables a floor's vault holds. */
export const VAULT_MAX = 200;
/** The longest value it takes: a PEM key or a service account's JSON fits. */
export const VAULT_VALUE_MAX = 16 * 1024;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** What the office sets for its workers itself, or a shell needs to be its own: the vault can't stand in for them. */
const RESERVED = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'TERM', 'COLORTERM']);
const RESERVED_PREFIXES = ['AGENT_OFFICE_'];

/** One variable in the vault, as a browser sees it: never its value. */
export interface VaultEntry {
  name: string;
  /** Who put it in last, and when. */
  by: string;
  at: number;
}

export interface VaultState {
  /** The floor it's on, so a window open while you change floors knows it's another vault. */
  floor: string;
  entries: VaultEntry[];
}

/** Why `name` can't be a variable in the vault, or undefined when it can. */
export function badVaultName(name: string): string | undefined {
  if (!NAME_RE.test(name)) return `“${name.slice(0, 40)}” isn't a variable name: letters, digits and _, not starting with a digit`;
  const upper = name.toUpperCase();
  if (RESERVED.has(upper) || RESERVED_PREFIXES.some((p) => upper.startsWith(p))) return `${name} is the office's to set`;
  return undefined;
}

/**
 * The variables in text pasted from a .env file: `NAME=value` lines, with `export ` in front or not,
 * values in single quotes as they are, in double quotes with \n and the like, or bare with a
 * trailing # comment. Blank lines and comments are skipped; `bad` lists the lines that are neither.
 */
export function parseDotenv(text: string): { vars: { name: string; value: string }[]; bad: string[] } {
  const vars: { name: string; value: string }[] = [];
  const bad: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      bad.push(line);
      continue;
    }
    const name = m[1];
    let rest = m[2];
    let value: string;
    const q = rest[0];
    if (q === '"' || q === "'" || q === '`') {
      // A quoted value may run on over the next lines until its closing quote.
      let body = rest.slice(1);
      let end = closing(body, q);
      while (end < 0 && i + 1 < lines.length) {
        body += '\n' + lines[++i];
        end = closing(body, q);
      }
      value = end < 0 ? body : body.slice(0, end);
      if (q === '"') value = value.replace(/\\([nrt"\\])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c);
    } else {
      rest = rest.replace(/\s+#.*$/, '');
      value = rest.trim();
    }
    vars.push({ name, value });
  }
  return { vars, bad };
}

/** Where the quote `q` closes in `s`: a double quote can be escaped with a backslash. */
function closing(s: string, q: string): number {
  for (let i = 0; i < s.length; i++) {
    if (q === '"' && s[i] === '\\') i++;
    else if (s[i] === q) return i;
  }
  return -1;
}
