// The project's own .env files, in each worktree the office makes. They're ignored by git (they
// hold secrets), so `git worktree add` leaves them behind, and a worker's `npm run dev` would start
// without them: copied in, the worktree runs like the checkout it came from.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/** .env, .env.local, .env.development.local… */
const ENV_FILE = /^\.env(\.[\w.-]+)?$/;

/**
 * Copies the .env files at the top of `project` into the worktree at `into`: only the ones git
 * ignores there (a tracked .env.example is in the worktree already), and never over one it has.
 * Returns the names it copied.
 */
export function copyEnvFiles(project: string, into: string): string[] {
  let names: string[];
  try {
    names = readdirSync(project).filter((n) => ENV_FILE.test(n) && statSync(path.join(project, n)).isFile());
  } catch {
    return [];
  }
  if (!names.length) return [];
  const ignored = ignoredOf(project, names);
  const copied: string[] = [];
  for (const n of names) {
    const to = path.join(into, n);
    if (!ignored.has(n) || existsSync(to)) continue;
    try {
      copyFileSync(path.join(project, n), to);
      copied.push(n);
    } catch {
      // the worktree runs without it, as it would have anyway
    }
  }
  return copied;
}

/** Which of `names` git ignores in `dir` (tracked files never are). */
function ignoredOf(dir: string, names: string[]): Set<string> {
  let out: string;
  try {
    out = execFileSync('git', ['check-ignore', '--', ...names], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
  } catch (err) {
    // Exits 1 when none of them are ignored.
    out = String((err as { stdout?: string }).stdout ?? '');
  }
  return new Set(out.split('\n').map((l) => l.trim()).filter(Boolean));
}
