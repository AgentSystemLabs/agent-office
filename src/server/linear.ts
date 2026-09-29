// The 📌 issue board from Linear, through its GraphQL API with the office's API key (linear-key.ts).
// Pull requests still come from GitHub; this is the issues half of the boards, the cards, the queue's
// links and the prompts. Ids are Linear identifiers like FOUND-2 (see shared/issues.ts).

import type { GhCloseReason, GhComment, GhIssue, GhIssueDetail, GhLabel, GhState } from '../shared/protocol.js';
import type { IssueProvider, IssuesConfig } from './issues.js';
import type { KeyCheck, KeySource } from './linear-key.js';

export type LinearConfig = Extract<IssuesConfig, { provider: 'linear' }>;

const API = 'https://api.linear.app/graphql';
const TIMEOUT_MS = 15_000;
/** Issues a page holds, and how many pages of open issues a team gets (500). */
const PAGE = 100;
const MAX_PAGES = 5;
const CLOSED_KEPT = 20;
const BODY_MAX = 4000;
/** How long the list of labels is kept before the label picker asks Linear again. */
const LABELS_MS = 60_000;
/** After Linear says slow down, how long the board waits before asking again. */
const RATE_LIMIT_PAUSE_MS = 2 * 60_000;

const OPEN_TYPES = ['triage', 'backlog', 'unstarted', 'started'];
const CLOSED_TYPES = ['completed', 'canceled'];

export const NO_KEY = 'No Linear API key yet: an admin can paste one on the 📌 Issues board.';
export const BAD_KEY = 'Linear rejected the API key. Paste a new one on the 📌 Issues board.';
export const RATE_LIMITED = 'Linear is rate-limiting the office; the board asks again in a couple of minutes.';

/** Linear turned the key away (401, or an authentication error in the answer). */
export class LinearAuthError extends Error {}
/** Linear asked for fewer calls (429). */
export class LinearRateLimit extends Error {}

/** One call to Linear's GraphQL API as `key`. Resolves to `data`; throws with a message a person can act on. */
export async function linearQuery<T>(key: string, query: string, variables: Record<string, unknown> = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchImpl(API, {
      method: 'POST',
      // A personal API key goes as it is; an OAuth token as a bearer token.
      headers: { 'content-type': 'application/json', authorization: key.startsWith('lin_oauth_') ? `Bearer ${key}` : key },
      body: JSON.stringify({ query, variables }),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const e = err as Error;
    throw new Error(e.name === 'TimeoutError' ? 'Linear did not answer in time' : `Couldn't reach Linear: ${(e.cause as Error | undefined)?.message ?? e.message}`);
  }
  if (res.status === 401 || res.status === 403) throw new LinearAuthError('Linear rejected the API key');
  if (res.status === 429) throw new LinearRateLimit('Linear is rate-limiting the office');
  const json = (await res.json().catch(() => null)) as { data?: T; errors?: { message?: string; extensions?: { code?: string; type?: string } }[] } | null;
  const first = json?.errors?.[0];
  if (first) {
    const code = `${first.extensions?.code ?? ''} ${first.extensions?.type ?? ''}`;
    if (/AUTHENTICATION|FORBIDDEN|UNAUTHENTICATED/i.test(code) || /not authenticated|authentication required|invalid.*key/i.test(first.message ?? '')) throw new LinearAuthError('Linear rejected the API key');
    if (/RATELIMIT|RATE_LIMIT/i.test(code)) throw new LinearRateLimit('Linear is rate-limiting the office');
    throw new Error(`Linear: ${first.message ?? 'unknown error'}`);
  }
  if (!res.ok) throw new Error(`Linear answered ${res.status}`);
  if (!json?.data) throw new Error('Linear answered without data');
  return json.data;
}

/** Who a key acts as, which is also whether it works at all. */
export async function checkLinearKey(key: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  const data = await linearQuery<{ viewer: { id: string; displayName?: string; name?: string; organization?: { name?: string } } }>(key, `query { viewer { id displayName name organization { name } } }`, {}, fetchImpl);
  const v = data.viewer;
  return { viewerId: v.id, viewer: v.displayName || v.name || 'someone', workspace: v.organization?.name ?? '' };
}

const ISSUE_FIELDS = `fragment IssueFields on Issue {
  id identifier title description url priority createdAt updatedAt branchName
  state { name type }
  labels { nodes { id name color } }
  assignee { displayName }
  creator { displayName }
}`;

interface RawLabel {
  id?: string;
  name: string;
  color?: string;
  description?: string;
}
interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url: string;
  priority?: number;
  createdAt: string;
  updatedAt: string;
  branchName?: string | null;
  state?: { name?: string; type?: string } | null;
  labels?: { nodes?: RawLabel[] } | null;
  assignee?: { displayName?: string } | null;
  creator?: { displayName?: string } | null;
}
interface RawComment {
  id: string;
  body: string;
  createdAt: string;
  url?: string;
  user?: { displayName?: string } | null;
  botActor?: { name?: string } | null;
}
interface Page<T> {
  nodes: T[];
  pageInfo?: { hasNextPage: boolean; endCursor?: string | null };
}

function labels(raw: RawLabel[] | undefined | null): GhLabel[] {
  return (raw ?? [])
    .filter((l) => l && typeof l.name === 'string' && l.name.trim())
    .map((l) => ({ name: l.name.trim(), color: typeof l.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(l.color) ? l.color : '#888888', ...(l.description ? { description: l.description } : {}) }));
}

/** Linear's priority as an order: urgent (1) first, low (4) last, none (0) after those. */
function priorityOrder(p: number | undefined): number {
  return p && p >= 1 && p <= 4 ? p : 5;
}

const CLOSED = new Set(CLOSED_TYPES.concat('cancelled'));

export class LinearIssues implements IssueProvider {
  readonly kind = 'linear' as const;
  issues: GhState<GhIssue> = { items: [], fetchedAt: 0, loading: false };
  private pausedUntil = 0;
  private labelList?: { at: number; list: Promise<GhLabel[]> };
  /** Linear's own ids, which its mutations take, by identifier; filled by every refresh. */
  private uuids = new Map<string, string>();
  /** Label ids by name, from the last list of labels. */
  private labelIds = new Map<string, string>();
  /** Each team's Done and Canceled workflow states, once asked. */
  private stateIds = new Map<string, Partial<Record<'completed' | 'canceled', string>>>();
  private viewerName = '';

  /**
   * @param keys the office's key, or none yet
   * @param fetchImpl how Linear is reached (a fake in tests)
   */
  constructor(
    private cfg: LinearConfig,
    private keys: KeySource,
    private onIssues: (s: GhState<GhIssue>) => void,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  get pausedFor(): number {
    return Math.max(0, this.pausedUntil - Date.now());
  }

  async refreshIssues(): Promise<void> {
    if (this.issues.loading) return;
    if (this.pausedUntil > Date.now()) return;
    if (!this.keys.key()) {
      this.issues = { items: [], fetchedAt: Date.now(), loading: false, error: NO_KEY };
      this.onIssues(this.issues);
      return;
    }
    this.issues = { ...this.issues, loading: true };
    this.onIssues(this.issues);
    try {
      const raw: RawIssue[] = [];
      for (const team of this.cfg.teams) {
        let after: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const d = await this.query<{ issues: Page<RawIssue> }>(
            `${ISSUE_FIELDS}
query Open($team: String!, $types: [String!]!, $after: String) {
  issues(first: ${PAGE}, after: $after, orderBy: updatedAt, filter: { team: { key: { eq: $team } }, state: { type: { in: $types } } }) { nodes { ...IssueFields } pageInfo { hasNextPage endCursor } }
}`,
            { team, types: OPEN_TYPES, after },
          );
          raw.push(...(d.issues.nodes ?? []));
          if (!d.issues.pageInfo?.hasNextPage || !d.issues.pageInfo.endCursor) break;
          after = d.issues.pageInfo.endCursor;
        }
        const closed = await this.query<{ issues: Page<RawIssue> }>(
          `${ISSUE_FIELDS}
query Closed($team: String!, $types: [String!]!) {
  issues(first: ${CLOSED_KEPT}, orderBy: updatedAt, filter: { team: { key: { eq: $team } }, state: { type: { in: $types } } }) { nodes { ...IssueFields } }
}`,
          { team, types: CLOSED_TYPES },
        );
        raw.push(...(closed.issues.nodes ?? []));
      }
      const items = raw.filter((i) => i && typeof i.identifier === 'string').map((i) => this.toIssue(i));
      // Urgent first, then what moved last; the sort is stable, so within a priority the newest stays first.
      items.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority) || b.updatedAt.localeCompare(a.updatedAt));
      this.issues = { items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      this.issues = { ...this.issues, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.onIssues(this.issues);
  }

  private toIssue(i: RawIssue): GhIssue {
    const id = i.identifier.trim().toUpperCase();
    if (i.id) this.uuids.set(id, i.id);
    const status = String(i.state?.type ?? '').toLowerCase();
    return {
      id,
      title: String(i.title ?? ''),
      state: CLOSED.has(status) ? 'CLOSED' : 'OPEN',
      url: String(i.url ?? ''),
      author: i.creator?.displayName ?? '',
      labels: labels(i.labels?.nodes),
      assignees: i.assignee?.displayName ? [i.assignee.displayName] : [],
      createdAt: String(i.createdAt ?? ''),
      updatedAt: String(i.updatedAt ?? ''),
      body: String(i.description ?? '').slice(0, BODY_MAX),
      comments: 0,
      status,
      priority: typeof i.priority === 'number' ? i.priority : undefined,
      branch: i.branchName || undefined,
    };
  }

  async issueDetail(id: string): Promise<GhIssueDetail> {
    const d = await this.query<{ issue: RawIssue & { comments?: Page<RawComment> }; viewer?: { displayName?: string } }>(
      `query Detail($id: String!) {
  issue(id: $id) { id identifier description state { type } comments(first: 100) { nodes { id body createdAt url user { displayName } botActor { name } } } }
  viewer { displayName }
}`,
      { id },
    );
    if (!d.issue) throw new Error(`Linear has no issue ${id}`);
    if (d.issue.id) this.uuids.set(id, d.issue.id);
    if (d.viewer?.displayName) this.viewerName = d.viewer.displayName;
    const comments = (d.issue.comments?.nodes ?? [])
      .filter((c) => c && typeof c.body === 'string')
      .map((c) => ({ id: String(c.id ?? ''), author: c.user?.displayName ?? c.botActor?.name ?? '', body: c.body, createdAt: String(c.createdAt ?? ''), url: String(c.url ?? '') }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { id, state: CLOSED.has(String(d.issue.state?.type ?? '').toLowerCase()) ? 'CLOSED' : 'OPEN', body: String(d.issue.description ?? ''), comments, viewer: this.viewerName };
  }

  async comment(_kind: 'issue', id: string, body: string): Promise<{ comment?: GhComment; error?: string }> {
    try {
      const issueId = await this.uuid(id);
      const d = await this.query<{ commentCreate: { success: boolean; comment?: RawComment } }>(
        `mutation Comment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id body createdAt url user { displayName } } }
}`,
        { issueId, body },
      );
      const c = d.commentCreate?.comment;
      if (!d.commentCreate?.success || !c) return { error: 'Linear did not take the comment' };
      return { comment: { id: String(c.id ?? ''), author: c.user?.displayName ?? this.viewerName, body: String(c.body ?? body), createdAt: String(c.createdAt ?? new Date().toISOString()), url: String(c.url ?? '') } };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  async close(_kind: 'issue', id: string, opts: { comment?: string; reason?: GhCloseReason }): Promise<string | undefined> {
    const type = opts.reason === 'not planned' ? 'canceled' : 'completed';
    try {
      const issueId = await this.uuid(id);
      const stateId = await this.stateId(id, type);
      if (opts.comment) {
        const r = await this.comment('issue', id, opts.comment);
        if (r.error) return r.error;
      }
      const d = await this.query<{ issueUpdate: { success: boolean } }>(`mutation Close($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`, { id: issueId, stateId });
      if (!d.issueUpdate?.success) return 'Linear did not close the issue';
    } catch (err) {
      return (err as Error).message;
    }
    // Closed on the board at once, before Linear is asked again.
    this.issues = { ...this.issues, items: this.issues.items.map((i) => (i.id === id ? { ...i, state: 'CLOSED', status: type } : i)) };
    this.onIssues(this.issues);
    void this.refreshIssues();
    return undefined;
  }

  async claim(id: string): Promise<string | undefined> {
    try {
      const issueId = await this.uuid(id);
      const assigneeId = this.keys.viewerId() ?? (await this.query<{ viewer: { id: string } }>(`query { viewer { id } }`)).viewer.id;
      const d = await this.query<{ issueUpdate: { success: boolean } }>(`mutation Claim($id: String!, $assigneeId: String!) { issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success } }`, { id: issueId, assigneeId });
      if (!d.issueUpdate?.success) return 'Linear did not assign the issue';
    } catch (err) {
      return (err as Error).message;
    }
    void this.refreshIssues();
    return undefined;
  }

  repoLabels(): Promise<GhLabel[]> {
    if (!this.labelList || Date.now() - this.labelList.at > LABELS_MS) {
      const list = this.query<{ issueLabels: Page<RawLabel> }>(
        `query Labels($teams: [String!]!) {
  issueLabels(first: 250, filter: { or: [{ team: { null: true } }, { team: { key: { in: $teams } } }] }) { nodes { id name color description } }
}`,
        { teams: this.cfg.teams },
      ).then((d) => {
        const raw = d.issueLabels?.nodes ?? [];
        for (const l of raw) if (l?.id && l.name) this.labelIds.set(l.name.trim(), l.id);
        // The same name on the workspace and a team is one label to the picker.
        const seen = new Set<string>();
        return labels(raw).filter((l) => !seen.has(l.name.toLowerCase()) && seen.add(l.name.toLowerCase()));
      });
      this.labelList = { at: Date.now(), list };
      list.catch(() => this.labelList?.list === list && (this.labelList = undefined));
    }
    return this.labelList.list;
  }

  async setLabels(_kind: 'issue', id: string, add: string[], remove: string[]): Promise<{ labels?: GhLabel[]; error?: string }> {
    try {
      const issueId = await this.uuid(id);
      const [, current] = await Promise.all([this.repoLabels(), this.query<{ issue: { labels?: Page<RawLabel> } }>(`query Has($id: String!) { issue(id: $id) { labels { nodes { id name } } } }`, { id: issueId })]);
      const gone = new Set(remove.map((n) => n.toLowerCase()));
      const ids = new Set((current.issue?.labels?.nodes ?? []).filter((l) => l.id && !gone.has(l.name.toLowerCase())).map((l) => l.id!));
      for (const name of add) {
        const labelId = this.labelIds.get(name) ?? [...this.labelIds].find(([n]) => n.toLowerCase() === name.toLowerCase())?.[1];
        if (!labelId) return { error: `Linear has no label “${name}”` };
        ids.add(labelId);
      }
      const d = await this.query<{ issueUpdate: { success: boolean; issue?: { labels?: Page<RawLabel> } } }>(
        `mutation Relabel($id: String!, $labelIds: [String!]!) { issueUpdate(id: $id, input: { labelIds: $labelIds }) { success issue { labels { nodes { id name color } } } } }`,
        { id: issueId, labelIds: [...ids] },
      );
      if (!d.issueUpdate?.success) return { error: 'Linear did not change the labels' };
      const now = labels(d.issueUpdate.issue?.labels?.nodes);
      // The board shows them at once, before the next look at Linear.
      this.issues = { ...this.issues, items: this.issues.items.map((i) => (i.id === id ? { ...i, labels: now } : i)) };
      this.onIssues(this.issues);
      void this.refreshIssues();
      return { labels: now };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  /** Linear's id for an identifier, from the last refresh or by asking. */
  private async uuid(id: string): Promise<string> {
    const known = this.uuids.get(id);
    if (known) return known;
    const d = await this.query<{ issue?: { id: string } }>(`query Id($id: String!) { issue(id: $id) { id } }`, { id });
    if (!d.issue?.id) throw new Error(`Linear has no issue ${id}`);
    this.uuids.set(id, d.issue.id);
    return d.issue.id;
  }

  /** The issue's team's workflow state of that type (Done, Canceled), asked once per team. */
  private async stateId(id: string, type: 'completed' | 'canceled'): Promise<string> {
    const team = id.slice(0, id.lastIndexOf('-'));
    const cached = this.stateIds.get(team)?.[type];
    if (cached) return cached;
    const d = await this.query<{ issue?: { team?: { states?: Page<{ id: string; type: string; name: string }> } } }>(`query States($id: String!) { issue(id: $id) { team { states { nodes { id type name } } } } }`, { id });
    const states: Partial<Record<'completed' | 'canceled', string>> = {};
    for (const s of d.issue?.team?.states?.nodes ?? []) {
      // The first state of each type is the team's usual one (Done, Canceled).
      if ((s.type === 'completed' || s.type === 'canceled') && !states[s.type]) states[s.type] = s.id;
    }
    this.stateIds.set(team, states);
    const found = states[type];
    if (!found) throw new Error(`Team ${team} has no ${type === 'completed' ? 'Done' : 'Canceled'} state`);
    return found;
  }

  /** A call as the office's key, with what goes wrong turned into the board's words (and the key marked when it's refused). */
  private async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const key = this.keys.key();
    if (!key) throw new Error(NO_KEY);
    if (this.pausedUntil > Date.now()) throw new Error(RATE_LIMITED);
    try {
      return await linearQuery<T>(key, query, variables, this.fetchImpl);
    } catch (err) {
      if (err instanceof LinearAuthError) {
        this.keys.failed(BAD_KEY);
        throw new Error(BAD_KEY);
      }
      if (err instanceof LinearRateLimit) {
        this.pausedUntil = Date.now() + RATE_LIMIT_PAUSE_MS;
        throw new Error(RATE_LIMITED);
      }
      throw err;
    }
  }
}
