import { isDocPath, resolveDocLink, type DocFile, type DocList, type DocText } from '../../shared/docs';
import { clip, h, openModal, setDoing, timeAgo, toast } from './dom';
import { markdownFile } from './markdown';

// The bookshelf: every Markdown file in the floor's project, to read without leaving the office.
// The filter box over the list picks docs out as you type (the letters in order, not necessarily
// together; a few words narrow it further), ↑ ↓ and Enter open one, and it reads beside the list,
// rendered as GitHub shows it: links to other docs open them here, pictures come from the project,
// and the contents menu jumps to a heading. While it's open your character reads an open book.

const LAST_KEY = 'agent-office.bookshelf';

export interface ShelfDeps {
  /** The floor whose project it is, and the project's name. */
  floor: string;
  project?: string;
  /** The project on GitHub, for links to files that aren't docs. */
  repoUrl?: string;
  /** You turned a page (opened a doc, or scrolled a screenful): the book in your hands turns one too. */
  onTurn(): void;
  /** Whether a page turning makes a sound (⚙️'s setting), and the 🔈 up top that turns it on or off. */
  pageSound: boolean;
  onPageSound(on: boolean): void;
}

/** A doc that passes the filter: how well, and which letters of its title and path matched. */
interface Hit {
  doc: DocFile;
  score: number;
  title: Set<number>;
  path: Set<number>;
}

const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Where the letters of `q` (lower case) turn up in `text`, in order: all together if they can be, else each as early as it can. */
function find(q: string, text: string): number[] | null {
  const lower = text.toLowerCase();
  const at = lower.indexOf(q);
  if (at >= 0) return Array.from(q, (_, i) => at + i);
  const out: number[] = [];
  for (let j = 0; j < lower.length && out.length < q.length; j++) if (lower[j] === q[out.length]) out.push(j);
  return out.length === q.length ? out : null;
}

/** How good a find is: together beats scattered, and the start of a word beats the middle of one. */
function rate(at: number[], text: string): number {
  let score = 0;
  for (let k = 0; k < at.length; k++) {
    const p = at[k];
    const prev = text[p - 1] ?? '';
    if (p === 0 || /[\s/_.-]/.test(prev) || (/[a-z]/.test(prev) && /[A-Z]/.test(text[p]))) score += 8;
    if (k > 0) score += at[k - 1] === p - 1 ? 5 : -Math.min(6, p - at[k - 1] - 1) * 0.5;
  }
  return score - at[0] * 0.05;
}

/** The docs that match every word of `query`, best first; all of them, in shelf order, for none. */
export function filterDocs(files: DocFile[], query: string): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return shelfOrder(files).map((doc) => ({ doc, score: 0, title: new Set(), path: new Set() }));
  const hits: Hit[] = [];
  for (const doc of files) {
    const name = nameOf(doc.path);
    const dir = doc.path.length - name.length;
    const hit: Hit = { doc, score: 0, title: new Set(), path: new Set() };
    let all = true;
    for (const w of words) {
      // The file's name counts most, then its title, then anywhere in its path.
      const inName = find(w, name);
      const inTitle = doc.title ? find(w, doc.title) : null;
      const inPath = inName ? null : find(w, doc.path);
      const options: [number, () => void][] = [];
      if (inName) options.push([rate(inName, name) + 20, () => inName.forEach((i) => hit.path.add(dir + i))]);
      if (inTitle) options.push([rate(inTitle, doc.title!) + 10, () => inTitle.forEach((i) => hit.title.add(i))]);
      if (inPath) options.push([rate(inPath, doc.path), () => inPath.forEach((i) => hit.path.add(i))]);
      if (!options.length) {
        all = false;
        break;
      }
      const best = options.reduce((a, b) => (b[0] > a[0] ? b : a));
      hit.score += best[0];
      best[1]();
    }
    if (all) hits.push(hit);
  }
  return hits.sort((a, b) => b.score - a.score || a.doc.path.length - b.doc.path.length || a.doc.path.localeCompare(b.doc.path));
}

/** The project's own docs first (its README before the rest), then each folder's, in path order. */
function shelfOrder(files: DocFile[]): DocFile[] {
  const rank = (p: string) => (p.includes('/') ? 2 : /^readme\./i.test(p) ? 0 : 1);
  return [...files].sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
}

/** `text` with the letters at `at` marked. */
function marked(text: string, at: Set<number>): (string | HTMLElement)[] {
  if (!at.size) return [text];
  const out: (string | HTMLElement)[] = [];
  let run = '';
  let on = false;
  for (let i = 0; i <= text.length; i++) {
    const hit = at.has(i);
    if (i === text.length || hit !== on) {
      if (run) out.push(on ? h('mark', {}, run) : run);
      run = '';
      on = hit;
    }
    if (i < text.length) run += text[i];
  }
  return out;
}

/** A heading's anchor, as GitHub makes them: lower case, punctuation dropped, spaces to dashes. */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

function lastRead(floor: string): string | undefined {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}')[floor];
  } catch {
    return undefined;
  }
}

function rememberRead(floor: string, path: string) {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}');
    all[floor] = path;
    localStorage.setItem(LAST_KEY, JSON.stringify(all));
  } catch {
    // Private mode, or storage is full: it just won't reopen where you were.
  }
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export function openBookshelf(deps: ShelfDeps) {
  const { floor, repoUrl } = deps;
  const q = (params: Record<string, string>) => new URLSearchParams({ floor, ...params }).toString();

  const filter = h('input', { type: 'text', placeholder: 'Filter the docs…', 'aria-label': 'Filter the docs', spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  const count = h('div.bs-count', {}, 'Looking along the shelves…');
  const list = h('ul.bs-list', { role: 'listbox', 'aria-label': 'Docs' });
  const crumbs = h('div.bs-crumbs');
  const meta = h('div.bs-meta');
  const toc = h('select.bs-toc', { 'aria-label': 'Jump to a heading', title: 'Jump to a heading' }) as HTMLSelectElement;
  const page = h('div.bs-page', { tabindex: -1 });
  let pageSound = deps.pageSound;
  const soundBtn = h('button.btn.bs-sound', { type: 'button', 'aria-label': 'Page turn sound' });
  const paintSound = () => {
    soundBtn.textContent = pageSound ? '🔈' : '🔇';
    soundBtn.title = pageSound ? 'Pages swish as they turn: click to turn that off' : 'Pages turn silently: click to hear them swish';
    soundBtn.setAttribute('aria-pressed', String(pageSound));
  };
  paintSound();
  soundBtn.addEventListener('click', () => {
    pageSound = !pageSound;
    deps.onPageSound(pageSound);
    paintSound();
  });
  const el = h(
    'div.modal.bookshelf',
    { role: 'dialog', 'aria-label': 'Bookshelf' },
    h('header', {}, h('h2', {}, '📚 Bookshelf', deps.project ? h('span.bs-project', {}, ` · ${deps.project}`) : ''), soundBtn),
    h(
      'div.body',
      {},
      h('aside.bs-side', {}, h('div.bs-find', {}, filter), count, list),
      h('article.bs-reader', {}, h('div.bs-bar', {}, crumbs, meta, toc), page),
    ),
  );
  toc.hidden = true;
  page.append(h('div.bs-empty', {}, h('span.spinner')));

  let files: DocFile[] = [];
  let shown: Hit[] = [];
  /** Which of `shown` ↑ ↓ are on. */
  let sel = 0;
  /** The doc open now, and each open's number, so a slow one that's been overtaken is dropped. */
  let current: string | null = null;
  let opening = 0;
  /** Where the page was last time it turned (see the scroll listener). */
  let turnedAt = 0;

  const modal = openModal(el, { doing: '📚 at the bookshelf', reading: true });

  const renderList = () => {
    count.textContent = !files.length ? '' : filter.value.trim() ? `${shown.length} of ${files.length} docs` : `${files.length} doc${files.length === 1 ? '' : 's'}`;
    list.replaceChildren(
      ...shown.map((hit, i) => {
        const { doc } = hit;
        const title = doc.title ?? nameOf(doc.path);
        const li = h(
          'li.bs-item',
          { role: 'option', 'aria-selected': String(i === sel), class: `${i === sel ? 'sel' : ''} ${doc.path === current ? 'open' : ''}`, title: doc.path },
          h('div.bs-title', {}, ...(doc.title ? marked(title, hit.title) : marked(title, new Set([...hit.path].map((p) => p - (doc.path.length - title.length)))))),
          h('div.bs-path', {}, ...marked(doc.path, hit.path)),
        );
        li.addEventListener('mousedown', (e) => e.preventDefault());
        li.addEventListener('click', () => {
          sel = i;
          void openDoc(doc.path);
        });
        return li;
      }),
    );
    if (!files.length) list.append(h('li.bs-none', {}, 'No Markdown files in this project yet.'));
    else if (!shown.length) list.append(h('li.bs-none', {}, 'No doc matches that.'));
  };

  const refilter = () => {
    shown = filterDocs(files, filter.value);
    sel = 0;
    renderList();
    list.scrollTop = 0;
  };

  const move = (by: number) => {
    if (!shown.length) return;
    sel = (sel + by + shown.length) % shown.length;
    renderList();
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
  };

  filter.addEventListener('input', refilter);
  filter.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = shown[sel];
      if (hit) void openDoc(hit.doc.path);
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      // The page, not the box: read on without leaving the filter.
      e.preventDefault();
      page.scrollBy({ top: (e.key === 'PageDown' ? 1 : -1) * page.clientHeight * 0.85, behavior: 'smooth' });
    }
  });

  /** Scrolls to the heading (or named anchor) `hash` names in the doc open now. */
  const jump = (hash: string) => {
    if (!hash) return page.scrollTo({ top: 0 });
    let id = hash;
    try {
      id = decodeURIComponent(hash);
    } catch {
      // Not encoded after all.
    }
    id = id.replace(/^user-content-/, '');
    const esc = CSS.escape(id);
    const at = page.querySelector(`[data-anchor="${esc}"]`) ?? page.querySelector(`[data-anchor="${CSS.escape(id.toLowerCase())}"]`) ?? page.querySelector(`[id="${esc}"], [name="${esc}"]`);
    at?.scrollIntoView({ block: 'start' });
  };

  /** Points the doc's links and pictures at the project: other docs open here, the rest on GitHub. */
  const wire = (body: HTMLElement, path: string) => {
    const seen = new Map<string, number>();
    const heads: { level: number; text: string; anchor: string }[] = [];
    for (const hd of body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
      const base = slug(hd.textContent ?? '');
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const anchor = n ? `${base}-${n}` : base;
      hd.dataset.anchor = anchor;
      const level = Number(hd.tagName[1]);
      if (level <= 3 && hd.textContent?.trim()) heads.push({ level, text: hd.textContent.trim(), anchor });
    }
    for (const a of body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const to = resolveDocLink(path, a.getAttribute('href') ?? '');
      if (!to) continue;
      if (to.path === path || isDocPath(to.path)) {
        a.removeAttribute('target');
        a.dataset.doc = to.path;
        a.dataset.hash = to.hash;
      } else if (repoUrl) {
        a.href = `${repoUrl}/blob/HEAD/${to.path.split('/').map(encodeURIComponent).join('/')}${to.hash ? `#${to.hash}` : ''}`;
      } else {
        a.removeAttribute('href');
        a.title = to.path;
      }
    }
    for (const img of body.querySelectorAll<HTMLImageElement>('img[src]')) {
      const to = resolveDocLink(path, img.getAttribute('src') ?? '');
      if (to) img.src = `/api/docs/picture?${q({ path: to.path })}`;
    }
    toc.replaceChildren(h('option', { value: '' }, '☰ Contents'), ...heads.map((x) => h('option', { value: x.anchor }, `${' '.repeat(x.level - 1)}${clip(x.text, 60)}`)));
    toc.hidden = heads.length < 3;
  };

  const openDoc = async (path: string, hash = '') => {
    if (path === current) return jump(hash);
    const mine = ++opening;
    let doc: DocText;
    try {
      doc = await getJson<DocText>(`/api/docs/file?${q({ path })}`);
    } catch (err) {
      if (mine !== opening) return;
      toast(`📚 Couldn't open ${nameOf(path)}: ${(err as Error).message}`, 'warn');
      if (!current) page.replaceChildren(h('div.bs-empty', {}, `Couldn't open ${path}.`));
      return;
    }
    if (mine !== opening || !el.isConnected) return;
    current = path;
    rememberRead(floor, path);
    const info = files.find((f) => f.path === path);
    const body = doc.text.trim() ? markdownFile(doc.text) : h('div.md', {}, h('p.none', {}, 'This file is empty.'));
    wire(body, path);
    page.replaceChildren(body);
    const dir = path.slice(0, path.length - nameOf(path).length);
    crumbs.replaceChildren(dir ? h('span.dir', {}, dir) : '', nameOf(path));
    crumbs.title = path;
    const words = doc.text.split(/\s+/).filter(Boolean).length;
    meta.replaceChildren(
      [`${Math.max(1, Math.round(words / 220))} min read`, info ? size(info.size) : '', info ? `updated ${timeAgo(info.mtime)}` : ''].filter(Boolean).join(' · '),
      repoUrl ? h('a', { href: `${repoUrl}/blob/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`, target: '_blank', rel: 'noopener noreferrer', title: 'Open it on GitHub' }, 'GitHub ↗') : '',
    );
    turnedAt = 0;
    jump(hash);
    renderList();
    setDoing(modal, `📚 reading ${info?.title ?? nameOf(path)}`);
    deps.onTurn();
  };

  page.addEventListener('click', (e) => {
    const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[data-doc]') : null;
    if (!a) return;
    e.preventDefault();
    void openDoc(a.dataset.doc!, a.dataset.hash ?? '');
  });
  // Every screenful you read, a page of the book in your hands turns.
  page.addEventListener('scroll', () => {
    if (Math.abs(page.scrollTop - turnedAt) < page.clientHeight * 0.8) return;
    turnedAt = page.scrollTop;
    deps.onTurn();
  });
  toc.addEventListener('change', () => {
    jump(toc.value);
    toc.value = '';
  });

  // A moment later, so the E that opened the shelf isn't typed into the box.
  setTimeout(() => filter.focus(), 30);
  getJson<DocList>(`/api/docs?${q({})}`)
    .then((r) => {
      if (!el.isConnected) return;
      files = r.files;
      refilter();
      if (r.more) count.textContent += ` (the first ${files.length})`;
      const start = [lastRead(floor), ...shelfOrder(files).map((f) => f.path)].find((p) => p && files.some((f) => f.path === p));
      if (start) void openDoc(start);
      else page.replaceChildren(h('div.bs-empty', {}, '📭 Nothing to read here: this project has no Markdown files yet.'));
    })
    .catch((err: Error) => {
      if (!el.isConnected) return;
      count.textContent = '';
      page.replaceChildren(h('div.bs-empty', {}, `Couldn't look along the shelves: ${err.message}`));
    });
}
