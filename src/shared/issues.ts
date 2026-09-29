// Issue ids, as the boards, cards, queue and prompts pass them around. A GitHub issue's id is its
// number as text ("123"); an issue from another tracker keeps that tracker's identifier ("FOUND-2").

/** A GitHub number, or a team-prefixed identifier like FOUND-2. */
export const ISSUE_ID_RE = /^(\d+|[A-Za-z][A-Za-z0-9]*-\d+)$/;

/** The id an issue is written as: "#123" for a GitHub number, the identifier itself otherwise. */
export function issueLabel(id: string): string {
  return isGithubIssueId(id) ? `#${id}` : id;
}

export function isGithubIssueId(id: string): boolean {
  return /^\d+$/.test(id);
}

/**
 * An issue id from what someone typed or sent: "12", "#12" or "FOUND-2" (any case, which is kept as
 * upper case for identifiers). Undefined for anything else, including a GitHub number of 0.
 */
export function parseIssueId(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? String(value) : undefined;
  if (typeof value !== 'string') return undefined;
  const s = value.trim().replace(/^#/, '');
  if (!ISSUE_ID_RE.test(s)) return undefined;
  if (isGithubIssueId(s)) return Number(s) > 0 ? String(Number(s)) : undefined;
  return s.toUpperCase();
}

/** A small stable number from an id, to pick a note colour, a pin or a tilt with. */
export function hashIssue(id: string): number {
  if (isGithubIssueId(id)) return Number(id);
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
