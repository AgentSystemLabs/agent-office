import type { AgentProvider, ProjectInfo, Usage, WorkerInfo } from '../../shared/protocol';
import { CLAUDE_MODELS, EFFORTS, isClaudeModel, isEffort, modelFamily, modelLabel, type Effort, type ModelFamily } from '../../shared/models';
import { h } from './dom';
import { store } from '../state';

const PROVIDER_KEY = 'agent-office.provider';
const CLAUDE_MODEL_KEY = 'agent-office.claude-model';
const EFFORT_KEY = 'agent-office.claude-effort';

/** Each Claude model's color: the worker's headset, its laptop sticker, and its chip in the sidebar. */
export const MODEL_STYLE: Record<ModelFamily, { dot: string; color: string }> = {
  fable: { dot: '🟣', color: '#9b5de5' },
  opus: { dot: '🟠', color: '#ff8c1a' },
  sonnet: { dot: '🔵', color: '#3a86ff' },
  haiku: { dot: '🟢', color: '#38b000' },
};

/**
 * The model a worker runs on, as best known: off its transcript once it has replied, else what it
 * was hired on, else the one --agent-args gives Claude Code workers.
 */
export function workerModel(w: WorkerInfo, project: ProjectInfo | null): string | undefined {
  if (w.kind !== 'agent') return undefined;
  if (w.liveModel ?? w.model) return w.liveModel ?? w.model;
  const provider = resolvedProvider(w.provider, project);
  return provider === 'claude' && project?.defaultProvider === 'claude' ? project.defaultModel : undefined;
}

/** e.g. "Haiku 4.5 · low", for the sidebar and the task card; '' when nothing is known. */
export function modelSummary(model: string | undefined, effort: string | undefined): string {
  return [model && modelLabel(model), effort].filter(Boolean).join(' · ');
}

/** The color of a model's family (see MODEL_STYLE), when it's a Claude model. */
export function modelColor(model: string | undefined): string | undefined {
  const family = modelFamily(model);
  return family && MODEL_STYLE[family].color;
}

/** What --agent-args gives Claude Code workers, when Claude Code is the configured agent. */
function officeDefaults(): { model?: string; effort?: string } {
  const p = store.project;
  return p?.defaultProvider === 'claude' ? { model: p.defaultModel, effort: p.defaultEffort } : {};
}

export const PROVIDER_LABEL: Record<AgentProvider, string> = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  codex: 'Codex',
  custom: 'Custom',
};

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
  /** The model picked for the chosen provider: a Claude alias, or an OpenCode provider/model. Empty or invalid input is omitted. */
  model(): string | undefined;
  /** Claude Code's reasoning effort, when one is picked. */
  effort(): Effort | undefined;
  /** Reports a visible field error for an invalid nonempty OpenCode model. */
  valid(): boolean;
  /** Relabels the "default" choices, e.g. after the queue's default changed. */
  refresh(): void;
}

export interface PickerOptions {
  /**
   * For a task on the queue: "default" means the queue's default, and the pick isn't remembered
   * (the hire dialogs' last pick would otherwise override the queue's default for good).
   */
  queue?: boolean;
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

function remembered(key: string, valid: (v: string) => boolean): string {
  try {
    const saved = localStorage.getItem(key);
    return saved && valid(saved) ? saved : '';
  } catch {
    return '';
  }
}

function remember(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // storage blocked
  }
}

/** The Claude Code model and effort selects: "default" first, then the aliases, biggest first. */
function claudeChoice(id: string, opts: PickerOptions) {
  const model = h('select.provider-select.model-select', { id: `${id}-claude-model`, 'aria-label': 'Claude model' }) as HTMLSelectElement;
  const modelDefault = h('option', { value: '' }) as HTMLOptionElement;
  model.append(modelDefault, ...CLAUDE_MODELS.map((m) => h('option', { value: m }, `${MODEL_STYLE[m].dot} ${modelLabel(m)}`)));
  const effort = h('select.provider-select.effort-select', {
    id: `${id}-effort`,
    'aria-label': 'Reasoning effort',
    title: 'How long it thinks before it answers. A model without effort levels ignores it.',
  }) as HTMLSelectElement;
  const effortDefault = h('option', { value: '' }) as HTMLOptionElement;
  effort.append(effortDefault, ...EFFORTS.map((e) => h('option', { value: e }, e)));
  const refresh = () => {
    const office = officeDefaults();
    const m = opts.queue ? store.queue.model ?? office.model : office.model;
    const e = opts.queue ? store.queue.effort ?? office.effort : office.effort;
    const name = opts.queue ? 'Queue default' : 'Default';
    modelDefault.textContent = m ? `${name} · ${modelLabel(m)}` : opts.queue ? name : 'Claude Code default';
    effortDefault.textContent = e ? `${name} · ${e}` : name;
  };
  refresh();
  if (!opts.queue) {
    model.value = remembered(CLAUDE_MODEL_KEY, (v) => (CLAUDE_MODELS as readonly string[]).includes(v));
    effort.value = remembered(EFFORT_KEY, isEffort);
    model.addEventListener('change', () => remember(CLAUDE_MODEL_KEY, model.value));
    effort.addEventListener('change', () => remember(EFFORT_KEY, effort.value));
  }
  const element = h(
    'div.provider-claude',
    { title: 'A smaller model is quicker and cheaper for small jobs' },
    h('label', { for: model.id }, 'Model'),
    model,
    h('label', { for: effort.id }, 'Effort'),
    effort,
  );
  return {
    element,
    refresh,
    model: () => (isClaudeModel(model.value) ? model.value : undefined),
    effort: () => (isEffort(effort.value) ? effort.value : undefined),
  };
}

/** A provider selector that never offers a provider outside the server's metadata. */
export function providerPicker(project: ProjectInfo | null, id: string, label = 'Worker provider', opts: PickerOptions = {}): ProviderPicker {
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
  const claude = claudeChoice(id, opts);
  const setModelVisibility = (provider: AgentProvider) => {
    claude.element.classList.toggle('hidden', provider !== 'claude');
    const openCode = provider === 'opencode';
    modelChoice.classList.toggle('hidden', !openCode);
    modelInput.disabled = !openCode;
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
    element: h('div.provider-choice', {}, h('label', { for: id }, label), select, note, claude.element, modelChoice),
    value: () => (options.includes(select.value as AgentProvider) ? (select.value as AgentProvider) : fallback),
    model: () => {
      if (select.value === 'claude') return claude.model();
      if (select.value !== 'opencode') return undefined;
      const value = modelInput.value;
      return validModel(value) ? value : undefined;
    },
    effort: () => (select.value === 'claude' ? claude.effort() : undefined),
    refresh: claude.refresh,
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
