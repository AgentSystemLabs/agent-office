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

/** Where a floor's issues come from. Pull requests always come from GitHub. */
export type IssueTracker = 'github' | 'linear';

export const TRACKER_NAME: Record<IssueTracker, string> = { github: 'GitHub', linear: 'Linear' };

/**
 * What an issue's prompts fill in (the 'issue.*' prompts in shared/prompts.ts): its id both bare and
 * as it's written, the tracker's name, how a worker reads it there, and for Linear the branch it
 * suggests. `number` keeps its old name, so prompts rewritten before there were trackers still work.
 */
export function issueVarsFor(tracker: IssueTracker, it: { id: string; title: string; url?: string; branch?: string }) {
  const label = issueLabel(it.id);
  return {
    number: it.id,
    label,
    title: it.title,
    url: it.url ?? '',
    tracker: TRACKER_NAME[tracker],
    read: tracker === 'linear' ? `the Linear MCP tool \`get_issue\` with id "${it.id}" (and \`list_comments\` for its comments)` : `\`gh issue view ${it.id} --comments\``,
    branch: tracker === 'linear' && it.branch ? ` (Linear suggests \`${it.branch}\`)` : '',
  };
}

/** What the board agents' briefs fill in (the 'station.*' prompts): which tracker, and how to reach it. */
export function stationVarsFor(tracker: IssueTracker) {
  return tracker === 'linear'
    ? { tracker: 'Linear', issueTool: 'the Linear MCP tools (list_issues, get_issue, save_issue, save_comment)', issueList: 'list_issues', issueExample: 'FOUND-2' }
    : { tracker: 'GitHub', issueTool: 'the gh CLI', issueList: 'gh issue list', issueExample: '12' };
}

/** What the 📌 board is narrowed to, on top of each column's labels: Linear's My issues, assignee and search. */
export interface IssueFilter {
  /** Only issues assigned to whoever the office acts as (the tracker's viewer). */
  mine?: boolean;
  /** Only issues assigned to, or opened by, this person. */
  user?: string;
  /** Only issues in this project (Linear) or milestone (GitHub). */
  project?: string;
  /** Words that must all appear in the id, title, body, labels, project or people. */
  search?: string;
}

/** Whether a filter narrows the board at all. */
export function filterActive(f: IssueFilter): boolean {
  return !!(f.mine || f.user || f.project || f.search?.trim());
}

type Filterable = { id: string; title: string; body: string; author: string; assignees: string[]; labels: { name: string }[]; project?: string };

/**
 * The cards a filter keeps. `viewer` is who "mine" means; with none known, "mine" keeps nothing rather
 * than everything, so the button never quietly shows the whole board. Search is case-insensitive and
 * every word must be found somewhere on the card.
 */
export function filterIssues<T extends Filterable>(items: T[], f: IssueFilter, viewer?: string): T[] {
  const words = (f.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const me = viewer?.toLowerCase();
  const user = f.user?.toLowerCase();
  const project = f.project?.toLowerCase();
  return items.filter((it) => {
    if (f.mine && !(me && it.assignees.some((a) => a.toLowerCase() === me))) return false;
    if (user && !(it.assignees.some((a) => a.toLowerCase() === user) || it.author.toLowerCase() === user)) return false;
    if (project && (it.project ?? '').toLowerCase() !== project) return false;
    if (words.length) {
      const hay = [it.id, issueLabel(it.id), it.title, it.body, it.project ?? '', it.author, ...it.assignees, ...it.labels.map((l) => l.name)].join('\n').toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/** Everyone on the board's cards (assignees and authors) and every project, each sorted, for the filter menus. */
export function boardPeople(items: Filterable[]): { people: string[]; projects: string[] } {
  const people = new Set<string>();
  const projects = new Set<string>();
  for (const it of items) {
    if (it.author) people.add(it.author);
    for (const a of it.assignees) people.add(a);
    if (it.project) projects.add(it.project);
  }
  const sort = (xs: Iterable<string>) => [...xs].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return { people: sort(people), projects: sort(projects) };
}
