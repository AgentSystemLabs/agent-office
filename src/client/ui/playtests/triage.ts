import './ui.css';
import { h, openModal } from '../dom';
import { store } from '../../state';
import { playtestUpdates } from '../../features/playtests/updates';
import type { TriageProposal } from '../../../shared/playtest-triage';
import type { WorkerInfo } from '../../../shared/protocol';

export function playtestIssueButton(worker?: WorkerInfo) {
  return worker?.deskId === 'station-issues' ? h('button.btn', { type: 'button', onclick: () => openPlaytestTriage() }, '☑ Playtests aussortieren') : null;
}

export function openPlaytestTriage(onlyIssue?: number) {
  const floor = store.floor;
  let alive = true, busy = false;
  const message = h('p', { 'aria-live': 'polite' }, 'Offene Issues werden geprüft…');
  const list = h('div.playtest-list');
  const error = h('p.playtest-error', { role: 'alert' });
  const refresh = h('button.btn', { type: 'button', onclick: () => { if (!busy) void scan(); } }, 'Erneut prüfen');
  const root = h('div.modal.playtest-modal', { role: 'dialog', 'aria-label': 'Playtests aussortieren' },
    h('header', {}, h('h2', {}, '☑ Playtests aus Issues aussortieren')), refresh,
    h('div.playtest-intro', {}, 'Erst prüfen, dann übertragen. Nur eindeutig manuelle Prüfungen wandern in die Checkliste. Dokumentation, Code und automatisierte Tests bleiben im Issue. Ein geschlossener Eintrag bedeutet hier „übertragen“, nicht „auf dem Headset bestanden“.'), message, error, list);
  const modal = openModal(root, { onClose: () => { alive = false; off(); } });
  const off = store.on('floor', () => { if (floor !== store.floor) modal.close(); });
  const api = async (body: unknown) => {
    const response = await fetch(`/api/playtests/triage?floor=${encodeURIComponent(floor ?? '')}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const value = await response.json(); if (!response.ok) throw new Error(value.error); return value;
  };
  async function scan() {
    if (busy) return;
    busy = true; refresh.disabled = true; error.textContent = ''; list.replaceChildren();
    try {
      const result = await api({ action: 'scan' }); if (!alive) return;
      const proposals: TriageProposal[] = result.proposals.filter((p: TriageProposal) => !onlyIssue || p.issue.number === onlyIssue);
      message.textContent = `${result.scanned} offene Issues geprüft · ${proposals.length} Vorschläge. Unklare Anforderungen bleiben offen.`;
      list.replaceChildren(...proposals.map(row));
      if (!proposals.length) list.append(h('p', {}, 'Keine noch offenen, eindeutig übertragbaren Playtest-Kriterien gefunden.'));
    } catch (e) { if (alive) { error.textContent = (e as Error).message; message.textContent = 'Prüfung nicht abgeschlossen.'; } }
    finally { busy = false; refresh.disabled = false; }
  }
  function row(p: TriageProposal) {
    const transfer = p.checks.filter(c => c.test);
    const button = h('button.btn.primary', { type: 'button', disabled: !transfer.length }, p.close ? 'Tests übertragen & Issue schließen' : 'Tests übertragen · Issue bleibt offen');
    const result = h('p', { 'aria-live': 'polite' });
    const card = h('article.playtest-card', {}, h('h3', {}, `#${p.issue.number} ${p.issue.title}`),
      h('strong', {}, p.kind === 'manual' ? 'Reines Playtest-Issue' : p.kind === 'mixed' ? 'Gemischt: Entwicklungsarbeit bleibt' : 'Unklar: keine automatische Schließung'),
      h('ul', {}, ...p.checks.map(c => h('li', {}, `${c.kind === 'manual' ? '→ Playtest' : c.kind === 'development' ? 'Bleibt: Entwicklung/Doku' : 'Bleibt: unklar'}: ${c.text}`))),
      h('details', {}, h('summary', {}, 'Originalbeschreibung ansehen'), h('pre.playtest-text', {}, p.issue.body)),
      h('a', { href: p.issue.url, target: '_blank', rel: 'noopener noreferrer' }, 'Issue öffnen ↗'), button, result);
    button.addEventListener('click', async () => {
      if (busy || !alive || floor !== store.floor) return;
      busy = true; refresh.disabled = true; root.setAttribute('aria-busy', 'true'); button.disabled = true; error.textContent = '';
      try {
        const data = await api({ action: 'apply', number: p.issue.number, fingerprint: p.fingerprint });
        if (!alive) return;
        playtestUpdates.publish(floor, data.state);
        result.textContent = `${data.tests.length} Tests verknüpft. ${data.closed ? 'Issue geschlossen.' : 'Verbleibende Aufgaben stehen weiter im Issue.'}`;
        button.remove();
      } catch (e) { if (alive) { error.textContent = (e as Error).message; button.disabled = false; } }
      finally { busy = false; refresh.disabled = false; root.removeAttribute('aria-busy'); }
    });
    return card;
  }
  void scan();
}
