// The 📈 market terminal's portfolio: what you hold, typed in or read from a CSV you export from your
// broker. It never leaves this browser: the office is only ever asked for the symbols' prices, never
// how many you hold, and there's no sign-in to any broker.
import { cleanSymbol, type Quote } from '../../../shared/market';

export interface Holding {
  symbol: string;
  qty: number;
  /** What you paid a share on average, when you know it. */
  cost?: number;
}

export interface HoldingRow extends Holding {
  quote?: Quote;
  value?: number;
  /** Today's move on what you hold (against the previous close, or 24 hours for a coin). */
  day?: number;
  /** What it's up or down against what you paid. */
  gain?: number;
}

const KEY = 'agent-office.market.portfolio';
/** The most holdings kept, so a stray file can't fill the page. */
export const MAX_HOLDINGS = 100;

export function loadHoldings(): Holding[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (Array.isArray(v)) return merge(v.map(toHolding).filter((x): x is Holding => !!x));
  } catch {
    // storage blocked
  }
  return [];
}

export function saveHoldings(list: readonly Holding[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked
  }
}

function toHolding(v: unknown): Holding | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const symbol = cleanSymbol(String(o.symbol ?? ''));
  const qty = Number(o.qty);
  const cost = o.cost === undefined ? undefined : Number(o.cost);
  if (!symbol || !Number.isFinite(qty) || qty <= 0) return null;
  return { symbol, qty, cost: cost !== undefined && Number.isFinite(cost) && cost >= 0 ? cost : undefined };
}

/** The same symbol twice becomes one holding: the shares added up, the cost averaged over them. */
export function merge(list: readonly Holding[]): Holding[] {
  const by = new Map<string, Holding>();
  for (const h of list) {
    const was = by.get(h.symbol);
    if (!was) by.set(h.symbol, { ...h });
    else {
      const qty = was.qty + h.qty;
      const cost = was.cost !== undefined && h.cost !== undefined ? (was.cost * was.qty + h.cost * h.qty) / qty : (was.cost ?? h.cost);
      by.set(h.symbol, { symbol: h.symbol, qty, cost });
    }
  }
  return [...by.values()].slice(0, MAX_HOLDINGS);
}

/** A number as a broker's CSV writes it: "$1,234.50", "(12.00)", "10 shares". */
function money(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  const s = raw.trim();
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return s.replace(/[^0-9]/g, '') === '' ? NaN : neg ? -n : n;
}

/** One line of a CSV, with "quoted, fields" and "" for a quote inside one. */
function cells(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') out.push(cur), (cur = '');
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const SYMBOL_COL = /^(symbol|ticker|instrument|ticker symbol)$/i;
const QTY_COL = /^(quantity|qty|shares|units|amount held)$/i;
const COST_COL = /^(average cost|avg cost|average price|avg price|cost per share|average buy price|cost basis per share)$/i;

/**
 * Holdings from a CSV with a header row naming the symbol and quantity columns (and, if it has
 * one, the average cost a share): a positions export from a broker, or one you make yourself.
 * Lines it can't read are skipped and counted.
 */
export function parseHoldingsCsv(text: string): { holdings: Holding[]; skipped: number; error?: string } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const at = lines.findIndex((l) => {
    const c = cells(l);
    return c.some((x) => SYMBOL_COL.test(x)) && c.some((x) => QTY_COL.test(x));
  });
  if (at < 0) return { holdings: [], skipped: 0, error: 'No header row with a Symbol and a Quantity column' };
  const head = cells(lines[at]);
  const sym = head.findIndex((x) => SYMBOL_COL.test(x));
  const qty = head.findIndex((x) => QTY_COL.test(x));
  const cost = head.findIndex((x) => COST_COL.test(x));
  const out: Holding[] = [];
  let skipped = 0;
  for (const line of lines.slice(at + 1)) {
    const c = cells(line);
    const h = toHolding({ symbol: c[sym], qty: money(c[qty]), cost: cost >= 0 ? money(c[cost]) : undefined });
    if (h) out.push(h);
    else skipped++;
  }
  return { holdings: merge(out), skipped };
}

/** "AAPL 10" or "AAPL 10 182.50" (shares, then what you paid a share) typed in the terminal's box. */
export function parseHoldingCommand(raw: string): Holding | { symbol: string; qty: 0 } | null {
  const m = raw.trim().match(/^(\S+)\s+([\d.,]+)(?:\s+@?\s*\$?([\d.,]+))?$/);
  if (!m) return null;
  const symbol = cleanSymbol(m[1]);
  const qty = money(m[2]);
  const cost = m[3] === undefined ? undefined : money(m[3]);
  if (!symbol || !Number.isFinite(qty) || qty < 0) return null;
  if (qty === 0) return { symbol, qty: 0 };
  return { symbol, qty, cost: cost !== undefined && Number.isFinite(cost) ? cost : undefined };
}

/** Each holding priced with the latest quotes, and the totals over the ones that have a price. */
export function valueHoldings(list: readonly Holding[], quotes: ReadonlyMap<string, Quote>) {
  let value = 0;
  let day = 0;
  let gain = 0;
  let paid = 0;
  const rows: HoldingRow[] = list.map((h) => {
    const quote = quotes.get(h.symbol);
    if (!quote) return { ...h };
    const v = quote.price * h.qty;
    const d = quote.change * h.qty;
    const g = h.cost !== undefined ? v - h.cost * h.qty : undefined;
    value += v;
    day += d;
    if (g !== undefined && h.cost !== undefined) (gain += g), (paid += h.cost * h.qty);
    return { ...h, quote, value: v, day: d, gain: g };
  });
  return { rows, value, day, gain, gainPct: paid > 0 ? (gain / paid) * 100 : undefined, priced: rows.filter((r) => r.quote).length };
}
