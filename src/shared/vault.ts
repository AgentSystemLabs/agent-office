// The floor's safe (see server/vault.ts): a .env file the office writes into every worker's worktree.
// Reading one, on both sides: which variables it sets, or the line it can't make sense of.

/** The most a safe holds, in characters. */
export const VAULT_MAX = 64 * 1024;

/** What a variable's name may be: a letter or _ first, then letters, digits, _ . and -. */
const NAME = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/;

/**
 * The variables a .env file sets, in order (a name set twice counts once), or what's wrong with it:
 * every line is blank, a # comment or NAME=value, and a value in double or single quotes may run on
 * over more lines (a private key, say) until its closing quote.
 */
export function parseEnv(text: string): { keys: string[]; error?: string } {
  if (text.length > VAULT_MAX) return { keys: [], error: `It's over ${VAULT_MAX / 1024} KB` };
  const keys: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const m = NAME.exec(line);
    if (!m) return { keys, error: `Line ${i + 1} isn't NAME=value` };
    if (!keys.includes(m[1])) keys.push(m[1]);
    const value = m[2].trim();
    const q = value[0];
    if ((q === '"' || q === "'") && !closes(value.slice(1), q)) {
      const start = i;
      while (++i < lines.length && !closes(lines[i], q));
      if (i >= lines.length) return { keys, error: `The value on line ${start + 1} never closes its ${q}` };
    }
  }
  return { keys };
}

/** Whether `rest` (what follows an opening quote) has its closing quote, not counting an escaped one. */
function closes(rest: string, q: string): boolean {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '\\') i++;
    else if (rest[i] === q) return true;
  }
  return false;
}
