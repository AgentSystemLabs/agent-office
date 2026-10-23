import { readFile, stat } from 'node:fs/promises';
import type { DomainTarget, WorkerMetric } from '../../shared/domain-monitor.js';
type Row = Record<string, unknown>;
const row = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(row) : [];
export const hostnameValid = (v: unknown): v is string => typeof v === 'string' && v.length <= 253 && v.includes('.') && v.split('.').every(s => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(s));
export function parseProfile(source: string): { token: string; account: string } {
  const tokens = new Set([...source.matchAll(/Bearer\s+([A-Za-z0-9_-]{35,300})/gi)].map(m => m[1]));
  const accounts = new Set([...source.matchAll(/\/accounts\/([0-9a-f]{32})(?:\/|\b)/gi)].map(m => m[1].toLowerCase()));
  if (tokens.size !== 1 || accounts.size !== 1) throw Error('Cloudflare credential file must contain one bearer token and one account URL.');
  return { token: [...tokens][0], account: [...accounts][0] };
}
export async function readProfile(file: string) {
  try { const info = await stat(file); if (!info.isFile() || info.size > 16384) throw Error(); return parseProfile(await readFile(file, 'utf8')); }
  catch { throw Error('Cloudflare credential file unavailable or ambiguous. Check removable drive and profile.'); }
}
export type ApiRequest = (route: string, body?: unknown) => Promise<unknown>;
const WORKER_QUERY = 'query($account:String!,$start:Time!,$end:Time!){viewer{accounts(filter:{accountTag:$account}){workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:$start,datetime_leq:$end}){sum{requests errors} dimensions{scriptName status}}}}}';
/** Fixed origin, GET metadata and one read-only GraphQL POST. No redirects or raw error text. */
export function cloudflareRequest(token: string, signal?: AbortSignal): ApiRequest {
  return async (route, body) => {
    if (!(route.startsWith('/accounts/') || route.startsWith('/zones') || route === '/graphql') || (body !== undefined && route !== '/graphql')) throw Error('API operation refused.');
    if (route === '/graphql' && row(body).query !== WORKER_QUERY) throw Error('Only the fixed read-only Worker analytics query is allowed.');
    const response = await fetch('https://api.cloudflare.com/client/v4' + route, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
      headers: { authorization: 'Bearer ' + token, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => { throw Error('Cloudflare API network/TLS/timeout failure.'); });
    if (!response.ok) { await response.body?.cancel(); throw Error('Cloudflare API HTTP ' + response.status + '.'); }
    const reader = response.body?.getReader(); if (!reader) throw Error('Cloudflare API empty response.');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 2 * 1024 * 1024) throw Error('Cloudflare API response limit.'); chunks.push(chunk.value); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Error('Cloudflare API invalid JSON.'); }
    } finally { await reader.cancel().catch(() => {}); }
  };
}
export async function collection(api: ApiRequest, route: string): Promise<Row[]> {
  const out: Row[] = []; const perPage = route.includes('/pages/projects') ? 10 : 50;
  for (let page = 1; page <= 40; page++) {
    const d = row(await api(route + (route.includes('?') ? '&' : '?') + `per_page=${perPage}&page=${page}`));
    if (d.success !== true || !Array.isArray(d.result)) throw Error('Cloudflare collection unavailable.');
    const batch = rows(d.result); out.push(...batch); const info = row(d.result_info);
    if (info.page !== undefined && info.page !== page) throw Error('Cloudflare pagination mismatch.');
    if (typeof info.total_pages === 'number' ? page >= info.total_pages : batch.length < perPage) return out;
  }
  throw Error('Cloudflare collection exceeded pagination limit.');
}
export interface Discovery { targets: DomainTarget[]; workers: string[]; issues: string[] }
export async function discover(api: ApiRequest, account: string): Promise<Discovery> {
  if (!/^[0-9a-f]{32}$/.test(account)) throw Error('Invalid Cloudflare account.');
  const issues: string[] = [], prefix = '/accounts/' + account, targets = new Map<string, DomainTarget>();
  const add = (hostname: unknown, source: string, worker?: unknown) => {
    if (!hostnameValid(hostname)) return; const key = hostname.toLowerCase();
    if (!targets.has(key)) targets.set(key, { hostname: key, workers: [], source });
    const item = targets.get(key)!;
    if (typeof worker === 'string' && /^[a-z0-9_.-]{1,100}$/i.test(worker) && !item.workers.includes(worker)) item.workers.push(worker);
  };
  const get = async (route: string, label: string) => {
    try { return await collection(api, route); }
    catch (e) { issues.push(label + ': ' + (e instanceof Error ? e.message : 'unavailable')); return []; }
  };
  const [zones, domains, scripts, pages] = await Promise.all([
    get('/zones?account.id=' + account, 'Zones'), get(prefix + '/workers/domains', 'Worker domains'),
    get(prefix + '/workers/scripts', 'Workers'), get(prefix + '/pages/projects', 'Pages'),
  ]);
  if (zones.length > 100) throw Error('Zone limit exceeded; coverage incomplete.');
  for (const zone of zones) {
    if (!/^[0-9a-f]{32}$/.test(String(zone.id))) { issues.push('Zone ID invalid.'); continue; }
    add(zone.name, 'Zone');
    const [dns, routes] = await Promise.all([get('/zones/' + zone.id + '/dns_records', 'DNS ' + zone.name), get('/zones/' + zone.id + '/workers/routes', 'Routes ' + zone.name)]);
    for (const d of dns) if (['A', 'AAAA', 'CNAME'].includes(String(d.type))) add(d.name, 'Live DNS');
    for (const r of routes) {
      const host = String(r.pattern ?? '').replace(/^https?:\/\//, '').split('/')[0];
      if (host.includes('*')) { const suffix = host.replace(/^\*\.?/, '').toLowerCase(); for (const name of targets.keys()) if (name === suffix || name.endsWith('.' + suffix)) add(name, 'Worker route', r.script); }
      else add(host, 'Worker route', r.script);
    }
  }
  for (const d of domains) add(d.hostname, 'Worker custom domain', d.service);
  for (const p of pages) for (const d of Array.isArray(p.domains) ? p.domains : []) add(d, 'Pages', p.name);
  const all = [...targets.values()].sort((a, b) => a.hostname.localeCompare(b.hostname));
  if (all.length > 200) issues.push('Domain coverage capped at 200; remaining domains are unmonitored.');
  return { targets: all.slice(0, 200), workers: scripts.map(s => s.id).filter((s): s is string => typeof s === 'string' && /^[a-z0-9_.-]{1,100}$/i.test(s)).slice(0, 2000), issues };
}
export async function analytics(api: ApiRequest, account: string, now = new Date()) {
  const from = new Date(now.getTime() - 15 * 60_000).toISOString(), to = now.toISOString();
  const query = WORKER_QUERY;
  const d = row(await api('/graphql', { query, variables: { account, start: from, end: to } }));
  if (Array.isArray(d.errors) && d.errors.length) throw Error('Worker analytics query rejected; error visibility unavailable.');
  const accounts = rows(row(row(d.data).viewer).accounts);
  if (accounts.length !== 1 || !Array.isArray(accounts[0].workersInvocationsAdaptive)) throw Error('Worker analytics unavailable for this account.');
  const samples = rows(accounts[0].workersInvocationsAdaptive);
  if (samples.length >= 1000) throw Error('Worker analytics result limit reached; incomplete data.');
  const metrics = new Map<string, WorkerMetric>();
  for (const sample of samples) {
    const dim = row(sample.dimensions), sum = row(sample.sum);
    if (typeof dim.scriptName !== 'string' || !/^[a-z0-9_.-]{1,100}$/i.test(dim.scriptName)) continue;
    const m = metrics.get(dim.scriptName) ?? { name: dim.scriptName, requests: 0, errors: 0, outcomes: Object.create(null) as Record<string, number> };
    if (![sum.requests, sum.errors].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)) throw Error('Worker analytics invalid counters.');
    m.requests += sum.requests as number; m.errors += sum.errors as number;
    const outcome = typeof dim.status === 'string' && /^[a-z0-9_-]{1,60}$/i.test(dim.status) ? dim.status : 'unknown';
    m.outcomes[outcome] = (m.outcomes[outcome] ?? 0) + (sum.requests as number); metrics.set(m.name, m);
  }
  return { metrics: [...metrics.values()], from, to };
}
