import { DESK_BY_ID } from '../../shared/layout';
import type { AgentEffort, AgentProvider, GhIssue, GhLabel, GhPull, WorkerInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { store, words, workerForPull } from '../state';
import { h, openModal, timeAgo } from './dom';
import { labelChip, openIssue, openLabels, openPull } from './pull';
import { providerLabel } from './provider';
import type { MeetingPreset } from './meeting';
import { renderJiraBoard } from './jira';

export interface BoardActions {
  /** Start a worker on a ready-made prompt (shown for editing first). */
  assign(prompt: string, title: string): void;
  /** Your own prompt about an issue or PR; `context` goes first so the worker knows which. */
  ask(context: string, title: string): void;
  /** Walks you to the desk a pull request came from. */
  goToDesk(deskId: string): void;
  /** Put an issue on the 📋 task queue; a worker is seated for it when there's room. */
  queue(prompt: string, title: string, issue: number, provider?: AgentProvider, model?: string, effort?: AgentEffort): void;
  /** Take the issue's card off the board, to carry to a desk or the queue. */
  pickUp(issue: GhIssue): void;
  /** Call a meeting about it: the meeting room's form, filled in. */
  meeting(preset: MeetingPreset): void;
}

/** The task a worker gets for an issue, from the board, a carried card or the queue. */
export function issuePrompt(it: Pick<GhIssue, 'number' | 'title'>): string {
  if (words().cli === 'glab') {
    return `Work on GitLab issue #${it.number}: "${it.title}".\n\nRead it first with \`glab issue view ${it.number} --comments\`. Create a new branch, implement the change, verify it, then open a merge request with \`glab mr create\` whose description says "Closes #${it.number}".`;
  }
  return `Work on GitHub issue #${it.number}: "${it.title}".\n\nRead it first with \`gh issue view ${it.number} --comments\`. Create a new branch, implement the change, verify it, then open a pull request that closes #${it.number}.`;
}

interface Column<T> {
  title: string;
  items: T[];
}

function issueColumns(items: GhIssue[]): Column<GhIssue>[] {
  const open = items.filter((i) => i.state === 'OPEN');
  const inProgress = open.filter((i) => i.assignees.length > 0 || i.labels.some((l) => /progress|doing|wip|started/i.test(l.name)) || store.taskForIssue(i.number)?.status === 'running');
  const todo = open.filter((i) => !inProgress.includes(i));
  const closed = items
    .filter((i) => i.state !== 'OPEN')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 40);
  return [
    { title: 'Open', items: todo },
    { title: 'In progress', items: inProgress },
    { title: 'Closed', items: closed },
  ];
}

function pullColumns(items: GhPull[]): Column<GhPull>[] {
  const open = items.filter((p) => p.state === 'OPEN');
  return [
    { title: 'Draft', items: open.filter((p) => p.isDraft) },
    { title: 'In review', items: open.filter((p) => !p.isDraft && p.reviewDecision !== 'APPROVED') },
    { title: 'Approved', items: open.filter((p) => !p.isDraft && p.reviewDecision === 'APPROVED') },
    {
      title: 'Merged',
      items: items
        .filter((p) => p.state === 'MERGED')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 30),
    },
    {
      title: 'Closed',
      items: items
        .filter((p) => p.state === 'CLOSED')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 20),
    },
  ];
}

function labelChips(labels: GhLabel[]) {
  return labels.slice(0, 4).map(labelChip);
}

const CHECK_ICON: Record<GhPull['checks'], string> = { pass: '🟢', fail: '🔴', pending: '🟡', none: '' };

/** A chip naming a worker and desk, color-coded to match the worker back on the floor. */
function workerChip(w: WorkerInfo, title: string) {
  return h('span.desk-link', { style: `--dot:${w.color}`, title }, `🪑 ${w.name} · ${DESK_BY_ID.get(w.deskId)?.label ?? 'a desk'}`);
}

/** A chip naming the worker and desk a pull request came from. */
function deskChip(w: WorkerInfo) {
  return workerChip(w, `Opened from ${w.name}'s desk (${w.worktree?.branch ?? 'its branch'})`);
}

/** Where an issue stands on the 📋 queue, for its card. */
function queueChip(issue: number): Node | '' {
  const t = store.taskForIssue(issue);
  if (!t) return '';
  const provider = providerLabel(t.provider, store.project);
  if (t.status === 'queued') return h('span.qchip', {}, `${store.queue.tasks.find((x) => x.status === 'queued') === t ? '📋 up next' : '📋 queued'} · ${provider}`);
  if (t.status === 'running') {
    const w = t.workerId ? store.workers.get(t.workerId) : undefined;
    if (w) return workerChip(w, `${w.name} is working on this at ${DESK_BY_ID.get(w.deskId)?.label ?? 'a desk'} · ${provider}`);
    return h('span.qchip.running', {}, `🤖 ${t.workerName ?? 'a worker'} · ${provider}`);
  }
  return t.pr ? h('span.qchip.done', {}, `🔀 ${words().pr} ${words().ref(t.pr.number)} · ${provider}`) : '';
}

function card(ref: string, title: string, meta: (Node | string)[], onclick: () => void, onLabels: () => void) {
  return h(
    'li.card',
    { tabindex: 0, onclick, onkeydown: ((e: KeyboardEvent) => e.key === 'Enter' && e.target === e.currentTarget && onclick()) as EventListener },
    h('button.card-labels', { type: 'button', title: 'Change the labels', 'aria-label': `Change the labels on ${ref}`, onclick: ((e: Event) => (e.stopPropagation(), onLabels())) as EventListener }, 'Labels'),
    h('div.num', {}, ref),
    h('div.ttl', {}, title),
    h('div.meta', {}, ...meta.filter((m) => m !== '').map((m) => (typeof m === 'string' ? h('span', {}, m) : m))),
  );
}

/** `startTab` is the tab the issues board opens on: the one the wall board is showing. */
export function openBoard(kind: 'issues' | 'pulls', net: Net, actions: BoardActions, startTab: 'issues' | 'jira' = 'issues') {
  const body = h('div.body');
  const status = h('span.board-status');
  /** On the issues board of a floor with a Jira epic: which tab is showing. */
  let tab: 'issues' | 'jira' = kind === 'issues' ? startTab : 'issues';
  const onJira = () => kind === 'issues' && tab === 'jira' && !!store.jiraBoard;
  const refresh = h('button.btn', { onclick: () => net.send(onJira() ? { t: 'jira.refresh' } : { t: 'gh.refresh' }) }, 'Refresh');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const pulls = words().cli === 'glab' ? 'Merge requests' : 'Pull requests';
  const tabIssues = h('button.gh-tab', { type: 'button', role: 'tab' }, 'Issues');
  const tabJira = h('button.gh-tab', { type: 'button', role: 'tab' });
  const tabs = h('nav.gh-tabs.board-tabs', { role: 'tablist' }, tabIssues, tabJira);
  const el = h('div.modal.board', { role: 'dialog', 'aria-label': kind === 'issues' ? 'Issues board' : `${pulls} board` }, h('header', {}, h('h2', {}, kind === 'issues' ? 'Issues' : pulls), status, refresh, close), tabs, body);
  const setTab = (t: typeof tab) => {
    if (t === tab) return;
    tab = t;
    body.replaceChildren();
    render();
  };
  tabIssues.addEventListener('click', () => setTab('issues'));
  tabJira.addEventListener('click', () => setTab('jira'));

  const statusText = () => {
    const st = onJira() ? store.jiraBoard! : kind === 'issues' ? store.issues : store.pulls;
    status.textContent = st.loading ? 'Refreshing…' : st.fetchedAt ? `Updated ${timeAgo(st.fetchedAt)}` : '';
  };
  const render = () => {
    // Floors without a Jira epic have no tabs at all, just as before.
    const jira = kind === 'issues' ? store.jiraBoard : null;
    if (!jira && tab === 'jira') tab = 'issues';
    tabs.classList.toggle('hidden', !jira);
    tabIssues.classList.toggle('on', tab === 'issues');
    tabJira.classList.toggle('on', tab === 'jira');
    tabIssues.setAttribute('aria-selected', String(tab === 'issues'));
    tabJira.setAttribute('aria-selected', String(tab === 'jira'));
    tabIssues.textContent = `${words().site} issues`;
    tabJira.textContent = jira ? `Jira · ${jira.epic}` : 'Jira';
    refresh.title = onJira() ? 'Refresh from Jira' : `Refresh from ${words().site}`;
    statusText();
    if (onJira()) {
      const { scrollLeft } = body;
      renderJiraBoard(body, actions);
      body.scrollLeft = scrollLeft;
      return;
    }
    const st = kind === 'issues' ? store.issues : store.pulls;
    // Every refresh rebuilds the columns, so note how far each was scrolled and put it back afterwards.
    const scrolled = [...body.querySelectorAll('.column > ul')].map((ul) => ul.scrollTop);
    const { scrollLeft, scrollTop } = body;
    body.replaceChildren();
    if (st.error && !st.items.length) {
      const w = words();
      body.append(h('div.board-error', {}, `Couldn't load from ${w.site}: ${st.error}`, h('br'), h('small', {}, `The server runs \`${w.cli}\` in the project directory — make sure it is installed and authenticated (${w.cli} auth login).`)));
      return;
    }
    if (kind === 'issues') {
      for (const col of issueColumns(store.issues.items)) {
        const ul = h('ul');
        col.items.forEach((it) =>
          ul.append(
            card(
              `#${it.number}`,
              it.title,
              [...labelChips(it.labels), queueChip(it.number), it.assignees.length ? `👤 ${it.assignees.join(', ')}` : `by ${it.author}`, it.comments ? `💬 ${it.comments}` : '', timeAgo(it.updatedAt)],
              () => openIssue(it, net, actions),
              () => openLabels('issue', it, net),
            ),
          ),
        );
        if (!col.items.length) ul.append(h('li.empty', {}, 'Nothing here'));
        body.append(h('section.column', {}, h('h4', {}, col.title, h('span', {}, String(col.items.length))), ul));
      }
    } else {
      for (const col of pullColumns(store.pulls.items)) {
        const ul = h('ul');
        col.items.forEach((it) => {
          const w = workerForPull(store.workers.values(), it);
          ul.append(
            card(
              words().ref(it.number),
              it.title,
              [
                w ? deskChip(w) : '',
                ...labelChips(it.labels),
                `by ${it.author}`,
                it.reviewDecision === 'CHANGES_REQUESTED' ? '🛠 changes requested' : '',
                CHECK_ICON[it.checks],
                h('span', { style: 'color:var(--success)' }, `+${it.additions}`),
                h('span', { style: 'color:var(--danger)' }, `-${it.deletions}`),
                timeAgo(it.updatedAt),
              ],
              () => openPull(it, net, actions),
              () => openLabels('pull', it, net),
            ),
          );
        });
        if (!col.items.length) ul.append(h('li.empty', {}, 'Nothing here'));
        body.append(h('section.column', {}, h('h4', {}, col.title, h('span', {}, String(col.items.length))), ul));
      }
    }
    body.querySelectorAll('.column > ul').forEach((ul, i) => (ul.scrollTop = scrolled[i] ?? 0));
    body.scrollLeft = scrollLeft;
    body.scrollTop = scrollTop;
  };

  const unsubs = [store.on(kind, render), store.on('queue', render)];
  if (kind === 'issues') unsubs.push(store.on('jiraBoard', render));
  // Which desk a PR came from can change (a worker sent home, a PR opened from a desk).
  if (kind === 'pulls') unsubs.push(store.on('workers', render));
  const timer = setInterval(statusText, 15000);
  const modal = openModal(el, {
    doing: kind === 'issues' ? '📋 at the issues board' : `🔀 at the ${words().pr} board`,
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(timer);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
}
