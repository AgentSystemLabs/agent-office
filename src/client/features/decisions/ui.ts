import './ui.css';
import { DECISION_CATEGORIES, blockedDecision, orderDecisions, type DecisionView } from '../../../shared/decisions';
import { h, openModal, type Modal } from '../../ui/dom';
import type { HudAction } from '../../ui/menu';
import { store } from '../../state';
import { decisions } from './state';
import { editDecision } from './editor';
let modal: Modal | undefined;
export const decisionsAction: HudAction = { id: 'decisions', icon: '💡', label: 'Entscheidungen', section: 'Open', count: () => decisions.state.items.filter(blockedDecision).length, run: () => openDecisions() };
export function openDecisions() {
  if (modal || !store.floor) return;
  const floor = store.floor, drafts = new Map<string,string>(), expanded = new Set<string>();
  const list = h('div.decision-list'), summary = h('p'), error = h('p.decision-error', { role: 'alert' }), connection = h('p.decision-error', { role: 'status' });
  const search = h('input', { placeholder: 'Frage, Issue oder Tag suchen', 'aria-label': 'Entscheidungen suchen', oninput: () => render(true) });
  const category = h('select', { 'aria-label': 'Kategorie', onchange: () => render(true) }, h('option', { value: '' }, 'Alle Kategorien'), ...DECISION_CATEGORIES.map(c => h('option', { value: c }, c)));
  const status = h('select', { 'aria-label': 'Status', onchange: () => render(true) }, h('option', { value: 'open' }, 'Offene Entscheidungen'), h('option', { value: 'blocked' }, 'Blockiert Arbeit'), h('option', { value: 'answered' }, 'Beantwortet'), h('option', { value: 'all' }, 'Alle'));
  async function action(body: unknown) {
    if (store.floor !== floor) throw Error('Projekt wurde gewechselt.');
    const r = await fetch('/api/decisions?floor=' + encodeURIComponent(floor), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json(); if (!r.ok) throw Error(data.error); await decisions.refresh(); return data;
  }
  const act = async (body: unknown) => { error.textContent = ''; try { await action(body); } catch (e) { error.textContent = (e as Error).message; } };
  function card(d: DecisionView) {
    const details = h('details.decision-card', { open: expanded.has(d.id), ontoggle: (e: Event) => { if ((e.target as HTMLDetailsElement).open) expanded.add(d.id); else expanded.delete(d.id); } });
    details.classList.toggle('blocked', blockedDecision(d));
    const badges = h('div.decision-tags', {}, ...d.tags.map(t => h('button', { type: 'button', onclick: () => { search.value = t; render(true); } }, t)));
    const source = h('div.decision-sources', {}, ...d.issues.map(n => decisions.state.repo ? h('a', { href: `https://github.com/${decisions.state.repo}/issues/${n}`, target: '_blank', rel: 'noopener noreferrer' }, '#' + n) : h('span', {}, '#' + n)));
    const body = h('div.decision-content', {}, h('p', {}, d.question), d.context ? h('p', {}, d.context) : null,
      d.blocking ? h('p.decision-blocker', {}, 'Abhängigkeit: ' + d.blockingReason) : null,
      d.recommendation ? h('p', {}, 'Empfehlung: ' + d.recommendation) : null,
      h('small', {}, `Erfasst von ${d.createdBy} · ${new Date(d.createdAt).toLocaleString()}`), badges, source);
    if (d.status === 'answered') body.append(h('p.decision-answer', {}, `Entschieden von ${d.answeredBy}: ${d.answer}`));
    if (d.canAnswer && d.status === 'open') {
      const answer = h('textarea', { rows: 3, placeholder: 'Deine Entscheidung und ggf. Bedingungen…', 'aria-label': 'Deine Entscheidung', oninput: () => drafts.set(d.id, answer.value) }, drafts.get(d.id) ?? '');
      body.append(h('div.decision-actions', {}, ...d.options.map(option => h('button.btn', { type: 'button', onclick: () => { answer.value = option; drafts.set(d.id, option); } }, option))), answer,
        h('button.btn.primary', { type: 'button', onclick: async () => { if (!answer.value.trim()) { error.textContent = 'Bitte eine Entscheidung eingeben.'; return; } await act({ action: 'answer', id: d.id, revision: d.revision, answer: answer.value }); } }, 'Entscheidung speichern'));
    } else if (!d.canAnswer && d.status === 'open') body.append(h('p', {}, 'Diese Frage beantwortet der zuständige Projektverantwortliche.'));
    if (d.canAnswer) {
      const actions = h('div.decision-actions', {}, h('button.btn', { type: 'button', onclick: () => { modal?.close(); editDecision(d, input => action({ action: 'edit', id: d.id, revision: d.revision, input }).then(()=>{})); } }, 'Bearbeiten'));
      if (d.status === 'answered') {
        actions.append(h('button.btn', { type: 'button', onclick: () => act({ action: 'reopen', id: d.id, revision: d.revision }) }, 'Wieder öffnen'));
        for (const w of d.workers) actions.append(h('button.btn', { type: 'button', disabled: d.notified?.[w.id] === d.answeredAt, onclick: () => act({ action: 'notify', id: d.id, revision: d.revision, worker: w.id }) }, d.notified?.[w.id] === d.answeredAt ? `${w.name} informiert` : `${w.name} informieren / fortsetzen`));
      }
      body.append(actions);
    }
    if (d.history.length) body.append(h('details', {}, h('summary', {}, 'Antwortverlauf'), ...d.history.map(a => h('p', {}, `${new Date(a.at).toLocaleString()} · ${a.by}: ${a.answer}`))));
    details.append(h('summary', {}, h('strong', {}, d.title), h('span.decision-label', {}, blockedDecision(d) ? 'Blockiert Arbeit' : d.status === 'answered' ? 'Beantwortet' : d.category)), body); return details;
  }
  let last = '';
  function render(force = false) {
    connection.textContent = decisions.error;
    const all = decisions.state.items, signature = JSON.stringify(all.map(d => [d.id,d.revision,d.canAnswer]));
    summary.textContent = `${all.filter(d => d.status === 'open').length} offen · ${all.filter(blockedDecision).length} blockieren Arbeit · ${all.filter(d => d.status === 'answered').length} beantwortet`;
    if (!force && signature === last) return; last = signature;
    const q = search.value.toLocaleLowerCase();
    const items = orderDecisions(all).filter(d => (!category.value || d.category === category.value) && (status.value === 'all' || (status.value === 'blocked' ? blockedDecision(d) : d.status === status.value)) && `${d.title} ${d.question} ${d.tags.join(' ')} ${d.issues.map(n=>'#'+n).join(' ')}`.toLocaleLowerCase().includes(q));
    list.replaceChildren(); let previous = '';
    for (const d of items) { const group = blockedDecision(d) ? 'Zuerst entscheiden: blockiert Arbeit' : d.status === 'answered' ? 'Beantwortet · ' + d.category : d.category;
      if (group !== previous) { list.append(h('h3', {}, group)); previous = group; } list.append(card(d)); }
    if (!items.length) list.append(h('p', {}, 'Keine Entscheidungen für diese Auswahl.'));
  }
  modal = openModal(h('section.decisions-dialog', { role: 'dialog', 'aria-label': 'Entscheidungen', 'aria-modal': 'true' },
    h('header', {}, h('h2', {}, '💡 Entscheidungen')),
    h('div.decisions-body', {}, h('p', {}, 'Deine Antworten für das Projekt. Speichern startet keine Aufgabe; bestehende Worker kannst du anschließend gezielt informieren.'),
      h('div.decision-actions', {}, search, category, status,
        h('button.btn', { type: 'button', onclick: () => decisions.refresh() }, 'Aktualisieren'),
        h('button.btn', { type: 'button', onclick: () => { modal?.close(); editDecision({}, input => action({ action: 'add', input }).then(()=>{})); } }, '+ Entscheidung'),
        h('button.btn', { type: 'button', onclick: async () => { try { await action({ action: 'scan' }); error.textContent = 'Issue Agent prüft Entscheidungen und Playtests. Die Liste aktualisiert sich automatisch.'; } catch(e) { error.textContent = (e as Error).message; } } }, 'Issues durchsuchen')),
      summary, connection, error, list)), { onClose: () => { off(); offFloor(); clearInterval(timer); modal = undefined; } });
  const off = decisions.on(() => render()), offFloor = store.on('floor', () => { if (store.floor !== floor) modal?.close(); });
  const timer = setInterval(() => void decisions.refresh(), 5000); render(true); void decisions.refresh();
}
