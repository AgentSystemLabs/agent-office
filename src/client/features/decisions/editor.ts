import { DECISION_CATEGORIES, type DecisionInput } from '../../../shared/decisions';
import { h, openModal } from '../../ui/dom';
export function editDecision(value: Partial<DecisionInput>, save: (input: DecisionInput) => Promise<void>) {
  const title = h('input', { value: value.title ?? '', required: true, maxlength: 180 });
  const question = h('textarea', { required: true, maxlength: 4000, rows: 3 }, value.question ?? '');
  const context = h('textarea', { maxlength: 6000, rows: 3 }, value.context ?? '');
  const options = h('textarea', { rows: 3 }, value.options?.join('\n') ?? '');
  const recommendation = h('textarea', { maxlength: 1000 }, value.recommendation ?? '');
  const category = h('select', {}, ...DECISION_CATEGORIES.map(c => h('option', { value: c, selected: c === (value.category ?? 'Sonstiges') }, c)));
  const tags = h('input', { value: value.tags?.join(', ') ?? '', placeholder: 'RIFT, Waffen, Koop' });
  const issues = h('input', { value: value.issues?.join(', ') ?? '', placeholder: '90, 180' });
  const blocking = h('input', { type: 'checkbox', checked: value.blocking ?? false });
  const reason = h('textarea', { maxlength: 1000 }, value.blockingReason ?? '');
  const error = h('p.decision-error', { role: 'alert' });
  const button = h('button.btn.primary', { type: 'submit' }, 'Speichern');
  const field = (name: string, element: HTMLElement) => h('label.decision-field', {}, h('span', {}, name), element);
  const form = h('form.decision-editor', { onsubmit: async (e: Event) => {
    e.preventDefault(); button.disabled = true; error.textContent = '';
    try { await save({ title: title.value, question: question.value, context: context.value, options: options.value.split('\n').map(s=>s.trim()).filter(Boolean), recommendation: recommendation.value,
      category: category.value, tags: tags.value.split(',').map(s=>s.trim()).filter(Boolean), issues: issues.value.split(',').map(s=>s.trim().replace(/^#/, '')).filter(Boolean).map(Number), blocking: blocking.checked, blockingReason: reason.value }); modal.close(); }
    catch (e) { error.textContent = (e as Error).message; } finally { button.disabled = false; }
  } }, field('Titel', title), field('Welche Entscheidung brauchst du?', question), field('Hintergrund / Auswirkungen', context), field('Optionen (eine je Zeile)', options), field('Empfehlung mit Begründung', recommendation),
    field('Kategorie', category), field('Tags (Komma getrennt)', tags), field('Abhängige Issues (Nummern, Komma getrennt)', issues),
    h('label', {}, blocking, ' Blockiert die weitere Arbeit'), field('Was genau ist blockiert?', reason), error, button);
  const modal = openModal(h('section.decisions-dialog', { role: 'dialog', 'aria-label': 'Entscheidungsfrage bearbeiten' }, h('header', {}, h('h2', {}, 'Entscheidungsfrage')), form));
}
