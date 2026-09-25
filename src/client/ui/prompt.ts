import { h, openModal } from './dom';

export interface PromptOptions {
  title: string;
  subtitle?: string;
  placeholder?: string;
  initial?: string;
  submitLabel?: string;
  onSubmit(text: string): void;
}

export function openPrompt(opts: PromptOptions) {
  const ta = h('textarea', { rows: 7, placeholder: opts.placeholder ?? 'What should Claude work on?', 'aria-label': 'Prompt' }) as HTMLTextAreaElement;
  ta.value = opts.initial ?? '';
  const submit = h('button.btn.primary', { type: 'submit' }, opts.submitLabel ?? 'Send ✨');
  const cancel = h('button.btn', { type: 'button' }, 'Cancel');
  const form = h(
    'form.modal',
    { role: 'dialog', 'aria-label': opts.title },
    h('header', {}, h('h2', {}, opts.title)),
    h('div.body', {}, opts.subtitle ? h('p', { style: 'margin:0 0 10px;font-weight:700;color:var(--muted)' }, opts.subtitle) : null, ta),
    h('footer', {}, h('span.grow', {}, 'Enter to send · Shift+Enter for a new line'), cancel, submit),
  ) as HTMLFormElement;

  const modal = openModal(form);
  cancel.addEventListener('click', () => modal.close());
  const send = () => {
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    modal.close();
    opts.onSubmit(text);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  setTimeout(() => {
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, 30);
}

export function confirmDialog(title: string, body: string, confirmLabel: string, onConfirm: () => void) {
  const yes = h('button.btn.danger', { type: 'button' }, confirmLabel);
  const no = h('button.btn', { type: 'button' }, 'Never mind');
  const el = h('div.modal', { role: 'alertdialog', 'aria-label': title }, h('header', {}, h('h2', {}, title)), h('div.body', {}, h('p', { style: 'margin:0;font-weight:700' }, body)), h('footer', {}, no, yes));
  const modal = openModal(el);
  no.addEventListener('click', () => modal.close());
  yes.addEventListener('click', () => {
    modal.close();
    onConfirm();
  });
  setTimeout(() => yes.focus(), 30);
}
