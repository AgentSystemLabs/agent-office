import './queue.css';
import type { AgentProvider, QueueTask, Usage } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo, STATUS_LABEL } from './dom';
import { confirmDialog } from './prompt';
import { providerPicker, providerLabel, providerUsageState, providerWaitingLabel, resolvedProvider, modelBadge } from './provider';
import { officeFull } from '../../shared/machine';
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
      return t.pr ? 'finished' : "작업 완료 · 아직 PR 없음";
    case 'exited':
      return t.error ? `중단됨: ${t.error}` : "완료 전에 중단됨";
    case 'killed':
      return "퇴근함";
    case 'failed':
      return `시작하지 못함: ${t.error ?? "알 수 없는 오류"}`;
    default:
      return '';
  }
}

export function openQueue(net: Net, actions: QueueActions) {
  const body = h('div.body.queue');
  const close = h('button.btn.close', { 'aria-label': "닫기" }, '✕');
  const limitValue = h('b');
  const minus = h('button.btn', { type: 'button', title: "동시 작업 인원 줄이기", 'aria-label': "동시 작업 인원 줄이기" }, '−');
  const plus = h('button.btn', { type: 'button', title: "동시 작업 인원 늘리기", 'aria-label': "동시 작업 인원 늘리기" }, '+');
  const limit = h('div.queue-limit', { title: "대기열에서 동시에 작업할 직원 수입니다. 0으로 설정하면 일시 중지합니다." }, "동시 작업 인원", minus, limitValue, plus);
  minus.addEventListener('click', () => net.send({ t: 'queue.limit', maxWorkers: store.queue.maxWorkers - 1 }));
  plus.addEventListener('click', () => net.send({ t: 'queue.limit', maxWorkers: store.queue.maxWorkers + 1 }));
  const el = h(
    'div.modal',
    { role: 'dialog', 'aria-label': "작업 대기열", style: 'width:min(800px,100%)' },
    h('header', {}, h('h2', {}, "📋 작업 대기열"), limit, close),
    body,
    h('footer', {}, h('span.grow', {}, "자리를 비워도 대기열의 작업은 계속됩니다. 일시 중지하려면 동시 작업 인원을 0으로 설정하세요.")),
  );

  const ta = h('textarea', { rows: 2, placeholder: 'Describe a task for the next free worker…', 'aria-label': 'New task' }) as HTMLTextAreaElement;
  const provider = providerPicker(store.project, 'queue-provider');
  const addBtn = h('button.btn.primary', { type: 'submit' }, "대기열에 추가");
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
    const model = badge ? ` · 시작 설정: ${badge}` : '';
    const usageSuffix = (provider: AgentProvider | undefined, usage?: Usage) => {
      const state = providerUsageState(provider, store.project, usage);
      if (state === 'untracked') return " · 사용량 집계 안 됨";
      if (state !== 'waiting') return '';
      const waiting = providerWaitingLabel(provider, store.project);
      return waiting ? ` · ${waiting}` : '';
    };
    let pos: string | null = null;
    if (t.status === 'running') {
      const selectedProvider = providerLabel(t.provider ?? w?.provider, store.project);
      meta.push(`⚙️ ${selectedProvider}${model}${usageSuffix(t.provider ?? w?.provider, w?.usage)}`);
      meta.push(`${t.workerName ?? "직원"} · ${w ? STATUS_LABEL[w.status] ?? w.status : 'gone'}`);
      if (t.branch) meta.push(`🌿 ${t.branch}`);
      if (t.startedAt) meta.push(`시작: ${timeAgo(t.startedAt)}`);
      meta.push(`${t.addedBy}`);
      if (w) {
        buttons.push(h('button.btn', { type: 'button', onclick: () => actions.openTerminal(w.id) }, "🖥️ 터미널"));
        buttons.push(
          h('button.btn', {
            type: 'button',
            title: "직원을 퇴근시키고 작업을 중단 상태로 표시합니다",
            onclick: () => confirmDialog(`${w.name}을(를) 중단할까요?`, `${w.name}을(를) 퇴근시키고 작업을 중단합니다. 나중에 대기열에 다시 넣을 수 있습니다.`, "중단", () => net.send({ t: 'worker.kill', workerId: w.id })),
          }, "⏹ 중단"),
        );
      }
    } else if (t.status === 'queued') {
      const queued = store.queue.tasks.filter((x) => x.status === 'queued');
      const i = queued.indexOf(t);
      pos = String(i + 1);
      meta.push(`⚙️ ${providerLabel(t.provider, store.project)}${model}${usageSuffix(t.provider, w?.usage)}`);
      meta.push(`추가: ${t.addedBy} ${timeAgo(t.addedAt)}`);
      buttons.push(h('button.btn', { type: 'button', title: "위로 이동", 'aria-label': "위로 이동", disabled: i === 0, onclick: () => net.send({ t: 'queue.move', taskId: t.id, delta: -1 }) }, '↑'));
      buttons.push(h('button.btn', { type: 'button', title: "아래로 이동", 'aria-label': "아래로 이동", disabled: i === queued.length - 1, onclick: () => net.send({ t: 'queue.move', taskId: t.id, delta: 1 }) }, '↓'));
      buttons.push(h('button.btn', { type: 'button', title: "대기열에서 제거", 'aria-label': "제거", onclick: () => net.send({ t: 'queue.remove', taskId: t.id }) }, '✕'));
    } else {
      meta.push(`⚙️ ${providerLabel(t.provider, store.project)}${model}${usageSuffix(t.provider, w?.usage)}`);
      meta.push(outcome(t));
      if (t.workerName) meta.push(t.workerName);
      if (t.branch) meta.push(`🌿 ${t.branch}`);
      if (t.finishedAt) meta.push(timeAgo(t.finishedAt));
      if (t.pr) buttons.push(h('a.btn', { href: t.pr.url, target: '_blank', rel: 'noopener', title: t.pr.title }, `🔀 PR #${t.pr.number}${t.pr.state === 'MERGED' ? ' ✓' : t.pr.state === 'DRAFT' ? " (초안)" : ''}`));
      if (w) buttons.push(h('button.btn', { type: 'button', onclick: () => actions.openTerminal(w.id) }, "🖥️ 터미널"));
      buttons.push(h('button.btn', { type: 'button', title: "대기열에 다시 추가", onclick: () => net.send({ t: 'queue.retry', taskId: t.id }) }, "↻ 다시 대기"));
      buttons.push(h('button.btn', { type: 'button', title: "목록에서 제거", 'aria-label': "제거", onclick: () => net.send({ t: 'queue.remove', taskId: t.id }) }, '✕'));
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
    limitValue.textContent = q.maxWorkers === 0 ? "일시 중지" : String(q.maxWorkers);
    minus.toggleAttribute('disabled', q.maxWorkers <= 0);
    const running = q.tasks.filter((t) => t.status === 'running');
    const queued = q.tasks.filter((t) => t.status === 'queued');
    const done = q.tasks.filter((t) => t.status === 'done').slice().reverse();
    const m = store.machine;
    const parts: (HTMLElement | null)[] = [
      h(
        'p.note',
        {},
        "또는 📌 이슈 게시판에서 원하는 이슈의 ",
        h('b', {}, "대기열에 추가"),
        " 버튼을 누르세요. 빈 책상이 있고 실행 중인 작업 수가 ",
        h('b', {}, q.maxWorkers === 0 ? '0' : String(q.maxWorkers)),
        "보다 적으면 다음 작업을 맡을 직원을 별도 Git worktree에서 시작합니다. 직접 고용한 직원은 이 인원에 포함하지 않습니다. 시작할 때 GitHub 이슈를 할당하고, PR이 생성되면 연결합니다.",
      ),
      queued.length && officeFull(m)
        ? h('p.note', {}, `⏸ 동시 작업 한도 ${m.limit}명에 도달했습니다. 직원이 퇴근하면 다음 작업을 시작합니다. 대기열 작업을 마친 직원은 자동 퇴근해 자리를 비웁니다.`)
        : null,
      section("🤖 작업 중", running),
      section("⏳ 다음 작업", queued),
      section("✅ 완료", done, h('button.btn', { type: 'button', onclick: () => net.send({ t: 'queue.clear' }) }, "초기화")),
      running.length + queued.length + done.length ? null : h('div.queue-empty', {}, "대기 중인 작업이 없습니다."),
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
    doing: "📥 작업 대기열을 보는 중",
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
  setTimeout(() => ta.focus(), 30);
}
