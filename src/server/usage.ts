import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Usage, UsageState } from '../shared/protocol.js';

/*
 * Where a worker's numbers come from
 * ----------------------------------
 * Claude Code hooks carry no usage, but every hook payload names the session's transcript
 * (~/.claude/projects/<dir>/<session>.jsonl). Each assistant message in it records the API's
 * `usage` (input, output, cache write, cache read) and the model, so tokens are exact and the cost
 * is priced here from PRICES. Subagents (the Agent tool) log to <session>/subagents/*.jsonl next to
 * it; those are read too. When a session ends, Claude Code appends a `cost-state` line with its own
 * tally — that also covers calls that never reach the transcript (titles, summaries) — and the
 * worker's figures snap to it; anything logged after (a resume) is estimated on top again.
 *
 * The transcript format is Claude Code's own and may change: everything below is defensive, and a
 * line it does not understand is skipped, never fatal.
 */

export const zeroUsage = (): Usage => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 });

export function addUsage(a: Usage, b: Usage, sign = 1): Usage {
  return {
    input: a.input + sign * b.input,
    output: a.output + sign * b.output,
    cacheWrite: a.cacheWrite + sign * b.cacheWrite,
    cacheRead: a.cacheRead + sign * b.cacheRead,
    cost: a.cost + sign * b.cost,
    calls: a.calls + sign * b.calls,
  };
}

const isZero = (u: Usage) => !u.input && !u.output && !u.cacheWrite && !u.cacheRead && !u.cost && !u.calls;

/**
 * USD per million tokens — [input, output, cache read] — from the Claude pricing page, checked
 * 2026-09-26. A 5-minute cache write costs 1.25x input, a 1-hour write 2x. First match wins, so
 * newer generations come before the family they belong to. A model not listed gets Opus rates:
 * a budget warning that comes early beats one that comes late.
 */
const PRICES: [RegExp, [number, number, number]][] = [
  [/fable-5-1|mythos-5-1/, [10, 50, 0.25]],
  [/fable|mythos/, [10, 50, 1]],
  [/opus-5-5/, [4, 20, 0.2]],
  [/opus-(5|4-[5-8])/, [5, 25, 0.5]],
  [/opus/, [15, 75, 1.5]],
  [/sonnet-5/, [2, 10, 0.2]],
  [/sonnet/, [3, 15, 0.3]],
  [/haiku-4/, [1, 5, 0.1]],
  [/haiku-3-5/, [0.8, 4, 0.08]],
  [/haiku/, [0.25, 1.25, 0.03]],
];
const OPUS: [number, number, number] = [5, 25, 0.5];
const WEB_SEARCH_USD = 0.01;

export function priceOf(model: string): [number, number, number] {
  const m = model.toLowerCase();
  return PRICES.find(([re]) => re.test(m))?.[1] ?? OPUS;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** One assistant message's tokens, priced. */
export function usageOfMessage(model: string, u: any): Usage {
  const input = num(u?.input_tokens);
  const output = num(u?.output_tokens);
  const cacheWrite = num(u?.cache_creation_input_tokens);
  const hour = Math.min(cacheWrite, num(u?.cache_creation?.ephemeral_1h_input_tokens));
  const cacheRead = num(u?.cache_read_input_tokens);
  const [pin, pout, pread] = priceOf(model);
  const cost = (input * pin + output * pout + (cacheWrite - hour) * pin * 1.25 + hour * pin * 2 + cacheRead * pread) / 1e6 + num(u?.server_tool_use?.web_search_requests) * WEB_SEARCH_USD;
  return { input, output, cacheWrite, cacheRead, cost, calls: 1 };
}

// ---------------------------------------------------------------------------------------------
// Per-worker tracking

interface FileCursor {
  /** Bytes of the file already read (always at a line boundary). */
  offset: number;
  /** A message with several content blocks is logged once per block, with the same id and usage. */
  lastId?: string;
  lastUsage?: Usage;
}

export interface UsageTracker {
  /** The session's transcript, from the hook payloads. */
  transcript?: string;
  files: Record<string, FileCursor>;
  /** Claude Code's own tally from the end of a session; `at` is the transcript time it covers up to. */
  base?: Usage & { at: number };
  /** Estimated from the messages logged after `base`. */
  since: Usage;
  /** Latest transcript timestamp seen. */
  at?: number;
  /** The model the session's own latest message ran on (not a subagent's). */
  model?: string;
}

export const newTracker = (): UsageTracker => ({ files: {}, since: zeroUsage() });

export function trackerUsage(t: UsageTracker): Usage {
  const model = t.model ? { model: t.model } : {};
  if (!t.base) return { ...t.since, ...model };
  const { at: _at, ...base } = t.base;
  return { ...addUsage(base, t.since), ...model };
}

const asUsage = (v: any): Usage | undefined =>
  v && typeof v === 'object' ? { input: num(v.input), output: num(v.output), cacheWrite: num(v.cacheWrite), cacheRead: num(v.cacheRead), cost: num(v.cost), calls: num(v.calls) } : undefined;

/** Rebuilds a tracker saved by a previous run; anything odd falls back to starting over. */
export function restoreTracker(saved: any): UsageTracker {
  const t = newTracker();
  if (!saved || typeof saved !== 'object') return t;
  if (typeof saved.transcript === 'string') t.transcript = saved.transcript;
  if (saved.files && typeof saved.files === 'object') {
    for (const [file, c] of Object.entries<any>(saved.files)) {
      if (!c || typeof c !== 'object') continue;
      t.files[file] = { offset: num(c.offset), lastId: typeof c.lastId === 'string' ? c.lastId : undefined, lastUsage: asUsage(c.lastUsage) };
    }
  }
  const base = asUsage(saved.base);
  if (base) t.base = { ...base, at: num(saved.base.at) };
  t.since = asUsage(saved.since) ?? zeroUsage();
  if (num(saved.at)) t.at = saved.at;
  if (isModelId(saved.model)) t.model = saved.model;
  return t;
}

/** Subagent transcripts live in <transcript dir>/<session id>/subagents/. */
function subagentFiles(transcript: string): string[] {
  const dir = path.join(path.dirname(transcript), path.basename(transcript, '.jsonl'), 'subagents');
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** Reads whatever was appended to the session's transcripts. True when the totals changed. */
export function scanTracker(t: UsageTracker): boolean {
  if (!t.transcript) return false;
  let changed = false;
  for (const file of [t.transcript, ...subagentFiles(t.transcript)]) {
    const cur = (t.files[file] ??= { offset: 0 });
    for (const line of readNewLines(file, cur)) {
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (applyLine(t, cur, obj, file === t.transcript)) changed = true;
    }
  }
  return changed;
}

/** A model id as a session logs it: Claude Code's own placeholder messages ("<synthetic>") aren't one. */
const isModelId = (v: unknown): v is string => typeof v === 'string' && /^[\w.:/@[\]-]{1,120}$/.test(v);

/** One transcript line; `main` when it's from the session's own transcript rather than a subagent's. */
function applyLine(t: UsageTracker, cur: FileCursor, line: any, main: boolean): boolean {
  if (!line || typeof line !== 'object') return false;
  const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN;
  if (at > (t.at ?? 0)) t.at = at;
  if (line.type === 'assistant') {
    const msg = line.message;
    if (!msg || typeof msg !== 'object' || typeof msg.id !== 'string' || !msg.usage) return false;
    if (main && !line.isSidechain && isModelId(msg.model)) t.model = msg.model;
    // Already inside Claude Code's own tally.
    if (t.base && at <= t.base.at) return false;
    const u = usageOfMessage(typeof msg.model === 'string' ? msg.model : '', msg.usage);
    const delta = cur.lastId === msg.id && cur.lastUsage ? addUsage(u, cur.lastUsage, -1) : u;
    cur.lastId = msg.id;
    cur.lastUsage = u;
    if (isZero(delta)) return false;
    t.since = addUsage(t.since, delta);
    return true;
  }
  if (line.type === 'cost-state' && typeof line.totalCostUSD === 'number' && line.modelUsage && typeof line.modelUsage === 'object' && !line.hasUnknownModelCost) {
    const base = zeroUsage();
    for (const m of Object.values<any>(line.modelUsage)) {
      if (!m || typeof m !== 'object') continue;
      base.input += num(m.inputTokens);
      base.output += num(m.outputTokens);
      base.cacheWrite += num(m.cacheCreationInputTokens);
      base.cacheRead += num(m.cacheReadInputTokens);
    }
    base.cost = num(line.totalCostUSD);
    base.calls = trackerUsage(t).calls;
    t.base = { ...base, at: t.at ?? 0 };
    t.since = zeroUsage();
    return true;
  }
  return false;
}

const CHUNK = 4 * 1024 * 1024;

/** Complete lines appended since the cursor; a half-written last line waits for the next read. */
function* readNewLines(file: string, cur: FileCursor): Generator<string> {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return;
  }
  try {
    const size = fstatSync(fd).size;
    if (size < cur.offset) {
      // Shorter than last time: not the file we knew. Start over.
      cur.offset = 0;
      cur.lastId = undefined;
      cur.lastUsage = undefined;
    }
    let want = CHUNK;
    while (cur.offset < size) {
      const len = Math.min(want, size - cur.offset);
      const buf = Buffer.allocUnsafe(len);
      let got = 0;
      while (got < len) {
        const n = readSync(fd, buf, got, len - got, cur.offset + got);
        if (n <= 0) break;
        got += n;
      }
      if (!got) return;
      const end = buf.lastIndexOf(10, got - 1);
      if (end < 0) {
        if (got < size - cur.offset) {
          want *= 2; // one line longer than the chunk: read more of it
          continue;
        }
        return; // the tail is still being written
      }
      const text = buf.toString('utf8', 0, end);
      cur.offset += end + 1;
      want = CHUNK;
      for (const line of text.split('\n')) if (line) yield line;
    }
  } finally {
    closeSync(fd);
  }
}

// ---------------------------------------------------------------------------------------------
// Office-wide ledger

export interface LedgerOptions {
  /** Daily budget in USD. */
  budget?: number;
  /** Refuse new hires for the rest of the day once the budget is spent. */
  pauseHiring: boolean;
}

const KEEP_DAYS = 90;

function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

/**
 * What the office has spent, all time and per day, so totals survive restarts and outlive the
 * workers they came from. Spend lands on the day it is read, which is the day it happened unless
 * the office was down at the time.
 */
export class Ledger {
  private file: string;
  private total = zeroUsage();
  private days: Record<string, Usage> = {};
  private warnedDay = '';
  private shownDay = '';
  private saveTimer: NodeJS.Timeout | null = null;
  private emitTimer: NodeJS.Timeout | null = null;
  private tick: NodeJS.Timeout;

  constructor(
    dataDir: string,
    private opts: LedgerOptions,
    private onChange: (state: UsageState) => void,
    private toast: (text: string, level: 'info' | 'warn') => void,
  ) {
    this.file = path.join(dataDir, 'usage.json');
    this.load();
    this.shownDay = localDay();
    // Midnight: "today" starts over and a paused office hires again.
    this.tick = setInterval(() => {
      if (localDay() !== this.shownDay) this.emit();
    }, 30_000);
    this.tick.unref();
  }

  state(): UsageState {
    const day = localDay();
    return { total: { ...this.total }, today: { ...(this.days[day] ?? zeroUsage()) }, day, budget: this.opts.budget, pauseHiring: this.opts.pauseHiring };
  }

  get overBudget(): boolean {
    return this.opts.budget !== undefined && (this.days[localDay()]?.cost ?? 0) >= this.opts.budget;
  }

  /** Why a new agent can't be hired right now, when it can't. */
  get hiringPaused(): string | undefined {
    if (!this.opts.pauseHiring || !this.overBudget) return undefined;
    return `Today's ${fmtUsd(this.opts.budget!)} budget is spent — no new hires until tomorrow`;
  }

  add(delta: Usage) {
    if (isZero(delta)) return;
    const day = localDay();
    this.total = addUsage(this.total, delta);
    this.days[day] = addUsage(this.days[day] ?? zeroUsage(), delta);
    for (const d of Object.keys(this.days).sort().slice(0, -KEEP_DAYS)) delete this.days[d];
    this.save();
    this.emit();
    if (this.opts.budget !== undefined && this.overBudget && this.warnedDay !== day) {
      this.warnedDay = day;
      const spent = fmtUsd(this.days[day].cost);
      this.toast(`💸 Today's spend passed the ${fmtUsd(this.opts.budget)} budget (${spent})${this.opts.pauseHiring ? ' — no new hires until tomorrow' : ''}`, 'warn');
    }
  }

  flush() {
    clearInterval(this.tick);
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.write();
    }
  }

  private emit() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.shownDay = localDay();
      this.onChange(this.state());
    }, 200);
  }

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.write();
    }, 1000);
  }

  private write() {
    try {
      writeFileSync(this.file, JSON.stringify({ total: this.total, days: this.days }, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }

  private load() {
    if (!existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      this.total = asUsage(saved?.total) ?? zeroUsage();
      if (saved?.days && typeof saved.days === 'object') {
        for (const [day, u] of Object.entries(saved.days)) {
          const usage = asUsage(u);
          if (usage && /^\d{4}-\d{2}-\d{2}$/.test(day)) this.days[day] = usage;
        }
      }
    } catch {
      // corrupt file: start fresh
    }
  }
}
