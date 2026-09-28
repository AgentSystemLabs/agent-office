import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { h } from './dom';

// GitHub-flavored markdown for issue and PR text: rendered by marked, then sanitized by DOMPurify
// before it touches the page, since anyone who can open an issue writes it.

// In issue and PR comments GitHub turns a single newline into a line break, unlike in .md files.
const md = new Marked({ gfm: true, breaks: true });
const mdFile = new Marked({ gfm: true });

const purify = DOMPurify(window);
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  } else if (node.tagName === 'IMG') {
    node.setAttribute('loading', 'lazy');
    node.setAttribute('referrerpolicy', 'no-referrer');
  } else if (node.tagName === 'INPUT') {
    // Task list boxes: show them ticked or not, but they don't do anything here.
    node.setAttribute('disabled', '');
  }
});

const ALERTS: Record<string, string> = { NOTE: 'ℹ️ Note', TIP: '💡 Tip', IMPORTANT: '❗ Important', WARNING: '⚠️ Warning', CAUTION: '🛑 Caution' };

/** `> [!NOTE]` blockquotes become callouts, as on GitHub. */
function alerts(root: HTMLElement) {
  for (const q of root.querySelectorAll('blockquote')) {
    const p = q.firstElementChild;
    const m = p?.tagName === 'P' ? /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i.exec(p.textContent ?? '') : null;
    if (!p || !m) continue;
    const kind = m[1].toUpperCase();
    // Drop the marker (and the line break after it) from the first paragraph.
    const first = p.firstChild;
    if (first?.nodeType === Node.TEXT_NODE) first.textContent = (first.textContent ?? '').replace(/^\s*\[![A-Za-z]+\]\s*/, '');
    if (p.firstChild?.nodeName === 'BR') p.firstChild.remove();
    if (!p.textContent?.trim() && !p.querySelector('img')) p.remove();
    q.classList.add('alert', kind.toLowerCase());
    q.prepend(h('div.alert-title', {}, ALERTS[kind]));
  }
}

const REF_RE = /(^|[^\w/&#`])(#(\d+)|@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})))\b/g;

/** Links #123 to the issue or PR and @name to the person, outside code and existing links. */
function linkify(root: HTMLElement, repoUrl?: string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('a, code, pre') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const t of texts) {
    const s = t.data;
    REF_RE.lastIndex = 0;
    if (!REF_RE.test(s)) continue;
    REF_RE.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let at = 0;
    for (let m = REF_RE.exec(s); m; m = REF_RE.exec(s)) {
      const start = m.index + m[1].length;
      const href = m[3] ? (repoUrl ? `${repoUrl}/issues/${m[3]}` : '') : `https://github.com/${m[4]}`;
      if (!href) continue;
      frag.append(s.slice(at, start), h('a', { href, target: '_blank', rel: 'noopener noreferrer', class: m[3] ? 'ref' : 'mention' }, m[2]));
      at = start + m[2].length;
    }
    frag.append(s.slice(at));
    t.replaceWith(frag);
  }
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

/** Relative links in a PR body mean GitHub pages: #anchors on the PR, paths in the repo. */
function absolutize(root: HTMLElement, itemUrl: string, repoUrl: string) {
  const fix = (v: string, anchors: boolean) => {
    if (!v || SCHEME_RE.test(v) || v.startsWith('//')) return v;
    if (v.startsWith('#')) return anchors ? `${itemUrl.split('#')[0]}${v}` : v;
    if (v.startsWith('/')) return `https://github.com${v}`;
    return `${repoUrl}/blob/HEAD/${v.replace(/^\.\//, '')}`;
  };
  for (const a of root.querySelectorAll('a[href]')) a.setAttribute('href', fix(a.getAttribute('href') ?? '', true));
  for (const img of root.querySelectorAll('img[src]')) img.setAttribute('src', fix(img.getAttribute('src') ?? '', false));
}

/** Marked's HTML, sanitized, as nodes to put on the page. */
function sanitized(html: string): DocumentFragment {
  return purify.sanitize(html, { RETURN_DOM_FRAGMENT: true, FORBID_TAGS: ['style', 'form', 'button', 'select', 'textarea'], FORBID_ATTR: ['style'] });
}

/** Renders markdown into a `.md` block. `itemUrl` (the issue or PR on GitHub) anchors its links. */
export function markdown(src: string, itemUrl?: string): HTMLElement {
  const el = h('div.md');
  if (!src.trim()) {
    el.append(h('p.none', {}, 'No description provided.'));
    return el;
  }
  el.append(sanitized(md.parse(src, { async: false }) as string));
  const repoUrl = itemUrl ? repoUrlOf(itemUrl) : undefined;
  if (itemUrl && repoUrl) absolutize(el, itemUrl, repoUrl);
  alerts(el);
  linkify(el, repoUrl);
  return el;
}

/**
 * Renders a Markdown file from the project into a `.md` block, the way GitHub shows it in the repo:
 * a lone newline is only a space, and #123 is just text. Its links and pictures are left as written,
 * for the bookshelf to point at the project (see ui/bookshelf.ts).
 */
export function markdownFile(src: string): HTMLElement {
  const el = h('div.md');
  el.append(sanitized(mdFile.parse(src, { async: false }) as string));
  alerts(el);
  return el;
}

/** https://github.com/owner/repo from an issue or PR URL. */
export function repoUrlOf(itemUrl: string): string {
  return itemUrl.replace(/\/(pull|issues)\/\d+.*$/, '');
}
