import type { WorkerAsk, WorkerInfo } from '../../shared/protocol';
import { h, openModal, type Modal } from './dom';
import type { Net } from '../net';

// A question an agent put to the office with office-ask (see server/asks.ts): pick an option, or type
// an answer, instead of hunting for its terminal. One window per question, closed by whoever answers.

const open = new Map<string, Modal>();

/** The answer to send: the ticked options' labels, one per line, then anything typed. */
export function composeAnswer(picked: string[], typed: string): string {
  return [...picked, typed.trim()].filter(Boolean).join('\n');
}

/** Whether this question's window is up. */
export function answerOpen(askId: string): boolean {
  return open.has(askId);
}

/** Closes the windows of questions no worker is waiting on any more (answered by someone else, or in the terminal). */
export function syncAnswers(workers: Iterable<WorkerInfo>) {
  const live = new Set<string>();
  for (const w of workers) if (w.asking) live.add(w.asking.id);
  for (const [id, modal] of [...open]) if (!live.has(id)) modal.close();
}

export function openAnswer(w: WorkerInfo, ask: WorkerAsk, net: Net) {
  if (open.has(ask.id)) return;
  const picked = new Set<string>();
  const typed = h('textarea', { rows: 3, placeholder: ask.options.length ? 'Or type something else…' : 'Your answer…', 'aria-label': 'Your answer' }) as HTMLTextAreaElement;
  const submit = h('button.btn.primary', { type: 'submit' }, 'Answer ✨') as HTMLButtonElement;
  const buttons = new Map<string, HTMLButtonElement>();
  const refresh = () => {
    for (const [label, b] of buttons) b.classList.toggle('picked', picked.has(label));
    submit.disabled = !composeAnswer([...picked], typed.value);
  };
  const send = () => {
    const answer = composeAnswer([...picked], typed.value);
    if (!answer) return typed.focus();
    net.send({ t: 'worker.answer', workerId: w.id, askId: ask.id, answer });
    modal.close();
  };
  const choices = ask.options.map((o) => {
    const b = h('button.ask-option', { type: 'button', 'aria-pressed': 'false' }, h('strong', {}, o.label), o.description ? h('span', {}, o.description) : null) as HTMLButtonElement;
    b.addEventListener('click', () => {
      if (ask.multi) picked.has(o.label) ? picked.delete(o.label) : picked.add(o.label);
      else {
        // One choice sends itself, unless something was typed to go with it.
        picked.clear();
        picked.add(o.label);
        if (!typed.value.trim()) return send();
      }
      refresh();
    });
    buttons.set(o.label, b);
    return b;
  });
  typed.addEventListener('input', refresh);
  typed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  const form = h(
    'form.modal.ask',
    { role: 'dialog', 'aria-label': ask.header ?? `${w.name} asks` },
    h('header', {}, h('h2', {}, `${ask.header ?? 'A question'} · ${w.name}`)),
    h('div.body', {}, h('p.ask-question', {}, ask.question), choices.length ? h('div.ask-options', {}, ...choices) : null, ask.multi ? h('p.setting-note', {}, 'Pick as many as you like.') : null, typed),
    h('footer', {}, h('span.grow', {}, 'Enter to send · Shift+Enter for a new line'), submit),
  ) as HTMLFormElement;
  form.noValidate = true;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  const modal = openModal(form, { doing: `answering ${w.name}`, onClose: () => open.delete(ask.id) });
  open.set(ask.id, modal);
  refresh();
  (choices[0] ?? typed).focus();
}
