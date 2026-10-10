import type { Playtest } from '../../../shared/playtests';
import { h } from '../dom';

/** Inline form keeps the tester in the expanded checklist, with the normal modal close/Esc behavior. */
export function playtestBugButton(test: Playtest, floor: string | null, notes: () => string): HTMLElement {
  const status = h('p.playtest-error', { role: 'status', 'aria-live': 'polite' });
  const description = h('textarea', { rows: 3, maxlength: 4000, required: true, 'aria-label': 'What went wrong?', placeholder: 'What exactly failed? What happened instead?' });
  const submit = h('button.btn.primary', { type: 'submit' }, 'Send to Issue agent');
  const cancel = h('button.btn', { type: 'button', onclick: () => { form.hidden = true; button.hidden = false; button.focus(); } }, 'Cancel');
  const form = h('form.playtest-bug-form', {}, h('label', {}, 'Describe what went wrong (required)', description),
    h('p', {}, 'The Issue agent will receive this test and your notes to create a bug issue. You decide when it gets worked on.'), submit, cancel, status);
  form.hidden = true;
  const button = h('button.btn', { type: 'button', onclick: () => { button.hidden = true; form.hidden = false; description.focus(); } }, 'Create Bug Issue');
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
