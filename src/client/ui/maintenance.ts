import type { ClientMsg, ServerMsg } from '../../shared/protocol';
import { MAINTENANCE_MODEL } from '../../shared/layout';
import { h, openModal } from './dom';
import { markdown } from './markdown';
import { store } from '../state';

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

/**
 * The Maintenance agent's stack: what he's committed since the office last restarted, and the big button
 * that commits what's left, checks it all, pushes, rebuilds and restarts the office, once.
 */
export function openStack(send: (msg: ClientMsg) => void) {
  const list = h('ol.stack-list');
  const status = h('div.stack-status', { 'aria-live': 'polite' });
  const big = h('button.btn.primary.stack-ship', { type: 'button' }, '🚀 Commit, push & rebuild');
  const note = h('p.stack-note', {}, 'Runs the typecheck and tests, pushes to the office’s repository, rebuilds and restarts the office once for everyone. Workers keep running through the restart.');
  const el = h(
    'div.modal.stack',
    { role: 'dialog', 'aria-label': 'Maintenance change stack' },
    h('header', {}, h('h2', {}, '📚 Change stack')),
    h('div.body', {}, h('p.laptop-note', {}, 'What the Maintenance agent has built since the office last restarted. Nothing is rebuilt until you press the button.'), list, status, big, note),
  );
  const modal = openModal(el, { onClose: () => void unsub() });

  const render = () => {
    const s = store.maintenance;
    const shipping = s.phase === 'shipping';
    const items: HTMLElement[] = [];
    if (s.dirty) items.push(h('li.stack-wip', {}, h('span', {}, '✏️ In the middle of a change'), h('small', {}, `${s.dirty} file${s.dirty === 1 ? '' : 's'} edited, not committed yet`)));
    // Newest on top, like a stack.
    for (const c of [...s.changes].reverse()) items.push(h('li', {}, h('code', {}, c.sha), ' ', c.subject));
    list.replaceChildren(...(items.length ? items : [h('li.stack-empty', {}, 'Nothing waiting. Ask the Maintenance agent for something at his counter.')]));
    status.replaceChildren();
    if (s.unavailable) status.append(h('p.setting-note.bad', { role: 'alert' }, s.unavailable));
    if (shipping) status.append(h('p.laptop-wait', {}, h('span.spinner'), ` ${s.step ?? 'Shipping'}…${s.by ? ` (started by ${s.by})` : ''}`));
    if (s.phase === 'failed' && s.error) status.append(h('pre.upgrade-error', {}, s.error), h('button.btn', { type: 'button', onclick: () => send({ t: 'maintenance.stack' }) }, 'Look again'));
    if (s.note) status.append(h('p.upgrade-status.ok', {}, s.note));
    big.disabled = shipping || !!s.unavailable || (!s.changes.length && !s.dirty);
    big.textContent = shipping ? '⏳ Shipping…' : `🚀 Commit, push & rebuild${s.changes.length + (s.dirty ? 1 : 0) > 1 ? ` (${s.changes.length + (s.dirty ? 1 : 0)} changes)` : ''}`;
  };
  const unsub = store.on('maintenance', render);
  big.addEventListener('click', () => send({ t: 'maintenance.ship' }));
  render();
  send({ t: 'maintenance.stack' });
  return modal;
}
