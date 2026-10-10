import { store } from '../../state';
import type { Playtest } from '../../../shared/playtests';
import { h } from '../dom';

/** Inline form keeps the tester in the expanded checklist, with the normal modal close/Esc behavior. */
export function playtestBugButton(test: Playtest, floor: string | null, notes: () => string): HTMLElement {
  const status = h('p.playtest-error', { role: 'status', 'aria-live': 'polite' });
  const description = h('textarea', { rows: 3, maxlength: 4000, required: true, 'aria-label': 'Was ist passiert?', placeholder: 'Was ist fehlgeschlagen? Was ist stattdessen passiert?' });
  const submit = h('button.btn.primary', { type: 'submit' }, 'Bug-Entwurf an Issue-Agent');
  const cancel = h('button.btn', { type: 'button', onclick: () => { form.hidden = true; button.hidden = false; button.focus(); } }, 'Cancel');
  const words = test.title.toLowerCase().split(/[^a-zäöüß0-9]+/).filter(w => w.length > 4);
  const existing = store.issues.items.filter(i => i.state === 'OPEN' && words.filter(w => i.title.toLowerCase().includes(w)).length >= Math.min(2, Math.max(1, words.length))).slice(0, 5);
  const matches = h('div', {}, existing.length ? h('strong', {}, 'Möglicherweise bereits gemeldet:') : null, ...existing.map(i => h('p', {}, h('a', { href: i.url, target: '_blank', rel: 'noopener noreferrer' }, `#${i.number} ${i.title}`))));
  const form = h('form.playtest-bug-form', {}, h('label', {}, 'Deine Beobachtung (Pflichtfeld)', description),
    h('p', {}, 'Der Issue-Agent bekommt Schritte, Soll-Ergebnis, Build und deine Beobachtung. Er prüft vorhandene Bugs und erstellt oder ergänzt das passende Issue. Es wird keine Arbeit gestartet.'), matches, submit, cancel, status);
  form.hidden = true;
  const button = h('button.btn', { type: 'button', onclick: () => { button.hidden = true; form.hidden = false; description.focus(); } }, 'Fehler melden');
  const reportId = crypto.randomUUID();
  let sent = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (sent) return;
    if (!description.value.trim()) { status.textContent = 'Please describe what went wrong.'; description.focus(); return; }
    submit.disabled = true; cancel.disabled = true; status.textContent = 'Sending…';
    try {
      const response = await fetch(`/api/playtests/bug?floor=${encodeURIComponent(floor ?? '')}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: test.id, revision: test.revision, reportId, description: description.value, notes: notes() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not send the report');
      sent = true; description.disabled = true; submit.textContent = 'Sent to Issue agent'; status.textContent = 'Report sent. The test stays on your checklist; verify the fix when ready.';
    } catch (err) { status.textContent = (err as Error).message; submit.disabled = false; }
    finally { cancel.disabled = false; }
  });
  return h('div.playtest-bug', {}, button, form);
}
