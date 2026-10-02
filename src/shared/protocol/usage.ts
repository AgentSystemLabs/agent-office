// What workers spend: session usage, the office ledger and the Claude plan limits.

/** Session usage. The persistent office ledger continues to cover Claude Code only. */
export interface Usage {
  /** Input tokens that missed the prompt cache. */
  input: number;
  output: number;
  /** Reasoning tokens reported separately from output, when available. */
  reasoning?: number;
  /** False when the provider supplies tokens without usable pricing. Omitted for legacy Claude usage. */
  costKnown?: boolean;
  /** Provider history is still loading, failed to load, or reached a traversal limit. */
  incomplete?: boolean;
  /** Tokens written to the prompt cache. */
  cacheWrite: number;
  /** Tokens read from the prompt cache. */
  cacheRead: number;
  /** USD: estimated from the office's price list while a session runs, Claude Code's own figure once it has ended. */
  cost: number;
  /** API calls (assistant messages) counted. */
  calls: number;
  /** False when the provider reports cumulative tokens without a reliable call count. */
  callsKnown?: boolean;
  /** Authoritative provider total when it cannot be reconstructed from the displayed buckets. */
  totalTokens?: number;
  /** Size of the context window in tokens, when the provider reports one (DeepSeek Harness over ACP). */
  contextSize?: number;
  /**
   * The model its latest call ran on, as its session names it (`claude-opus-5-5`), when the office
   * reads that off the session: what a worker's card says it runs, whatever was asked for.
   */
  model?: string;
}

/** Every token a session used, cache reads and writes included: what the office shows. */
export function tokensOf(u: Usage): number {
  return u.totalTokens ?? u.input + u.output + (u.reasoning ?? 0) + u.cacheWrite + u.cacheRead;
}

/** e.g. 950, 12k, 1.25M */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(n < 10e6 ? 2 : 1)}M`;
}

export function fmtCost(usd: number): string {
  if (usd > 0 && usd < 0.005) return '<$0.01';
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Spend across the whole office, kept on disk (see server/usage.ts). */
export interface UsageState {
  /** Every worker the office ever ran, including ones sent home. */
  total: Usage;
  /** Since midnight on the office's machine. */
  today: Usage;
  /** The day `today` covers, YYYY-MM-DD on the office's machine. */
  day: string;
  /** Daily budget in USD (--budget), when one is set. */
  budget?: number;
  /** New hires are refused for the rest of the day once the budget is spent (--budget-pause). */
  pauseHiring: boolean;
}

/** One of the Claude plan's usage windows: the 5-hour session, the week, or a model's week. */
export interface PlanWindow {
  /** e.g. "5h session", "Week", "Fable week". */
  label: string;
  /** Percent of the window used, 0-100. */
  pct: number;
  /** When it starts over (ms since epoch), when known. */
  resetsAt?: number;
}

/**
 * The Claude plan limits of the account the office's Claude workers run on, as Claude Code's
 * /usage shows them (see server/limits.ts). One account for the whole building.
 */
export interface PlanLimits {
  /** 'pro', 'max', 'team', 'enterprise'…, when known. */
  plan?: string;
  /** The 5-hour session first, then the week, then per-model weeks. Empty until first read, or when there is no plan. */
  windows: PlanWindow[];
  /** When the numbers were read (ms since epoch); 0 before the first read. */
  at: number;
}

export type UsageClientMsg =
  /** Read the Claude plan limits again now, instead of at the next poll. */
  | { t: 'limits.refresh' };

export type UsageServerMsg =
  | { t: 'usage'; state: UsageState }
  | { t: 'limits'; state: PlanLimits };
