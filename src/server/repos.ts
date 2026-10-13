// What the office's `gh` login can see on GitHub: the repositories it can clone, and the branches of
// one of them. The elevator's "add a project" is what asks, through the Building.
import { normalizeBranch, normalizeRepo } from '../shared/floors.js';
import type { BranchChoices, RepoChoice } from '../shared/protocol.js';
import { gh } from './github.js';

/** The most repositories the elevator lists, and the most branches of one. */
const MAX_REPOS = 1000;
const MAX_BRANCHES = 500;

/** Repositories the office's `gh` login can clone, most recently pushed first. */
export async function listRepos(cwd: string): Promise<RepoChoice[]> {
  const out = await gh(
    [
      'api',
      '--paginate',
      'user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
      '--jq',
      '.[] | {name: .full_name, description: (.description // ""), private: .private, pushedAt: .pushed_at}',
    ],
    cwd,
    90_000,
  );
  const repos: RepoChoice[] = [];
  const seen = new Set<string>();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { name?: unknown; description?: unknown; private?: unknown; pushedAt?: unknown };
      const name = normalizeRepo(r.name);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      repos.push({
        name,
        description: typeof r.description === 'string' && r.description ? r.description.slice(0, 200) : undefined,
        private: r.private === true,
        pushedAt: typeof r.pushedAt === 'string' ? r.pushedAt : undefined,
      });
    } catch {
      // not a line of ours
    }
    if (repos.length >= MAX_REPOS) break;
  }
  return repos.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
}

/**
 * The branches of a repository, for the elevator's "add a project" to clone a floor on one of them.
 * The default branch is always among them, even when the list was cut short before it.
 */
export async function listBranches(cwd: string, repo: string): Promise<BranchChoices> {
  const [names, view] = await Promise.all([
    gh(['api', '--paginate', `repos/${repo}/branches?per_page=100`, '--jq', '.[].name'], cwd, 60_000),
    gh(['repo', 'view', repo, '--json', 'defaultBranchRef'], cwd, 30_000).catch(() => ''),
  ]);
  const branches: string[] = [];
  const seen = new Set<string>();
  for (const line of names.split('\n')) {
    const name = normalizeBranch(line);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    branches.push(name);
    if (branches.length >= MAX_BRANCHES) break;
  }
  const def = normalizeBranch(defaultBranchOf(view));
  if (def && !seen.has(def)) branches.unshift(def);
  return { branches, ...(def ? { default: def } : {}) };
}

/** The default branch's name in `gh repo view --json defaultBranchRef`'s answer, when it names one. */
function defaultBranchOf(view: string): unknown {
  try {
    return (JSON.parse(view) as { defaultBranchRef?: { name?: unknown } }).defaultBranchRef?.name;
  } catch {
    return undefined;
  }
}
