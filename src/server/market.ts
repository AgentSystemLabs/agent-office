// The 📈 market terminal's data: stocks and news from Finnhub (with the office's own free key, which
// never leaves the server), coins from Coinbase's public prices (no key). Only those two hosts are
// ever asked, and each answer is kept a few seconds so a room full of open terminals asks once.
import type { Headline, NewsAnswer, Quote, QuotesAnswer } from '../shared/market.js';
import { isCoin } from '../shared/market.js';

const FINNHUB = 'https://finnhub.io/api/v1';
const COINBASE = 'https://api.exchange.coinbase.com';
/** How long a price is kept before it's asked for again. Finnhub's free tier takes 60 calls a minute. */
const QUOTE_TTL = 10_000;
const NEWS_TTL = 60_000;
const TIMEOUT = 6_000;
const MAX_HEADLINES = 40;

/** The Finnhub key, read each time so a restart isn't needed to drop it (finnhub.io, free). */
const finnhubKey = () => process.env.AGENT_OFFICE_FINNHUB_KEY?.trim() || '';

type Got<T> = { ok: true; value: T } | { ok: false; why: string };
const cache = new Map<string, { at: number; got: Promise<Got<unknown>> }>();

/** `load`'s answer for `key`, kept for `ttl`; a failure is kept too, for a shorter while, so a down source isn't hammered. */
function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<Got<T>> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < ttl) return hit.got as Promise<Got<T>>;
  const got = load().then(
    (value): Got<T> => ({ ok: true, value }),
    (err: unknown): Got<T> => {
      // A failure is tried again after a few seconds, not a whole TTL.
      cache.set(key, { at: Date.now() - ttl + 3_000, got });
      return { ok: false, why: err instanceof Error ? err.message : 'Unavailable' };
    },
  );
  cache.delete(key);
  cache.set(key, { at: now, got });
  // Oldest first (a Map keeps the order things went in), so a flood of symbols can't grow it.
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return got;
}

const MAX_CACHED = 500;
/** The most Finnhub calls the office makes a minute, for everyone together: under the free tier's 60. */
const FINNHUB_PER_MINUTE = 50;
const finnhubCalls: number[] = [];

/** Whether the office may ask Finnhub once more this minute (and counts it if so). */
function finnhubBudget(): boolean {
  const now = Date.now();
  while (finnhubCalls.length && now - finnhubCalls[0] > 60_000) finnhubCalls.shift();
  if (finnhubCalls.length >= FINNHUB_PER_MINUTE) return false;
  finnhubCalls.push(now);
  return true;
}

/** The most an answer may be: a quote is a few hundred bytes, the headlines a few dozen kB. */
const MAX_BODY = 2 * 1024 * 1024;

async function getJson(source: 'Finnhub' | 'Coinbase', url: string, headers: Record<string, string> = {}): Promise<unknown> {
  if (source === 'Finnhub' && !finnhubBudget()) throw new Error('Busy, try again in a minute');
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'agent-office', ...headers }, signal: AbortSignal.timeout(TIMEOUT), redirect: 'error' });
  if (res.status === 429) throw new Error(`${source} is rate limiting, try again in a minute`);
  if (res.status === 401 || res.status === 403) throw new Error(source === 'Finnhub' ? 'The Finnhub key was refused' : `${source} refused the request`);
  if (res.status === 404) throw new Error('Unknown symbol');
  if (!res.ok) throw new Error(`${source} answered ${res.status}`);
  if (Number(res.headers.get('content-length')) > MAX_BODY) throw new Error(`${source} answered too much`);
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BODY) throw new Error(`${source} answered too much`);
  return JSON.parse(new TextDecoder().decode(body));
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);
const round = (n: number) => Math.round(n * 1e4) / 1e4;

async function stockQuote(symbol: string): Promise<Quote> {
  const j = (await getJson('Finnhub', `${FINNHUB}/quote?symbol=${encodeURIComponent(symbol)}`, { 'x-finnhub-token': finnhubKey() })) as Record<string, unknown>;
  const price = num(j.c);
  // Finnhub answers a symbol it doesn't know with zeros.
  if (!Number.isFinite(price) || price <= 0) throw new Error('Unknown symbol');
  return { symbol, price, change: round(num(j.d) || 0), changePct: round(num(j.dp) || 0), high: num(j.h), low: num(j.l), open: num(j.o), at: num(j.t) * 1000 || Date.now(), source: 'finnhub' };
}

async function coinQuote(symbol: string): Promise<Quote> {
  const j = (await getJson('Coinbase', `${COINBASE}/products/${encodeURIComponent(symbol)}/stats`)) as Record<string, unknown>;
  const price = num(j.last);
  const open = num(j.open);
  if (!Number.isFinite(price) || price <= 0) throw new Error('Unknown symbol');
  const change = Number.isFinite(open) && open > 0 ? price - open : 0;
  return { symbol, price, change: round(change), changePct: open > 0 ? round((change / open) * 100) : 0, high: num(j.high), low: num(j.low), open, at: Date.now(), source: 'coinbase' };
}

/** The latest prices of `symbols` (already cleaned by parseSymbols). */
export async function quotes(symbols: readonly string[]): Promise<QuotesAnswer> {
  const stocks = !!finnhubKey();
  const out: QuotesAnswer = { quotes: [], missing: [], stocks };
  const got = await Promise.all(
    symbols.map((s): Promise<Got<Quote>> => {
      if (isCoin(s)) return cached(`coin:${s}`, QUOTE_TTL, () => coinQuote(s));
      if (!stocks) return Promise.resolve({ ok: false, why: 'Stocks need a Finnhub key' });
      return cached(`stock:${s}`, QUOTE_TTL, () => stockQuote(s));
    }),
  );
  got.forEach((g, i) => (g.ok ? out.quotes.push(g.value) : out.missing.push({ symbol: symbols[i], why: g.why })));
  return out;
}

/** Only a link a browser can follow safely: http(s), nothing else. */
function safeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The market's latest headlines (Finnhub's general news), newest first. */
export async function news(): Promise<NewsAnswer> {
  if (!finnhubKey()) return { items: [], stocks: false };
  const got = await cached('news', NEWS_TTL, async () => {
    const j = await getJson('Finnhub', `${FINNHUB}/news?category=general`, { 'x-finnhub-token': finnhubKey() });
    if (!Array.isArray(j)) throw new Error('Unexpected answer');
    return j
      .map((n: Record<string, unknown>): Headline => ({ id: num(n.id) || 0, headline: text(n.headline, 300), source: text(n.source, 60), summary: text(n.summary, 600), url: safeUrl(n.url), at: num(n.datetime) * 1000 || 0 }))
      .filter((n) => n.headline && n.url)
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_HEADLINES);
  });
  if (!got.ok) throw new Error(got.why);
  return { items: got.value, stocks: true };
}
