// The floor's safe (see server/vault.ts): a .env file the office writes into every worker's worktree.
// Reading one, on both sides: which variables it sets, or the line it can't make sense of.

/** The most a safe holds, in characters. */
export const VAULT_MAX = 64 * 1024;

/** What a variable's name may be: a letter or _ first, then letters, digits, _ . and -. */
const NAME = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=(.*)$/;

/**
 * The variables a .env file sets, in order (a name set twice counts once, and its last value wins),
 * or what's wrong with it: every line is blank, a # comment or NAME=value. A value in double quotes
 * may use \n, \t and \" and, like one in single quotes (taken as it is), run on over more lines (a
 * private key, say) until its closing quote. An unquoted value ends at a # after a space.
 */
export function parseEnv(text: string): { keys: string[]; values: Record<string, string>; error?: string } {
  const keys: string[] = [];
  const values: Record<string, string> = {};
  if (text.length > VAULT_MAX) return { keys, values, error: `It's over ${VAULT_MAX / 1024} KB` };
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const m = NAME.exec(line);
    if (!m) return { keys, values, error: `Line ${i + 1} isn't NAME=value` };
    if (!keys.includes(m[1])) keys.push(m[1]);
    let value = m[2].trim();
    const q = value[0];
    if (q !== '"' && q !== "'") {
      values[m[1]] = value.replace(/\s+#.*$/, '');
      continue;
    }
    value = value.slice(1);
    const start = i;
    let end = closeAt(value, q);
    while (end < 0) {
      if (++i >= lines.length) return { keys, values, error: `The value on line ${start + 1} never closes its ${q}` };
      value += `\n${lines[i]}`;
      end = closeAt(value, q);
    }
    value = value.slice(0, end);
    values[m[1]] = q === "'" ? value : value.replace(/\\([nrt"\\])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c);
  }
  return { keys, values };
}

/** Where the closing quote is in `rest` (what follows an opening quote), not counting an escaped one; -1 when it isn't there. */
function closeAt(rest: string, q: string): number {
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '\\' && q === '"') i++;
    else if (rest[i] === q) return i;
  }
  return -1;
}
