import './ui.css';
import { playtestUpdates } from '../../features/playtests/updates';
import { playtestBugButton } from './bug';
import { editPlaytest } from './editor';
import { openPlaytestTriage } from './triage';
import { store } from '../../state';
import { h, openModal } from '../dom';
import type { HudAction } from '../menu';
import { playtestMarkdown, type Playtest, type PlaytestState } from '../../../shared/playtests';
import { PLAYTEST_MODES, PLAY_STYLES, STYLE_LABELS, TEST_OUTCOMES, OUTCOME_LABELS, testModes, testStyles, testOutcome } from '../../../shared/playtest-categories';

export const playtestAction: HudAction = {
  id: 'playtests', icon: '☑️', label: 'Playtest checklist', section: 'Open',
  title: () => 'Deine Spieltests nach Modus und Spielweise', run: () => openPlaytests(),
};

export function openPlaytests(initialMode = '') {
  const floor = store.floor;
  let state: PlaytestState = { items: [] }, pending = false, alive = true, mode = initialMode;
  const notesDrafts = new Map<string, string>(), builds = new Map<string, string>(), expanded = new Set<string>();
  const error = h('p.playtest-error', { role: 'alert' });
  const progress = h('p.playtest-progress', { 'aria-live': 'polite' });
  const list = h('div.playtest-list');
  const tabs = h('nav.playtest-modes', { 'aria-label': 'Spielmodus' });
  const search = h('input', { type: 'search', placeholder: 'Tests, Notizen, Issues suchen…', 'aria-label': 'Tests suchen' });
  const style = h('select', { 'aria-label': 'Spielweise' }, h('option', { value: '' }, 'Alle Spielweisen'), ...PLAY_STYLES.map(s => h('option', { value: s }, STYLE_LABELS[s])));
  const outcome = h('select', { 'aria-label': 'Ergebnisfilter' }, h('option', { value: 'pending' }, 'Noch zu prüfen'), h('option', { value: '' }, 'Alle Ergebnisse'), ...TEST_OUTCOMES.map(s => h('option', { value: s }, OUTCOME_LABELS[s])));
  const add = h('button.btn.primary', { type: 'button', onclick: () => edit() }, '+ Test');
  const refresh = h('button.btn', { type: 'button', onclick: () => void request() }, 'Aktualisieren');
  const scan = h('button.btn', { type: 'button', onclick: () => openPlaytestTriage() }, 'Issues aussortieren');
  const download = h('button.btn', { type: 'button', onclick: () => {
    const url = URL.createObjectURL(new Blob([playtestMarkdown(visible())], { type: 'text/markdown;charset=utf-8' }));
    h('a', { href: url, download: 'playtests.md' }).click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } }, 'Auswahl exportieren');
  const root = h('div.modal.playtest-modal', { role: 'dialog', 'aria-label': 'Playtest checklist' },
    h('header', {}, h('h2', {}, '☑ Playtest-Checkliste')),
    h('div.playtest-intro', {}, h('strong', {}, 'Für deine nächste Spielrunde'), h('p', {}, 'Modus auswählen und Tests durchgehen. Offene Spieltests blockieren keine Worker oder Merges. Ergebnisse beziehen sich auf den tatsächlich getesteten Build.')),
    tabs, h('div.playtest-toolbar', {}, search, style, outcome, refresh, add, scan, download), progress, error, list);
  const modal = openModal(root, { doing: 'reviewing playtests', onClose: () => { alive = false; off(); offUpdates(); } });
  const off = store.on('floor', () => { if (store.floor !== floor) modal.close(); });
  const offUpdates = playtestUpdates.on((id, data) => { if (alive && id === floor) { state = data; render(); } });
  for (const field of [search, style, outcome]) field.addEventListener('input', render);
  const url = `/api/playtests?floor=${encodeURIComponent(floor ?? '')}`;
  async function request(body?: unknown): Promise<boolean> {
    if (pending || !alive || floor !== store.floor) return false;
    pending = true; error.textContent = ''; render();
    try {
      const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? 'Speichern fehlgeschlagen');
      if (!alive) return false;
      state = data; playtestUpdates.publish(floor, state); return true;
    } catch (e) { if (alive) error.textContent = (e as Error).message; return false; }
    finally { pending = false; if (alive) render(); }
  }
  function visible() {
    const q = search.value.toLocaleLowerCase();
    return state.items.filter(t => (!mode || testModes(t).some(m => m === mode)) && (!style.value || !testStyles(t).length || testStyles(t).some(s => s === style.value)) &&
      (!outcome.value || (outcome.value === 'pending' ? testOutcome(t) !== 'passed' : testOutcome(t) === outcome.value)) &&
      `${t.title} ${t.steps} ${t.expected} ${t.notes} ${t.source}`.toLocaleLowerCase().includes(q));
  }
  function render() {
    root.setAttribute('aria-busy', String(pending)); add.disabled = pending; refresh.disabled = pending;
    tabs.replaceChildren(...['', ...PLAYTEST_MODES].map(m => {
      const tests = state.items.filter(t => !m || testModes(t).some(n => n === m));
      return h('button.btn', { type: 'button', 'aria-pressed': String(mode === m), onclick: () => { mode = m; render(); } }, `${m || 'Alle'} · ${tests.filter(t => testOutcome(t) !== 'passed').length}`);
    }));
    const items = visible().sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    progress.textContent = `${items.length} angezeigt · insgesamt ${state.items.filter(t => testOutcome(t) === 'passed').length}/${state.items.length} bestanden · Mehrfachzuordnung ohne doppelte Tests`;
    list.replaceChildren();
    let topic = '';
    for (const item of items) {
      if (item.category !== topic) { topic = item.category; list.append(h('h3.playtest-group', {}, topic)); }
      list.append(row(item));
    }
    if (!items.length) list.append(h('p.playtest-empty', {}, pending ? 'Checkliste wird geladen…' : 'Für diese Auswahl sind keine Tests offen.'));
  }
  function row(t: Playtest) {
    const status = testOutcome(t);
    const notes = h('textarea', { rows: 2, maxlength: 6000, placeholder: 'Deine Beobachtung…', 'aria-label': `Notizen: ${t.title}` }); notes.value = notesDrafts.get(t.id) ?? t.notes;
    notes.addEventListener('input', () => notesDrafts.set(t.id, notes.value));
    const build = h('input', { maxlength: 120, placeholder: 'Build-Nr. / Version (oder unbekannt)', 'aria-label': `Getesteter Build: ${t.title}` }); build.value = builds.get(t.id) ?? t.build ?? '';
    build.addEventListener('input', () => builds.set(t.id, build.value));
    const actions = TEST_OUTCOMES.filter(s => s !== status).map(s => h('button.btn', { type: 'button', disabled: pending, onclick: () => {
      if ((s === 'passed' || s === 'failed') && !build.value.trim()) { error.textContent = 'Bitte den getesteten Build angeben oder ausdrücklich „unbekannt“ eintragen.'; build.focus(); return; }
      void request({ action: 'update', id: t.id, revision: t.revision, outcome: s, build: build.value, notes: notes.value });
    } }, OUTCOME_LABELS[s]));
    const detail = h('details', {}, h('summary', {}, 'Anleitung & Ergebnis'),
      h('h4', {}, 'Vorbereitung'), h('p.playtest-text', {}, t.setup || 'Passenden Modus und die angegebene Spielweise starten.'),
      h('h4', {}, 'Was machen?'), h('p.playtest-text', {}, t.steps), h('h4', {}, 'Erwartetes Ergebnis'), h('p.playtest-text', {}, t.expected),
      h('label', {}, 'Getesteter Build', build), notes,
      h('div.playtest-row-actions', {}, ...actions, h('button.btn', { type: 'button', disabled: pending, onclick: () => void request({ action: 'update', id: t.id, revision: t.revision, notes: notes.value }) }, 'Notizen speichern'), h('button.btn', { type: 'button', onclick: () => edit(t) }, 'Bearbeiten')),
      playtestBugButton(t, floor, () => notes.value),
      t.results?.length ? h('details', {}, h('summary', {}, 'Bisherige Ergebnisse'), ...t.results.slice().reverse().map(r => h('p', {}, `${OUTCOME_LABELS[r.outcome]} · Build ${r.build || 'nicht angegeben'} · ${r.by} · ${new Date(r.at).toLocaleString()}`))) : t.checkedAt ? h('small', {}, `Bisher abgehakt: ${t.checkedBy ?? ''} · ${new Date(t.checkedAt).toLocaleString()} · Build nicht dokumentiert`) : null);
    detail.open = expanded.has(t.id);
    detail.addEventListener('toggle', () => { if (detail.open) expanded.add(t.id); else expanded.delete(t.id); });
    return h('article.playtest-card', { class: status === 'passed' ? 'checked' : '', 'data-test-id': t.id },
      h('div.playtest-card-head', {}, h('span.playtest-result', { 'data-result': status }, OUTCOME_LABELS[status]), h('div', {}, h('h3', {}, t.title),
        h('span.playtest-category', {}, `${testModes(t).join(' · ')} / ${testStyles(t).map(s => STYLE_LABELS[s]).join(' · ') || 'Alle Spielweisen'}`),
        t.source ? h('a', { href: t.source, target: '_blank', rel: 'noopener noreferrer' }, sourceLabel(t.source)) : null)), detail);
  }
  function edit(item?: Playtest) { editPlaytest(item, test => request(item ? { action: 'update', id: item.id, revision: item.revision, test } : { action: 'add', test })); }
  function sourceLabel(source: string) { const m = /\/(pull|issues)\/(\d+)/.exec(source); return m ? `${m[1] === 'pull' ? 'PR' : 'Issue'} #${m[2]}` : 'Quelle ↗'; }
  void request();
}
