import type { ChatLine, SearchResults, TerminalHit } from '../../shared/protocol';
import { SEARCH_MAX, SEARCH_MIN, searchKey } from '../../shared/search';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import type { TerminalFind } from './terminal';

// The 🔎 window: words in the office chat and in every worker's terminal, including what was said
// and shown before the office last restarted. A terminal line opens that terminal right at it.

/** What was searched last, so the window opens where you left it. */
let lastQuery = '';

async function search(q: string): Promise<SearchResults> {
  // Terminals are the workers on your floor; the chat is the whole building's.
  const floor = store.floor ? `&floor=${encodeURIComponent(store.floor)}` : '';
  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}${floor}`, { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.json() as Promise<SearchResults>;
}

/** `text` with every match of `needle` (a searchKey) marked. */
function highlight(text: string, needle: string): (string | HTMLElement)[] {
  const flat = text.replace(/\s+/g, ' ');
  const lower = flat.toLowerCase();
  // Lowercasing can change a string's length (rare scripts); then just show it plain.
  if (lower.length !== flat.length) return [flat];
  const out: (string | HTMLElement)[] = [];
  let from = 0;
  for (let at = lower.indexOf(needle); at >= 0 && needle; at = lower.indexOf(needle, from)) {
    out.push(flat.slice(from, at), h('mark', {}, flat.slice(at, at + needle.length)));
    from = at + needle.length;
  }
  out.push(flat.slice(from));
  return out;
}

export function openSearch(openTerminal: (workerId: string, find: TerminalFind) => void) {
  const input = h('input', {
    type: 'text',
    placeholder: 'Search the chat and every terminal…',
    maxlength: SEARCH_MAX,
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': 'Search the chat and every terminal',
  });
  input.value = lastQuery;
  const status = h('p.note.search-status');
  const results = h('div.search-results');
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h(
    'div.modal.search',
    { role: 'dialog', 'aria-label': 'Search' },
    h('header', {}, h('h2', {}, '🔎 Search'), close),
    h('div.body', {}, input, status, results),
  );

  let found: SearchResults | null = null;
  let error = '';
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    clearTimeout(timer);
    const q = input.value;
    lastQuery = q;
    const mine = ++seq;
    if (searchKey(q).length < SEARCH_MIN) {
      found = null;
      error = '';
      return render();
    }
    status.textContent = 'Searching…';
    try {
      const r = await search(q);
      if (mine !== seq) return;
      found = r;
      error = '';
    } catch (err) {
      if (mine !== seq) return;
      error = (err as Error).message;
    }
    render();
  };

  const jump = (hit: TerminalHit, needle: string) => {
    modal.close();
    openTerminal(hit.workerId, { needle, fromEnd: hit.rows - hit.row });
  };

  const chatRow = (c: ChatLine, needle: string) =>
    h(
      'li.search-hit',
      {},
      h('div.search-meta', {}, h('b', { style: `color:${c.color}` }, c.name), h('span', {}, timeAgo(c.at))),
      h('div.search-text', {}, ...highlight(c.text, needle)),
    );

  const termRow = (hit: TerminalHit, needle: string) => {
    const li = h('li.search-hit.term', { tabindex: 0, role: 'button', title: 'Open the terminal at this line' }, h('code', {}, ...highlight(hit.text, needle)));
    li.addEventListener('click', () => jump(hit, needle));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        jump(hit, needle);
      }
    });
    return li;
  };

  const render = () => {
    if (error) {
      status.textContent = `Couldn't search: ${error}`;
      results.replaceChildren();
      return;
    }
    if (!found) {
      status.textContent = `Finds words in the office chat and in every worker's terminal, including what they showed before the office restarted.`;
      results.replaceChildren();
      return;
    }
    const needle = searchKey(found.q);
    // Workers sent home since the search ran have nothing left to open.
    const byWorker = new Map<string, TerminalHit[]>();
    for (const hit of found.terminals) {
      if (!store.workers.has(hit.workerId)) continue;
      let list = byWorker.get(hit.workerId);
      if (!list) byWorker.set(hit.workerId, (list = []));
      list.push(hit);
    }
    const count = found.chat.length + [...byWorker.values()].reduce((n, l) => n + l.length, 0);
    status.textContent = !count
      ? `Nothing in the chat or any terminal matches “${found.q.trim()}”.`
      : `${count} ${count === 1 ? 'line' : 'lines'}, newest first${found.more ? ' (only the newest are shown; add words to narrow it down)' : ''}.`;
    const groups: HTMLElement[] = [];
    if (found.chat.length) groups.push(h('section.search-group', {}, h('h4', {}, '💬 Chat'), h('ul', {}, ...found.chat.map((c) => chatRow(c, needle)))));
    for (const [workerId, hits] of byWorker) {
      const w = store.workers.get(workerId)!;
      groups.push(
        h(
          'section.search-group',
          {},
          h('h4', {}, h('span.dot', { style: `background:${w.color}` }), [w.name, w.worktree && `🌿 ${w.worktree.branch}`].filter(Boolean).join(' · ')),
          h('ul', {}, ...hits.map((hit) => termRow(hit, needle))),
        ),
      );
    }
    results.replaceChildren(...groups);
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 200);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void run();
    } else if (e.key === 'ArrowDown') {
      // Down from the box steps into the terminal lines, which Enter opens.
      const first = results.querySelector<HTMLElement>('.search-hit.term');
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  results.addEventListener('keydown', (e) => {
    const at = (e.target as HTMLElement).closest<HTMLElement>('.search-hit.term');
    if (!at || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const all = [...results.querySelectorAll<HTMLElement>('.search-hit.term')];
    const next = all[all.indexOf(at) + (e.key === 'ArrowDown' ? 1 : -1)];
    (next ?? (e.key === 'ArrowUp' ? input : at)).focus();
  });

  const modal = openModal(el, { doing: '🔎 searching the office', onClose: () => clearTimeout(timer) });
  close.addEventListener('click', () => modal.close());
  render();
  void run();
  // Right away, so the first keys typed after / land in the box.
  input.focus();
  input.select();
}
