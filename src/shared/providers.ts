// The agents a worker can run, and what the office knows about each of them, in one table: its
// name, the executable it runs as, which models and reasoning efforts it takes and how its spend
// shows. How the server starts and follows each one is its adapter in server/providers/.
//
// Browser-safe: no node imports, the hire dialog reads this too.

export const AGENT_PROVIDERS = ['claude', 'opencode', 'codex', 'grok', 'muse', 'dsh', 'pi', 'custom'] as const;

export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export function isAgentProvider(value: unknown): value is AgentProvider {
  return (AGENT_PROVIDERS as readonly unknown[]).includes(value);
}

/** A Claude model alias the hire dialog and queue can request explicitly (see server/agents.ts). */
export type ClaudeModel = 'fable' | 'opus' | 'sonnet' | 'haiku';
export const CLAUDE_MODELS: readonly ClaudeModel[] = ['fable', 'opus', 'sonnet', 'haiku'];
export function isClaudeModel(value: unknown): value is ClaudeModel {
  return value === 'fable' || value === 'opus' || value === 'sonnet' || value === 'haiku';
}

/** Claude Code's `--effort` levels, from fastest/cheapest to most thorough. */
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const AGENT_EFFORTS: readonly AgentEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export function isAgentEffort(value: unknown): value is AgentEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max';
}

export const OPEN_CODE_MODEL_MAX = 256;
export const GROK_MODEL_MAX = 64;
export const MUSE_MODEL_MAX = 128;
export const PI_MODEL_MAX = 256;

/**
 * DeepSeek Harness model ids are opaque option ids from its live catalog (the `session/new`
 * configuration-option state), so the office cannot validate them syntactically the way it does
 * Claude aliases or OpenCode `provider/model` ids: it only bounds length and rejects control
 * characters. A stale saved id degrades at `session/new` instead of failing the launch.
 */
export const DSH_MODEL_MAX = 256;

/** OpenCode model ids are argv values, so reject anything that could be ambiguous or unsafe. */
export function isValidOpenCodeModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > OPEN_CODE_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  const parts = value.split('/');
  return parts.length >= 2 && /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(parts[0]) && parts.slice(1).every((part) => part.length > 0);
}

/** Grok model ids are argv values (`grok-4.6`), so reject anything that could be ambiguous or unsafe. */
export function isValidGrokModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > GROK_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

/** Muse model ids are argv values (`muse-spark-1.3-contributor`), so reject anything ambiguous or unsafe. */
export function isValidMuseModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MUSE_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

/**
 * Pi takes model ids, fuzzy model names and provider/model patterns (`sonnet`, `openai/gpt-4.1`,
 * `sonnet:high`). They're argv values, and a Windows `.cmd` launcher runs them through cmd.exe, so
 * only the characters a model name uses get through, and never a leading '-'.
 */
export function isValidPiModel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= PI_MODEL_MAX && /^[A-Za-z0-9._:/@+][A-Za-z0-9._:/@+-]*$/.test(value);
}

/** DSH catalog ids are opaque, so only their length and control characters can be checked here. */
export function isValidDshModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > DSH_MODEL_MAX) return false;
  return !/[\p{Cc}\p{Cf}]/u.test(value);
}

export interface ProviderMeta {
  /** What the office's windows call it. */
  label: string;
  /** What the server's messages and --help call it, where that's shorter ("Muse"). */
  name: string;
  /** The executable it runs as: an office started with `--agent <bin>` runs it (see server/agents.ts). None for a custom --agent. */
  bin?: string;
  /** Takes a model picked for each worker: which ids (they end up on its command line, so they're checked). */
  validModel?: (value: unknown) => value is string;
  /** What asking for a model `validModel` turns down says. */
  invalidModel?: string;
  /** Takes a reasoning effort picked for each worker. */
  takesEffort?: boolean;
  /** How its spend shows on a worker's card, in the workers list and in the queue (see client ui/provider.ts). */
  usage: {
    /** Tracked from its start, numbers or not: the office reads them off its session itself. */
    tracked?: boolean;
    /** It reports numbers of its own: until the first report comes in, it's waiting for one rather than untracked. */
    reports?: boolean;
    /** Its reports leave the cost out unless they say it's known. */
    noCost?: boolean;
    /** What it says while it waits for its first numbers. */
    waiting?: string;
    /** The note under the provider picker. */
    note: string;
  };
}

export const PROVIDER_META: Record<AgentProvider, ProviderMeta> = {
  claude: {
    label: 'Claude Code',
    name: 'Claude Code',
    bin: 'claude',
    validModel: isClaudeModel,
    invalidModel: 'Invalid Claude model (expected fable, opus, sonnet or haiku)',
    takesEffort: true,
    usage: { tracked: true, note: 'Office usage and budget track Claude Code.' },
  },
  opencode: {
    label: 'OpenCode',
    name: 'OpenCode',
    bin: 'opencode',
    validModel: isValidOpenCodeModel,
    invalidModel: 'Invalid OpenCode model (expected provider/model without whitespace)',
    usage: { reports: true, waiting: 'waiting for metrics', note: 'OpenCode reports model/provider estimates; they are not billing, and arrive after the first report.' },
  },
  codex: {
    label: 'Codex',
    name: 'Codex',
    bin: 'codex',
    usage: {
      reports: true,
      noCost: true,
      waiting: 'waiting for first report',
      note: 'Review Office hooks in /hooks to enable tracking. Codex reports root-session tokens; subagents are excluded and cost is unavailable.',
    },
  },
  grok: {
    label: 'Grok',
    name: 'Grok',
    bin: 'grok',
    validModel: isValidGrokModel,
    invalidModel: 'Invalid Grok model',
    takesEffort: true,
    usage: { note: 'Grok spend is not metered by the office; token totals stay in the worker terminal.' },
  },
  muse: {
    label: 'Muse Code',
    name: 'Muse',
    bin: 'muse',
    validModel: isValidMuseModel,
    invalidModel: 'Invalid Muse model',
    takesEffort: true,
    usage: { note: 'Muse spend is not metered by the office; token totals stay in the worker terminal.' },
  },
  dsh: {
    label: 'DeepSeek Harness',
    name: 'DeepSeek Harness',
    bin: 'dsh',
    validModel: isValidDshModel,
    invalidModel: 'Invalid DeepSeek Harness model (expected a catalog model id of up to 256 characters)',
    takesEffort: true,
    usage: { reports: true, waiting: 'waiting for first report', note: 'DeepSeek Harness reports context usage over ACP after its first turn; cost may be unavailable.' },
  },
  pi: {
    label: 'Pi',
    name: 'Pi',
    bin: 'pi',
    validModel: isValidPiModel,
    invalidModel: 'Invalid Pi model (expected a model name or provider/model without whitespace)',
    takesEffort: true,
    usage: { note: 'Pi uses your existing Pi login and settings. Usage and cost stay in its terminal; the office does not meter them.' },
  },
  custom: {
    label: 'Custom',
    name: 'Custom',
    usage: { note: 'Usage is untracked unless compatible Claude Code hooks report it.' },
  },
};

/** What the table says about `provider`, when it's one (saved state and the wire can hold anything). */
export function providerMeta(provider: unknown): ProviderMeta | undefined {
  return isAgentProvider(provider) ? PROVIDER_META[provider] : undefined;
}

/** Whether a model can be picked for a worker on `provider`. */
export function takesModel(provider: unknown): boolean {
  return !!providerMeta(provider)?.validModel;
}

/** Whether a reasoning effort can be picked for a worker on `provider`. */
export function takesEffort(provider: unknown): boolean {
  return !!providerMeta(provider)?.takesEffort;
}

/** A saved model, when `provider` takes that one; for what workers.json or the queue kept, which may be from anywhere. */
export function savedModel(provider: unknown, model: unknown): string | undefined {
  return providerMeta(provider)?.validModel?.(model) ? (model as string) : undefined;
}

/** A saved reasoning effort, when `provider` takes one. */
export function savedEffort(provider: unknown, effort: unknown): AgentEffort | undefined {
  return takesEffort(provider) && isAgentEffort(effort) ? effort : undefined;
}

/** "a, b or c": the names of the providers that `has` holds for, in the table's order. */
export function providerNames(has: (meta: ProviderMeta) => boolean): string {
  const names = AGENT_PROVIDERS.map((p) => PROVIDER_META[p]).filter(has).map((m) => m.name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names.join('');
}
