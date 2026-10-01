import './ask.css';
import type { AgentEffort, AgentProvider, WorkerStatus } from '../../shared/protocol';
import { h, openModal, STATUS_LABEL } from './dom';
import { store } from '../state';
import { providerPicker, type ProviderPicker } from './provider';
import { repoPicker } from './prompt';
import { L } from '../i18n';

// Send a prompt about an issue or PR to a worker: a new one at a free desk, or one already sitting
// at a desk (it lands in their input box, queued if they're busy).

export interface AskWorker {
  id: string;
  name: string;
  color: string;
  status: WorkerStatus;
}

export interface AskOptions {
  title: string;
  /** Told to the worker before your text, so it knows what you mean. Shown, not editable. */
  context?: string;
  /** A ready-made prompt to start from. */
  initial?: string;
  placeholder?: string;
  /** The desk a new worker would take, when one is free. */
  newDesk?: string;
  workers: AskWorker[];
  /** Offer the "own git worktree" option for a new worker. */
  worktreeOption: boolean;
  /** Offer the configured provider choice for a new worker. */
  providerOption?: boolean;
  /** Other floors' projects a new worker in its own worktree can work in too (see WorkerInfo.repos). */
  repoOptions?: { id: string; name: string }[];
  /** `to` is a worker id, or null for a new worker. */
  onSubmit(prompt: string, to: string | null, worktree: boolean, provider?: AgentProvider, model?: string, effort?: AgentEffort, repos?: string[]): void;
}

// Shared with the hire prompt, so the choice sticks either way.
const WT_KEY = 'agent-office.worktree';

export function openAsk(opts: AskOptions) {
  let to: string | null = opts.newDesk ? null : (opts.workers[0]?.id ?? null);
  const ta = h('textarea', { rows: opts.initial ? 9 : 5, placeholder: opts.placeholder ?? L.ask.placeholder, 'aria-label': L.hints.prompt }) as HTMLTextAreaElement;
  ta.value = opts.initial ?? '';
  const wtBox = h('input', { type: 'checkbox', id: 'ask-wt' }) as HTMLInputElement;
  try {
    wtBox.checked = localStorage.getItem(WT_KEY) === '1';
  } catch {
    // storage blocked
  }
  const wtRow = h('label.ask-wt', { for: 'ask-wt', title: L.ask.worktreeTip }, wtBox, L.prompt.worktree);
  const repos = repoPicker(opts.worktreeOption ? opts.repoOptions : undefined, wtBox);
  const provider: ProviderPicker | null = opts.providerOption ? providerPicker(store.project, 'ask-provider') : null;
  const submit = h('button.btn.primary', { type: 'submit' });

  const choices = h('div.seg.ask-to');
  const pick = (id: string | null) => {
    to = id;
    for (const b of choices.children) b.classList.toggle('on', (b as HTMLElement).dataset.to === (id ?? ''));
    wtRow.classList.toggle('hidden', !!id || !opts.worktreeOption);
    repos.element?.classList.toggle('hidden', !!id);
    provider?.element.classList.toggle('hidden', !!id);
    submit.textContent = id ? L.main.send : L.main.hireStart;
  };
  if (opts.newDesk) choices.append(h('button.btn', { type: 'button', 'data-to': '', onclick: () => pick(null) }, L.ask.newWorker(opts.newDesk)));
  for (const w of opts.workers) {
    choices.append(h('button.btn', { type: 'button', 'data-to': w.id, title: L.ask.typeInto(w.name), onclick: () => pick(w.id) }, h('span.dot', { style: `background:${w.color}` }), w.name, h('small', {}, STATUS_LABEL[w.status] ?? w.status)));
  }

  const cancel = h('button.btn', { type: 'button' }, L.hints.cancel);
  const form = h(
    'form.modal.ask',
    { role: 'dialog', 'aria-label': opts.title },
    h('header', {}, h('h2', {}, opts.title)),
    h(
      'div.body',
      {},
      h('label', {}, L.ask.sendTo),
      choices,
      opts.context ? h('details.ask-context', {}, h('summary', {}, L.ask.toldFirst), h('pre', {}, opts.context)) : null,
      h('label', { style: 'margin-top:14px' }, L.hints.prompt),
      ta,
      provider?.element ?? null,
      wtRow,
      repos.element,
    ),
    h('footer', {}, h('span.grow', {}, L.prompt.enterToSend), cancel, submit),
  ) as HTMLFormElement;
  form.noValidate = true;
  pick(to);

  const modal = openModal(form);
  cancel.addEventListener('click', () => modal.close());
  const send = () => {
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    if (!to && provider && !provider.valid()) return;
    modal.close();
    if (!to && opts.worktreeOption) {
      try {
        localStorage.setItem(WT_KEY, wtBox.checked ? '1' : '0');
      } catch {
        // storage blocked
      }
    }
    opts.onSubmit(
      opts.context ? `${opts.context}\n\n${text}` : text,
      to,
      !to && opts.worktreeOption && wtBox.checked,
      !to ? provider?.value() : undefined,
      !to ? provider?.model() : undefined,
      !to ? provider?.effort() : undefined,
      !to && opts.worktreeOption && wtBox.checked ? repos.value() : undefined,
    );
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
