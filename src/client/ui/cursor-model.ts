// The Cursor model field under the provider picker (see provider.ts): free text, with suggestions
// from `cursor-agent models` (GET /api/agents/cursor/models) once someone can see it.
import { CURSOR_MODEL_MAX, isValidCursorModel } from '../../shared/providers';
import { h } from './dom';

let list: string[] | null = null;
let listAt = 0;
let request: Promise<string[]> | null = null;

function fetchCursorModels(): Promise<string[]> {
  if (list && Date.now() - listAt < 60_000) return Promise.resolve(list);
  if (request) return request;
  request = fetch('/api/agents/cursor/models', { credentials: 'same-origin', cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { models?: unknown };
      const models = Array.isArray(body.models) ? body.models.filter((m): m is string => isValidCursorModel(m)) : [];
      list = [...new Set(models)];
      listAt = Date.now();
      return list;
    })
    .finally(() => {
      request = null;
    });
  return request;
}

export interface CursorModelField {
  element: HTMLElement;
  input: HTMLInputElement;
  /** Fetches the suggestions, when the field can be seen. */
  load(): void;
  /** The model typed, when it's a valid one. */
  model(): string | undefined;
  /** Reports a visible error for a nonempty invalid model. */
  valid(): boolean;
}

export function cursorModelField(id: string): CursorModelField {
  const input = h('input', {
    type: 'text',
    id: `${id}-cursor-model`,
    list: `${id}-cursor-models`,
    placeholder: 'Default (Cursor settings)',
    'aria-label': 'Cursor model',
    autocomplete: 'off',
    maxlength: CURSOR_MODEL_MAX,
  }) as HTMLInputElement;
  const options = h('datalist', { id: `${id}-cursor-models` });
  const hint = h('small.provider-model-hint', {}, 'Optional model id; suggestions load from `cursor-agent models`.');
  const element = h('div.provider-model.cursor-model', {}, h('label', { for: input.id }, 'Model'), input, options, hint);
  input.addEventListener('input', () => input.setCustomValidity(''));
  const load = () => {
    if (!element.isConnected || element.closest('.hidden')) return;
    void fetchCursorModels()
      .then((models) => {
        options.replaceChildren(...models.map((model) => h('option', { value: model })));
        hint.textContent = 'Optional model id for this worker; choose a suggestion or type one.';
      })
      .catch(() => {
        hint.textContent = 'Model list unavailable; leave empty or type a Cursor model id.';
      });
  };
  input.addEventListener('focus', load);
  return {
    element,
    input,
    load,
    model: () => (isValidCursorModel(input.value) ? input.value : undefined),
    valid: () => {
      const okay = !input.value || isValidCursorModel(input.value);
      input.setCustomValidity(okay ? '' : 'Use a Cursor model id such as gpt-5 or claude-opus-4-8[effort=high] (up to 128 characters).');
      if (!okay) input.reportValidity();
      return okay;
    },
  };
}
