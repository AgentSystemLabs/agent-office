import './followup-ui.css';
import type { DecisionView } from '../../../shared/decisions';
import { h } from '../../ui/dom';

const labels = {
  pending: 'Umsetzung: Abgleich ausstehend', dispatching: 'Umsetzung: Issues Agent prüft',
  issue_linked: 'Umsetzung: Issue erfasst', merged: 'Umsetzung: gemergt, Prüfung offen',
  verified: 'Umsetzung: bestätigt', no_action: 'Keine weitere Arbeit? Bitte prüfen', accepted_no_action: 'Keine weitere Arbeit bestätigt', needs_clarification: 'Umsetzung: Klärung nötig',
};
export function followupCard(d: DecisionView, repo: string | undefined, action: (body: unknown) => Promise<unknown>) {
  if (d.status !== 'answered') return null;
  const f = d.followup;
  const root = h('section.decision-followup', {}, h('strong', {}, f ? labels[f.status] : labels.pending));
  if (!f) { root.append(h('p', {}, 'Ältere Antwort wird beim nächsten Abgleich erfasst.')); return root; }
  if (f.issueNumbers.length) root.append(h('p', {}, 'Umsetzungs-Issues: ', ...f.issueNumbers.map(n => repo ? h('a', { href: `https://github.com/${repo}/issues/${n}`, target: '_blank', rel: 'noopener noreferrer' }, '#' + n + ' ') : h('span', {}, '#' + n + ' '))));
  if (f.note) root.append(h('p', {}, f.note));
  if (f.evidence) root.append(h('p', {}, 'Nachweis: ', /^https:\/\//.test(f.evidence) ? h('a', { href: f.evidence, target: '_blank', rel: 'noopener noreferrer' }, f.evidence) : h('span', {}, f.evidence)));
  if (f.verifiedAt) root.append(h('p', {}, `Bestätigt von ${f.verifiedBy} am ${new Date(f.verifiedAt).toLocaleString()}: ${f.verificationNote ?? ''}`));
  if (d.canAnswer && f.status !== 'dispatching') root.append(h('button.btn', { type: 'button', onclick: () => void action({ action: 'followup-retry', id: d.id, revision: d.revision }) }, 'Erneut abgleichen'));
  if (d.canAnswer && (f.status === 'merged' || f.status === 'no_action')) {
    const note = h('textarea', { rows: 2, placeholder: 'Was hast du geprüft? Build/Ergebnis angeben.', 'aria-label': 'Umsetzung geprüft' });
    root.append(note, h('button.btn', { type: 'button', onclick: () => { if (note.value.trim()) void action({ action: 'followup-verify', id: d.id, revision: d.revision, note: note.value }); } }, f.status === 'no_action' ? 'Keine Arbeit bestätigen' : 'Umsetzung bestätigen'));
  }
  return root;
}
