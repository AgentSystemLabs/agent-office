import type { ClientMsg, ServerMsg } from '../../shared/protocol';
import { MAINTENANCE_MODEL } from '../../shared/layout';
import { h, openModal } from './dom';
import { markdown } from './markdown';

// The maintenance closet's laptop: ask a small model a question about Agent Office itself. It reads
// the office's source and docs and answers; building the thing instead is the Maintenance agent's job.

let ask: { id: string; show(m: Extract<ServerMsg, { t: 'maintenance.answer' }>): void } | null = null;
let counter = 0;

/** Routes the server's answer to the window waiting for it (main.ts hands every `maintenance.answer` here). */
export function onMaintenanceAnswer(msg: Extract<ServerMsg, { t: 'maintenance.answer' }>) {
  if (ask?.id === msg.id) ask.show(msg);
}

export function openLaptop(send: (msg: ClientMsg) => void) {
  const ta = h('textarea', { rows: 3, placeholder: 'e.g. How does a worker get from the queue to a desk?', 'aria-label': 'Question' }) as HTMLTextAreaElement;
  const out = h('div.laptop-out', { 'aria-live': 'polite' });
  const submit = h('button.btn.primary', { type: 'submit' }, 'Ask 💬');
  const form = h(
    'form.modal.laptop',
    { role: 'dialog', 'aria-label': 'Office laptop' },
    h('header', {}, h('h2', {}, '💻 Ask about the office')),
    h('div.body', {}, h('p.laptop-note', {}, `A small model (${MAINTENANCE_MODEL}) reads the office's own source and docs. To change something, tell the Maintenance agent at the counter.`), ta, out),
    h('footer', {}, h('span.grow', {}, 'Enter to ask · Shift+Enter for a new line'), submit),
  ) as HTMLFormElement;
  form.noValidate = true;
  const modal = openModal(form, { onClose: () => void (ask = null) });

  const busy = (on: boolean) => {
    submit.disabled = on;
    ta.disabled = on;
  };
  const go = () => {
    const question = ta.value.trim();
    if (!question || submit.disabled) return;
    const id = `q${Date.now().toString(36)}${counter++}`;
    busy(true);
    out.replaceChildren(h('p.laptop-wait', {}, '⏳ Looking through the code…'));
    ask = {
      id,
      show: (m) => {
        busy(false);
        if (m.error) out.replaceChildren(h('p.setting-note.bad', { role: 'alert' }, m.error));
        else out.replaceChildren(h('div.laptop-answer', {}, markdown(m.answer ?? '')), h('p.laptop-model', {}, `— ${m.model}`));
        ta.focus();
        ta.select();
      },
    };
    send({ t: 'maintenance.ask', id, question });
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    go();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      go();
    }
  });
  setTimeout(() => ta.focus(), 30);
  return modal;
}
