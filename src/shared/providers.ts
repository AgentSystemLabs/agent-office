// The agents a worker can run, and what the office knows about each of them, in one table: its
// name, the executable it runs as, which models and reasoning efforts it takes and how its spend
// shows. How the server starts and follows each one is its adapter in server/providers/.
//
// Browser-safe: no node imports, the hire dialog reads this too.

export const AGENT_PROVIDERS = ['claude', 'opencode', 'codex', 'grok', 'muse', 'dsh', 'pi', 'cursor', 'custom'] as const;

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

/**
 * The model each alias stands for in Claude Code today, for the windows to say which one a worker
 * gets ("Opus 5.5", not "Opus"). Claude Code resolves the alias itself, to its own latest: a new
 * model generation means new names here. Once a worker has spoken, its card goes by the model its
 * session reports instead (see claudeModelName).
 */
export const CLAUDE_MODEL_NAMES: Record<ClaudeModel, string> = {
  fable: 'Fable 5.1',
  opus: 'Opus 5.5',
  sonnet: 'Sonnet 5.5',
  haiku: 'Haiku 4.5',
};

/**
 * What a Claude model id is called: "Opus 5.5" for `claude-opus-5-5`, "Haiku 4.5" for
 * `claude-haiku-4-5-20251001`, "Sonnet 3.5" for the older `claude-3-5-sonnet-20241022`, with or
 * without a cloud's prefix and suffix around it. Undefined for anything that isn't one.
 */
export function claudeModelName(id: string): string | undefined {
  const cap = (family: string) => family[0].toUpperCase() + family.slice(1);
  const version = (major: string, minor?: string) => (minor ? `${major}.${minor}` : major);
  const now = /claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?![0-9])/.exec(id);
  if (now) return `${cap(now[1])} ${version(now[2], now[3])}`;
  const old = /claude-(\d{1,2})(?:-(\d{1,2}))?-([a-z]+)/.exec(id);
  return old ? `${cap(old[3])} ${version(old[1], old[2])}` : undefined;
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
export const CURSOR_MODEL_MAX = 128;
export const CODEX_MODEL_MAX = 128;

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
 * Codex model ids are argv values: its own (`gpt-5.5`), or a local provider's (`gpt-oss:20b`,
 * `openai/gpt-oss-20b`). Only the characters a model name uses get through, and never a leading '-'.
 */
export function isValidCodexModel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= CODEX_MODEL_MAX && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
}

/**
 * Pi takes model ids, fuzzy model names and provider/model patterns (`sonnet`, `openai/gpt-4.1`,
 * `sonnet:high`). They're argv values, and a Windows `.cmd` launcher runs them through cmd.exe, so
 * only the characters a model name uses get through, and never a leading '-'.
 */
export function isValidPiModel(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= PI_MODEL_MAX && /^[A-Za-z0-9._:/@+][A-Za-z0-9._:/@+-]*$/.test(value);
}

/**
 * Cursor model ids are argv values (`gpt-5`, `sonnet-4-thinking`), and a parameterized one carries
 * its overrides in brackets (`claude-opus-4-8[context=1m,effort=high]`). Only those characters get
 * through, and never a leading '-'.
 */
export function isValidCursorModel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= CURSOR_MODEL_MAX && /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9._-]+=[A-Za-z0-9._-]+(?:,[A-Za-z0-9._-]+=[A-Za-z0-9._-]+)*\])?$/.test(value);
}

/** DSH catalog ids are opaque, so only their length and control characters can be checked here. */
export function isValidDshModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > DSH_MODEL_MAX) return false;
  return !/[\p{Cc}\p{Cf}]/u.test(value);
}

/** One model a provider offers, for the hire dialog: a fixed one, or one its own CLI lists (see server/models.ts). */
export interface ModelOption {
  id: string;
  /** What it's called, when that's more than its id ("GPT-5.5", "Opus 5.5"). */
  name?: string;
  /** The reasoning efforts it takes, when its catalogue says: every one, when it doesn't. */
  efforts?: AgentEffort[];
}

/** How the hire dialog asks for a provider's model (see client ui/provider.ts). */
export interface ModelField {
  /** Picked from a list (the fixed ones, or its catalogue), or typed in, with its catalogue as suggestions. */
  pick: 'list' | 'typed';
  /** The ones it always has (Claude Code's aliases). */
  fixed?: readonly ModelOption[];
  /** Its CLI lists them: the office asks it, at /api/agents/<provider>/models. */
  catalog?: boolean;
  /** What leaving it alone gets: "Default (Grok settings)". */
  unset: string;
  /** The longest id it takes, for a typed one. */
  max?: number;
  /** The line under the fields. */
  hint: string;
  /** What a typed id it turns down says. */
  invalid?: string;
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
  /** How the hire dialog asks for that model. A provider that takes one has this too (a test checks). */
  models?: ModelField;
  /** Takes a reasoning effort picked for each worker. */
  takesEffort?: boolean;
  /** What it calls its reasoning effort, when that isn't "Effort". */
  effortLabel?: string;
  /** Why it has no model or effort to pick, for the hire dialog to say. */
  unpicked?: string;
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
    models: {
      pick: 'list',
      fixed: CLAUDE_MODELS.map((id) => ({ id, name: CLAUDE_MODEL_NAMES[id] })),
      unset: 'Default (--agent-args)',
      hint: 'The cost panel tracks each model separately.',
    },
    takesEffort: true,
    usage: { tracked: true, note: 'Office usage and budget track Claude Code.' },
  },
  opencode: {
    label: 'OpenCode',
    name: 'OpenCode',
    bin: 'opencode',
    validModel: isValidOpenCodeModel,
    invalidModel: 'Invalid OpenCode model (expected provider/model without whitespace)',
    models: {
      pick: 'typed',
      catalog: true,
      unset: 'Default (OpenCode settings)',
      max: OPEN_CODE_MODEL_MAX,
      hint: 'Optional provider/model: choose a suggestion or type one. Effort is the model\u2019s variant in OpenCode.',
      invalid: 'Use provider/model format without whitespace or control characters (up to 256 characters).',
    },
    takesEffort: true,
    usage: { reports: true, waiting: 'waiting for metrics', note: 'OpenCode reports model/provider estimates; they are not billing, and arrive after the first report.' },
  },
  codex: {
    label: 'Codex',
    name: 'Codex',
    bin: 'codex',
    validModel: isValidCodexModel,
    invalidModel: 'Invalid Codex model (expected a model id such as gpt-5.5, without whitespace)',
    models: {
      pick: 'list',
      catalog: true,
      unset: 'Default (Codex settings)',
      max: CODEX_MODEL_MAX,
      hint: 'Optional model and effort for this worker.',
      invalid: 'Use a Codex model id without whitespace (up to 128 characters).',
    },
    takesEffort: true,
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
    models: {
      pick: 'list',
      catalog: true,
      unset: 'Default (Grok settings)',
      max: GROK_MODEL_MAX,
      hint: 'Optional model and effort for this worker.',
      invalid: 'Use a Grok model id without whitespace (up to 64 characters).',
    },
    takesEffort: true,
    usage: { note: 'Grok spend is not metered by the office; token totals stay in the worker terminal.' },
  },
  muse: {
    label: 'Muse Code',
    name: 'Muse',
    bin: 'muse',
    validModel: isValidMuseModel,
    invalidModel: 'Invalid Muse model',
    models: {
      pick: 'typed',
      unset: 'Default (Muse settings)',
      max: MUSE_MODEL_MAX,
      hint: 'Optional model id (for example muse-spark-1.3-contributor) and effort for this worker.',
      invalid: 'Use a Muse model id without whitespace or control characters (up to 128 characters).',
    },
    takesEffort: true,
    usage: { note: 'Muse spend is not metered by the office; token totals stay in the worker terminal.' },
  },
  dsh: {
    label: 'DeepSeek Harness',
    name: 'DeepSeek Harness',
    bin: 'dsh',
    validModel: isValidDshModel,
    invalidModel: 'Invalid DeepSeek Harness model (expected a catalog model id of up to 256 characters)',
    models: {
      pick: 'typed',
      unset: 'Default (DSH profile)',
      max: DSH_MODEL_MAX,
      hint: 'Optional model id from DeepSeek Harness\u2019s catalog, and effort; leave empty to use the profile default.',
      invalid: 'Use a DeepSeek Harness catalog model id of up to 256 characters without control characters.',
    },
    takesEffort: true,
    usage: { reports: true, waiting: 'waiting for first report', note: 'DeepSeek Harness reports context usage over ACP after its first turn; cost may be unavailable.' },
  },
  pi: {
    label: 'Pi',
    name: 'Pi',
    bin: 'pi',
    validModel: isValidPiModel,
    invalidModel: 'Invalid Pi model (expected a model name or provider/model without whitespace)',
    models: {
      pick: 'typed',
      unset: 'Default (Pi settings)',
      max: PI_MODEL_MAX,
      hint: 'Optional model name or provider/model; leave Default to use Pi settings.',
      invalid: 'Use a Pi model name or provider/model: letters, digits and . _ : / @ + - (up to 256 characters).',
    },
    takesEffort: true,
    effortLabel: 'Thinking',
    usage: { note: 'Pi uses your existing Pi login and settings. Usage and cost stay in its terminal; the office does not meter them.' },
  },
  cursor: {
    label: 'Cursor',
    name: 'Cursor',
    bin: 'cursor-agent',
    validModel: isValidCursorModel,
    invalidModel: 'Invalid Cursor model (expected a model id such as gpt-5, with any overrides in brackets)',
    models: {
      pick: 'typed',
      catalog: true,
      unset: 'Default (Cursor settings)',
      max: CURSOR_MODEL_MAX,
      hint: 'Optional model id; suggestions come from `cursor-agent models` once Cursor is signed in on the office machine. An effort goes in brackets after it: model[effort=high].',
      invalid: 'Use a Cursor model id: letters, digits and . _ -, with any overrides in brackets, like model[effort=high] (up to 128 characters).',
    },
    usage: { note: 'Cursor uses the Cursor CLI login on the office machine. Usage and cost stay in its terminal and your Cursor account; the office does not meter them.' },
  },
  custom: {
    label: 'Custom',
    name: 'Custom',
    unpicked: 'A custom --agent runs as it is: set its model and effort in --agent-args.',
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
