import { DESK_BY_ID } from '../../shared/layout';
import type { AgentProvider, GhIssue, GhIssuesState, GhPull, WorkerInfo } from '../../shared/protocol';
import { MAX_ISSUE_REPOSITORIES, normalizeIssueRepository, sameRepository } from '../../shared/issue-repositories';
import type { Net } from '../net';
import { issueRepositoryLabel, projectRepository, store, visibleIssues, type IssueRepositoryFilter, workerForPull } from '../state';
import { h, openModal, timeAgo, toast } from './dom';
import { labelChip, openIssue, openPull } from './pull';
import { providerLabel } from './provider';

export interface BoardActions {
  /** Start a worker on a ready-made prompt (shown for editing first). */
  assign(prompt: string, title: string, repository?: string): void;
  /** Your own prompt about an issue or PR; `context` goes first so the worker knows which. */
  ask(context: string, title: string, repository?: string): void;
  /** Walks you to the desk a pull request came from. */
  goToDesk(deskId: string): void;
  /** Put an issue on the 📋 task queue; a worker is seated for it when there's room. */
  queue(prompt: string, title: string, issue: number, provider?: AgentProvider, model?: string, issueRepository?: string): void;
}

/** The task a worker gets for an issue, from the board or the queue. */
export function issuePrompt(it: GhIssue): string {
  const repo = it.repository ? ` in ${it.repository}` : '';
  const flag = it.repository ? ` --repo ${it.repository}` : '';
  return `Work on GitHub issue #${it.number}${repo}: "${it.title}".\n\nRead it first with \`gh issue view ${it.number} --comments${flag}\`. Create a new branch, implement the change, verify it, then open a pull request that closes #${it.number}.`;
}

const TILTS = ['-1.2deg', '0.8deg', '-0.4deg', '1.4deg', '0deg', '-0.9deg'];
const NOTE_COLORS = ['#fff7b0', '#ffd6e0', '#caffbf', '#bde0fe', '#ffe5b4'];

interface Column<T> {
  title: string;
  items: T[];
}

function issueColumns(items: GhIssue[]): Column<GhIssue>[] {
  const open = items.filter((i) => i.state === 'OPEN');
  const inProgress = open.filter((i) => i.assignees.length > 0 || i.labels.some((l) => /progress|doing|wip|started/i.test(l.name)) || store.taskForIssue(i.number, i.repository)?.status === 'running');
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
  return labels.slice(0, 4).map(labelChip);
}

const CHECK_ICON: Record<GhPull['checks'], string> = { pass: '🟢', fail: '🔴', pending: '🟡', none: '' };

/** A chip naming the worker and desk a pull request came from. */
function deskChip(w: WorkerInfo) {
  return h('span.desk-link', { style: `--dot:${w.color}`, title: `Opened from ${w.name}'s desk (${w.worktree?.branch ?? 'its branch'})` }, `🪑 ${w.name} · ${DESK_BY_ID.get(w.deskId)?.label ?? 'a desk'}`);
}

/** Where an issue stands on the 📋 queue, for its card. */
function queueChip(issue: number, repository?: string): Node | '' {
  const t = store.taskForIssue(issue, repository);
  if (!t) return '';
  const provider = ` · ${providerLabel(t.provider, store.project)}`;
  if (t.status === 'queued') return h('span.qchip', {}, `${store.queue.tasks.find((x) => x.status === 'queued') === t ? '📋 up next' : '📋 queued'}${provider}`);
  if (t.status === 'running') return h('span.qchip.running', {}, `🤖 ${t.workerName ?? 'a worker'}${provider}`);
  return t.pr ? h('span.qchip.done', {}, `🔀 PR #${t.pr.number}${provider}`) : '';
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
  const repoError = h('span.board-status-error');
  const refresh = h('button.btn', { title: 'Refresh from GitHub', onclick: () => net.send({ t: 'gh.refresh' }) }, '🔄 Refresh');
  let repoFilter: IssueRepositoryFilter = 'all';
  let repoPanelOpen = false;
  let pendingRepository = '';
  let lastConfigurationError = '';
  const repoToggle = h('button.btn', { type: 'button', title: 'Configure tracked issue repositories' }, '🗂 Repositories');
  const repoPanel = h('div.board-repos');
  repoPanel.classList.toggle('hidden', kind !== 'issues');
  const columns = h('div.board-columns');
  const repoInput = h('input', { type: 'text', placeholder: 'owner/repo', 'aria-label': 'Repository to track' }) as HTMLInputElement;
  const repoAdd = h('button.btn', { type: 'button' }, 'Add');
  const repoFilterSelect = h('select', { 'aria-label': 'Issue repository filter' }) as HTMLSelectElement;
  body.append(repoPanel, columns);
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h('div.modal.board', { role: 'dialog', 'aria-label': kind === 'issues' ? 'Issues board' : 'Pull requests board' }, h('header', {}, h('h2', {}, kind === 'issues' ? '📌 Issues' : '🔀 Pull Requests'), status, repoError, kind === 'issues' ? repoToggle : null, refresh, close), body);

  repoToggle.addEventListener('click', () => {
    repoPanelOpen = !repoPanelOpen;
    repoPanel.classList.toggle('hidden', !repoPanelOpen);
  });

  const issueState = () => store.issues as GhIssuesState;
  const submitRepository = () => {
    const value = normalizeIssueRepository(repoInput.value);
    if (!value) {
      repoInput.setCustomValidity('Use a GitHub repository in owner/repo form.');
      repoInput.reportValidity();
      return;
    }
    const configured = stRepositories(issueState());
    const current = issueState().currentRepository ?? projectRepository(store.project);
    const additional = configured.filter((name) => !sameRepository(name, current));
    if (additional.length >= MAX_ISSUE_REPOSITORIES && !sameRepository(value, current) && !additional.some((name) => sameRepository(name, value))) {
      repoInput.setCustomValidity(`Track up to ${MAX_ISSUE_REPOSITORIES} repositories.`);
      repoInput.reportValidity();
      return;
    }
    repoInput.setCustomValidity('');
    pendingRepository = value;
    net.send({ t: 'gh.issues.repo.add', repository: value });
  };
  repoAdd.addEventListener('click', submitRepository);
  repoInput.addEventListener('keydown', (e) => e.key === 'Enter' && submitRepository());
  repoFilterSelect.addEventListener('change', () => {
    repoFilter = repoFilterSelect.value as IssueRepositoryFilter;
    render();
  });
  const stRepositories = (st: GhIssuesState): string[] => [...new Set([st.currentRepository ?? projectRepository(store.project), ...(st.repositories ?? []).map((r) => r.name)].filter((x): x is string => !!x))];
  const renderRepositories = (st: GhIssuesState) => {
    if (kind !== 'issues') return;
    const current = st.currentRepository ?? projectRepository(store.project);
    const names = [...new Set([current, ...(st.repositories ?? []).map((r) => r.name), ...st.items.map((i) => i.repository)].filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b));
    if (pendingRepository && names.some((name) => sameRepository(name, pendingRepository))) {
      pendingRepository = '';
      repoInput.value = '';
    }
    const oldValue = repoFilterSelect.value;
    repoFilterSelect.replaceChildren(h('option', { value: 'all' }, 'All repositories'));
    names.forEach((name) => repoFilterSelect.append(h('option', { value: name }, name === current ? `${name} · current` : name)));
    repoFilterSelect.value = names.some((name) => sameRepository(name, repoFilter)) ? repoFilter : oldValue && names.some((name) => sameRepository(name, oldValue)) ? oldValue : 'all';
    repoFilter = repoFilterSelect.value as IssueRepositoryFilter;
    const list = h('div.board-repo-list', {}, ...names.map((name) => {
      const info = (st.repositories ?? []).find((r) => sameRepository(r.name, name));
      const isCurrent = sameRepository(name, current);
      const remove = h('button.btn', { type: 'button', disabled: isCurrent, title: isCurrent ? 'The office repository is always tracked' : `Stop tracking ${name}` }, 'Remove');
      if (!isCurrent) remove.addEventListener('click', () => net.send({ t: 'gh.issues.repo.remove', repository: name }));
      return h('div.board-repo-row', {}, h('span', {}, isCurrent ? `📁 ${name} · current` : `📦 ${name}`, info?.error ? h('small', {}, `⚠️ ${info.error}`) : ''), remove);
    }));
    const wasFocused = document.activeElement === repoInput;
    const selection = wasFocused ? [repoInput.selectionStart, repoInput.selectionEnd] : [null, null];
    repoPanel.replaceChildren(h('div.board-repo-controls', {}, repoFilterSelect, h('span.grow'), repoInput, repoAdd), ...(st.configurationError ? [h('p.board-repo-error', {}, st.configurationError)] : []), h('p.board-repo-note', {}, 'Each repository can use its own mapped checkout when you start work.'), list);
    if (wasFocused) {
      repoInput.focus();
      if (selection[0] !== null && selection[1] !== null) repoInput.setSelectionRange(selection[0], selection[1]);
    }
    repoPanel.classList.toggle('hidden', !repoPanelOpen);
    if (st.configurationError && st.configurationError !== lastConfigurationError) {
      lastConfigurationError = st.configurationError;
      toast(st.configurationError, 'warn');
    }
  };

  const render = () => {
    const st = kind === 'issues' ? store.issues : store.pulls;
    status.textContent = st.loading ? 'Refreshing…' : st.fetchedAt ? `Updated ${timeAgo(st.fetchedAt)}` : '';
    const issueSt = issueState();
    const repoErrors = (issueSt.repositories ?? []).filter((r) => r.error).map((r) => `${r.name}: ${r.error}`);
    repoError.textContent = kind === 'issues' && (issueSt.configurationError || repoErrors.length) ? `⚠️ ${issueSt.configurationError ?? repoErrors[0]}` : '';
    repoError.title = [issueSt.configurationError, ...repoErrors].filter(Boolean).join('\n');
    columns.replaceChildren();
    renderRepositories(issueSt);
    if (st.error && !st.items.length) {
      columns.replaceChildren(h('div.board-error', {}, `Couldn't load from GitHub: ${st.error}`, h('br'), h('small', {}, 'The server runs `gh` in the project directory — make sure it is installed and authenticated (gh auth login).')));
      return;
    }
    if (kind === 'issues') {
      const currentRepo = issueState().currentRepository ?? projectRepository(store.project);
      if (repoFilter !== 'all' && ![currentRepo, ...(issueState().repositories ?? []).map((r) => r.name)].some((name) => name && sameRepository(name, repoFilter))) {
        repoFilter = 'all';
        repoFilterSelect.value = 'all';
      }
      const filtered = visibleIssues(store.issues.items, repoFilter);
      const sections: HTMLElement[] = [];
      for (const col of issueColumns(filtered)) {
        const ul = h('ul');
        col.items.forEach((it, i) =>
          ul.append(
            card(it.number, it.title, [h('span.repo-chip', {}, issueRepositoryLabel(it)), ...labelChips(it.labels), queueChip(it.number, it.repository), it.assignees.length ? `👤 ${it.assignees.join(', ')}` : `by ${it.author}`, it.comments ? `💬 ${it.comments}` : '', timeAgo(it.updatedAt)], i, () => openIssue(it, actions)),
          ),
        );
        if (!col.items.length) ul.append(h('li.empty', {}, 'Nothing here'));
        sections.push(h('section.column', {}, h('h4', {}, col.title, h('span', {}, String(col.items.length))), ul));
      }
      columns.replaceChildren(...sections);
    } else {
      for (const col of pullColumns(store.pulls.items)) {
        const ul = h('ul');
        col.items.forEach((it, i) => {
          const w = workerForPull(store.workers.values(), it, store.issues.currentRepository ?? projectRepository(store.project));
          ul.append(
            card(
              it.number,
              it.title,
              [
                w ? deskChip(w) : '',
                ...labelChips(it.labels),
                `by ${it.author}`,
                it.reviewDecision === 'CHANGES_REQUESTED' ? '🛠 changes requested' : '',
                CHECK_ICON[it.checks],
                h('span', { style: 'color:#2a9d4b' }, `+${it.additions}`),
                h('span', { style: 'color:#c3423f' }, `-${it.deletions}`),
                timeAgo(it.updatedAt),
              ],
              i,
              () => openPull(it, net, actions),
            ),
          );
        });
        if (!col.items.length) ul.append(h('li.empty', {}, 'Nothing here'));
        columns.append(h('section.column', {}, h('h4', {}, col.title, h('span', {}, String(col.items.length))), ul));
      }
    }
  };

  const unsubs = [store.on(kind, render), store.on('queue', render)];
  // Which desk a PR came from can change (a worker sent home, a PR opened from a desk).
  if (kind === 'pulls') unsubs.push(store.on('workers', render));
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
