// A worker's own worktree, or its workspace across repositories: their folder names, what's kept
// of them in workers.json, and taking a workspace away again.
import { execFileSync } from 'node:child_process';
import { readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import type { WorkerInfo, WorkerRepo } from '../../shared/protocol.js';
import { normalizeRepo } from '../../shared/floors.js';
import { WORKSPACE_FILES, workspaceOf } from '../worktrees.js';

/**
 * The folder each checkout gets in a workspace: its folder's name, made safe, with -2, -3… when two
 * checkouts share one (owner-a/api and owner-b/api).
 */
export function workspaceNames(dirs: string[]): string[] {
  const used = new Set<string>();
  return dirs.map((dir) => {
    let base = path.basename(path.resolve(dir)).replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '') || 'project';
    if (WORKSPACE_FILES.has(base)) base = `${base}-repo`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Takes a workspace folder away once its worktrees are gone: only the brief the office wrote, never anything else left in it. */
export function clearWorkspace(abs: string) {
  try {
    for (const name of readdirSync(abs)) if (WORKSPACE_FILES.has(name)) unlinkSync(path.join(abs, name));
    rmdirSync(abs);
  } catch {
    // already gone, or something else is in it: it stays
  }
}

/** The other repositories of a worker across repositories, as workers.json kept them. */
export function validRepos(raw: unknown): WorkerRepo[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const repos = raw.flatMap((r): WorkerRepo[] => {
    const floor = str(r?.floor), name = str(r?.name), dir = str(r?.dir), rel = str(r?.path), branch = str(r?.branch), base = str(r?.base);
    if (!floor || !name || !dir || !rel || !branch || !base) return [];
    const pr = r.pr && typeof r.pr.number === 'number' && typeof r.pr.url === 'string' ? { number: r.pr.number, url: r.pr.url } : undefined;
    return [{ floor, name, repo: str(r.repo), dir, path: rel, branch, base, from: str(r.from), pr }];
  });
  return repos.length ? repos : undefined;
}

/** owner/name of a checkout's origin on GitHub, when it has one. */
export function originRepo(dir: string): string | undefined {
  try {
    return normalizeRepo(execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim());
  } catch {
    return undefined;
  }
}

/** What starting a worker whose worktree was deleted (see WorkerInfo.lost) says instead. */
export function lostMessage(info: WorkerInfo): string {
  return `${info.name}'s worktree ${workspaceOf(info)} was deleted outside agent-office — rebuild it or send ${info.name} home from its desk`;
}
