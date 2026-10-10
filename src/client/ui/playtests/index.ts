import { playtestUpdates } from '../../features/playtests/updates';
import './ui.css';
import { playtestBugButton } from './bug';
import { store } from '../../state';
import { h, openModal } from '../../ui/dom';
import type { HudAction } from '../../ui/menu';
import { playtestMarkdown, type Playtest, type PlaytestState } from '../../../shared/playtests';

/** Menu registration; no frame loop, queue hooks or polling while the list is closed. */
export const playtestAction: HudAction = {
  id: 'playtests', icon: '☑️', label: 'Playtest checklist', section: 'Open',
  title: () => 'Your own play sessions: check off tests without blocking workers or PRs',
  run: () => openPlaytests(),
};

export function openPlaytests() {
  const floor = store.floor;
  const error = h('p.playtest-error', { role: 'alert' });
  const progress = h('p.playtest-progress', { 'aria-live': 'polite' });
  const list = h('div.playtest-list');
  const search = h('input', { type: 'search', placeholder: 'Search tests, notes or PRs…', 'aria-label': 'Search tests' });
  const filter = h('select', { 'aria-label': 'Show tests' },
    h('option', { value: 'open' }, 'Still to test'), h('option', { value: 'done' }, 'Checked off'), h('option', { value: 'all' }, 'All tests'));
  const category = h('select', { 'aria-label': 'Category' }, h('option', { value: '' }, 'All categories'));
  let state: PlaytestState = { items: [] };
  let pending = false;
  let alive = true;
  const url = `/api/playtests?floor=${encodeURIComponent(floor ?? '')}`;
  const add = h('button.btn.primary', { type: 'button', onclick: () => edit() }, '+ Add test');
  const refresh = h('button.btn', { type: 'button', onclick: () => void request() }, 'Refresh');
  const download = h('button.btn', { type: 'button', onclick: () => {
    const u = URL.createObjectURL(new Blob([playtestMarkdown(state.items)], { type: 'text/markdown;charset=utf-8' }));
    const a = h('a', { href: u, download: 'playtest-checklist.md' }); a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
  } }, 'Export');
  const root = h('div.modal.playtest-modal', { role: 'dialog', 'aria-label': 'Playtest checklist' },
    h('header', {}, h('h2', {}, '☑️ Playtest checklist')),
    h('div.playtest-intro', {}, h('strong', {}, 'For your next play session'),
      h('p', {}, 'Check these whenever you play. Open items do not block agents, issues or merges. Only you and other people in the Office can check them off.')),
    h('div.playtest-toolbar', {}, search, filter, category, refresh, download, add), progress, error, list);
  const modal = openModal(root, { doing: 'reviewing playtests', onClose: () => { alive = false; off(); } });
  const off = store.on('floor', () => { if (store.floor !== floor) modal.close(); });
  for (const field of [search, filter, category]) field.addEventListener('input', render);

  async function request(body?: unknown): Promise<boolean> {
    if (pending || !alive) return false;
    pending = true; error.textContent = ''; root.setAttribute('aria-busy', 'true');
    for (const button of [add, refresh]) button.disabled = true;
    try {
      const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not save checklist');
      if (!alive) return false;
      state = data;
      playtestUpdates.publish(floor, state);
      const selected = category.value;
      category.replaceChildren(h('option', { value: '' }, 'All categories'), ...[...new Set(state.items.map(t => t.category))].sort().map(c => h('option', { value: c }, c)));
      category.value = selected;
      if (category.selectedIndex < 0) category.value = '';
      return true;
    } catch (e) { if (alive) error.textContent = (e as Error).message; return false; }
    finally { pending = false; root.removeAttribute('aria-busy'); for (const button of [add, refresh]) button.disabled = false; if (alive) render(); }
  }

  function render() {
    const done = state.items.filter(t => t.done).length;
    progress.textContent = `${done} of ${state.items.length} checked off · ${state.items.length - done} still to test`;
    const q = search.value.toLocaleLowerCase();
    const items = state.items.filter(t => (filter.value === 'all' || t.done === (filter.value === 'done')) && (!category.value || t.category === category.value) && `${t.title} ${t.steps} ${t.expected} ${t.notes} ${t.source}`.toLocaleLowerCase().includes(q));
    items.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    list.replaceChildren(...items.map(row));
    if (!items.length) list.append(h('p.playtest-empty', {}, state.items.length ? 'No tests match this view.' : 'Your list is ready. Add a test, or let a worker leave a playtest here.'));
  }

  function row(t: Playtest) {
    const check = h('input', { type: 'checkbox', 'aria-label': `Checked off: ${t.title}`, disabled: pending }); check.checked = t.done;
    check.addEventListener('change', () => void request({ action: 'update', id: t.id, revision: t.revision, done: check.checked }));
    const notes = h('textarea', { rows: 2, maxlength: 6000, placeholder: 'Build played, what happened, anything to revisit…', 'aria-label': `Notes: ${t.title}` }); notes.value = t.notes;
    notes.addEventListener('input', () => drafts.set(t.id, notes.value));
    const save = h('button.btn', { type: 'button', onclick: async () => {
      save.disabled = true;
      const ok = await request({ action: 'update', id: t.id, revision: t.revision, notes: notes.value });
      if (!ok) { save.disabled = false; } // Input is retained below on failure.
    } }, 'Save notes');
    // Keep unsaved notes through filtering and failed saves.
    if (drafts.has(t.id) && drafts.get(t.id) !== t.notes) notes.value = drafts.get(t.id)!;
    const detail = h('details', {}, h('summary', {}, 'Instructions & notes'),
      h('h4', {}, 'What to do'), h('p.playtest-text', {}, t.steps), h('h4', {}, 'What to expect'), h('p.playtest-text', {}, t.expected),
      notes, h('div.playtest-row-actions', {}, save, h('button.btn', { type: 'button', onclick: () => edit(t) }, 'Edit test')),
      playtestBugButton(t, floor, () => notes.value),
      t.checkedAt ? h('small', {}, `Checked by ${t.checkedBy ?? 'Office user'} · ${new Date(t.checkedAt).toLocaleString()}`) : null);
    detail.open = expanded.has(t.id);
    detail.addEventListener('toggle', () => { if (detail.open) expanded.add(t.id); else expanded.delete(t.id); });
    return h('article.playtest-card', { class: t.done ? 'checked' : '' },
      h('div.playtest-card-head', {}, check, h('div', {}, h('h3', {}, t.title), h('span.playtest-category', {}, t.category),
        t.source ? h('a', { href: t.source, target: '_blank', rel: 'noopener noreferrer' }, sourceLabel(t.source)) : null)), detail);
  }
  const drafts = new Map<string, string>();
  const expanded = new Set<string>();

  function edit(item?: Playtest) {
    const field = (name: string, value: string, max: number, long = false) => {
      const input = long ? h('textarea', { rows: 3, maxlength: max, required: true }) : h('input', { maxlength: max, required: name !== 'Source URL' });
      input.value = value; return { input, label: h('label', {}, name, input) };
    };
    const title = field('Test title', item?.title ?? '', 180);
    const steps = field('What to do', item?.steps ?? '', 6000, true);
    const expected = field('What to expect', item?.expected ?? '', 3000, true);
    const group = field('Category', item?.category ?? 'Gameplay', 60);
    const source = field('Source URL', item?.source ?? '', 800);
    const message = h('p.playtest-error', { role: 'alert' });
    const submit = h('button.btn.primary', { type: 'submit' }, item ? 'Save test' : 'Add test');
    const form = h('form.playtest-editor', {}, title.label, group.label, steps.label, expected.label, source.label, message, submit);
    const editor = openModal(h('div.modal.playtest-modal', { role: 'dialog', 'aria-label': item ? 'Edit test' : 'Add test' }, h('header', {}, h('h2', {}, item ? 'Edit test' : 'Add a playtest')), form));
    form.addEventListener('submit', async e => {
      e.preventDefault(); submit.disabled = true;
      const test = { title: title.input.value, steps: steps.input.value, expected: expected.input.value, category: group.input.value, source: source.input.value };
      const ok = await request(item ? { action: 'update', id: item.id, revision: item.revision, test } : { action: 'add', test });
      if (ok) editor.close(); else { message.textContent = error.textContent || 'Wait for the current save, then retry.'; submit.disabled = false; }
    });
    title.input.focus();
  }
  function sourceLabel(source: string) { const m = /\/(pull|issues)\/(\d+)/.exec(source); return m ? `${m[1] === 'pull' ? 'PR' : 'Issue'} #${m[2]}` : 'Source ↗'; }
  void request();
}
