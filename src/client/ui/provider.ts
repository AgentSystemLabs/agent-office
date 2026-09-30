import type { AgentChoice, AgentEffort, AgentProvider, ClaudeModel, ProjectInfo, Usage } from '../../shared/protocol';
import { AGENT_EFFORTS, CLAUDE_MODELS } from '../../shared/protocol';
import { store } from '../state';
import { h } from './dom';

export const PROVIDER_LABEL: Record<AgentProvider, string> = {
  claude: 'Claude Code',
  opencode: 'OpenCode',
  codex: 'Codex',
  grok: 'Grok',
  muse: 'Muse Code',
  dsh: 'DeepSeek Harness',
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

/** A short badge for the task card / sidebar: "Opus", "Opus · High", or the raw OpenCode/Grok/Muse/DeepSeek Harness model id. */
export function modelBadge(provider: AgentProvider | undefined, model: string | undefined, effort: AgentEffort | undefined): string | undefined {
  if (!model && !effort) return undefined;
  if (provider === 'claude' || provider === 'grok' || provider === 'muse' || provider === 'dsh') {
    const label = provider === 'claude' && model && model in CLAUDE_MODEL_LABEL ? CLAUDE_MODEL_LABEL[model as ClaudeModel] : model;
    const parts = [label, effort ? EFFORT_LABEL[effort] : undefined].filter((v): v is string => !!v);
    return parts.length ? parts.join(' · ') : undefined;
  }
  return model;
}

/** Providers the server says this project can start. */
export function supportedProviders(project: ProjectInfo | null): AgentProvider[] {
  const values = project?.agentProviders?.filter((p): p is AgentProvider => p === 'claude' || p === 'opencode' || p === 'codex' || p === 'grok' || p === 'muse' || p === 'dsh' || p === 'custom') ?? [];
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
  return selected === 'claude' || ((selected === 'opencode' || selected === 'codex' || selected === 'grok' || selected === 'muse' || selected === 'dsh' || selected === 'custom') && usage !== undefined);
}

export type ProviderUsageState = 'tracked' | 'waiting' | 'untracked';

/** Distinguishes a provider with no first report from one whose metrics are intentionally unavailable. */
export function providerUsageState(provider: AgentProvider | undefined, project: ProjectInfo | null, usage?: Usage): ProviderUsageState {
  const selected = resolvedProvider(provider, project);
  if (selected === 'claude') return usage ? 'tracked' : 'waiting';
  if (selected === 'opencode') return usage ? 'tracked' : 'waiting';
  if (selected === 'codex') return usage ? 'tracked' : 'waiting';
  if (selected === 'grok') return usage ? 'tracked' : 'untracked';
  if (selected === 'muse') return usage ? 'tracked' : 'untracked';
  if (selected === 'dsh') return usage ? 'tracked' : 'waiting';
  if (selected === 'custom') return usage ? 'tracked' : 'untracked';
  return 'untracked';
}

/**
 * The short "no numbers yet" suffix for a tracked-but-silent provider, shared by the terminal, the
 * workers list and the queue so all three say the same thing.
 */
export function providerWaitingLabel(provider: AgentProvider | undefined, project: ProjectInfo | null): string {
  const selected = resolvedProvider(provider, project);
  if (selected === 'opencode') return 'waiting for metrics';
  if (selected === 'codex' || selected === 'dsh') return 'waiting for first report';
  return '';
}

export function providerUsageNote(provider: AgentProvider): string {
  if (provider === 'claude') return 'Office usage and budget track Claude Code.';
  if (provider === 'codex') return 'Review Office hooks in /hooks to enable tracking. Codex reports root-session tokens; subagents are excluded and cost is unavailable.';
  if (provider === 'grok') return 'Grok spend is not metered by the office; token totals stay in the worker terminal.';
  if (provider === 'muse') return 'Muse spend is not metered by the office; token totals stay in the worker terminal.';
  if (provider === 'dsh') return 'DeepSeek Harness reports context usage over ACP after its first turn; cost may be unavailable.';
  if (provider === 'custom') return 'Usage is untracked unless compatible Claude Code hooks report it.';
  return 'OpenCode reports model/provider estimates; they are not billing, and arrive after the first report.';
}

/**
 * The worker a new one starts on unless someone picks another: the one set in ⚙️ Settings, or the
 * office's --agent on its own default model.
 */
export function officeChoice(project: ProjectInfo | null): AgentChoice {
  const picked = store.prompts.agent;
  if (picked && supportedProviders(project).includes(picked.provider)) {
    return { provider: picked.provider, ...(picked.model ? { model: picked.model } : {}), ...(picked.effort ? { effort: picked.effort } : {}) };
  }
  return { provider: resolvedProvider(project?.defaultProvider, project) };
}

/** "Claude Code · Opus · High", "Claude Code", "OpenCode · anthropic/claude-sonnet-4", "Grok · grok-4.6". */
export function choiceLabel(choice: AgentChoice): string {
  const badge = modelBadge(choice.provider, choice.model, choice.effort);
  return badge ? `${PROVIDER_LABEL[choice.provider]} · ${badge}` : PROVIDER_LABEL[choice.provider];
}

export interface ProviderPicker {
  element: HTMLElement;
  value(): AgentProvider;
  /** The optional initial model override: an OpenCode provider/model id, a Claude model alias, a Grok/Muse model id, or a DeepSeek Harness catalog id. */
  model(): string | undefined;
  /** The optional Claude, Grok, Muse or DeepSeek Harness reasoning effort. */
  effort(): AgentEffort | undefined;
  /** Reports a visible field error for an invalid nonempty OpenCode model. */
  valid(): boolean;
}

export interface AgentFields extends ProviderPicker {
  /** Puts the fields on this provider, model and effort. */
  set(choice: AgentChoice): void;
  /** What they're on now. */
  choice(): AgentChoice;
}

const MODEL_MAX = 256;
const GROK_MODEL_MAX = 64;
const MUSE_MODEL_MAX = 128;
const DSH_MODEL_MAX = 256;
let modelList: string[] | null = null;
let modelListAt = 0;
let modelRequest: Promise<string[]> | null = null;
let grokModelList: string[] | null = null;
let grokModelListAt = 0;
let grokModelRequest: Promise<string[]> | null = null;

function validModel(value: string): boolean {
  if (value.length === 0 || value.length > MODEL_MAX || /[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  const parts = value.split('/');
  return parts.length >= 2 && /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(parts[0]) && parts.slice(1).every((part) => part.length > 0);
}

function validGrokModel(value: string): boolean {
  return value.length > 0 && value.length <= GROK_MODEL_MAX && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !/[\s\p{Cc}\p{Cf}]/u.test(value);
}

function validMuseModel(value: string): boolean {
  return value.length > 0 && value.length <= MUSE_MODEL_MAX && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !/[\s\p{Cc}\p{Cf}]/u.test(value);
}

function fetchGrokModels(): Promise<string[]> {
  if (grokModelList && Date.now() - grokModelListAt < 60_000) return Promise.resolve(grokModelList);
  if (grokModelRequest) return grokModelRequest;
  grokModelRequest = fetch('/api/agents/grok/models', { credentials: 'same-origin', cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { models?: unknown };
      const models = Array.isArray(body.models) ? body.models.filter((m): m is string => typeof m === 'string' && validGrokModel(m)) : [];
      grokModelList = [...new Set(models)];
      grokModelListAt = Date.now();
      return grokModelList;
    })
    .finally(() => {
      grokModelRequest = null;
    });
  return grokModelRequest;
}

/** DeepSeek Harness ids are opaque catalog values (see server/agents.ts), so bound length and controls only. */
function validDshModel(value: string): boolean {
  return value.length > 0 && value.length <= DSH_MODEL_MAX && !/[\p{Cc}\p{Cf}]/u.test(value);
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
 * The provider, model and effort fields: a provider selector that never offers a provider outside
 * the server's metadata, with a model (and, for Claude, Grok or Muse, reasoning effort) picker underneath.
 */
export function agentFields(project: ProjectInfo | null, id: string, initial: AgentChoice, label = 'Provider'): AgentFields {
  const options = supportedProviders(project);
  const fallback = resolvedProvider(project?.defaultProvider, project);
  const select = h('select.provider-select', { id, 'aria-label': 'Worker provider' }) as HTMLSelectElement;
  for (const provider of options) select.append(h('option', { value: provider }, PROVIDER_LABEL[provider]));
  const note = h('small.provider-note');
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
  const effortSelect = h('select', { id: `${id}-effort`, 'aria-label': 'Reasoning effort' }) as HTMLSelectElement;
  effortSelect.append(h('option', { value: '' }, 'Default'));
  for (const e of AGENT_EFFORTS) effortSelect.append(h('option', { value: e }, EFFORT_LABEL[e]));
  const claudeChoice = h(
    'div.provider-model.claude-model',
    {},
    h('label', { for: `${id}-claude-model` }, 'Model'),
    claudeModelSelect,
    h('label', { for: `${id}-effort` }, 'Effort'),
    effortSelect,
    h('small.provider-model-hint', {}, 'The cost panel tracks each model separately.'),
  );

  const grokModelSelect = h('select', { id: `${id}-grok-model`, 'aria-label': 'Grok model' }) as HTMLSelectElement;
  grokModelSelect.append(h('option', { value: '' }, 'Default (Grok settings)'));
  const grokEffortSelect = h('select', { id: `${id}-grok-effort`, 'aria-label': 'Grok reasoning effort' }) as HTMLSelectElement;
  grokEffortSelect.append(h('option', { value: '' }, 'Default'));
  for (const e of AGENT_EFFORTS) grokEffortSelect.append(h('option', { value: e }, EFFORT_LABEL[e]));
  const grokHint = h('small.provider-model-hint', {}, 'Suggestions load from `grok models` when Grok is selected.');
  const grokChoice = h(
    'div.provider-model.grok-model',
    {},
    h('label', { for: `${id}-grok-model` }, 'Model'),
    grokModelSelect,
    h('label', { for: `${id}-grok-effort` }, 'Effort'),
    grokEffortSelect,
    grokHint,
  );

  const museModelInput = h('input', {
    type: 'text',
    id: `${id}-muse-model`,
    placeholder: 'Default (Muse settings)',
    'aria-label': 'Muse model',
    autocomplete: 'off',
    maxlength: MUSE_MODEL_MAX,
  }) as HTMLInputElement;
  const museEffortSelect = h('select', { id: `${id}-muse-effort`, 'aria-label': 'Muse reasoning effort' }) as HTMLSelectElement;
  museEffortSelect.append(h('option', { value: '' }, 'Default'));
  for (const e of AGENT_EFFORTS) museEffortSelect.append(h('option', { value: e }, EFFORT_LABEL[e]));
  const museChoice = h(
    'div.provider-model.muse-model',
    {},
    h('label', { for: `${id}-muse-model` }, 'Model'),
    museModelInput,
    h('label', { for: `${id}-muse-effort` }, 'Effort'),
    museEffortSelect,
    h('small.provider-model-hint', {}, 'Optional model id (for example muse-spark-1.3-contributor) and effort for this worker.'),
  );

  const dshModelInput = h('input', {
    type: 'text',
    id: `${id}-dsh-model`,
    placeholder: 'Default (DSH profile)',
    'aria-label': 'DeepSeek Harness model',
    autocomplete: 'off',
    maxlength: DSH_MODEL_MAX,
  }) as HTMLInputElement;
  const dshEffortSelect = h('select', { id: `${id}-dsh-effort`, 'aria-label': 'DeepSeek Harness reasoning effort' }) as HTMLSelectElement;
  dshEffortSelect.append(h('option', { value: '' }, 'Default'));
  for (const e of AGENT_EFFORTS) dshEffortSelect.append(h('option', { value: e }, EFFORT_LABEL[e]));
  const dshChoice = h(
    'div.provider-model.dsh-model',
    {},
    h('label', { for: `${id}-dsh-model` }, 'Model'),
    dshModelInput,
    h('label', { for: `${id}-dsh-effort` }, 'Effort'),
    dshEffortSelect,
    h('small.provider-model-hint', {}, 'Optional model id from DeepSeek Harness\u2019s catalog, and effort; leave empty to use the profile default.'),
  );

  const element = h('div.provider-choice', {}, h('label', { for: id }, label), select, note, modelChoice, claudeChoice, grokChoice, museChoice, dshChoice);
  const fillGrokModels = (models: string[], selected?: string) => {
    const keep = selected && validGrokModel(selected) ? selected : '';
    grokModelSelect.replaceChildren(h('option', { value: '' }, 'Default (Grok settings)'));
    const seen = new Set<string>();
    for (const model of models) {
      if (!validGrokModel(model) || seen.has(model)) continue;
      seen.add(model);
      grokModelSelect.append(h('option', { value: model }, model));
    }
    if (keep && !seen.has(keep)) grokModelSelect.append(h('option', { value: keep }, keep));
    grokModelSelect.value = keep;
  };
  /** OpenCode's model suggestions, asked for only once someone can see the field. */
  const loadModels = () => {
    if (select.value === 'grok') {
      if (!element.isConnected || element.closest('.hidden')) return;
      grokHint.textContent = grokModelList ? 'Optional model and effort for this worker.' : 'Loading Grok models…';
      void fetchGrokModels()
        .then((models) => {
          fillGrokModels(models, grokModelSelect.value);
          grokHint.textContent = 'Optional model and effort for this worker.';
        })
        .catch(() => {
          grokHint.textContent = 'Model list unavailable; leave Default or pick a known Grok model id.';
        });
      return;
    }
    if (select.value !== 'opencode' || !element.isConnected || element.closest('.hidden')) return;
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
  const setModelVisibility = (provider: AgentProvider) => {
    const openCode = provider === 'opencode';
    note.textContent = providerUsageNote(provider);
    modelChoice.classList.toggle('hidden', !openCode);
    modelInput.disabled = !openCode;
    claudeChoice.classList.toggle('hidden', provider !== 'claude');
    grokChoice.classList.toggle('hidden', provider !== 'grok');
    museChoice.classList.toggle('hidden', provider !== 'muse');
    dshChoice.classList.toggle('hidden', provider !== 'dsh');
    loadModels();
  };
  const set = (c: AgentChoice) => {
    select.value = options.includes(c.provider) ? c.provider : options.includes(fallback) ? fallback : options[0];
    const claude = select.value === 'claude';
    const grok = select.value === 'grok';
    const muse = select.value === 'muse';
    const dsh = select.value === 'dsh';
    claudeModelSelect.value = claude && c.model && (CLAUDE_MODELS as readonly string[]).includes(c.model) ? c.model : '';
    effortSelect.value = claude && c.effort ? c.effort : '';
    fillGrokModels(grokModelList ?? [], grok ? c.model : undefined);
    grokEffortSelect.value = grok && c.effort ? c.effort : '';
    museModelInput.value = muse && c.model ? c.model : '';
    museEffortSelect.value = muse && c.effort ? c.effort : '';
    dshModelInput.value = dsh && c.model ? c.model : '';
    dshEffortSelect.value = dsh && c.effort ? c.effort : '';
    modelInput.value = select.value === 'opencode' && c.model ? c.model : '';
    modelInput.setCustomValidity('');
    museModelInput.setCustomValidity('');
    dshModelInput.setCustomValidity('');
    setModelVisibility(select.value as AgentProvider);
  };
  set(initial);
  select.addEventListener('change', () => setModelVisibility(select.value as AgentProvider));
  modelInput.addEventListener('focus', loadModels);
  modelInput.addEventListener('input', () => modelInput.setCustomValidity(''));
  museModelInput.addEventListener('input', () => museModelInput.setCustomValidity(''));
  dshModelInput.addEventListener('input', () => dshModelInput.setCustomValidity(''));
  const value = () => (options.includes(select.value as AgentProvider) ? (select.value as AgentProvider) : fallback);
  const effort = () => {
    if (select.value === 'claude' && effortSelect.value) return effortSelect.value as AgentEffort;
    if (select.value === 'grok' && grokEffortSelect.value) return grokEffortSelect.value as AgentEffort;
    if (select.value === 'muse' && museEffortSelect.value) return museEffortSelect.value as AgentEffort;
    if (select.value === 'dsh' && dshEffortSelect.value) return dshEffortSelect.value as AgentEffort;
    return undefined;
  };
  const model = () => {
    if (select.value === 'claude') return claudeModelSelect.value || undefined;
    if (select.value === 'grok') return grokModelSelect.value || undefined;
    if (select.value === 'muse') {
      const v = museModelInput.value;
      return validMuseModel(v) ? v : undefined;
    }
    if (select.value === 'dsh') {
      const v = dshModelInput.value;
      return validDshModel(v) ? v : undefined;
    }
    if (select.value !== 'opencode') return undefined;
    const v = modelInput.value;
    return validModel(v) ? v : undefined;
  };
  return {
    element,
    value,
    effort,
    model,
    set,
    choice: () => ({ provider: value(), ...(model() ? { model: model() } : {}), ...(effort() ? { effort: effort() } : {}) }),
    valid: () => {
      if (select.value === 'muse') {
        if (!museModelInput.value) {
          museModelInput.setCustomValidity('');
          return true;
        }
        const okay = validMuseModel(museModelInput.value);
        museModelInput.setCustomValidity(okay ? '' : 'Use a Muse model id without whitespace or control characters (up to 128 characters).');
        if (!okay) museModelInput.reportValidity();
        return okay;
      }
      if (select.value === 'dsh') {
        if (!dshModelInput.value) {
          dshModelInput.setCustomValidity('');
          return true;
        }
        const okay = validDshModel(dshModelInput.value);
        dshModelInput.setCustomValidity(okay ? '' : 'Use a DeepSeek Harness catalog model id of up to 256 characters without control characters.');
        if (!okay) dshModelInput.reportValidity();
        return okay;
      }
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

/**
 * Which worker to start: the office's default (⚙️ Settings), shown as a line, with an ✏️ Edit button
 * that opens the provider, model and effort fields to pick another for this one.
 */
export function providerPicker(project: ProjectInfo | null, id: string, label = 'Worker'): ProviderPicker {
  let editing = false;
  const fields = agentFields(project, id, officeChoice(project));
  fields.element.classList.add('hidden');
  const current = h('span.provider-current');
  const edit = h('button.btn.small', { type: 'button', 'aria-expanded': 'false' }) as HTMLButtonElement;
  const element = h('div.provider-pick', {}, h('div.provider-summary', {}, h('span.provider-label', {}, label), current, edit), fields.element);
  const paint = () => {
    const def = officeChoice(project);
    current.textContent = choiceLabel(def);
    current.title = store.prompts.agent ? 'The office’s default worker, set in ⚙️ Settings' : 'The office’s default worker (its --agent); an admin can pick another in ⚙️ Settings';
    current.classList.toggle('hidden', editing);
    edit.textContent = editing ? '↺ Use the default' : '✏️ Edit';
    edit.title = editing ? `Back to ${choiceLabel(def)}` : 'Pick another provider, model or effort for this one';
    edit.setAttribute('aria-expanded', String(editing));
    fields.element.classList.toggle('hidden', !editing);
  };
  edit.addEventListener('click', () => {
    editing = !editing;
    paint();
    // They open on the default as it is now.
    if (!editing) return;
    fields.set(officeChoice(project));
    (fields.element.querySelector('select') as HTMLSelectElement | null)?.focus();
  });
  paint();
  // The default can change while this is open; it goes once its window has closed.
  const off = store.on('prompts', () => (element.isConnected ? paint() : off()));
  return {
    element,
    value: () => (editing ? fields.value() : officeChoice(project).provider),
    model: () => (editing ? fields.model() : officeChoice(project).model),
    effort: () => (editing ? fields.effort() : officeChoice(project).effort),
    valid: () => !editing || fields.valid(),
  };
}
