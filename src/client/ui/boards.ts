import type { GhIssue, GhPull } from '../../shared/protocol';
import type { Net } from '../net';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';

export interface BoardActions {
  assign(prompt: string, title: string): void;
  /** Put an issue on the 📋 task queue; a worker is seated for it when there's room. */
  queue(prompt: string, title: string, issue: number): void;
}

/** The task a worker gets for an issue, from the board or the queue. */
export function issuePrompt(it: GhIssue): string {
  return `Work on GitHub issue #${it.number}: "${it.title}".\n\nRead it first with \`gh issue view ${it.number} --comments\`. Create a new branch, implement the change, verify it, then open a pull request that closes #${it.number}.`;
}

const TILTS = ['-1.2deg', '0.8deg', '-0.4deg', '1.4deg', '0deg', '-0.9deg'];
const NOTE_COLORS = ['#fff7b0', '#ffd6e0', '#caffbf', '#bde0fe', '#ffe5b4'];

interface Column<T> {
  title: string;
  items: T[];
}

function issueColumns(items: GhIssue[]): Column<GhIssue>[] {
  const open = items.filter((i) => i.state === 'OPEN');
  const inProgress = open.filter((i) => i.assignees.length > 0 || i.labels.some((l) => /progress|doing|wip|started/i.test(l.name)) || store.taskForIssue(i.number)?.status === 'running');
  const todo = open.filter((i) => !inProgress.includes(i));
  const closed = items.filter((i) => i.state !== 'OPEN').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 40);
  return [
    { title: '📥 Open', items: todo },
    { title: '🚧 In progress', items: inProgress },
    { title: '✅ Closed', items: closed },
  ];
}

function pullColumns(items: GhPull[]): Column<GhPull>[] {
  const open = items.filter((p) => p.state === 'OPEN');
  return [
    { title: '✏️ Draft', items: open.filter((p) => p.isDraft) },
    { title: '👀 In review', items: open.filter((p) => !p.isDraft && p.reviewDecision !== 'APPROVED') },
    { title: '👍 Approved', items: open.filter((p) => !p.isDraft && p.reviewDecision === 'APPROVED') },
    { title: '🎉 Merged', items: items.filter((p) => p.state === 'MERGED').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 30) },
    { title: '🗑️ Closed', items: items.filter((p) => p.state === 'CLOSED').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20) },
  ];
}

function labelChips(labels: { name: string; color: string }[]) {
  return labels.slice(0, 4).map((l) => h('span.label', { style: `background:${l.color}` }, l.name));
}

const CHECK_ICON: Record<GhPull['checks'], string> = { pass: '🟢', fail: '🔴', pending: '🟡', none: '' };

/** Where an issue stands on the 📋 queue, for its card. */
function queueChip(issue: number): Node | '' {
  const t = store.taskForIssue(issue);
  if (!t) return '';
  if (t.status === 'queued') return h('span.qchip', {}, store.queue.tasks.find((x) => x.status === 'queued') === t ? '📋 up next' : '📋 queued');
  if (t.status === 'running') return h('span.qchip.running', {}, `🤖 ${t.workerName ?? 'a worker'}`);
  return t.pr ? h('span.qchip.done', {}, `🔀 PR #${t.pr.number}`) : '';
}

function card(n: number, title: string, meta: (Node | string)[], i: number, onclick: () => void) {
  return h(
    'li.card',
    { style: `--tilt:${TILTS[n % TILTS.length]};background:${NOTE_COLORS[n % NOTE_COLORS.length]};--pin:${['#ef476f', '#118ab2', '#06d6a0', '#ffd166'][i % 4]}`, tabindex: 0, onclick, onkeydown: ((e: KeyboardEvent) => e.key === 'Enter' && onclick()) as EventListener },
    h('div.num', {}, `#${n}`),
    h('div.ttl', {}, title),
    h('div.meta', {}, ...meta.filter((m) => m !== '').map((m) => (typeof m === 'string' ? h('span', {}, m) : m))),
  );
}

export function openBoard(kind: 'issues' | 'pulls', net: Net, actions: BoardActions) {
  const body = h('div.body');
  const status = h('span.board-status');
  const refresh = h('button.btn', { title: 'Refresh from GitHub', onclick: () => net.send({ t: 'gh.refresh' }) }, '🔄 Refresh');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h('div.modal.board', { role: 'dialog', 'aria-label': kind === 'issues' ? 'Issues board' : 'Pull requests board' }, h('header', {}, h('h2', {}, kind === 'issues' ? '📌 Issues' : '🔀 Pull Requests'), status, refresh, close), body);

  const render = () => {
    const st = kind === 'issues' ? store.issues : store.pulls;
    status.textContent = st.loading ? 'Refreshing…' : st.fetchedAt ? `Updated ${timeAgo(st.fetchedAt)}` : '';
    body.replaceChildren();
    if (st.error && !st.items.length) {
      body.append(h('div.board-error', {}, `Couldn't load from GitHub: ${st.error}`, h('br'), h('small', {}, 'The server runs `gh` in the project directory — make sure it is installed and authenticated (gh auth login).')));
      return;
    }
    if (kind === 'issues') {
      for (const col of issueColumns(store.issues.items)) {
        const ul = h('ul');
        col.items.forEach((it, i) =>
          ul.append(
            card(it.number, it.title, [...labelChips(it.labels), queueChip(it.number), it.assignees.length ? `👤 ${it.assignees.join(', ')}` : `by ${it.author}`, it.comments ? `💬 ${it.comments}` : '', timeAgo(it.updatedAt)], i, () => issueDetail(it, actions)),
          ),
        );
        if (!col.items.length) ul.append(h('li.empty', {}, 'Nothing here'));
        body.append(h('section.column', {}, h('h4', {}, col.title, h('span', {}, String(col.items.length))), ul));
      }
    } else {
      for (const col of pullColumns(store.pulls.items)) {
        const ul = h('ul');
        col.items.forEach((it, i) =>
          ul.append(
            card(
              it.number,
              it.title,
              [
                ...labelChips(it.labels),
                `by ${it.author}`,
                it.reviewDecision === 'CHANGES_REQUESTED' ? '🛠 changes requested' : '',
                CHECK_ICON[it.checks],
                h('span', { style: 'color:#2a9d4b' }, `+${it.additions}`),
                h('span', { style: 'color:#c3423f' }, `-${it.deletions}`),
                timeAgo(it.updatedAt),
              ],
              i,
              () => pullDetail(it, actions),
            ),
          ),
        );
        if (!col.items.length) ul.append(h('li.empty', {}, 'Nothing here'));
        body.append(h('section.column', {}, h('h4', {}, col.title, h('span', {}, String(col.items.length))), ul));
      }
    }
  };

  const unsubs = [store.on(kind, render), store.on('queue', render)];
  const timer = setInterval(() => {
    const st = kind === 'issues' ? store.issues : store.pulls;
    status.textContent = st.loading ? 'Refreshing…' : st.fetchedAt ? `Updated ${timeAgo(st.fetchedAt)}` : '';
  }, 15000);
  const modal = openModal(el, {
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(timer);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
}

function detailModal(title: string, rows: (Node | string)[], bodyText: string, url: string, buttons: HTMLElement[]) {
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal.detail',
    { role: 'dialog', 'aria-label': title, style: 'width:min(720px,100%)' },
    h('header', {}, h('h2', {}, title), close),
    h('div.body', {}, h('div.row', {}, ...rows.filter((r) => r !== '').map((r) => (typeof r === 'string' ? h('span', {}, r) : r))), bodyText.trim() ? h('pre', {}, bodyText) : h('p.empty', {}, 'No description.')),
    h('footer', {}, h('a', { href: url, target: '_blank', rel: 'noopener', class: 'grow' }, 'Open on GitHub ↗'), ...buttons),
  );
  const modal = openModal(el);
  close.addEventListener('click', () => modal.close());
  return modal;
}

function issueDetail(it: GhIssue, actions: BoardActions) {
  const assign = h('button.btn.primary', {}, '🤖 Hand to a worker');
  const task = store.taskForIssue(it.number);
  const onQueue = !!task && task.status !== 'done';
  const queue = h(
    'button.btn',
    { disabled: onQueue, title: onQueue ? undefined : 'A worker picks it up by itself when a desk is free and there is room under the worker limit' },
    onQueue ? (task!.status === 'running' ? `🤖 ${task!.workerName ?? 'A worker'} is on it` : '📋 On the queue') : '📋 Add to queue',
  );
  const modal = detailModal(
    `#${it.number} ${it.title}`,
    [h('span.pill', { class: it.state === 'OPEN' ? 'done' : 'offline' }, it.state.toLowerCase()), ...labelChips(it.labels), `opened by ${it.author} ${timeAgo(it.createdAt)}`, it.assignees.length ? `· 👤 ${it.assignees.join(', ')}` : ''],
    it.body,
    it.url,
    it.state === 'OPEN' ? [queue, assign] : [assign],
  );
  queue.addEventListener('click', () => {
    modal.close();
    actions.queue(issuePrompt(it), `#${it.number} ${it.title}`, it.number);
  });
  assign.addEventListener('click', () => {
    modal.close();
    actions.assign(issuePrompt(it), `Hand issue #${it.number} to a worker`);
  });
}

function pullDetail(it: GhPull, actions: BoardActions) {
  const review = h('button.btn.primary', {}, '🔍 Review with a worker');
  const modal = detailModal(
    `#${it.number} ${it.title}`,
    [
      h('span.pill', { class: it.state === 'OPEN' ? (it.isDraft ? 'idle' : 'working') : it.state === 'MERGED' ? 'done' : 'offline' }, it.isDraft ? 'draft' : it.state.toLowerCase()),
      ...labelChips(it.labels),
      `${it.headRefName} → ${it.baseRefName}`,
      `by ${it.author}`,
      `+${it.additions} −${it.deletions}`,
      it.checks !== 'none' ? `checks ${CHECK_ICON[it.checks]}` : '',
      it.reviewDecision ? it.reviewDecision.toLowerCase().replace('_', ' ') : '',
    ],
    it.body,
    it.url,
    it.state === 'OPEN' ? [review] : [],
  );
  review.addEventListener('click', () => {
    modal.close();
    actions.assign(
      `Review pull request #${it.number}: "${it.title}".\n\nUse \`gh pr view ${it.number} --comments\` and \`gh pr diff ${it.number}\`. Look for bugs, risky changes and missing tests, then give me a short summary with concrete suggestions. Don't push any commits.`,
      `Review PR #${it.number} with a worker`,
    );
  });
}
