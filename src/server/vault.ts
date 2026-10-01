import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from '../shared/vault.js';

// The safe on every floor: the environment variables its workers' services need (an API's read
// token, a database URL), kept in the floor's .agent-office/vault.json where only the office's user
// can read it. The office writes it as .env into every worktree it makes for a worker, and into the
// floor's own checkout, so `npm run dev` there finds what it needs and the preview works. Git is
// told to ignore that .env, so a worker can't commit it by mistake. Each worker also starts with
// them in its environment (see workerEnv in workers/env.ts).
//
// A .env the safe wrote starts with STOCK_MARK, and it's rewritten (or taken away) when the safe
// changes. One that doesn't, the project's own or one someone wrote by hand, is never touched.

/** What the safe holds, as saved. */
export interface Saved {
  text: string;
  by: string;
  at: number;
}

/** The first line of a .env the safe wrote. */
export const STOCK_MARK = '# From the agent-office safe 🔐: change it there. Take this line out to keep your own.';
const WORKTREES = path.join('.agent-office', 'worktrees');

const fileOf = (dir: string) => path.join(dir, '.agent-office', 'vault.json');

/** What's in floor `dir`'s safe; undefined when it's empty. */
export function readVault(dir: string): Saved | undefined {
  try {
    const saved = JSON.parse(readFileSync(fileOf(dir), 'utf8')) as Saved;
    return typeof saved.text === 'string' && saved.text.trim() ? saved : undefined;
  } catch {
    return undefined;
  }
}

/** The variables in floor `dir`'s safe, by name, for a worker's environment (see workerEnv). */
export function vaultEnv(dir: string): Record<string, string> {
  const saved = readVault(dir);
  return saved ? parseEnv(saved.text).values : {};
}

/**
 * Puts `text` in floor `dir`'s safe (nothing but space empties it) and writes it out to every
 * checkout of the floor's. Says what's wrong with it instead, when it isn't a .env file.
 */
export function saveVault(dir: string, text: string, by: string): { error: string } | { keys: string[]; stocked: number } {
  const { keys, error } = parseEnv(text);
  if (error) return { error };
  const file = fileOf(dir);
  try {
    if (text.trim()) {
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      const saved: Saved = { text: text.replace(/\r\n/g, '\n').replace(/\n*$/, '\n'), by, at: Date.now() };
      writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
    } else rmSync(file, { force: true });
  } catch (err) {
    return { error: `Couldn't save the safe: ${(err as Error).message}` };
  }
  return { keys, stocked: restock(dir) };
}

/**
 * Writes floor `dir`'s safe into the checkout at `at` (a worktree of the floor's, or the floor
 * itself) as its .env, unless it has a .env of its own; with the safe empty, takes away a .env the
 * safe wrote there. Returns whether `at` has the safe's .env now. Never throws: a worktree is still
 * a worktree without it.
 */
export function stock(dir: string, at: string): boolean {
  const env = path.join(at, '.env');
  try {
    const ours = !existsSync(env) || readFileSync(env, 'utf8').startsWith(STOCK_MARK);
    if (!ours) return false;
    const saved = readVault(dir);
    if (!saved) {
      rmSync(env, { force: true });
      return false;
    }
    ignoreEnv(at);
    writeFileSync(env, `${STOCK_MARK}\n${saved.text}`, { mode: 0o600 });
    return true;
  } catch (err) {
    console.warn(`agent-office: couldn't write the safe's .env into ${at}: ${(err as Error).message}`);
    return false;
  }
}

/** Every checkout of floor `dir`'s project: itself and the worktrees the office made for its workers. */
export function checkouts(dir: string): string[] {
  const own = commonDir(dir);
  if (!own) return [];
  const found = [dir];
  const look = (folder: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(folder, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return;
    }
    for (const name of names) {
      const sub = path.join(folder, name);
      // A worktree has a .git file; a workspace of a worker across repositories has one per project.
      if (existsSync(path.join(sub, '.git'))) {
        if (commonDir(sub) === own) found.push(sub);
      } else if (depth > 0) look(sub, depth - 1);
    }
  };
  look(path.join(dir, WORKTREES), 1);
  return found;
}

/** Writes the safe out to every checkout of floor `dir`'s (see stock), and says how many have it now. */
export function restock(dir: string): number {
  return checkouts(dir).filter((at) => stock(dir, at)).length;
}

/** How many checkouts of floor `dir`'s have the safe's .env. */
export function stocked(dir: string): number {
  return checkouts(dir).filter((at) => {
    try {
      return readFileSync(path.join(at, '.env'), 'utf8').startsWith(STOCK_MARK);
    } catch {
      return false;
    }
  }).length;
}

/** Tells git to ignore .env in the repository `at` is a checkout of, when nothing does already. */
function ignoreEnv(at: string) {
  const ignored = (() => {
    try {
      execFileSync('git', ['check-ignore', '-q', '.env'], { cwd: at, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  if (ignored) return;
  const common = commonDir(at);
  if (!common) return;
  const exclude = path.join(common, 'info', 'exclude');
  mkdirSync(path.dirname(exclude), { recursive: true });
  const had = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  appendFileSync(exclude, `${had && !had.endsWith('\n') ? '\n' : ''}# The agent-office safe's .env (see .agent-office/vault.json)\n/.env\n`);
}

/** The git folder a checkout's repository keeps, which all its worktrees share. */
function commonDir(at: string): string | undefined {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: at, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return realpathSync(path.resolve(at, out));
  } catch {
    return undefined;
  }
}
