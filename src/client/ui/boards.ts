import './boards.css';
import type { GhIssue, GhLabel, GhPull, WorkerInfo } from '../../shared/protocol';
import type { Net } from '../net';
import { store, workerForPull } from '../state';
import { h, openModal, timeAgo } from './dom';
import { openIssue } from './github/issue-window';
import { labelChip, openLabels } from './github/labels';
import { inProgress } from './github/progress';
import type { BoardActions } from './github/prompts';
import { openPull } from './github/pull-window';
import { providerLabel } from './provider';
import { L, placeLabel } from '../i18n';

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
  const started = open.filter((i) => inProgress(i, store.taskForIssue(i.number)));
  const todo = open.filter((i) => !started.includes(i));
  return [
    { key: 'open', title: L.boards.open, items: todo },
    { key: 'progress', title: L.boards.progress, items: started },
    { key: 'closed', title: L.boards.closedIssues, items: items.filter((i) => i.state !== 'OPEN').sort(byUpdated), max: 40 },
  ];
}

function pullColumns(items: GhPull[]): Column<GhPull>[] {
  const open = items.filter((p) => p.state === 'OPEN');
  return [
    { key: 'draft', title: L.boards.draft, items: open.filter((p) => p.isDraft) },
    { key: 'review', title: L.boards.review, items: open.filter((p) => !p.isDraft && p.reviewDecision !== 'APPROVED') },
    { key: 'approved', title: L.boards.approved, items: open.filter((p) => !p.isDraft && p.reviewDecision === 'APPROVED') },
    { key: 'merged', title: L.boards.merged, items: items.filter((p) => p.state === 'MERGED').sort(byUpdated), max: 30 },
    { key: 'closed', title: L.boards.closedPulls, items: items.filter((p) => p.state === 'CLOSED').sort(byUpdated), max: 20 },
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
function deskOf(w: WorkerInfo): string {
  const desk = store.plan().byId.get(w.deskId);
  return desk ? placeLabel(desk) : L.boards.aDesk;
}

function workerChip(w: WorkerInfo, title: string) {
  return h('span.desk-link', { style: `--dot:${w.color}`, title }, `🪑 ${w.name} · ${store.plan().byId.get(w.deskId)?.label ?? 'a desk'}`);
}

/** A chip naming the worker and desk a pull request came from. */
function deskChip(w: WorkerInfo) {
  return workerChip(w, L.boards.openedFrom(w.name, w.worktree?.branch));
}

/** Where an issue stands on the 📋 queue, for its card. */
function queueChip(issue: number): Node | '' {
  const t = store.taskForIssue(issue);
  if (!t) return '';
  const provider = providerLabel(t.provider, store.project);
  if (t.status === 'queued') return h('span.qchip', {}, `${store.queue.tasks.find((x) => x.status === 'queued') === t ? L.boards.upNext : L.boards.queued} · ${provider}`);
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
    h('button.card-labels', { type: 'button', title: L.pull.changeLabels, 'aria-label': L.boards.changeLabelsOn(n), onclick: ((e: Event) => (e.stopPropagation(), onLabels())) as EventListener }, '🏷️'),
    h('div.num', {}, `#${n}`),
    h('div.ttl', {}, title),
    h('div.meta', {}, ...meta.filter((m) => m !== '').map((m) => (typeof m === 'string' ? h('span', {}, m) : m))),
  );
}

export function openBoard(kind: 'issues' | 'pulls', net: Net, actions: BoardActions) {
  const body = h('div.body');
  const status = h('span.board-status');
  const refresh = h('button.btn', { title: L.boards.refreshTip, onclick: () => net.send({ t: 'gh.refresh' }) }, L.boards.refresh);
  const close = h('button.btn.close', { 'aria-label': L.common.close }, '✕');
  const el = h('div.modal.board', { role: 'dialog', 'aria-label': kind === 'issues' ? L.boards.issuesBoard : L.boards.pullsBoard }, h('header', {}, h('h2', {}, kind === 'issues' ? L.boards.issuesTitle : L.boards.pullsTitle), status, refresh, close), body);

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
          { type: 'button', 'aria-pressed': String(on), 'data-focus': `${col.key}:${name}`, title: L.boards.nIn(n, col.title.replace(/^\S+ /, '')), onclick: () => setFilter(col.key, on ? picked.filter((x) => x !== name) : [...picked, name]) },
          labelChip({ name, color: all.get(name) ?? '#dddddd' }),
          h('small', {}, String(n)),
        ),
      );
    }
    if (!names.length) list.append(h('small', {}, L.boards.noLabels));
    const hint = picked.length ? L.boards.showingAny : L.boards.pickLabels;
    return h('div.col-filter', {}, list, h('div.col-filter-foot', {}, h('small', {}, hint), picked.length ? h('button.btn.small', { type: 'button', onclick: () => setFilter(col.key, []) }, L.boards.clear) : null));
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
      placeholder: L.boards.filterTitle,
      'aria-label': L.boards.filterBy(name),
      'data-focus': `search:${col.key}`,
      spellcheck: 'false',
      autocomplete: 'off',
    }) as HTMLInputElement;
    const clear = h('button.col-search-clear', { type: 'button', 'aria-label': L.boards.clearTitleFilter, title: L.boards.clear }, '✕');
    const section = h('section.column');
    /** Deals the cards that match both filters. Typing only redoes this column, so the box keeps focus. */
    const fill = () => {
      const words = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      const matching = words.length ? labelled.filter((it) => words.every((w) => it.title.toLowerCase().includes(w))) : labelled;
      const shown = matching.slice(0, col.max);
      ul.replaceChildren(...shown.map((it, i) => cardOf(it, i)));
      if (!shown.length) ul.append(h('li.empty', {}, words.length ? L.boards.noMatch(search.value.trim(), picked.length > 0) : picked.length ? L.boards.nothingLabels : L.boards.nothing));
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
        title: picked.length ? L.boards.onlyLabelled(picked) : L.boards.filterByLabel,
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
          h('button.col-clear', { type: 'button', 'aria-label': L.boards.clearFilter, title: L.boards.showEvery, onclick: () => setFilter(col.key, []) }, '✕'),
        ),
      );
    }
    section.append(ul);
    fill();
    return section;
  };

  const render = () => {
    const st = kind === 'issues' ? store.issues : store.pulls;
    status.textContent = st.loading ? L.boards.refreshing : st.fetchedAt ? L.boards.updated(timeAgo(st.fetchedAt)) : '';
    // Every refresh rebuilds the columns, so note how far each was scrolled and put it back afterwards,
    // and keep focus (and the caret, in a filter box) on the header, label toggle or box it was on.
    const scrolled = [...body.querySelectorAll('.column > ul')].map((ul) => ul.scrollTop);
    const { scrollLeft, scrollTop } = body;
    const active = document.activeElement;
    const focused = active && body.contains(active) ? active.getAttribute('data-focus') : null;
    const caret = active instanceof HTMLInputElement ? ([active.selectionStart, active.selectionEnd] as const) : null;
    body.replaceChildren();
    if (st.error && !st.items.length) {
      body.append(h('div.board-error', {}, L.pull.loadFailed(st.error), h('br'), h('small', {}, L.boards.ghHelp)));
      return;
    }
    const all = boardLabels(st.items);
    if (kind === 'issues') {
      for (const col of issueColumns(store.issues.items)) {
        body.append(
          column(col, all, (it, i) =>
            card(it.number, it.title, [...labelChips(it.labels), queueChip(it.number), it.assignees.length ? `👤 ${it.assignees.join(', ')}` : it.taken ? L.boards.handed : L.boards.by(it.author), it.comments ? `💬 ${it.comments}` : '', timeAgo(it.updatedAt)], i, () => openIssue(it, net, actions), () => openLabels('issue', it, net)),
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
                L.boards.by(it.author),
                it.reviewDecision === 'CHANGES_REQUESTED' ? L.boards.changesRequested : '',
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
    status.textContent = st.loading ? L.boards.refreshing : st.fetchedAt ? L.boards.updated(timeAgo(st.fetchedAt)) : '';
  }, 15000);
  const modal = openModal(el, {
    doing: kind === 'issues' ? L.boards.atIssues : L.boards.atPulls,
    onClose: () => {
      unsubs.forEach((u) => u());
      clearInterval(timer);
    },
  });
  close.addEventListener('click', () => modal.close());
  render();
}
