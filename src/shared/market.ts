// The 📈 market terminal: what the office's proxy answers with, and which symbols it takes.

/** One symbol's latest price: a stock from Finnhub, or a coin from Coinbase. */
export interface Quote {
  symbol: string;
  /** The last trade. */
  price: number;
  /** Against the previous close (a stock) or 24 hours ago (a coin). */
  change: number;
  changePct: number;
  high: number;
  low: number;
  open: number;
  /** When the price is from, in ms; a coin's is when the office asked. */
  at: number;
  source: 'finnhub' | 'coinbase';
}

export interface Headline {
  id: number;
  headline: string;
  source: string;
  summary: string;
  url: string;
  /** When it was published, in ms. */
  at: number;
}

export interface QuotesAnswer {
  quotes: Quote[];
  /** Symbols nobody could price, with why: a stock with no key, a symbol no one knows, a source that's down. */
  missing: { symbol: string; why: string }[];
  /** Whether the office has a Finnhub key, so stocks and news work. */
  stocks: boolean;
}

export interface NewsAnswer {
  items: Headline[];
  stocks: boolean;
}

/** The most symbols one request can ask for, so a page can't run the free tier's limit down at once. */
export const MAX_SYMBOLS = 20;

/** The watchlist a new terminal starts with. */
export const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'TSLA', 'BTC-USD', 'ETH-USD', 'SOL-USD'];

const STOCK = /^[A-Z][A-Z0-9.]{0,9}$/;
const COIN = /^[A-Z0-9]{2,10}-(USD|USDC|USDT|EUR|GBP|BTC|ETH)$/;

/** Whether a symbol is a coin pair (BTC-USD), which Coinbase prices. */
export const isCoin = (s: string) => COIN.test(s);

/** A symbol as typed, upper-cased, or null when it's neither a stock ticker nor a coin pair. */
export function cleanSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  return STOCK.test(s) || COIN.test(s) ? s : null;
}

/** The symbols in a comma-separated list, cleaned, without repeats, at most MAX_SYMBOLS. */
export function parseSymbols(list: string): string[] {
  const out: string[] = [];
  for (const raw of list.split(',')) {
    const s = cleanSymbol(raw);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= MAX_SYMBOLS) break;
  }
  return out;
}
