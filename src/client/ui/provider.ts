import type { AgentEffort, AgentProvider, ClaudeModel, ProjectInfo, Usage } from '../../shared/protocol';
import { AGENT_EFFORTS, CLAUDE_MODELS } from '../../shared/protocol';
import { h } from './dom';

const PROVIDER_KEY = 'agent-office.provider';

export const PROVIDER_LABEL: Record<AgentProvider, string> = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  codex: 'Codex',
  custom: 'Custom',
};

export const CLAUDE_MODEL_LABEL: Record<ClaudeModel, string> = {
  fable: 'Fable',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

export const EFFORT_LABEL: Record<AgentEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

/** A short badge for the task card / sidebar: "Opus", "Opus · High", or the raw OpenCode model id. */
export function modelBadge(provider: AgentProvider | undefined, model: string | undefined, effort: AgentEffort | undefined): string | undefined {
  if (!model && !effort) return undefined;
  if (provider === 'claude') {
    const label = model && model in CLAUDE_MODEL_LABEL ? CLAUDE_MODEL_LABEL[model as ClaudeModel] : undefined;
    const parts = [label, effort ? EFFORT_LABEL[effort] : undefined].filter((v): v is string => !!v);
    return parts.length ? parts.join(' · ') : undefined;
  }
  return model;
}

/** Providers the server says this project can start. */
export function supportedProviders(project: ProjectInfo | null): AgentProvider[] {
  const values = project?.agentProviders?.filter((p): p is AgentProvider => p === 'claude' || p === 'opencode' || p === 'codex' || p === 'custom') ?? [];
  if (values.length) return [...new Set(values)];
  return project?.defaultProvider && PROVIDER_LABEL[project.defaultProvider] ? [project.defaultProvider] : ['claude'];
}

/** Resolve old workers/tasks that have no provider metadata to the configured default. */
export function resolvedProvider(provider: AgentProvider | undefined, project: ProjectInfo | null): AgentProvider {
  // A worker/task keeps its identity even if the office was later restarted with a
  // configuration that no longer offers that provider.
  if (provider && PROVIDER_LABEL[provider]) return provider;
  const configured = project?.defaultProvider;
  return configured && PROVIDER_LABEL[configured] ? configured : supportedProviders(project)[0];
}

export function providerLabel(provider: AgentProvider | undefined, project: ProjectInfo | null): string {
  return PROVIDER_LABEL[resolvedProvider(provider, project)];
}

export function providerUsageTracked(provider: AgentProvider | undefined, project: ProjectInfo | null, usage?: Usage): boolean {
  const selected = resolvedProvider(provider, project);
  return selected === 'claude' || ((selected === 'opencode' || selected === 'codex' || selected === 'custom') && usage !== undefined);
}

export type ProviderUsageState = 'tracked' | 'waiting' | 'untracked';

/** Distinguishes a provider with no first report from one whose metrics are intentionally unavailable. */
export function providerUsageState(provider: AgentProvider | undefined, project: ProjectInfo | null, usage?: Usage): ProviderUsageState {
  const selected = resolvedProvider(provider, project);
  if (selected === 'claude') return usage ? 'tracked' : 'waiting';
  if (selected === 'opencode') return usage ? 'tracked' : 'waiting';
  if (selected === 'codex') return usage ? 'tracked' : 'waiting';
  if (selected === 'custom') return usage ? 'tracked' : 'untracked';
  return 'untracked';
}

export function providerUsageNote(provider: AgentProvider): string {
  if (provider === 'claude') return 'Office usage and budget track Claude Code.';
  if (provider === 'codex') return 'Review Office hooks in /hooks to enable tracking. Codex reports root-session tokens; subagents are excluded and cost is unavailable.';
  if (provider === 'custom') return 'Usage is untracked unless compatible Claude Code hooks report it.';
  return 'OpenCode reports model/provider estimates; they are not billing, and arrive after the first report.';
}

function preferredProvider(options: AgentProvider[], fallback: AgentProvider): AgentProvider {
  try {
    const saved = localStorage.getItem(PROVIDER_KEY);
    if (saved && options.includes(saved as AgentProvider)) return saved as AgentProvider;
  } catch {
    // storage blocked
  }
  return options.includes(fallback) ? fallback : options[0];
}

export interface ProviderPicker {
  element: HTMLElement;
  value(): AgentProvider;
  /** The optional initial model override: an OpenCode provider/model id, or a Claude model alias. */
  model(): string | undefined;
  /** The optional Claude reasoning effort. */
  effort(): AgentEffort | undefined;
  /** Reports a visible field error for an invalid nonempty OpenCode model. */
  valid(): boolean;
}

/** Remembers the last Claude model/effort chosen at this picker's key (a desk, or the queue). */
function claudeChoiceKey(kind: 'model' | 'effort', key: string): string {
  return `agent-office.claude-${kind}.${key}`;
}

function preferredClaudeModel(key: string): ClaudeModel | undefined {
  try {
    const saved = localStorage.getItem(claudeChoiceKey('model', key));
    if (saved && (CLAUDE_MODELS as readonly string[]).includes(saved)) return saved as ClaudeModel;
  } catch {
    // storage blocked
  }
  return undefined;
}

function preferredEffort(key: string): AgentEffort | undefined {
  try {
    const saved = localStorage.getItem(claudeChoiceKey('effort', key));
    if (saved && (AGENT_EFFORTS as readonly string[]).includes(saved)) return saved as AgentEffort;
  } catch {
    // storage blocked
  }
  return undefined;
}

/**
 * What a picker remembered at `key` starts on, for hiring without showing one (an issue card
 * dropped on a desk): the provider last picked anywhere, and that key's Claude model and effort.
 */
export function rememberedChoice(project: ProjectInfo | null, key: string): { provider: AgentProvider; model?: string; effort?: AgentEffort } {
  const provider = preferredProvider(supportedProviders(project), resolvedProvider(project?.defaultProvider, project));
  return provider === 'claude' ? { provider, model: preferredClaudeModel(key), effort: preferredEffort(key) } : { provider };
}

const MODEL_MAX = 256;
let modelList: string[] | null = null;
let modelListAt = 0;
let modelRequest: Promise<string[]> | null = null;

function validModel(value: string): boolean {
  if (value.length === 0 || value.length > MODEL_MAX || /[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  const parts = value.split('/');
  return parts.length >= 2 && /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(parts[0]) && parts.slice(1).every((part) => part.length > 0);
}

function fetchOpenCodeModels(): Promise<string[]> {
  if (modelList && Date.now() - modelListAt < 60_000) return Promise.resolve(modelList);
  if (modelRequest) return modelRequest;
  modelRequest = fetch('/api/agents/opencode/models', { credentials: 'same-origin', cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { models?: unknown };
      const models = Array.isArray(body.models) ? body.models.filter((m): m is string => typeof m === 'string' && validModel(m)) : [];
      modelList = [...new Set(models)];
      modelListAt = Date.now();
      return modelList;
    })
    .finally(() => {
      modelRequest = null;
    });
  return modelRequest;
}

/**
 * A provider selector that never offers a provider outside the server's metadata, with a model
 * (and, for Claude, reasoning effort) picker underneath. `key` scopes what gets remembered between
 * hires — a desk id for the hire dialog, or a fixed key like "queue" for the queue's add form —
 * so a desk that always got Haiku offers Haiku again next time, without one hire changing another's.
 */
export function providerPicker(project: ProjectInfo | null, id: string, label = 'Worker provider', key = id): ProviderPicker {
  const options = supportedProviders(project);
  const fallback = resolvedProvider(project?.defaultProvider, project);
  const select = h('select.provider-select', { id, 'aria-label': 'Worker provider' }) as HTMLSelectElement;
  for (const provider of options) select.append(h('option', { value: provider }, PROVIDER_LABEL[provider]));
  select.value = preferredProvider(options, fallback);
  const note = h('small.provider-note', {}, providerUsageNote(select.value as AgentProvider));
  const modelInput = h('input', {
    type: 'text',
    id: `${id}-model`,
    list: `${id}-models`,
    placeholder: 'Default (OpenCode settings)',
    'aria-label': 'OpenCode model',
    autocomplete: 'off',
    maxlength: MODEL_MAX,
  }) as HTMLInputElement;
  const modelHint = h('small.provider-model-hint', {}, 'Optional provider/model override; suggestions load when OpenCode is selected.');
  const modelListEl = h('datalist', { id: `${id}-models` });
  const modelChoice = h('div.provider-model', {}, h('label', { for: `${id}-model` }, 'OpenCode model'), modelInput, modelListEl, modelHint);

  const claudeModelSelect = h('select', { id: `${id}-claude-model`, 'aria-label': 'Claude model' }) as HTMLSelectElement;
  claudeModelSelect.append(h('option', { value: '' }, 'Default (--agent-args)'));
  for (const m of CLAUDE_MODELS) claudeModelSelect.append(h('option', { value: m }, CLAUDE_MODEL_LABEL[m]));
  claudeModelSelect.value = preferredClaudeModel(key) ?? '';
  const effortSelect = h('select', { id: `${id}-effort`, 'aria-label': 'Reasoning effort' }) as HTMLSelectElement;
  effortSelect.append(h('option', { value: '' }, 'Default'));
  for (const e of AGENT_EFFORTS) effortSelect.append(h('option', { value: e }, EFFORT_LABEL[e]));
  effortSelect.value = preferredEffort(key) ?? '';
  const claudeChoice = h(
    'div.provider-model.claude-model',
    {},
    h('label', { for: `${id}-claude-model` }, 'Model'),
    claudeModelSelect,
    h('label', { for: `${id}-effort` }, 'Effort'),
    effortSelect,
    h('small.provider-model-hint', {}, 'Overrides the office default for this worker; the cost panel tracks each model separately.'),
  );
  claudeModelSelect.addEventListener('change', () => {
    try {
      if (claudeModelSelect.value) localStorage.setItem(claudeChoiceKey('model', key), claudeModelSelect.value);
      else localStorage.removeItem(claudeChoiceKey('model', key));
    } catch {
      // storage blocked
    }
  });
  effortSelect.addEventListener('change', () => {
    try {
      if (effortSelect.value) localStorage.setItem(claudeChoiceKey('effort', key), effortSelect.value);
      else localStorage.removeItem(claudeChoiceKey('effort', key));
    } catch {
      // storage blocked
    }
  });

  const setModelVisibility = (provider: AgentProvider) => {
    const openCode = provider === 'opencode';
    const claude = provider === 'claude';
    modelChoice.classList.toggle('hidden', !openCode);
    modelInput.disabled = !openCode;
    claudeChoice.classList.toggle('hidden', !claude);
    if (!openCode) return;
    modelHint.textContent = modelList ? 'Optional provider/model override; choose a suggestion or enter one manually.' : 'Loading OpenCode models… You can enter a provider/model manually.';
    void fetchOpenCodeModels()
      .then((models) => {
        modelListEl.replaceChildren(...models.map((model) => h('option', { value: model })));
        modelHint.textContent = 'Optional provider/model override; choose a suggestion or enter one manually.';
      })
      .catch(() => {
        modelHint.textContent = 'Model suggestions unavailable; enter a provider/model manually if needed.';
      });
  };
  setModelVisibility(select.value as AgentProvider);
  select.addEventListener('change', () => {
    const provider = select.value as AgentProvider;
    note.textContent = providerUsageNote(provider);
    setModelVisibility(provider);
    if (options.includes(provider)) {
      try {
        localStorage.setItem(PROVIDER_KEY, provider);
      } catch {
        // storage blocked
      }
    }
  });
  modelInput.addEventListener('input', () => modelInput.setCustomValidity(''));
  return {
    element: h('div.provider-choice', {}, h('label', { for: id }, label), select, note, modelChoice, claudeChoice),
    value: () => (options.includes(select.value as AgentProvider) ? (select.value as AgentProvider) : fallback),
    effort: () => (select.value === 'claude' && effortSelect.value ? (effortSelect.value as AgentEffort) : undefined),
    model: () => {
      if (select.value === 'claude') return claudeModelSelect.value || undefined;
      if (select.value !== 'opencode') return undefined;
      const value = modelInput.value;
      return validModel(value) ? value : undefined;
    },
    valid: () => {
      if (select.value !== 'opencode' || !modelInput.value) {
        modelInput.setCustomValidity('');
        return true;
      }
      const okay = validModel(modelInput.value);
      modelInput.setCustomValidity(okay ? '' : 'Use provider/model format without whitespace or control characters (up to 256 characters).');
      if (!okay) modelInput.reportValidity();
      return okay;
    },
  };
}
