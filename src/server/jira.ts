import { chmodSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { adfToMarkdown, childrenJql, jiraKey, type JiraBoardState, type JiraCategory, type JiraComment, type JiraConnection, type JiraEpic, type JiraFloorState, type JiraTicket, type JiraTicketDetail } from '../shared/jira.js';

const TIMEOUT_MS = 20_000;
/** After a 429, the board waits at least this long, doubling for each one in a row, up to MAX_BACKOFF_MS. */
const BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 10 * 60_000;
/** The most tickets the Jira tab shows (pages of 100). */
const MAX_TICKETS = 500;
/** Atlassian's API gateway: the one place a scoped (read-only) API token works, and a classic token too. */
const GATEWAY = 'https://api.atlassian.com/ex/jira';
/**
 * The language Jira names issue types, statuses and priorities in. Node's fetch sends
 * `Accept-Language: *`, which Jira answers in whatever language it picks (Chinese, for one site),
 * so every request names one: the office machine's, then English.
 */
export function acceptLanguage(locale: string | undefined = Intl.DateTimeFormat().resolvedOptions().locale): string {
  const tag = locale && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(locale) && locale !== 'und' ? locale : '';
  const base = tag.split('-')[0].toLowerCase();
  if (!tag || base === 'en') return 'en-US, en;q=0.9';
  return base === tag ? `${tag}, en;q=0.5` : `${tag}, ${base};q=0.9, en;q=0.5`;
}
const LANGUAGE = acceptLanguage();

/** The search that checks a connection: anything that can read issues can run it. */
export const CHECK_JQL = 'created >= -1d ORDER BY created DESC';

/** Something Jira (or the way to it) turned down, in words for whoever is at the board. */
export class JiraError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Seconds, from a 429's Retry-After. */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

/** The site as https://<site>.atlassian.net, from what someone typed; undefined for anything that isn't Jira Cloud. */
export function jiraSite(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  let s = raw.trim();
  if (!s || s.length > 300) return undefined;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let host: string;
  try {
    host = new URL(s).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (!host.includes('.')) host += '.atlassian.net';
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.atlassian\.net$/.test(host) ? `https://${host}` : undefined;
}

/** Takes the token (and the Basic auth made from it) out of anything that's shown or logged. */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join('[redacted]');
  return out;
}

interface Credentials {
  site: string;
  /** The site's cloud id, which the gateway addresses it by. */
  cloudId: string;
  email: string;
  token: string;
}

/** Why Jira said no, from its error body: {errorMessages: [...], errors: {field: msg}, message}. */
function jiraSays(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const b = body as { errorMessages?: unknown; errors?: unknown; message?: unknown };
  const msgs = [...(Array.isArray(b.errorMessages) ? b.errorMessages : []), ...(b.errors && typeof b.errors === 'object' ? Object.values(b.errors) : []), ...(typeof b.message === 'string' ? [b.message] : [])];
  return msgs
    .filter((m): m is string => typeof m === 'string' && !!m.trim())
    .join(' ')
    .slice(0, 300);
}

/** The site's cloud id, from its public tenant_info (no credentials needed). */
export async function cloudIdOf(site: string, fetchImpl: Fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await fetchImpl(`${site}/_edge/tenant_info`, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    throw new JiraError(`Couldn't reach ${site} (${e.name === 'TimeoutError' ? 'it did not answer in time' : (e.cause?.code ?? e.message)}). Check the site URL.`, 0);
  }
  const body = (await res.json().catch(() => undefined)) as { cloudId?: unknown } | undefined;
  const id = typeof body?.cloudId === 'string' ? body.cloudId : '';
  if (!res.ok || !/^[0-9a-f-]{36}$/i.test(id)) throw new JiraError(`${site} doesn't look like a Jira Cloud site. Check the site URL.`, res.status || 404);
  return id;
}

/**
 * Jira Cloud's REST API, read only, as the office's one account: basic auth with its email and API
 * token, through Atlassian's gateway so that a read-only scoped token works as well as a classic one.
 * Nothing here logs; errors carry no token.
 */
export class JiraApi {
  private auth: string;

  constructor(
    private creds: Credentials,
    private fetchImpl: Fetch = fetch,
  ) {
    this.auth = `Basic ${Buffer.from(`${creds.email}:${creds.token}`).toString('base64')}`;
  }

  get site(): string {
    return this.creds.site;
  }

  get cloudId(): string {
    return this.creds.cloudId;
  }

  private redact(text: string): string {
    return redact(text, [this.creds.token, this.auth.slice(6)]);
  }

  async request<T>(method: 'GET' | 'POST', api: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${GATEWAY}/${this.creds.cloudId}${api}`, {
        method,
        headers: { authorization: this.auth, accept: 'application/json', 'accept-language': LANGUAGE, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } };
      const why = e.name === 'TimeoutError' ? 'it did not answer in time' : (e.cause?.code ?? e.message);
      throw new JiraError(this.redact(`Couldn't reach Jira (${why}).`), 0);
    }
    const text = await res.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (res.ok) return parsed as T;
    const said = this.redact(jiraSays(parsed));
    if (res.status === 401) throw new JiraError(`Jira didn't accept the email and API token (401)${said && said !== 'Unauthorized' ? `: ${said}` : ''}. Check both, and that the token hasn't expired or been revoked.`, 401);
    if (res.status === 403) throw new JiraError(`The office's Jira account has no access to that (403)${said ? `: ${said}` : ''}`, 403);
    if (res.status === 429) {
      const after = Number(res.headers.get('retry-after'));
      throw new JiraError('Jira is rate limiting the office (429). It tries again in a while.', 429, Number.isFinite(after) && after > 0 ? after : undefined);
    }
    throw new JiraError(said || `Jira answered ${res.status}`, res.status);
  }

  /** An issue with the fields asked for; a 404 means it doesn't exist or the account can't see it. */
  issue(key: string, fields: string[]): Promise<RawIssue> {
    return this.request('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields.join(',')}`);
  }

  /** Who the token reads as: its display name, when its scopes let it say (a read:jira-work-only token can't). */
  async name(): Promise<string | undefined> {
    try {
      const me = await this.request<{ displayName?: string }>('GET', '/rest/api/3/myself');
      return me?.displayName || undefined;
    } catch {
      return undefined;
    }
  }

  /** Every direct child of the epic, in rank order. */
  async children(epic: string): Promise<RawIssue[]> {
    const out: RawIssue[] = [];
    let nextPageToken: string | undefined;
    do {
      const page = await this.request<{ issues?: RawIssue[]; nextPageToken?: string; isLast?: boolean }>('POST', '/rest/api/3/search/jql', {
        jql: childrenJql(epic),
        fields: CARD_FIELDS,
        maxResults: 100,
        ...(nextPageToken ? { nextPageToken } : {}),
      });
      out.push(...(page?.issues ?? []));
      nextPageToken = page?.isLast === false || page?.nextPageToken ? page?.nextPageToken : undefined;
    } while (nextPageToken && out.length < MAX_TICKETS);
    return out.slice(0, MAX_TICKETS);
  }

  async comments(key: string): Promise<JiraComment[]> {
    const r = await this.request<{ comments?: RawComment[] }>('GET', `/rest/api/3/issue/${encodeURIComponent(key)}/comment?orderBy=created&maxResults=100`);
    return (r?.comments ?? []).map(commentOf);
  }
}

interface RawComment {
  id?: string;
  author?: { displayName?: string };
  body?: unknown;
  created?: string;
}

export interface RawIssue {
  key: string;
  fields?: Record<string, any>;
}

const CARD_FIELDS = ['summary', 'issuetype', 'priority', 'assignee', 'status', 'updated'];
const DETAIL_FIELDS = [...CARD_FIELDS, 'description', 'reporter', 'created', 'parent'];

function category(key: unknown): JiraCategory {
  return key === 'done' || key === 'new' ? key : 'indeterminate';
}

function commentOf(c: RawComment): JiraComment {
  return { id: String(c.id ?? ''), author: c.author?.displayName ?? 'someone', body: adfToMarkdown(c.body), created: c.created ?? '' };
}

/** A card for the Jira tab, from an issue as the search API returns it. */
export function ticketOf(site: string, raw: RawIssue): JiraTicket {
  const f = raw.fields ?? {};
  return {
    key: raw.key,
    summary: String(f.summary ?? ''),
    type: String(f.issuetype?.name ?? ''),
    priority: String(f.priority?.name ?? ''),
    assignee: f.assignee?.displayName ?? undefined,
    status: String(f.status?.name ?? ''),
    category: category(f.status?.statusCategory?.key),
    url: `${site}/browse/${raw.key}`,
    updated: String(f.updated ?? ''),
  };
}

// ---- The office's connection ---------------------------------------------------------------------

interface SavedConnection extends Credentials {
  name: string;
  by: string;
  at: number;
}

/** Writes JSON readable only by the office's user, whole: a temp file renamed into place. */
function writePrivate(file: string, data: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/**
 * The office's one Jira Cloud connection, shared by every floor: the site, the account's email and
 * its API token (a read-only one is enough: the office only reads), kept in the office's
 * .droid-office/jira.json (0600). The token never leaves this class: connection() is what browsers
 * get, and API errors are redacted.
 */
export class JiraOffice {
  private saved?: SavedConnection;
  private api?: JiraApi;
  readonly file: string;

  constructor(
    dataDir: string,
    private fetchImpl: Fetch = fetch,
  ) {
    this.file = path.join(dataDir, 'jira.json');
    this.restore();
  }

  /** Who the office reads Jira as; undefined while it isn't connected. Never the token. */
  connection(): JiraConnection | undefined {
    const s = this.saved;
    return s ? { site: s.site, email: s.email, name: s.name, by: s.by, at: s.at } : undefined;
  }

  /** The API as the connected account; undefined while there's no connection. */
  client(): JiraApi | undefined {
    return this.api;
  }

  /**
   * Checks the details with Jira, then saves them. Resolves to why not, if not. The check is a search
   * (what the board runs), since a read-only token may not be allowed to ask who it is.
   */
  async connect(site: string, email: string, token: string, by: string): Promise<string | undefined> {
    const s = jiraSite(site);
    if (!s) return 'The site is your Jira Cloud address, like https://your-site.atlassian.net';
    const mail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || mail.length > 254) return "That email doesn't look right. Use the email of the account the token belongs to.";
    const tok = token.trim();
    if (tok.length < 8 || tok.length > 2000 || /\s/.test(tok)) return "That doesn't look like an Atlassian API token. Make one at https://id.atlassian.com/manage-profile/security/api-tokens";
    let api: JiraApi;
    try {
      const cloudId = await cloudIdOf(s, this.fetchImpl);
      api = new JiraApi({ site: s, cloudId, email: mail, token: tok }, this.fetchImpl);
      // Jira turns down a search with no restriction, so this one has one.
      await api.request('POST', '/rest/api/3/search/jql', { jql: CHECK_JQL, fields: ['summary'], maxResults: 1 });
    } catch (err) {
      return redact((err as Error).message, [tok]);
    }
    this.saved = { site: s, cloudId: api.cloudId, email: mail, token: tok, name: (await api.name()) ?? mail, by, at: Date.now() };
    this.api = api;
    this.persist();
    return undefined;
  }

  disconnect() {
    this.saved = undefined;
    this.api = undefined;
    try {
      rmSync(this.file, { force: true });
    } catch {
      // already gone
    }
  }

  private persist() {
    try {
      writePrivate(this.file, this.saved);
    } catch (err) {
      console.error(`droid-office: couldn't save the Jira connection: ${(err as Error).message}`);
    }
  }

  private restore() {
    if (!existsSync(this.file)) return;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SavedConnection>;
      const site = jiraSite(s.site);
      if (!site || typeof s.cloudId !== 'string' || typeof s.email !== 'string' || typeof s.token !== 'string') return;
      this.saved = { site, cloudId: s.cloudId, email: s.email, token: s.token, name: typeof s.name === 'string' ? s.name : s.email, by: typeof s.by === 'string' ? s.by : '?', at: typeof s.at === 'number' ? s.at : Date.now() };
      this.api = new JiraApi(this.saved, this.fetchImpl);
    } catch {
      // a broken file just means no connection
    }
  }
}

// ---- A floor's epic --------------------------------------------------------------------------------

export interface FloorJiraEvents {
  /** The floor's Jira setup changed (its epic, or the office's connection). */
  state(state: JiraFloorState): void;
  board(state: JiraBoardState | null): void;
}

/**
 * One floor's Jira epic, shown read-only as the issue board's Jira tab: every direct child of the
 * epic, in To Do, In Progress and Done by status category. Kept in the floor's
 * .droid-office/jira-epic.json. Everything goes through the office's connection (JiraOffice).
 */
export class FloorJira {
  epic?: JiraEpic;
  board: JiraBoardState | null = null;
  private file: string;
  private backoffUntil = 0;
  private strikes = 0;

  constructor(
    dataDir: string,
    private office: JiraOffice,
    private events: FloorJiraEvents,
  ) {
    this.file = path.join(dataDir, 'jira-epic.json');
    this.restore();
    this.board = this.emptyBoard();
  }

  state(): JiraFloorState {
    return { connection: this.office.connection(), epic: this.epic };
  }

  /** Connected, with an epic: the Jira tab is up. */
  get on(): boolean {
    return !!this.epic && !!this.office.client();
  }

  private emptyBoard(): JiraBoardState | null {
    return this.on && this.epic ? { epic: this.epic.key, items: [], fetchedAt: 0, loading: false } : null;
  }

  /** The office connected, reconnected or disconnected: start over. Resolves once the board is read again. */
  connectionChanged(): Promise<void> {
    this.backoffUntil = 0;
    this.strikes = 0;
    this.board = this.emptyBoard();
    this.events.state(this.state());
    this.events.board(this.board);
    return this.on ? this.refresh(true) : Promise.resolve();
  }

  /** Maps the floor to an epic, which must exist and be an epic. Resolves to it, or why not. */
  async setEpic(rawKey: string, by: string): Promise<{ epic: JiraEpic } | { error: string }> {
    const api = this.office.client();
    if (!api) return { error: 'Connect the office to Jira first' };
    const key = jiraKey(rawKey);
    if (!key) return { error: 'An epic key looks like EDP-168' };
    let raw: RawIssue;
    try {
      raw = await api.issue(key, ['summary', 'issuetype']);
    } catch (err) {
      if (err instanceof JiraError && err.status === 404) return { error: `There's no ${key} in Jira, or the office's account can't see it` };
      return { error: (err as Error).message };
    }
    const type = raw.fields?.issuetype ?? {};
    if (type.name !== 'Epic' && type.hierarchyLevel !== 1) return { error: `${key} is a ${type.name ?? 'ticket'}, not an epic` };
    this.epic = { key, summary: String(raw.fields?.summary ?? ''), by, at: Date.now() };
    const epic = this.epic;
    this.persist();
    await this.connectionChanged();
    return { epic };
  }

  clearEpic() {
    this.epic = undefined;
    try {
      rmSync(this.file, { force: true });
    } catch {
      // already gone
    }
    void this.connectionChanged();
  }

  /** Reads the epic's children again. Skipped while Jira asked the office to back off, unless forced. */
  async refresh(force = false) {
    const api = this.office.client();
    const epic = this.epic;
    if (!api || !epic || !this.board || this.board.loading) return;
    if (!force && Date.now() < this.backoffUntil) return;
    this.board = { ...this.board, loading: true };
    this.events.board(this.board);
    try {
      const items = (await api.children(epic.key)).map((r) => ticketOf(api.site, r));
      if (this.epic !== epic) return;
      this.strikes = 0;
      this.board = { epic: epic.key, items, fetchedAt: Date.now(), loading: false };
    } catch (err) {
      if (this.epic !== epic) return;
      if (err instanceof JiraError && err.status === 429) {
        this.strikes++;
        const wait = Math.max((err.retryAfter ?? 0) * 1000, Math.min(MAX_BACKOFF_MS, BACKOFF_MS * 2 ** (this.strikes - 1)));
        this.backoffUntil = Date.now() + wait;
      }
      this.board = { ...this.board, loading: false, error: (err as Error).message, fetchedAt: Date.now() };
    }
    this.events.board(this.board);
  }

  get fetchedAt(): number {
    return this.board?.fetchedAt ?? 0;
  }

  /** Description and comments: what the ticket window shows. Only for one of the epic's children. */
  async detail(rawKey: string): Promise<JiraTicketDetail> {
    const api = this.office.client();
    if (!api || !this.epic) throw new JiraError('This floor has no Jira epic set up', 400);
    const key = jiraKey(rawKey);
    if (!key) throw new JiraError('A ticket key looks like EDP-12', 400);
    let raw: RawIssue;
    try {
      raw = await api.issue(key, DETAIL_FIELDS);
    } catch (err) {
      if (err instanceof JiraError && err.status === 404) throw new JiraError(`There's no ${key} in Jira, or the office's account can't see it`, 404);
      throw err;
    }
    if (raw.fields?.parent?.key !== this.epic.key) throw new JiraError(`${key} isn't one of ${this.epic.key}'s tickets`, 403);
    const f = raw.fields ?? {};
    return {
      ...ticketOf(api.site, raw),
      description: adfToMarkdown(f.description),
      reporter: f.reporter?.displayName ?? undefined,
      created: String(f.created ?? ''),
      comments: await api.comments(key),
    };
  }

  private persist() {
    try {
      writePrivate(this.file, this.epic);
    } catch (err) {
      console.error(`droid-office: couldn't save the floor's Jira epic: ${(err as Error).message}`);
    }
  }

  private restore() {
    if (!existsSync(this.file)) return;
    try {
      const s = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<JiraEpic>;
      const key = jiraKey(s.key);
      if (!key) return;
      this.epic = { key, summary: typeof s.summary === 'string' ? s.summary : '', by: typeof s.by === 'string' ? s.by : '?', at: typeof s.at === 'number' ? s.at : Date.now() };
    } catch {
      // a broken file just means no epic
    }
  }
}
