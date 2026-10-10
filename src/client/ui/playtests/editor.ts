import { h, openModal } from '../dom';
import { store } from '../../state';
import { PLAYTEST_MODES, PLAY_STYLES, STYLE_LABELS, testModes, testStyles } from '../../../shared/playtest-categories';
import type { Playtest, PlaytestInput } from '../../../shared/playtests';

export function editPlaytest(item: Playtest | undefined, save: (test: PlaytestInput) => Promise<boolean>) {
  const floor = store.floor;
  const field = (name: string, value = '', max = 6000, required = false) => {
    const input = h('textarea', { rows: name === 'Titel' ? 1 : 3, maxlength: max, required, 'aria-label': name });
    input.value = value; return { input, label: h('label', {}, name, input) };
  };
  const title = field('Titel', item?.title, 180, true);
  const topic = field('Thema', item?.category ?? 'Spielablauf', 60, true);
  const setup = field('Vorbereitung', item?.setup, 3000);
  const steps = field('Was machen?', item?.steps, 6000, true);
  const expected = field('Erwartetes Ergebnis', item?.expected, 3000, true);
  const source = field('Quelle (HTTPS)', item?.source, 800);
  const modes = PLAYTEST_MODES.map(mode => { const box = h('input', { type: 'checkbox', value: mode }); box.checked = item ? testModes(item).includes(mode) : mode === 'Allgemein'; return { box, label: h('label', {}, box, mode) }; });
  const styles = PLAY_STYLES.map(style => { const box = h('input', { type: 'checkbox', value: style }); box.checked = item ? testStyles(item).includes(style) : false; return { box, label: h('label', {}, box, STYLE_LABELS[style]) }; });
  const error = h('p.playtest-error', { role: 'alert' });
  const submit = h('button.btn.primary', { type: 'submit' }, 'Speichern');
  const form = h('form.playtest-editor', {}, title.label,
    h('fieldset.playtest-tags', {}, h('legend', {}, 'Bereiche – mehrere möglich'), ...modes.map(m => m.label)),
    h('fieldset.playtest-tags', {}, h('legend', {}, 'Spielweise – leer bedeutet alle'), ...styles.map(m => m.label)),
    topic.label, setup.label, steps.label, expected.label, source.label, error, submit);
  const modal = openModal(h('div.modal.playtest-modal', { role: 'dialog', 'aria-label': 'Playtest bearbeiten' }, h('header', {}, h('h2', {}, item ? 'Playtest bearbeiten' : 'Playtest hinzufügen')), form), { onClose: () => off() });
  const off = store.on('floor', () => { if (store.floor !== floor) modal.close(); });
  form.addEventListener('submit', async e => {
    e.preventDefault(); error.textContent = '';
    const selected = modes.filter(m => m.box.checked).map(m => m.box.value as typeof PLAYTEST_MODES[number]);
    if (!selected.length) { error.textContent = 'Mindestens einen Bereich auswählen.'; return; }
    submit.disabled = true;
    const ok = await save({ title: title.input.value, category: topic.input.value, setup: setup.input.value, steps: steps.input.value, expected: expected.input.value, source: source.input.value, modes: selected, playStyles: styles.filter(m => m.box.checked).map(m => m.box.value as typeof PLAY_STYLES[number]) });
    if (ok) modal.close(); else { submit.disabled = false; error.textContent = 'Speichern fehlgeschlagen. Die Eingaben bleiben erhalten; Fehlermeldung in der Checkliste beachten.'; }
  });
  title.input.focus();
}
