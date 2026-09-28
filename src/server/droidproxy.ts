// The subscription limits of the accounts DroidProxy (github.com/anand-92/droidproxy) serves on this
// machine, for the machine monitor. DroidProxy keeps each account's OAuth sign-in as a JSON file in
// ~/.cli-proxy-api; its own OAuthUsageTracker asks each provider for the same quota windows read
// here. The files are only read: DroidProxy's bundled CLIProxyAPI refreshes the tokens, and refresh
// tokens rotate, so refreshing them from here could sign it out.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProxyAccount, ProxyProvider, ProxyState, ProxyWindow } from '../shared/protocol.js';

export const DROIDPROXY_AUTH_DIR = path.join(os.homedir(), '.cli-proxy-api');
/** DroidProxy's own proxy, the one Droid and the other agents talk to. */
export const DROIDPROXY_HEALTH_URL = 'http://127.0.0.1:8317/healthz';

const POLL_MS = 5 * 60_000;
/** Someone walking in reads again, at most this often. */
const MIN_GAP_MS = 60_000;
/** The refresh button reads again at most this often, so a room full of people can't hammer the providers. */
const MANUAL_GAP_MS = 15_000;
const TIMEOUT_MS = 15_000;
/** The most windows one account shows on the monitor. */
const MAX_WINDOWS = 4;
const LABEL_MAX = 18;

/** One enabled sign-in from DroidProxy's auth folder, with what it takes to ask for its limits. */
interface Credential {
  provider: ProxyProvider;
  file: string;
  token: string;
  /** ms since epoch; past it, the provider will turn the token away until DroidProxy refreshes it. */
  expires?: number;
  accountId?: string;
}

export type Fetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

export class DroidProxyUsage {
  private state: ProxyState = { accounts: [], at: 0 };
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private lastRead = 0;
  private closed = false;

  /**
   * @param dir DroidProxy's auth folder; nothing is ever read or shown when it isn't there
   * @param wanted whether anyone is in the office to see the numbers; polls are skipped when not
   */
  constructor(
    private dir: string,
    private wanted: () => boolean,
    private onChange: (state: ProxyState) => void,
    private fetcher: Fetcher = fetch,
    private healthUrl = DROIDPROXY_HEALTH_URL,
  ) {}

  get current(): ProxyState {
    return this.state;
  }

  start() {
    this.schedule(0);
  }

  /** Reads now, unless a read is running or one just finished. */
  refresh() {
    if (this.running || Date.now() - this.lastRead < MIN_GAP_MS) return;
    this.schedule(0);
  }

  /** Someone pressed refresh on the monitor: reads now, or says why it won't. */
  refreshNow(): string | undefined {
    if (this.closed) return;
    if (this.running) return 'Already reading DroidProxy’s limits';
    const wait = this.lastRead + MANUAL_GAP_MS - Date.now();
    if (wait > 0) return `DroidProxy’s limits were just read: try again in ${Math.ceil(wait / 1000)}s`;
    clearTimeout(this.timer);
    void this.poll(true);
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
  }

  /** One read of every account, for tests and the poll alike. */
  async read(): Promise<ProxyState> {
    const creds = readCredentials(this.dir);
    if (!creds) return { accounts: [], at: Date.now() };
    const [running, accounts] = await Promise.all([this.healthy(), Promise.all(creds.map((c) => this.account(c)))]);
    labelDuplicates(accounts);
    return { running, accounts, at: Date.now() };
  }

  private schedule(ms: number) {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), ms);
    this.timer.unref();
  }

  /** @param force read even with nobody in the office to see it (the refresh button) */
  private async poll(force = false) {
    if (!force && !this.wanted()) return this.schedule(POLL_MS);
    this.running = true;
    this.publish({ ...this.state, refreshing: true });
    let next: ProxyState;
    try {
      next = await this.read();
    } catch {
      next = { ...this.state, refreshing: false };
    } finally {
      this.running = false;
      this.lastRead = Date.now();
    }
    if (this.closed) return;
    this.publish(next);
    this.schedule(POLL_MS);
  }

  private publish(state: ProxyState) {
    this.state = state;
    this.onChange(state);
  }

  private async healthy(): Promise<boolean> {
    try {
      const res = await this.fetcher(this.healthUrl, { headers: {}, signal: AbortSignal.timeout(3000) });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  private async account(c: Credential): Promise<ProxyAccount> {
    const base: ProxyAccount = { provider: c.provider, label: PROVIDER_NAME[c.provider], windows: [] };
    if (c.expires !== undefined && c.expires <= Date.now()) return { ...base, error: 'Sign-in expired: DroidProxy renews it on its next request' };
    const { url, headers } = request(c);
    try {
      const res = await this.fetcher(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 401 || res.status === 403) return { ...base, error: 'Signed out: sign in again in DroidProxy' };
      if (res.status < 200 || res.status >= 300) return { ...base, error: `Usage check failed (HTTP ${res.status})` };
      const parsed = PARSE[c.provider](await res.json());
      if (!parsed.windows.length) return { ...base, ...parsed, error: parsed.error ?? 'No limits reported' };
      return { ...base, ...parsed, windows: parsed.windows.slice(0, MAX_WINDOWS) };
    } catch {
      return { ...base, error: 'Usage check failed' };
    }
  }
}

const PROVIDER_NAME: Record<ProxyProvider, string> = { claude: 'Claude', codex: 'Codex', grok: 'Grok' };

/** DroidProxy's enabled sign-ins that report limits, or null when DroidProxy isn't on this machine. */
export function readCredentials(dir: string): Credential[] | null {
  let names: string[];
  try {
    if (!statSync(dir).isDirectory()) return null;
    names = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
  } catch {
    return null;
  }
  const out: Credential[] = [];
  for (const file of names) {
    let j: any;
    try {
      j = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    if (!j || typeof j !== 'object' || j.disabled === true) continue;
    const c = toCredential(file, j);
    if (c) out.push(c);
  }
  const order: ProxyProvider[] = ['claude', 'codex', 'grok'];
  return out.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
}

function toCredential(file: string, j: any): Credential | undefined {
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  if (j.type === 'claude' || j.type === 'codex') {
    const token = str(j.access_token);
    if (!token) return;
    const expires = str(j.expired) ? Date.parse(j.expired) : NaN;
    return { provider: j.type, file, token, expires: Number.isFinite(expires) ? expires : undefined, accountId: str(j.account_id) };
  }
  if (j.type === 'grok-cli') {
    const token = str(j.access);
    if (!token) return;
    return { provider: 'grok', file, token, expires: typeof j.expires === 'number' && j.expires > 0 ? j.expires : undefined };
  }
  return undefined;
}

/** The request DroidProxy's OAuthUsageTracker makes for each provider. */
function request(c: Credential): { url: string; headers: Record<string, string> } {
  const auth = { Authorization: `Bearer ${c.token}`, Accept: 'application/json' };
  switch (c.provider) {
    case 'claude':
      return { url: 'https://api.anthropic.com/api/oauth/usage', headers: { ...auth, 'anthropic-beta': 'oauth-2025-04-20' } };
    case 'codex':
      return {
        url: 'https://chatgpt.com/backend-api/wham/usage',
        headers: { ...auth, 'User-Agent': 'codex-cli', ...(c.accountId ? { 'ChatGPT-Account-Id': c.accountId } : {}) },
      };
    case 'grok':
      return { url: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits', headers: { ...auth, 'x-xai-token-auth': 'xai-grok-cli' } };
  }
}

type Parsed = Pick<ProxyAccount, 'windows'> & Partial<Pick<ProxyAccount, 'plan' | 'limited' | 'error'>>;

const PARSE: Record<ProxyProvider, (body: unknown) => Parsed> = { claude: parseClaude, codex: parseCodex, grok: parseGrok };

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const pct = (v: number) => Math.max(0, Math.min(100, v));
const time = (v: unknown): number | undefined => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

/** Claude's /api/oauth/usage: the 5-hour session, the week, per-model weeks, and extra usage when it's on. */
export function parseClaude(body: unknown): Parsed {
  const b = body as any;
  if (!b || typeof b !== 'object') return { windows: [] };
  const windows: ProxyWindow[] = [];
  const bucket = (label: string, w: any) => {
    const used = num(w?.utilization);
    if (used !== undefined) windows.push({ label, pct: pct(used), resetsAt: time(w.resets_at) });
  };
  bucket('5h', b.five_hour);
  bucket('Week', b.seven_day);
  const scoped = Array.isArray(b.limits) ? b.limits.filter((l: any) => l?.kind === 'weekly_scoped' && typeof l.scope?.model?.display_name === 'string') : [];
  if (scoped.length) {
    for (const l of scoped) {
      const used = num(l.percent);
      if (used !== undefined) windows.push({ label: `${l.scope.model.display_name.trim().slice(0, LABEL_MAX - 3)} wk`, pct: pct(used), resetsAt: time(l.resets_at) });
    }
  } else {
    bucket('Opus wk', b.seven_day_opus);
    bucket('Sonnet wk', b.seven_day_sonnet);
  }
  const extra = b.extra_usage;
  if (extra?.is_enabled === true) {
    const used = num(extra.utilization);
    if (used !== undefined) windows.push({ label: 'Extra', pct: pct(used) });
  }
  const limited = windows.some((w) => w.label !== 'Extra' && w.pct >= 100) || b.extra_usage?.spend_limit_reached === true;
  return { windows, ...(limited ? { limited } : {}) };
}

/** ChatGPT's /wham/usage: whichever windows the Codex plan has, named by their length. */
export function parseCodex(body: unknown): Parsed {
  const b = body as any;
  const rl = b?.rate_limit;
  if (!rl || typeof rl !== 'object') return { windows: [] };
  const windows: ProxyWindow[] = [];
  for (const [w, fallback] of [
    [rl.primary_window, '5h'],
    [rl.secondary_window, 'Week'],
  ] as const) {
    const used = num(w?.used_percent);
    if (used === undefined) continue;
    const resetAt = num(w.reset_at);
    windows.push({ label: windowName(num(w.limit_window_seconds)) ?? fallback, pct: pct(used), resetsAt: resetAt !== undefined ? resetAt * 1000 : undefined });
  }
  const plan = typeof b.plan_type === 'string' && b.plan_type ? b.plan_type.slice(0, LABEL_MAX) : undefined;
  return { windows, ...(plan ? { plan } : {}), ...(rl.limit_reached === true ? { limited: true } : {}) };
}

/** A Codex window by how long it runs: "5h", "Week", "Month"… */
function windowName(seconds: number | undefined): string | undefined {
  if (!seconds || seconds <= 0) return;
  const hours = seconds / 3600;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (Math.abs(days - 7) < 0.5) return 'Week';
  if (days >= 28 && days <= 31) return 'Month';
  return `${Math.round(days)}d`;
}

/** Grok's /v1/billing: one pooled credit window for the billing period. */
export function parseGrok(body: unknown): Parsed {
  const c = (body as any)?.config;
  if (!c || typeof c !== 'object') return { windows: [] };
  let used = num(c.creditUsagePercent);
  if (used === undefined) {
    const cap = num(c.onDemandCap?.val);
    const spent = num(c.onDemandUsed?.val);
    if (cap && cap > 0 && spent !== undefined) used = (spent / cap) * 100;
  }
  if (used === undefined) return { windows: [] };
  const period = typeof c.currentPeriod?.type === 'string' ? c.currentPeriod.type : '';
  const label = period.endsWith('WEEKLY') ? 'Week' : period.endsWith('MONTHLY') ? 'Month' : period.endsWith('DAILY') ? 'Day' : 'Credits';
  const window: ProxyWindow = { label, pct: pct(used), resetsAt: time(c.currentPeriod?.end ?? c.billingPeriodEnd) };
  return { windows: [window], ...(window.pct >= 100 ? { limited: true } : {}) };
}

/** Accounts of the same provider get told apart by a number, never by their email. */
function labelDuplicates(accounts: ProxyAccount[]) {
  const total = new Map<ProxyProvider, number>();
  for (const a of accounts) total.set(a.provider, (total.get(a.provider) ?? 0) + 1);
  const seen = new Map<ProxyProvider, number>();
  for (const a of accounts) {
    if (total.get(a.provider)! < 2) continue;
    const n = (seen.get(a.provider) ?? 0) + 1;
    seen.set(a.provider, n);
    a.label = `${a.label} ${n}`;
  }
}
