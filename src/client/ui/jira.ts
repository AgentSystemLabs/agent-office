import { ticketColumns, ticketPrompt, type JiraComment, type JiraTicket, type JiraTicketDetail } from '../../shared/jira';
import type { ServerMsg } from '../../shared/protocol';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import { markdown } from './markdown';

// The Jira tab of a floor's issue board, read only: every direct child of its epic in To Do, In
// Progress and Done, and the window behind each card with the ticket's description and comments.

export interface JiraActions {
  /** Start a worker on a ready-made prompt (shown for editing first). */
  assign(prompt: string, title: string): void;
}

type SetupMsg = Extract<ServerMsg, { t: 'jira.setup' }>;
const setupWaiters = new Set<(msg: SetupMsg) => void>();

/** Main feeds server messages through here so the settings hear how connecting or setting the epic went. */
export function routeJiraMessage(msg: ServerMsg) {
  if (msg.t === 'jira.setup') for (const fn of setupWaiters) fn(msg);
}

/** Hears the answers to connecting Jira and setting the floor's epic; returns the unlisten. */
export function onJiraSetup(fn: (msg: SetupMsg) => void): () => void {
  setupWaiters.add(fn);
  return () => setupWaiters.delete(fn);
}

async function ticketDetail(key: string): Promise<JiraTicketDetail> {
  const floor = store.floor ? `&floor=${encodeURIComponent(store.floor)}` : '';
  const r = await fetch(`/api/jira/ticket?key=${encodeURIComponent(key)}${floor}`, { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.json() as Promise<JiraTicketDetail>;
}

const CATEGORY_CLASS: Record<JiraTicket['category'], string> = { new: 'idle', indeterminate: 'working', done: 'done' };

function ticketCard(t: JiraTicket, onclick: () => void) {
  const meta: string[] = [t.type, t.priority ? `⚑ ${t.priority}` : '', t.assignee ? `👤 ${t.assignee}` : 'unassigned', t.updated ? timeAgo(t.updated) : ''];
  return h(
    'li.card',
    { tabindex: 0, onclick, onkeydown: ((e: KeyboardEvent) => e.key === 'Enter' && onclick()) as EventListener },
    h('div.num', {}, h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer', onclick: ((e: Event) => e.stopPropagation()) as EventListener, title: 'Open in Jira' }, t.key)),
    h('div.ttl', {}, t.summary),
    h('div.meta', {}, ...meta.filter(Boolean).map((m) => h('span', {}, m)), h('span.pill', { class: CATEGORY_CLASS[t.category] }, t.status)),
  );
}

/** Draws the Jira tab into `body`: To Do, In Progress and Done, left to right. */
export function renderJiraBoard(body: HTMLElement, actions: JiraActions) {
  const st = store.jiraBoard;
  const scrolled = [...body.querySelectorAll('.column > ul')].map((ul) => ul.scrollTop);
  body.replaceChildren();
  if (!st) return;
  if (st.error && !st.items.length) {
    body.append(h('div.board-error', {}, `Couldn't load ${st.epic} from Jira: ${st.error}`));
    return;
  }
  if (!st.fetchedAt) {
    body.append(h('div.board-error', {}, `Loading ${st.epic} from Jira…`));
    return;
  }
  for (const col of ticketColumns(st.items)) {
    const ul = h('ul');
    for (const t of col.items) ul.append(ticketCard(t, () => openTicket(t, actions)));
    if (!col.items.length) ul.append(h('li.empty', {}, 'Nothing here'));
    body.append(h('section.column', {}, h('h4', {}, col.name, h('span', {}, String(col.items.length))), ul));
  }
  body.querySelectorAll('.column > ul').forEach((ul, i) => (ul.scrollTop = scrolled[i] ?? 0));
}

function commentCard(c: JiraComment) {
  return h('article.gh-card', {}, h('header', {}, h('b', {}, c.author), h('span', {}, 'commented'), h('span.when', { title: c.created ? new Date(c.created).toLocaleString() : '' }, c.created ? timeAgo(c.created) : '')), markdown(c.body));
}

/** The window behind a ticket's card: its description and comments, read only. */
export function openTicket(first: JiraTicket, actions: JiraActions) {
  let it: JiraTicket = first;
  let detail: JiraTicketDetail | null = null;
  let error = '';
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const pill = h('span.pill');
  const meta = h('div.gh-meta');
  const thread = h('div.gh-items');
  const handBtn = h('button.btn.primary', { type: 'button' }, 'Hand to a worker') as HTMLButtonElement;

  const el = h(
    'div.modal.gh-window.issue.jira-ticket',
    { role: 'dialog', 'aria-label': `Jira ticket ${it.key}` },
    h('header', {}, pill, h('h2', { title: it.summary }, `${it.key} ${it.summary}`), close),
    meta,
    h('div.gh-body', {}, h('div.gh-conv', {}, h('div.gh-col', {}, thread))),
    h('footer', {}, h('a.grow', { href: it.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open in Jira ↗'), handBtn),
  );

  const renderFrame = () => {
    pill.className = `pill ${CATEGORY_CLASS[it.category]}`;
    pill.textContent = it.status;
    meta.replaceChildren(
      h('span.jira-type', {}, it.type || 'Ticket'),
      it.priority ? h('span', {}, `⚑ ${it.priority}`) : '',
      h('span', {}, it.assignee ? `👤 ${it.assignee}` : 'unassigned'),
      detail?.reporter ? h('span', {}, `· reported by ${detail.reporter}${detail.created ? ` ${timeAgo(detail.created)}` : ''}`) : '',
      store.jira.epic ? h('span', {}, `· in ${store.jira.epic.key}`) : '',
    );
  };
  const render = () => {
    thread.replaceChildren(h('article.gh-card', {}, h('header', {}, h('b', {}, 'Description')), detail ? markdown(detail.description || '_(No description.)_') : h('p.gh-quiet', {}, error ? '' : 'Loading…')));
    if (error) thread.append(h('div.gh-error', {}, `Couldn't load ${it.key} from Jira: ${error}`, h('button.btn', { type: 'button', onclick: () => load() }, 'Try again')));
    else if (detail && !detail.comments.length) thread.append(h('p.gh-quiet', {}, 'No comments.'));
    else if (detail) thread.append(...detail.comments.map(commentCard));
  };
  let generation = 0;
  function load() {
    const g = ++generation;
    error = '';
    render();
    ticketDetail(it.key)
      .then((d) => {
        if (g !== generation) return;
        detail = d;
        it = { ...it, ...d };
      })
      .catch((err) => g === generation && (error = (err as Error).message))
      .finally(() => g === generation && (renderFrame(), render()));
  }

  handBtn.addEventListener('click', () => {
    modal.close();
    actions.assign(ticketPrompt({ key: it.key, summary: it.summary, description: detail?.description, url: it.url }), `🎫 Hand ${it.key} to a worker`);
  });

  const unsub = store.on('jiraBoard', () => {
    const fresh = store.jiraBoard?.items.find((t) => t.key === it.key);
    if (!fresh) return;
    it = { ...it, ...fresh };
    renderFrame();
  });
  const modal = openModal(el, { doing: `🎫 reading ${it.key}`, onClose: unsub });
  close.addEventListener('click', () => modal.close());
  renderFrame();
  load();
}
