import type { GhIssue, GhIssuesState } from './protocol.js';

export const MAX_ISSUE_REPOSITORIES = 10;

/** Deliberately accept owner/repo only: never CLI switches, paths, or arbitrary hosts. */
export function normalizeIssueRepository(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (name.length > 140) return undefined;
  const parts = name.split('/');
  if (parts.length !== 2) return undefined;
  const [owner, repo] = parts;
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(owner)) return undefined;
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') return undefined;
  return name;
}

export function sameRepository(a: string | undefined, b: string | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/** Legacy issue messages have no repository and refer to the current checkout. */
export function isCurrentIssue(issue: Pick<GhIssue, 'repository'>, state: GhIssuesState): boolean {
  return !issue.repository || sameRepository(issue.repository, state.currentRepository);
}
