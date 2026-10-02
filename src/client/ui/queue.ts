import './queue.css';
import type { AgentProvider, QueueTask, Usage } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, STATUS_LABEL } from './dom';
import { confirmDialog } from './prompt';
import { providerPicker, providerLabel, providerUsageState, providerWaitingLabel, resolvedProvider, modelBadge } from './provider';
import { officeFull } from '../../shared/machine';
import { L } from '../i18n';
import { dictateField } from './dictate';

export interface QueueActions {
  openTerminal(workerId: string): void;
}

/** The queue task's name, linked to its GitHub issue when it has one. */
function taskTitle(t: QueueTask): HTMLElement {
  if (t.issue === undefined) return h('div.queue-title', { title: t.prompt }, t.title);
  const issue = store.issues.items.find((i) => i.number === t.issue);
  const text = t.title.startsWith(`#${t.issue}`) ? t.title : `#${t.issue} ${t.title}`;
  return h('div.queue-title', { title: t.prompt }, issue ? h('a', { href: issue.url, target: '_blank', rel: 'noopener' }, text) : text);
}

function outcome(t: QueueTask): string {
  switch (t.outcome) {
    case 'done':
      return t.pr ? L.queue.finished : L.queue.finishedNoPr;
    case 'exited':
      return t.error ? L.queue.stopped(t.error) : L.queue.stoppedEarly;
    case 'killed':
      return L.queue.sentHome;
    case 'failed':
      return L.queue.couldntStart(t.error ?? L.queue.unknownError);
    default:
      return '';
  }
}

export function openQueue(net: Net, actions: QueueActions) {
  const body = h('div.body.queue');
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const limitValue = h('b');
  const minus = h('button.btn', { type: 'button', title: L.queue.fewer, 'aria-label': L.queue.fewer }, '−');
  const plus = h('button.btn', { type: 'button', title: L.queue.more, 'aria-label': L.queue.more }, '+');
  const limit = h('div.queue-limit', { title: L.queue.limitTip }, L.queue.atOnce, minus, limitValue, plus);
  minus.addEventListener('click', () => net.send({ t: 'queue.limit', maxWorkers: store.queue.maxWorkers - 1 }));
  plus.addEventListener('click', () => net.send({ t: 'queue.limit', maxWorkers: store.queue.maxWorkers + 1 }));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': L.menu.queue, style: 'width:min(800px,100%)' },
    h('header', {}, h('h2', {}, L.hints.taskQueue), limit, close),
    body,
    h('footer', {}, h('span.grow', {}, L.queue.foot)),
  );

  const ta = h('textarea', { rows: 2, placeholder: L.queue.describe, 'aria-label': L.queue.newTask }) as HTMLTextAreaElement;
  const provider = providerPicker(store.project, 'queue-provider');
  const addBtn = h('button.btn.primary', { type: 'submit' }, L.queue.add);
  const form = h('form.queue-add', {}, dictateField(ta), provider.element, addBtn) as HTMLFormElement;
  form.noValidate = true;
  const submit = () => {
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    if (!provider.valid()) return;
    net.send({ t: 'queue.add', prompt: text, provider: provider.value(), model: provider.model(), effort: provider.effort() });
    ta.value = '';
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  });

  const section = (title: string, tasks: QueueTask[], extra?: HTMLElement) => {
    if (!tasks.length) return null;
    return h('div', {}, h('h4', {}, title, h('span.count', {}, String(tasks.length)), extra ?? null), h('ul.queue-list', {}, ...tasks.map(row)));
  };

  const row = (t: QueueTask): HTMLElement => {
    const w = t.workerId ? store.workers.get(t.workerId) : undefined;
    const meta: string[] = [];
    const buttons: HTMLElement[] = [];
    const badge = modelBadge(t.provider, t.model, t.effort);
    const model = badge ? ` · ${L.queue.initial(badge)}` : '';
    const usageSuffix = (provider: AgentProvider | undefined, usage?: Usage) => {
      const state = providerUsageState(provider, store.project, usage);
      if (state === 'untracked') return ` · ${L.hud.untracked}`;
      if (state !== 'waiting') return '';
      const waiting = providerWaitingLabel(provider, store.project);
      return waiting ? ` · ${waiting}` : '';
    };
    let pos: string | null = null;
    if (t.status === 'running') {
      const selectedProvider = providerLabel(t.provider ?? w?.provider, store.project);
      meta.push(`⚙️ ${selectedProvider}${model}${usageSuffix(t.provider ?? w?.provider, w?.usage)}`);
      meta.push(`${t.workerName ?? L.boards.aWorker} · ${w ? STATUS_LABEL[w.status] ?? w.status : L.queue.gone}`);
      if (t.branch) meta.push(`🌿 ${t.branch}`);
      if (t.startedAt) meta.push(L.queue.started(timeAgo(t.startedAt)));
      meta.push(L.boards.by(t.addedBy));
      if (w) {
        buttons.push(h('button.btn', { type: 'button', onclick: () => actions.openTerminal(w.id) }, L.queue.terminal));
        buttons.push(
          h('button.btn', {
            type: 'button',
            title: L.queue.stopTip,
            onclick: () => confirmDialog(L.queue.stopQ(w.name), L.queue.stopBody(w.name), L.queue.stopWord, () => net.send({ t: 'worker.kill', workerId: w.id })),
          }, L.queue.stop),
        );
      }
    } else if (t.status === 'queued') {
      const queued = store.queue.tasks.filter((x) => x.status === 'queued');
      const i = queued.indexOf(t);
      pos = String(i + 1);
      meta.push(`⚙️ ${providerLabel(t.provider, store.project)}${model}${usageSuffix(t.provider, w?.usage)}`);
      meta.push(L.queue.addedBy(t.addedBy, timeAgo(t.addedAt)));
      buttons.push(h('button.btn', { type: 'button', title: L.queue.moveUp, 'aria-label': L.queue.moveUp, disabled: i === 0, onclick: () => net.send({ t: 'queue.move', taskId: t.id, delta: -1 }) }, '↑'));
      buttons.push(h('button.btn', { type: 'button', title: L.queue.moveDown, 'aria-label': L.queue.moveDown, disabled: i === queued.length - 1, onclick: () => net.send({ t: 'queue.move', taskId: t.id, delta: 1 }) }, '↓'));
      buttons.push(h('button.btn', { type: 'button', title: L.queue.removeTip, 'aria-label': L.settings.remove, onclick: () => net.send({ t: 'queue.remove', taskId: t.id }) }, '✕'));
    } else {
      meta.push(`⚙️ ${providerLabel(t.provider, store.project)}${model}${usageSuffix(t.provider, w?.usage)}`);
      meta.push(outcome(t));
      if (t.workerName) meta.push(t.workerName);
      if (t.branch) meta.push(`🌿 ${t.branch}`);
      if (t.finishedAt) meta.push(timeAgo(t.finishedAt));
      if (t.pr) buttons.push(h('a.btn', { href: t.pr.url, target: '_blank', rel: 'noopener', title: t.pr.title }, `🔀 PR #${t.pr.number}${t.pr.state === 'MERGED' ? ' ✓' : t.pr.state === 'DRAFT' ? ` (${L.pull.draft})` : ''}`));
      if (w) buttons.push(h('button.btn', { type: 'button', onclick: () => actions.openTerminal(w.id) }, L.queue.terminal));
      buttons.push(h('button.btn', { type: 'button', title: L.queue.requeueTip, onclick: () => net.send({ t: 'queue.retry', taskId: t.id }) }, L.queue.requeue));
      buttons.push(h('button.btn', { type: 'button', title: L.queue.forget, 'aria-label': L.settings.remove, onclick: () => net.send({ t: 'queue.remove', taskId: t.id }) }, '✕'));
    }
    return h(
      'li',
      { class: t.status },
      pos ? h('span.pos', {}, pos) : null,
      h('div.queue-main', {}, taskTitle(t), h('div.queue-meta', {}, meta.join(' · '))),
      h('div.queue-actions', {}, ...buttons),
    );
  };

  // The form stays put and only the list below it re-renders, so worker updates don't pull focus out of the textarea.
  const list = h('div');
  body.append(form, list);

  const render = () => {
    const q = store.queue;
    limitValue.textContent = q.maxWorkers === 0 ? L.queue.paused : String(q.maxWorkers);
    minus.toggleAttribute('disabled', q.maxWorkers <= 0);
    const running = q.tasks.filter((t) => t.status === 'running');
    const queued = q.tasks.filter((t) => t.status === 'queued');
    const done = q.tasks.filter((t) => t.status === 'done').slice().reverse();
    const m = store.machine;
    const parts: (HTMLElement | null)[] = [
      h(
        'p.note',
        {},
        L.queue.note1,
        h('b', {}, L.queue.add),
        L.queue.note2,
        h('b', {}, q.maxWorkers === 0 ? '0' : String(q.maxWorkers)),
        L.queue.note3,
      ),
      queued.length && officeFull(m)
        ? h('p.note', {}, L.queue.atLimit(m.limit ?? 0))
        : null,
      section(L.queue.working, running),
      section(L.queue.upNext, queued),
      section(L.queue.done, done, h('button.btn', { type: 'button', onclick: () => net.send({ t: 'queue.clear' }) }, L.boards.clear)),
      running.length + queued.length + done.length ? null : h('div.queue-empty', {}, L.queue.empty),
    ];
    list.replaceChildren(...parts.filter((n): n is HTMLElement => n !== null));
  };

  // The machine reports every few seconds; only a change to whether the office is full shows here.
  let full = '';
  const machineChanged = () => {
    const k = `${officeFull(store.machine)}|${store.machine.limit}`;
    if (k === full) return;
    full = k;
    render();
  };
  const unsubs = [store.on('queue', render), store.on('workers', render), store.on('issues', render), store.on('machine', machineChanged)];
  const tick = setInterval(render, 30_000);
  const modal = openModal(el, {
    doing: L.queue.doing,
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  setTimeout(() => ta.focus(), 30);
}
