import './provider.css';
import type { AgentChoice, AgentEffort, AgentProvider, ClaudeModel, ProjectInfo, Usage } from '../../shared/protocol';
import { AGENT_EFFORTS, CLAUDE_MODELS } from '../../shared/protocol';
import {
  AGENT_PROVIDERS,
  DSH_MODEL_MAX,
  MUSE_MODEL_MAX,
  OPEN_CODE_MODEL_MAX as MODEL_MAX,
  PI_MODEL_MAX,
  PROVIDER_META,
  isAgentProvider,
  isValidDshModel as validDshModel,
  isValidGrokModel as validGrokModel,
  isValidMuseModel as validMuseModel,
  isValidOpenCodeModel as validModel,
  isValidPiModel as validPiModel,
  takesEffort,
} from '../../shared/providers';
import { store } from '../state';
import { h } from './dom';
import { L } from '../i18n';

export const PROVIDER_LABEL = Object.fromEntries(AGENT_PROVIDERS.map((p) => [p, p === 'custom' ? L.provider.custom : PROVIDER_META[p].label])) as Record<AgentProvider, string>;

export const CLAUDE_MODEL_LABEL: Record<ClaudeModel, string> = {
  fable: 'Fable',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

export const EFFORT_LABEL: Record<AgentEffort, string> = L.provider.efforts;

/** A short badge for the task card / sidebar: "Opus", "Opus · High", or the raw OpenCode/Grok/Muse/DeepSeek Harness/Pi model id. */
export function modelBadge(provider: AgentProvider | undefined, model: string | undefined, effort: AgentEffort | undefined): string | undefined {
  if (!model && !effort) return undefined;
  if (takesEffort(provider)) {
    const label = provider === 'claude' && model && model in CLAUDE_MODEL_LABEL ? CLAUDE_MODEL_LABEL[model as ClaudeModel] : model;
    const parts = [label, effort ? EFFORT_LABEL[effort] : undefined].filter((v): v is string => !!v);
    return parts.length ? parts.join(' · ') : undefined;
  }
  return model;
}

/** Providers the server says this project can start. */
export function supportedProviders(project: ProjectInfo | null): AgentProvider[] {
  const values = project?.agentProviders?.filter(isAgentProvider) ?? [];
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
  return !!PROVIDER_META[resolvedProvider(provider, project)].usage.tracked || usage !== undefined;
}

export type ProviderUsageState = 'tracked' | 'waiting' | 'untracked';

/** Distinguishes a provider with no first report from one whose metrics are intentionally unavailable. */
export function providerUsageState(provider: AgentProvider | undefined, project: ProjectInfo | null, usage?: Usage): ProviderUsageState {
  const { tracked, reports } = PROVIDER_META[resolvedProvider(provider, project)].usage;
  if (usage) return 'tracked';
  return tracked || reports ? 'waiting' : 'untracked';
}

/**
 * The short "no numbers yet" suffix for a tracked-but-silent provider, shared by the terminal, the
 * workers list and the queue so all three say the same thing.
 */
export function providerWaitingLabel(provider: AgentProvider | undefined, project: ProjectInfo | null): string {
  return PROVIDER_META[resolvedProvider(provider, project)].usage.waiting ?? '';
}

export function providerUsageNote(provider: AgentProvider): string {
  return PROVIDER_META[provider].usage.note;
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
  /** The optional Claude, Grok, Muse, DeepSeek Harness or Pi reasoning effort (Pi calls it thinking). */
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

let modelList: string[] | null = null;
let modelListAt = 0;
let modelRequest: Promise<string[]> | null = null;
let grokModelList: string[] | null = null;
let grokModelListAt = 0;
let grokModelRequest: Promise<string[]> | null = null;

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
export function agentFields(project: ProjectInfo | null, id: string, initial: AgentChoice, label: string = L.provider.provider): AgentFields {
  const options = supportedProviders(project);
  const fallback = resolvedProvider(project?.defaultProvider, project);
  const select = h('select.provider-select', { id, 'aria-label': L.provider.workerProvider }) as HTMLSelectElement;
  for (const provider of options) select.append(h('option', { value: provider }, PROVIDER_LABEL[provider]));
  const note = h('small.provider-note');
  const modelInput = h('input', {
    type: 'text',
    id: `${id}-model`,
    list: `${id}-models`,
    placeholder: L.provider.openCodeDefault,
    'aria-label': L.provider.openCodeModel,
    autocomplete: 'off',
    maxlength: MODEL_MAX,
  }) as HTMLInputElement;
  const modelHint = h('small.provider-model-hint', {}, L.provider.hintLoad);
  const modelListEl = h('datalist', { id: `${id}-models` });
  const modelChoice = h('div.provider-model', {}, h('label', { for: `${id}-model` }, L.provider.openCodeModel), modelInput, modelListEl, modelHint);

  const claudeModelSelect = h('select', { id: `${id}-claude-model`, 'aria-label': L.provider.claudeModel }) as HTMLSelectElement;
  claudeModelSelect.append(h('option', { value: '' }, L.provider.defaultArgs));
  for (const m of CLAUDE_MODELS) claudeModelSelect.append(h('option', { value: m }, CLAUDE_MODEL_LABEL[m]));
  const effortSelect = h('select', { id: `${id}-effort`, 'aria-label': L.provider.effortLong }) as HTMLSelectElement;
  effortSelect.append(h('option', { value: '' }, L.provider.default));
  for (const e of AGENT_EFFORTS) effortSelect.append(h('option', { value: e }, EFFORT_LABEL[e]));
  const claudeChoice = h(
    'div.provider-model.claude-model',
    {},
    h('label', { for: `${id}-claude-model` }, L.provider.model),
    claudeModelSelect,
    h('label', { for: `${id}-effort` }, L.provider.effort),
    effortSelect,
    h('small.provider-model-hint', {}, L.provider.costPerModel),
  );

  const grokModelSelect = h('select', { id: `${id}-grok-model`, 'aria-label': L.provider.modelOf('Grok') }) as HTMLSelectElement;
  grokModelSelect.append(h('option', { value: '' }, L.provider.defaultGrok));
  const grokEffortSelect = h('select', { id: `${id}-grok-effort`, 'aria-label': L.provider.effortOf('Grok') }) as HTMLSelectElement;
  grokEffortSelect.append(h('option', { value: '' }, L.provider.default));
  for (const e of AGENT_EFFORTS) grokEffortSelect.append(h('option', { value: e }, EFFORT_LABEL[e]));
  const grokHint = h('small.provider-model-hint', {}, L.provider.grokHint);
  const grokChoice = h(
    'div.provider-model.grok-model',
    {},
    h('label', { for: `${id}-grok-model` }, L.provider.model),
    grokModelSelect,
    h('label', { for: `${id}-grok-effort` }, L.provider.effort),
    grokEffortSelect,
    grokHint,
  );

  const museModelInput = h('input', {
    type: 'text',
    id: `${id}-muse-model`,
    placeholder: L.provider.defaultMuse,
    'aria-label': L.provider.modelOf('Muse'),
    autocomplete: 'off',
    maxlength: MUSE_MODEL_MAX,
  }) as HTMLInputElement;
  const museEffortSelect = h('select', { id: `${id}-muse-effort`, 'aria-label': L.provider.effortOf('Muse') }) as HTMLSelectElement;
  museEffortSelect.append(h('option', { value: '' }, L.provider.default));
  for (const e of AGENT_EFFORTS) museEffortSelect.append(h('option', { value: e }, EFFORT_LABEL[e]));
  const museChoice = h(
    'div.provider-model.muse-model',
    {},
    h('label', { for: `${id}-muse-model` }, L.provider.model),
    museModelInput,
    h('label', { for: `${id}-muse-effort` }, L.provider.effort),
    museEffortSelect,
    h('small.provider-model-hint', {}, L.provider.museHint),
  );

  const dshModelInput = h('input', {
    type: 'text',
    id: `${id}-dsh-model`,
    placeholder: L.provider.defaultDsh,
    'aria-label': L.provider.modelOf('DeepSeek Harness'),
    autocomplete: 'off',
    maxlength: DSH_MODEL_MAX,
  }) as HTMLInputElement;
  const dshEffortSelect = h('select', { id: `${id}-dsh-effort`, 'aria-label': L.provider.effortOf('DeepSeek Harness') }) as HTMLSelectElement;
  dshEffortSelect.append(h('option', { value: '' }, L.provider.default));
  for (const e of AGENT_EFFORTS) dshEffortSelect.append(h('option', { value: e }, EFFORT_LABEL[e]));
  const dshChoice = h(
    'div.provider-model.dsh-model',
    {},
    h('label', { for: `${id}-dsh-model` }, L.provider.model),
    dshModelInput,
    h('label', { for: `${id}-dsh-effort` }, L.provider.effort),
    dshEffortSelect,
    h('small.provider-model-hint', {}, L.provider.dshHint),
  );

  const piModelInput = h('input', {
    type: 'text',
    id: `${id}-pi-model`,
    placeholder: L.provider.defaultPi,
    'aria-label': L.provider.modelOf('Pi'),
    autocomplete: 'off',
    maxlength: PI_MODEL_MAX,
  }) as HTMLInputElement;
  const piEffortSelect = h('select', { id: `${id}-pi-effort`, 'aria-label': L.provider.piThinking }) as HTMLSelectElement;
  piEffortSelect.append(h('option', { value: '' }, L.provider.default));
  for (const e of AGENT_EFFORTS) piEffortSelect.append(h('option', { value: e }, EFFORT_LABEL[e]));
  const piChoice = h(
    'div.provider-model.pi-model',
    {},
    h('label', { for: `${id}-pi-model` }, L.provider.model),
    piModelInput,
    h('label', { for: `${id}-pi-effort` }, L.provider.thinking),
    piEffortSelect,
    h('small.provider-model-hint', {}, 'Optional model name or provider/model; leave Default to use Pi settings.'),
  );

  const element = h('div.provider-choice', {}, h('label', { for: id }, label), select, note, modelChoice, claudeChoice, grokChoice, museChoice, dshChoice, piChoice);
  const fillGrokModels = (models: string[], selected?: string) => {
    const keep = selected && validGrokModel(selected) ? selected : '';
    grokModelSelect.replaceChildren(h('option', { value: '' }, L.provider.defaultGrok));
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
      grokHint.textContent = grokModelList ? L.provider.optionalModel : L.provider.loadingGrok;
      void fetchGrokModels()
        .then((models) => {
          fillGrokModels(models, grokModelSelect.value);
          grokHint.textContent = L.provider.optionalModel;
        })
        .catch(() => {
          grokHint.textContent = L.provider.grokUnavailable;
        });
      return;
    }
    if (select.value !== 'opencode' || !element.isConnected || element.closest('.hidden')) return;
    modelHint.textContent = modelList ? L.provider.hintChoose : L.provider.hintLoading;
    void fetchOpenCodeModels()
      .then((models) => {
        modelListEl.replaceChildren(...models.map((model) => h('option', { value: model })));
        modelHint.textContent = L.provider.hintChoose;
      })
      .catch(() => {
        modelHint.textContent = L.provider.hintUnavailable;
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
    piChoice.classList.toggle('hidden', provider !== 'pi');
    loadModels();
  };
  const set = (c: AgentChoice) => {
    select.value = options.includes(c.provider) ? c.provider : options.includes(fallback) ? fallback : options[0];
    const claude = select.value === 'claude';
    const grok = select.value === 'grok';
    const muse = select.value === 'muse';
    const dsh = select.value === 'dsh';
    const pi = select.value === 'pi';
    claudeModelSelect.value = claude && c.model && (CLAUDE_MODELS as readonly string[]).includes(c.model) ? c.model : '';
    effortSelect.value = claude && c.effort ? c.effort : '';
    fillGrokModels(grokModelList ?? [], grok ? c.model : undefined);
    grokEffortSelect.value = grok && c.effort ? c.effort : '';
    museModelInput.value = muse && c.model ? c.model : '';
    museEffortSelect.value = muse && c.effort ? c.effort : '';
    dshModelInput.value = dsh && c.model ? c.model : '';
    dshEffortSelect.value = dsh && c.effort ? c.effort : '';
    piModelInput.value = pi && c.model ? c.model : '';
    piEffortSelect.value = pi && c.effort ? c.effort : '';
    modelInput.value = select.value === 'opencode' && c.model ? c.model : '';
    modelInput.setCustomValidity('');
    museModelInput.setCustomValidity('');
    dshModelInput.setCustomValidity('');
    piModelInput.setCustomValidity('');
    setModelVisibility(select.value as AgentProvider);
  };
  set(initial);
  select.addEventListener('change', () => setModelVisibility(select.value as AgentProvider));
  modelInput.addEventListener('focus', loadModels);
  modelInput.addEventListener('input', () => modelInput.setCustomValidity(''));
  museModelInput.addEventListener('input', () => museModelInput.setCustomValidity(''));
  dshModelInput.addEventListener('input', () => dshModelInput.setCustomValidity(''));
  piModelInput.addEventListener('input', () => piModelInput.setCustomValidity(''));
  const value = () => (options.includes(select.value as AgentProvider) ? (select.value as AgentProvider) : fallback);
  const effort = () => {
    if (select.value === 'claude' && effortSelect.value) return effortSelect.value as AgentEffort;
    if (select.value === 'grok' && grokEffortSelect.value) return grokEffortSelect.value as AgentEffort;
    if (select.value === 'muse' && museEffortSelect.value) return museEffortSelect.value as AgentEffort;
    if (select.value === 'dsh' && dshEffortSelect.value) return dshEffortSelect.value as AgentEffort;
    if (select.value === 'pi' && piEffortSelect.value) return piEffortSelect.value as AgentEffort;
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
    if (select.value === 'pi') {
      const v = piModelInput.value;
      return validPiModel(v) ? v : undefined;
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
        museModelInput.setCustomValidity(okay ? '' : L.provider.museInvalid);
        if (!okay) museModelInput.reportValidity();
        return okay;
      }
      if (select.value === 'dsh') {
        if (!dshModelInput.value) {
          dshModelInput.setCustomValidity('');
          return true;
        }
        const okay = validDshModel(dshModelInput.value);
        dshModelInput.setCustomValidity(okay ? '' : L.provider.dshInvalid);
        if (!okay) dshModelInput.reportValidity();
        return okay;
      }
      if (select.value === 'pi') {
        const okay = !piModelInput.value || validPiModel(piModelInput.value);
        piModelInput.setCustomValidity(okay ? '' : L.provider.piInvalid);
        if (!okay) piModelInput.reportValidity();
        return okay;
      }
      if (select.value !== 'opencode' || !modelInput.value) {
        modelInput.setCustomValidity('');
        return true;
      }
      const okay = validModel(modelInput.value);
      modelInput.setCustomValidity(okay ? '' : L.provider.badModel);
      if (!okay) modelInput.reportValidity();
      return okay;
    },
  };
}

/**
 * Which worker to start: the office's default (⚙️ Settings), shown as a line, with an ✏️ Edit button
 * that opens the provider, model and effort fields to pick another for this one.
 */
export function providerPicker(project: ProjectInfo | null, id: string, label: string = L.provider.worker): ProviderPicker {
  let editing = false;
  const fields = agentFields(project, id, officeChoice(project));
  fields.element.classList.add('hidden');
  const current = h('span.provider-current');
  const edit = h('button.btn.small', { type: 'button', 'aria-expanded': 'false' }) as HTMLButtonElement;
  const element = h('div.provider-pick', {}, h('div.provider-summary', {}, h('span.provider-label', {}, label), current, edit), fields.element);
  const paint = () => {
    const def = officeChoice(project);
    current.textContent = choiceLabel(def);
    current.title = store.prompts.agent ? L.provider.defaultSet : L.provider.defaultAgent;
    current.classList.toggle('hidden', editing);
    edit.textContent = editing ? L.provider.useDefault : L.provider.edit;
    edit.title = editing ? L.settings.backTo(choiceLabel(def)) : L.provider.editTip;
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
