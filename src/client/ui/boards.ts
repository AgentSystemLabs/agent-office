import type { AgentEffort, AgentProvider, GhIssue, GhLabel, GhPull, WorkerInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { store, workerForPull } from '../state';
import { h, openModal, timeAgo } from './dom';
import { labelChip, openIssue, openLabels, openPull } from './pull';
import { providerLabel } from './provider';
import type { MeetingPreset } from './meeting';
import { officePrompt } from './prompts';

export interface BoardActions {
  /** Start a worker on a ready-made prompt (shown for editing first). */
  assign(prompt: string, title: string): void;
  /** Your own prompt about an issue or PR; `context` goes first so the worker knows which. */
  ask(context: string, title: string): void;
  /** Walks you to the desk a pull request came from. */
  goToDesk(deskId: string): void;
  /** Put an issue on the 📋 task queue; a worker is seated for it when there's room. */
  queue(prompt: string, title: string, issue: number, provider?: AgentProvider, model?: string, effort?: AgentEffort): void;
  /** Take the issue's card off the board, to carry to a desk or the queue (not on the 2D view, where there's nobody to carry it). */
  pickUp?(issue: GhIssue): void;
  /** Call a meeting about it: the meeting room's form, filled in. */
  meeting(preset: MeetingPreset): void;
}

/** The task a worker gets for an issue, from the board, a carried card or the queue (the 'issue.work' prompt). */
export function issuePrompt(it: Pick<GhIssue, 'number' | 'title'> & { url?: string }): string {
  return officePrompt('issue.work', issueVars(it));
}

/** What an issue's prompts fill in. A carried card has no URL, but the board usually knows it. */
export function issueVars(it: Pick<GhIssue, 'number' | 'title'> & { url?: string }) {
  return { number: it.number, title: it.title, url: it.url ?? store.issues.items.find((i) => i.number === it.number)?.url ?? '' };
}

const TILTS = ['-1.2deg', '0.8deg', '-0.4deg', '1.4deg', '0deg', '-0.9deg'];
const NOTE_COLORS = ['#fff7b0', '#ffd6e0', '#caffbf', '#bde0fe', '#ffe5b4'];

interface Column<T> {
  /** Names the column in your saved label filters. */
  key: string;
  title: string;
  items: T[];
  /** Shows at most this many (after the label filter). */
  max?: number;
}

const byUpdated = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);

function issueColumns(items: GhIssue[]): Column<GhIssue>[] {
  const open = items.filter((i) => i.state === 'OPEN');
  const inProgress = open.filter((i) => i.assignees.length > 0 || i.labels.some((l) => /progress|doing|wip|started/i.test(l.name)) || store.taskForIssue(i.number)?.status === 'running');
  const todo = open.filter((i) => !inProgress.includes(i));
  return [
    { key: 'open', title: '📥 Open', items: todo },
    { key: 'progress', title: '🚧 In progress', items: inProgress },
    { key: 'closed', title: '✅ Closed', items: items.filter((i) => i.state !== 'OPEN').sort(byUpdated), max: 40 },
  ];
}

function pullColumns(items: GhPull[]): Column<GhPull>[] {
  const open = items.filter((p) => p.state === 'OPEN');
  return [
    { key: 'draft', title: '✏️ Draft', items: open.filter((p) => p.isDraft) },
    { key: 'review', title: '👀 In review', items: open.filter((p) => !p.isDraft && p.reviewDecision !== 'APPROVED') },
    { key: 'approved', title: '👍 Approved', items: open.filter((p) => !p.isDraft && p.reviewDecision === 'APPROVED') },
    { key: 'merged', title: '🎉 Merged', items: items.filter((p) => p.state === 'MERGED').sort(byUpdated), max: 30 },
    { key: 'closed', title: '🗑️ Closed', items: items.filter((p) => p.state === 'CLOSED').sort(byUpdated), max: 20 },
  ];
}

/** The labels each column is filtered to (column key → label names), per floor and board, kept in this browser. */
type LabelFilters = Record<string, string[]>;

function filtersKey(kind: 'issues' | 'pulls'): string {
  return `agent-office.board-labels.${store.floor ?? store.project?.dir ?? ''}.${kind}`;
}

function loadFilters(kind: 'issues' | 'pulls'): LabelFilters {
  const out: LabelFilters = {};
  try {
    const saved = JSON.parse(localStorage.getItem(filtersKey(kind)) ?? 'null');
    if (saved && typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved)) if (Array.isArray(v) && v.length) out[k] = v.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    // storage blocked or garbled
  }
  return out;
}

function saveFilters(kind: 'issues' | 'pulls', filters: LabelFilters) {
  try {
    localStorage.setItem(filtersKey(kind), JSON.stringify(filters));
  } catch {
    // storage blocked
  }
}

/** Every label on the board's cards, by name, for the column filters. */
function boardLabels(items: { labels: { name: string; color: string }[] }[]): Map<string, string> {
  const all = new Map<string, string>();
  for (const it of items) for (const l of it.labels) if (!all.has(l.name)) all.set(l.name, l.color);
  return all;
}

function labelChips(labels: GhLabel[]) {
  return labels.slice(0, 4).map(labelChip);
}

const CHECK_ICON: Record<GhPull['checks'], string> = { pass: '🟢', fail: '🔴', pending: '🟡', none: '' };

/** A chip naming a worker and desk, color-coded to match the worker back on the floor. */
function workerChip(w: WorkerInfo, title: string) {
  return h('span.desk-link', { style: `--dot:${w.color}`, title }, `🪑 ${w.name} · ${store.plan().byId.get(w.deskId)?.label ?? 'a desk'}`);
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
    if (w) return workerChip(w, `${w.name} is working on this at ${store.plan().byId.get(w.deskId)?.label ?? 'a desk'} · ${provider}`);
    return h('span.qchip.running', {}, `🤖 ${t.workerName ?? 'a worker'} · ${provider}`);
  }
  return t.pr ? h('span.qchip.done', {}, `🔀 PR #${t.pr.number} · ${provider}`) : '';
}

function card(n: number, title: string, meta: (Node | string)[], i: number, onclick: () => void, onLabels: () => void) {
  return h(
    'li.card',
    {
      style: `--tilt:${TILTS[n % TILTS.length]};background:${NOTE_COLORS[n % NOTE_COLORS.length]};--pin:${['#ef476f', '#118ab2', '#06d6a0', '#ffd166'][i % 4]}`,
      tabindex: 0,
      onclick,
      onkeydown: ((e: KeyboardEvent) => e.key === 'Enter' && e.target === e.currentTarget && onclick()) as EventListener,
    },
    h('button.card-labels', { type: 'button', title: 'Change the labels', 'aria-label': `Change the labels on #${n}`, onclick: ((e: Event) => (e.stopPropagation(), onLabels())) as EventListener }, '🏷️'),
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

  const filters = loadFilters(kind);
  /** What each column's filter box holds (column key → text), for as long as the board is open. */
  const queries: Record<string, string> = {};
  /** The column whose label picker is open, if any. */
  let picking: string | null = null;
  const setFilter = (key: string, labels: string[]) => {
    if (labels.length) filters[key] = labels;
    else delete filters[key];
    saveFilters(kind, filters);
    render();
  };

  /** Toggles for every label on the board; the column shows cards with any of the ones picked. */
  const labelPicker = <T extends GhIssue | GhPull>(col: Column<T>, all: Map<string, string>, picked: string[]) => {
    const names = [...new Set([...all.keys(), ...picked])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const list = h('div.col-labels');
    for (const name of names) {
      const on = picked.includes(name);
      const n = col.items.filter((it) => it.labels.some((l) => l.name === name)).length;
      list.append(
        h(
          'button.label-pick',
          { type: 'button', 'aria-pressed': String(on), 'data-focus': `${col.key}:${name}`, title: `${n} in ${col.title.replace(/^\S+ /, '')}`, onclick: () => setFilter(col.key, on ? picked.filter((x) => x !== name) : [...picked, name]) },
          labelChip({ name, color: all.get(name) ?? '#dddddd' }),
          h('small', {}, String(n)),
        ),
      );
    }
    if (!names.length) list.append(h('small', {}, 'No labels on this board yet.'));
    const hint = picked.length ? 'Showing cards with any of these labels' : 'Pick labels to show only their cards';
    return h('div.col-filter', {}, list, h('div.col-filter-foot', {}, h('small', {}, hint), picked.length ? h('button.btn.small', { type: 'button', onclick: () => setFilter(col.key, []) }, 'Clear') : null));
  };

  /** A column of cards. Type in its box to narrow it by title; click its header to filter it by label. */
  const column = <T extends GhIssue | GhPull>(col: Column<T>, all: Map<string, string>, cardOf: (it: T, i: number) => HTMLElement) => {
    const picked = filters[col.key] ?? [];
    const labelled = picked.length ? col.items.filter((it) => it.labels.some((l) => picked.includes(l.name))) : col.items;
    const ul = h('ul');
    const count = h('span');
    const name = col.title.replace(/^\S+ /, '');
    const search = h('input', {
      type: 'text',
      value: queries[col.key] ?? '',
      placeholder: 'Filter by title…',
      'aria-label': `Filter ${name} by title`,
      'data-focus': `search:${col.key}`,
      spellcheck: 'false',
      autocomplete: 'off',
    }) as HTMLInputElement;
    const clear = h('button.col-search-clear', { type: 'button', 'aria-label': 'Clear the title filter', title: 'Clear' }, '✕');
    const section = h('section.column');
    /** Deals the cards that match both filters. Typing only redoes this column, so the box keeps focus. */
    const fill = () => {
      const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      const matching = words.length ? labelled.filter((it) => words.every((w) => it.title.toLowerCase().includes(w))) : labelled;
      const shown = matching.slice(0, col.max);
      ul.replaceChildren(...shown.map((it, i) => cardOf(it, i)));
      if (!shown.length) ul.append(h('li.empty', {}, words.length ? `No titles match “${search.value.trim()}”${picked.length ? ' with those labels' : ''}` : picked.length ? 'Nothing here with those labels' : 'Nothing here'));
      count.textContent = picked.length || words.length ? `${shown.length} / ${col.items.slice(0, col.max).length}` : String(shown.length);
      clear.classList.toggle('hidden', !search.value);
      section.classList.toggle('filtered', picked.length > 0 || words.length > 0);
    };
    search.addEventListener('input', () => {
      queries[col.key] = search.value;
      ul.scrollTop = 0;
      fill();
    });
    clear.addEventListener('click', () => {
      search.value = queries[col.key] = '';
      fill();
      search.focus();
    });
    const open = picking === col.key;
    const head = h(
      'button.col-head',
      {
        type: 'button',
        'aria-expanded': String(open),
        'data-focus': col.key,
        title: picked.length ? `Only cards labelled ${picked.join(' or ')}. Click to change.` : 'Filter by label',
        onclick: () => {
          picking = open ? null : col.key;
          render();
        },
      },
      h('span', {}, col.title),
      h('span.col-count', {}, count, h('span.col-caret', { 'aria-hidden': 'true' }, open ? '▴' : '▾')),
    );
    section.append(h('h4', {}, head), h('div.col-search', {}, search, clear));
    if (open) section.append(labelPicker(col, all, picked));
    else if (picked.length) {
      section.append(
        h(
          'div.col-active',
          {},
          ...picked.map((name) => labelChip({ name, color: all.get(name) ?? '#dddddd' })),
          h('button.col-clear', { type: 'button', 'aria-label': 'Clear label filter', title: 'Show every card', onclick: () => setFilter(col.key, []) }, '✕'),
        ),
      );
    }
    section.append(ul);
    fill();
    return section;
  };

  const render = () => {
    const st = kind === 'issues' ? store.issues : store.pulls;
    status.textContent = st.loading ? 'Refreshing…' : st.fetchedAt ? `Updated ${timeAgo(st.fetchedAt)}` : '';
    // Every refresh rebuilds the columns, so note how far each was scrolled and put it back afterwards,
    // and keep focus (and the caret, in a filter box) on the header, label toggle or box it was on.
    const scrolled = [...body.querySelectorAll('.column > ul')].map((ul) => ul.scrollTop);
    const { scrollLeft, scrollTop } = body;
    const active = document.activeElement;
    const focused = active && body.contains(active) ? active.getAttribute('data-focus') : null;
    const caret = active instanceof HTMLInputElement ? ([active.selectionStart, active.selectionEnd] as const) : null;
    body.replaceChildren();
    if (st.error && !st.items.length) {
      body.append(h('div.board-error', {}, `Couldn't load from GitHub: ${st.error}`, h('br'), h('small', {}, 'The server runs `gh` in the project directory — make sure it is installed and authenticated (gh auth login).')));
      return;
    }
    const all = boardLabels(st.items);
    if (kind === 'issues') {
      for (const col of issueColumns(store.issues.items)) {
        body.append(
          column(col, all, (it, i) =>
            card(it.number, it.title, [...labelChips(it.labels), queueChip(it.number), it.assignees.length ? `👤 ${it.assignees.join(', ')}` : `by ${it.author}`, it.comments ? `💬 ${it.comments}` : '', timeAgo(it.updatedAt)], i, () => openIssue(it, net, actions), () => openLabels('issue', it, net)),
          ),
        );
      }
    } else {
      for (const col of pullColumns(store.pulls.items)) {
        body.append(
          column(col, all, (it, i) => {
            const w = workerForPull(store.workers.values(), it);
            return card(
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
              () => openLabels('pull', it, net),
            );
          }),
        );
      }
    }
    body.querySelectorAll('.column > ul').forEach((ul, i) => (ul.scrollTop = scrolled[i] ?? 0));
    body.scrollLeft = scrollLeft;
    body.scrollTop = scrollTop;
    const again = focused === null ? undefined : [...body.querySelectorAll<HTMLElement>('[data-focus]')].find((b) => b.dataset.focus === focused);
    again?.focus();
    if (caret && again instanceof HTMLInputElement) again.setSelectionRange(caret[0], caret[1]);
  };

  const unsubs = [store.on(kind, render), store.on('queue', render)];
  // Which desk a PR came from can change (a worker sent home, a PR opened from a desk).
  if (kind === 'pulls') unsubs.push(store.on('workers', render));
  const timer = setInterval(() => {
    const st = kind === 'issues' ? store.issues : store.pulls;
    status.textContent = st.loading ? 'Refreshing…' : st.fetchedAt ? `Updated ${timeAgo(st.fetchedAt)}` : '';
  }, 15000);
  const modal = openModal(el, {
    doing: kind === 'issues' ? '📋 at the issues board' : '🔀 at the PR board',
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(timer);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
}
