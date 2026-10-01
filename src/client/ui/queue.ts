import './queue.css';
import type { AgentProvider, FloorInfo, QueueState, QueueTask, Usage } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, STATUS_LABEL } from './dom';
import { confirmDialog } from './prompt';
import { providerPicker, providerLabel, providerUsageState, providerWaitingLabel, resolvedProvider, modelBadge } from './provider';
import { officeFull } from '../../shared/machine';

export interface QueueActions {
  openTerminal(workerId: string): void;
}

/** The queue task's name, linked to its GitHub issue when it has one (and it's on the floor you're on, whose issues the store has). */
function taskTitle(t: QueueTask, here: boolean): HTMLElement {
  if (t.issue === undefined) return h('div.queue-title', { title: t.prompt }, t.title);
  const issue = here ? store.issues.items.find((i) => i.number === t.issue) : undefined;
  const text = t.title.startsWith(`#${t.issue}`) ? t.title : `#${t.issue} ${t.title}`;
  return h('div.queue-title', { title: t.prompt }, issue ? h('a', { href: issue.url, target: '_blank', rel: 'noopener' }, text) : text);
}

function outcome(t: QueueTask): string {
  switch (t.outcome) {
    case 'done':
      return t.pr ? 'finished' : 'finished, no PR found yet';
    case 'exited':
      return t.error ? `stopped: ${t.error}` : 'stopped before finishing';
    case 'killed':
      return 'sent home';
    case 'failed':
      return `couldn't start: ${t.error ?? 'unknown error'}`;
    default:
      return '';
  }
}

/** Which queues the window shows: the floor you're on, or every floor's (remembered while the page is open). */
let scope: 'floor' | 'all' = 'floor';

/** The building's floors a task can go to (not the ones still being cloned). */
const openFloors = (): FloorInfo[] => store.floors.filter((f) => !f.cloning);

export function openQueue(net: Net, actions: QueueActions) {
  const body = h('div.body.queue');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const limitValue = h('b');
  const minus = h('button.btn', { type: 'button', title: 'Fewer workers at once', 'aria-label': 'Fewer workers at once' }, '−');
  const plus = h('button.btn', { type: 'button', title: 'More workers at once', 'aria-label': 'More workers at once' }, '+');
  const limit = h('div.queue-limit', { title: 'How many workers the queue keeps busy at once. 0 pauses it.' }, 'Workers at once', minus, limitValue, plus);
  minus.addEventListener('click', () => net.send({ t: 'queue.limit', maxWorkers: store.queue.maxWorkers - 1 }));
  plus.addEventListener('click', () => net.send({ t: 'queue.limit', maxWorkers: store.queue.maxWorkers + 1 }));
  // 🏢 All floors: every project's queue in one place, so tasks can go to any of them from here.
  const hereBtn = h('button.btn', { type: 'button', title: 'The queue of the floor you are on' }, 'This floor');
  const allBtn = h('button.btn', { type: 'button', title: 'Every floor’s queue: hand tasks to any project in the building' }, '🏢 All floors');
  const scopes = h('div.queue-scope', { role: 'group', 'aria-label': 'Which queues' }, hereBtn, allBtn);
  const setScope = (to: typeof scope) => {
    if (to !== scope) net.send({ t: 'queue.watch', on: to === 'all' });
    scope = to;
    render();
  };
  hereBtn.addEventListener('click', () => setScope('floor'));
  allBtn.addEventListener('click', () => setScope('all'));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': 'Task queue', style: 'width:min(800px,100%)' },
    h('header', {}, h('h2', {}, '📋 Task queue'), scopes, limit, close),
    body,
    h('footer', {}, h('span.grow', {}, 'The queue keeps going while you are away. Set “workers at once” to 0 to pause it.')),
  );

  const ta = h('textarea', { rows: 2, placeholder: 'Describe a task for the next free worker…', 'aria-label': 'New task' }) as HTMLTextAreaElement;
  const provider = providerPicker(store.project, 'queue-provider');
  // Which project the task is for: the floor you're on unless you pick another.
  const target = h('select.queue-target', { 'aria-label': 'Floor (project) for the task', title: 'Which floor’s project the task is for' }) as HTMLSelectElement;
  const targetPick = h('label.queue-target-pick', {}, '🏢 Floor', target);
  let targets = '';
  const fillTargets = () => {
    const floors = openFloors();
    // The elevator's counts come several times a second: only a floor coming, going or renamed changes the picker.
    const key = JSON.stringify([store.floor, floors.map((f) => [f.id, f.name])]);
    if (key === targets) return;
    targets = key;
    const was = target.value || store.floor || '';
    target.replaceChildren(...floors.map((f) => h('option', { value: f.id }, f.id === store.floor ? `${f.name} (this floor)` : f.name)));
    target.value = floors.some((f) => f.id === was) ? was : store.floor ?? floors[0]?.id ?? '';
    targetPick.classList.toggle('hidden', floors.length < 2);
  };
  fillTargets();
  const addBtn = h('button.btn.primary', { type: 'submit' }, 'Add to queue');
  const form = h('form.queue-add', {}, ta, targetPick, provider.element, addBtn) as HTMLFormElement;
  form.noValidate = true;
  const submit = () => {
    const text = ta.value.trim();
    if (!text) {
      ta.focus();
      return;
    }
    if (!provider.valid()) return;
    const floor = target.value && target.value !== store.floor ? target.value : undefined;
    net.send({ t: 'queue.add', prompt: text, provider: provider.value(), model: provider.model(), effort: provider.effort(), ...(floor ? { floor } : {}) });
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

  /** The queue a row belongs to: the floor's id when it isn't the one you're on (the messages then name it), and its tasks. */
  interface Of {
    floor?: string;
    q: QueueState;
  }
  const on = (of: Of) => (of.floor ? { floor: of.floor } : {});

  const section = (of: Of, title: string, tasks: QueueTask[], extra?: HTMLElement) => {
    if (!tasks.length) return null;
    return h('div', {}, h('h4', {}, title, h('span.count', {}, String(tasks.length)), extra ?? null), h('ul.queue-list', {}, ...tasks.map((t) => row(t, of))));
  };

  const row = (t: QueueTask, of: Of): HTMLElement => {
    // Only the workers of the floor you're on are in the store: elsewhere, a task's worker is just its name.
    const w = t.workerId && !of.floor ? store.workers.get(t.workerId) : undefined;
    const meta: string[] = [];
    const buttons: HTMLElement[] = [];
    const badge = modelBadge(t.provider, t.model, t.effort);
    const model = badge ? ` · initial: ${badge}` : '';
    const usageSuffix = (provider: AgentProvider | undefined, usage?: Usage) => {
      const state = providerUsageState(provider, store.project, usage);
      if (state === 'untracked') return ' · usage untracked';
      if (state !== 'waiting') return '';
      const waiting = providerWaitingLabel(provider, store.project);
      return waiting ? ` · ${waiting}` : '';
    };
    let pos: string | null = null;
    if (t.status === 'running') {
      const selectedProvider = providerLabel(t.provider ?? w?.provider, store.project);
      meta.push(`⚙️ ${selectedProvider}${model}${usageSuffix(t.provider ?? w?.provider, w?.usage)}`);
      meta.push(`${t.workerName ?? 'a worker'} · ${w ? STATUS_LABEL[w.status] ?? w.status : 'gone'}`);
      if (t.branch) meta.push(`🌿 ${t.branch}`);
      if (t.startedAt) meta.push(`started ${timeAgo(t.startedAt)}`);
      meta.push(`by ${t.addedBy}`);
      if (w) {
        buttons.push(h('button.btn', { type: 'button', onclick: () => actions.openTerminal(w.id) }, '🖥️ Terminal'));
        buttons.push(
          h('button.btn', {
            type: 'button',
            title: 'Send the worker home; the task counts as stopped',
            onclick: () => confirmDialog(`Stop ${w.name}?`, `This sends ${w.name} home and stops the task. You can requeue it afterwards.`, 'Stop', () => net.send({ t: 'worker.kill', workerId: w.id })),
          }, '⏹ Stop'),
        );
      }
    } else if (t.status === 'queued') {
      const queued = of.q.tasks.filter((x) => x.status === 'queued');
      const i = queued.indexOf(t);
      pos = String(i + 1);
      meta.push(`⚙️ ${providerLabel(t.provider, store.project)}${model}${usageSuffix(t.provider, w?.usage)}`);
      meta.push(`added by ${t.addedBy} ${timeAgo(t.addedAt)}`);
      buttons.push(h('button.btn', { type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, onclick: () => net.send({ t: 'queue.move', taskId: t.id, delta: -1, ...on(of) }) }, '↑'));
      buttons.push(h('button.btn', { type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === queued.length - 1, onclick: () => net.send({ t: 'queue.move', taskId: t.id, delta: 1, ...on(of) }) }, '↓'));
      buttons.push(h('button.btn', { type: 'button', title: 'Remove from the queue', 'aria-label': 'Remove', onclick: () => net.send({ t: 'queue.remove', taskId: t.id, ...on(of) }) }, '✕'));
    } else {
      meta.push(`⚙️ ${providerLabel(t.provider, store.project)}${model}${usageSuffix(t.provider, w?.usage)}`);
      meta.push(outcome(t));
      if (t.workerName) meta.push(t.workerName);
      if (t.branch) meta.push(`🌿 ${t.branch}`);
      if (t.finishedAt) meta.push(timeAgo(t.finishedAt));
      if (t.pr) buttons.push(h('a.btn', { href: t.pr.url, target: '_blank', rel: 'noopener', title: t.pr.title }, `🔀 PR #${t.pr.number}${t.pr.state === 'MERGED' ? ' ✓' : t.pr.state === 'DRAFT' ? ' (draft)' : ''}`));
      if (w) buttons.push(h('button.btn', { type: 'button', onclick: () => actions.openTerminal(w.id) }, '🖥️ Terminal'));
      buttons.push(h('button.btn', { type: 'button', title: 'Put it back on the queue', onclick: () => net.send({ t: 'queue.retry', taskId: t.id, ...on(of) }) }, '↻ Requeue'));
      buttons.push(h('button.btn', { type: 'button', title: 'Forget it', 'aria-label': 'Remove', onclick: () => net.send({ t: 'queue.remove', taskId: t.id, ...on(of) }) }, '✕'));
    }
    return h(
      'li',
      { class: t.status },
      pos ? h('span.pos', {}, pos) : null,
      h('div.queue-main', {}, taskTitle(t, !of.floor), h('div.queue-meta', {}, meta.join(' · '))),
      h('div.queue-actions', {}, ...buttons),
    );
  };

  // The form stays put and only the list below it re-renders, so worker updates don't pull focus out of the textarea.
  const list = h('div');
  body.append(form, list);

  /** A floor's queue: what's running, what's next and what's finished. */
  const sections = (of: Of): (HTMLElement | null)[] => {
    const running = of.q.tasks.filter((t) => t.status === 'running');
    const queued = of.q.tasks.filter((t) => t.status === 'queued');
    const done = of.q.tasks.filter((t) => t.status === 'done').slice().reverse();
    return [
      section(of, '🤖 Working on it', running),
      section(of, '⏳ Up next', queued),
      section(of, '✅ Finished', done, h('button.btn', { type: 'button', onclick: () => net.send({ t: 'queue.clear', ...on(of) }) }, 'Clear')),
    ];
  };

  /** Every floor's queue, one after the other, the floor you're on first. */
  const everyFloor = (): (HTMLElement | null)[] => {
    const floors = openFloors().sort((a, b) => Number(b.id === store.floor) - Number(a.id === store.floor));
    return [
      h('p.note', {}, 'Every project in the building, each with its own queue and workers. Pick a ', h('b', {}, '🏢 Floor'), ' above to hand the task to that project.'),
      ...floors.map((f) => {
        const here = f.id === store.floor;
        const q = here ? store.queue : store.queues.get(f.id);
        const of: Of = { floor: here ? undefined : f.id, q: q ?? { tasks: [], maxWorkers: 0 } };
        const running = q?.tasks.filter((t) => t.status === 'running').length ?? 0;
        const queued = q?.tasks.filter((t) => t.status === 'queued').length ?? 0;
        const stats = !q ? 'loading…' : `${running} working · ${queued} up next · ${q.maxWorkers === 0 ? 'paused' : `${q.maxWorkers} at once`}`;
        const parts = q ? sections(of).filter((n): n is HTMLElement => n !== null) : [];
        return h(
          'section.queue-floor',
          {},
          h('h3', {}, `🏢 ${f.name}`, here ? h('span.here', {}, 'this floor') : null, h('span.stats', {}, stats)),
          ...(parts.length ? parts : q ? [h('div.queue-floor-empty', {}, 'Nothing on its queue.')] : []),
        );
      }),
    ];
  };

  const render = () => {
    const q = store.queue;
    const all = scope === 'all' && openFloors().length > 1;
    scopes.classList.toggle('hidden', openFloors().length < 2);
    hereBtn.classList.toggle('primary', !all);
    allBtn.classList.toggle('primary', all);
    limit.classList.toggle('hidden', all);
    limitValue.textContent = q.maxWorkers === 0 ? 'Paused' : String(q.maxWorkers);
    minus.toggleAttribute('disabled', q.maxWorkers <= 0);
    const m = store.machine;
    const waiting = all ? openFloors().some((f) => (f.id === store.floor ? q : store.queues.get(f.id))?.tasks.some((t) => t.status === 'queued')) : q.tasks.some((t) => t.status === 'queued');
    const full = waiting && officeFull(m) ? h('p.note', {}, `⏸ The office is at its limit of ${m.limit} worker${m.limit === 1 ? '' : 's'}, so the next task waits until one goes home. A queue worker that's finished goes home by itself to make room.`) : null;
    if (all) {
      list.replaceChildren(...[full, ...everyFloor()].filter((n): n is HTMLElement => n !== null));
      return;
    }
    const parts: (HTMLElement | null)[] = [
      h(
        'p.note',
        {},
        'Or open the 📌 Issues board and click ',
        h('b', {}, 'Add to queue'),
        ' on an issue. Whenever a desk is free and fewer than ',
        h('b', {}, q.maxWorkers === 0 ? '0' : String(q.maxWorkers)),
        " of its tasks are running, the next task gets a fresh worker in its own git worktree (workers you hire yourself don't count). Issues are assigned on GitHub when they start, and the pull request is linked when it shows up.",
      ),
      full,
      ...sections({ q }),
      q.tasks.length ? null : h('div.queue-empty', {}, 'Nothing on the queue yet.'),
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
  const floorsChanged = () => {
    const before = targets;
    fillTargets();
    if (targets !== before) render();
  };
  const unsubs = [
    store.on('queue', render),
    store.on('queues', render),
    store.on('workers', render),
    store.on('issues', render),
    store.on('machine', machineChanged),
    store.on('floors', floorsChanged),
    store.on('floor', floorsChanged),
    // Back after a dropped connection: the office has forgotten this page followed every floor.
    store.on('me', () => scope === 'all' && net.send({ t: 'queue.watch', on: true })),
  ];
  if (scope === 'all') net.send({ t: 'queue.watch', on: true });
  const tick = setInterval(render, 30_000);
  const modal = openModal(el, {
    doing: '📥 at the queue',
    onClose: () => {
      unsubs.forEach((u) => u());
      if (scope === 'all') net.send({ t: 'queue.watch', on: false });
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  setTimeout(() => ta.focus(), 30);
}
