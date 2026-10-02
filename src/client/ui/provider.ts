import './provider.css';
import type { AgentChoice, AgentEffort, AgentProvider, ProjectInfo, Usage, WorkerInfo } from '../../shared/protocol';
import { AGENT_EFFORTS, isAgentEffort } from '../../shared/protocol';
import { AGENT_PROVIDERS, CLAUDE_MODEL_NAMES, PROVIDER_META, claudeModelName, isAgentProvider, isClaudeModel, takesEffort, type ModelOption } from '../../shared/providers';
import { store } from '../state';
import { h } from './dom';

export const PROVIDER_LABEL = Object.fromEntries(AGENT_PROVIDERS.map((p) => [p, PROVIDER_META[p].label])) as Record<AgentProvider, string>;

export const EFFORT_LABEL: Record<AgentEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

/** Claude Code's models go by their names, and so does a custom --agent's, which is read the same way. */
const namesClaude = (provider: AgentProvider | undefined) => provider === 'claude' || provider === 'custom';

/** What a model is called: "Opus 5.5" for Claude Code's `opus` or `claude-opus-5-5`, and the id itself for the others. */
export function modelName(provider: AgentProvider | undefined, model: string): string {
  if (!namesClaude(provider)) return model;
  return isClaudeModel(model) ? CLAUDE_MODEL_NAMES[model] : (claudeModelName(model) ?? model);
}

/**
 * A short badge for the task card / sidebar: "Opus 5.5", "Opus 5.5 · High", "gpt-5.5 · High".
 * `runs` is the model its session says it's on (Usage.model): for Claude Code that's surer than
 * what an alias stands for, and it's there for a worker left on the default too.
 */
export function modelBadge(provider: AgentProvider | undefined, model: string | undefined, effort: AgentEffort | undefined, runs?: string): string | undefined {
  const id = namesClaude(provider) ? (runs ?? model) : (model ?? runs);
  const parts = [id ? modelName(provider, id) : undefined, effort && takesEffort(provider) ? EFFORT_LABEL[effort] : undefined].filter((v): v is string => !!v);
  return parts.length ? parts.join(' · ') : undefined;
}

/** What a worker runs, in a line: "Claude Code · Opus 5.5 · High", or only "Codex" for one on its defaults that hasn't said. */
export function engineLabel(w: Pick<WorkerInfo, 'provider' | 'model' | 'effort' | 'usage'>, project: ProjectInfo | null): string {
  const badge = modelBadge(w.provider, w.model, w.effort, w.usage?.model);
  return badge ? `${providerLabel(w.provider, project)} · ${badge}` : providerLabel(w.provider, project);
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
  /** The model picked for it, when one was: an id its provider takes (a Claude Code alias, an OpenCode provider/model, a Codex model). */
  model(): string | undefined;
  /** The reasoning effort picked for it, when one was (Pi calls it thinking). */
  effort(): AgentEffort | undefined;
  /** Reports a visible field error for a typed model its provider doesn't take. */
  valid(): boolean;
}

export interface AgentFields extends ProviderPicker {
  /** Puts the fields on this provider, model and effort. */
  set(choice: AgentChoice): void;
  /** What they're on now. */
  choice(): AgentChoice;
}

/** Each provider's models as its CLI listed them, kept a minute; one that couldn't be listed isn't asked again for as long. */
const catalogues = new Map<AgentProvider, { list?: ModelOption[]; failed?: boolean; at: number; request?: Promise<void> }>();
const CATALOGUE_TTL_MS = 60_000;

/** Asks for a provider's models, unless what's here is fresh: then there's nothing to wait for. */
function loadCatalogue(provider: AgentProvider): Promise<void> | undefined {
  const c = catalogues.get(provider) ?? { at: 0 };
  catalogues.set(provider, c);
  if ((c.list || c.failed) && Date.now() - c.at < CATALOGUE_TTL_MS) return undefined;
  c.request ??= fetch(`/api/agents/${provider}/models`, { credentials: 'same-origin', cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { models?: unknown };
      const valid = PROVIDER_META[provider].validModel;
      const seen = new Set<string>();
      c.list = (Array.isArray(body.models) ? (body.models as Partial<ModelOption>[]) : [])
        .filter((m): m is ModelOption => !!m && !!valid?.(m.id) && !seen.has(m.id) && !!seen.add(m.id))
        .map((m) => ({ id: m.id, name: typeof m.name === 'string' ? m.name : undefined, efforts: Array.isArray(m.efforts) ? m.efforts.filter(isAgentEffort) : undefined }));
      c.failed = false;
    })
    .catch(() => {
      c.failed = true;
    })
    .finally(() => {
      c.at = Date.now();
      c.request = undefined;
    });
  return c.request;
}

/**
 * The provider, model and effort fields: a provider selector that never offers a provider outside
 * the server's metadata, with its model and reasoning effort underneath. Which of those a provider
 * takes, and how its model is asked for, is its row in the provider table (shared/providers.ts), so
 * a provider added there gets its fields here.
 */
export function agentFields(project: ProjectInfo | null, id: string, initial: AgentChoice, label = 'Provider'): AgentFields {
  const options = supportedProviders(project);
  const fallback = resolvedProvider(project?.defaultProvider, project);
  const select = h('select.provider-select', { id, 'aria-label': 'Worker provider' }) as HTMLSelectElement;
  for (const provider of options) select.append(h('option', { value: provider }, PROVIDER_LABEL[provider]));
  const note = h('small.provider-note');
  // A model is picked from a list or typed in, by provider: the two controls take turns.
  const modelLabel = h('label', {}, 'Model') as HTMLLabelElement;
  const modelSelect = h('select', { id: `${id}-model` }) as HTMLSelectElement;
  const modelInput = h('input', { type: 'text', id: `${id}-model-id`, list: `${id}-models`, autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const suggestions = h('datalist', { id: `${id}-models` });
  const effortLabel = h('label', { for: `${id}-effort` }, 'Effort');
  const effortSelect = h('select', { id: `${id}-effort` }) as HTMLSelectElement;
  effortSelect.append(h('option', { value: '' }, 'Default'));
  for (const e of AGENT_EFFORTS) effortSelect.append(h('option', { value: e }, EFFORT_LABEL[e]));
  const hint = h('small.provider-model-hint');
  const fields = h('div.provider-model', {}, modelLabel, modelSelect, modelInput, suggestions, effortLabel, effortSelect, hint);
  const element = h('div.provider-choice', {}, h('label', { for: id }, label), select, note, fields);

  const value = () => (options.includes(select.value as AgentProvider) ? (select.value as AgentProvider) : fallback);
  const meta = () => PROVIDER_META[value()];
  /** Its models: the ones it always has, or the ones its CLI listed. */
  const known = () => meta().models?.fixed ?? catalogues.get(value())?.list ?? [];
  /** Typed in: for a provider whose model is, and for one whose list couldn't be had. */
  const typed = () => meta().models?.pick === 'typed' || !!(meta().models?.catalog && catalogues.get(value())?.failed);
  /** The model id the fields are on, whichever control is showing. */
  let chosen = '';
  /**
   * Puts both controls on `id`: the list gets it as an option of its own when it isn't one of the
   * provider's (a saved one, or the list is still on its way). What's being typed is left alone.
   */
  const pick = (id: string) => {
    const models = known();
    chosen = id;
    modelSelect.replaceChildren(h('option', { value: '' }, meta().models?.unset ?? 'Default'), ...models.map((m) => h('option', { value: m.id }, m.name ?? m.id)));
    if (id && !models.some((m) => m.id === id)) modelSelect.append(h('option', { value: id }, id));
    modelSelect.value = id;
    if (modelInput.value.trim() !== id) modelInput.value = id;
    suggestions.replaceChildren(...models.map((m) => h('option', { value: m.id, label: m.name })));
  };
  /** The efforts on offer: the ones the model picked takes, where its catalogue says. */
  const paintEffort = () => {
    const efforts = known().find((o) => o.id === chosen)?.efforts;
    for (const option of effortSelect.options) option.disabled = !!option.value && !!efforts && !efforts.includes(option.value as AgentEffort);
    if (effortSelect.selectedOptions[0]?.disabled) effortSelect.value = '';
    effortSelect.disabled = efforts?.length === 0;
    effortSelect.title = efforts?.length === 0 ? 'This model has no reasoning effort to pick' : '';
  };
  /** Shows the fields the provider takes. */
  const paint = () => {
    const m = meta();
    const field = m.models;
    const catalogue = catalogues.get(value());
    note.textContent = providerUsageNote(value());
    modelLabel.classList.toggle('hidden', !field);
    modelSelect.classList.toggle('hidden', !field || typed());
    modelInput.classList.toggle('hidden', !field || !typed());
    modelLabel.htmlFor = typed() ? modelInput.id : modelSelect.id;
    for (const control of [modelSelect, modelInput]) control.setAttribute('aria-label', `${m.label} model`);
    modelInput.placeholder = field?.unset ?? '';
    modelInput.maxLength = field?.max ?? 256;
    effortLabel.textContent = m.effortLabel ?? 'Effort';
    effortLabel.classList.toggle('hidden', !m.takesEffort);
    effortSelect.classList.toggle('hidden', !m.takesEffort);
    effortSelect.setAttribute('aria-label', m.effortLabel ? `${m.label} ${m.effortLabel.toLowerCase()} level` : `${m.label} reasoning effort`);
    if (!field) hint.textContent = m.unpicked ?? '';
    else if (field.catalog && catalogue?.request) hint.textContent = `Loading ${m.label} models…`;
    else if (field.catalog && catalogue?.failed) hint.textContent = `${m.label}’s models couldn’t be listed: leave it empty for its default, or type a model id.`;
    else hint.textContent = field.hint;
    fields.classList.toggle('hidden', !field && !m.takesEffort && !hint.textContent);
    paintEffort();
  };
  /** Asks the provider's CLI for its models, only once someone can see the fields. */
  const load = () => {
    const provider = value();
    if (!meta().models?.catalog || !element.isConnected || element.closest('.hidden')) return;
    const loading = loadCatalogue(provider);
    if (!loading) return;
    paint();
    void loading.then(() => {
      if (value() !== provider) return;
      pick(chosen);
      paint();
    });
  };
  const set = (c: AgentChoice) => {
    select.value = options.includes(c.provider) ? c.provider : options.includes(fallback) ? fallback : options[0];
    const mine = select.value === c.provider;
    pick(mine && c.model && meta().validModel?.(c.model) ? c.model : '');
    modelInput.setCustomValidity('');
    effortSelect.value = mine && c.effort && meta().takesEffort ? c.effort : '';
    paint();
    load();
  };
  set(initial);
  // Another provider's model and effort mean nothing to this one: it starts on its own defaults.
  select.addEventListener('change', () => set({ provider: value() }));
  modelSelect.addEventListener('change', () => {
    pick(modelSelect.value);
    paintEffort();
  });
  modelInput.addEventListener('input', () => {
    chosen = modelInput.value.trim();
    modelInput.setCustomValidity('');
    paintEffort();
  });
  // Fields put on their provider before anyone could see them (in ⚙️ Settings) ask once they're on the page, or once they're used.
  setTimeout(load, 0);
  fields.addEventListener('focusin', load);
  const model = () => (chosen && meta().validModel?.(chosen) ? chosen : undefined);
  const effort = () => (meta().takesEffort && isAgentEffort(effortSelect.value) && !effortSelect.selectedOptions[0]?.disabled ? effortSelect.value : undefined);
  return {
    element,
    value,
    effort,
    model,
    set,
    choice: () => ({ provider: value(), ...(model() ? { model: model() } : {}), ...(effort() ? { effort: effort() } : {}) }),
    valid: () => {
      const okay = !chosen || !!meta().validModel?.(chosen);
      modelInput.setCustomValidity(okay ? '' : (meta().models?.invalid ?? 'That isn’t a model id this provider takes.'));
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
