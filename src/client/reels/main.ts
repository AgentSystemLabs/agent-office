import './reels.css';
// The reels studio's page: your series on autopilot, making a new one in three steps, each series'
// videos, reviewing what's waiting, the crew of agents, the numbers and the accounts posted to. It
// asks the office for everything again every few seconds and draws the page that's open, except
// the steps of a new series and any form someone's typing in.

import { h } from '../ui/dom';
import { api, type Overview } from './api';
import { createPage } from './create';
import { homePage } from './home';
import { reviewPage } from './review';
import { seriesPage } from './series';
import { accountsPage, analyticsPage, crewPage } from './views';

/** What every page draws from, and does with. */
export interface Page {
  data: Overview;
  /** Whether the first answer from the office is in. */
  loaded: boolean;
  /** Says how something went, for a few seconds. */
  toast(text: string, bad?: boolean): void;
  /** Sends `body` to `path`, says how it went, and draws everything again; resolves to what came back, or undefined when it failed. */
  act<T = unknown>(path: string, body: Record<string, unknown>, done?: string): Promise<T | undefined>;
  refresh(): Promise<void>;
  /** Goes to a page of the studio: '/', '/new', '/series/<id>', '/review'… */
  go(to: string): void;
}

interface Route {
  match: RegExp;
  draw: (p: Page, ...args: string[]) => HTMLElement;
  /** Left alone by the refresh: drawn once when it's opened. */
  still?: boolean;
}

const ROUTES: Route[] = [
  { match: /^\/$/, draw: homePage },
  { match: /^\/new$/, draw: createPage, still: true },
  { match: /^\/series\/([\w-]+)$/, draw: seriesPage },
  { match: /^\/review$/, draw: reviewPage, still: true },
  { match: /^\/crew$/, draw: crewPage },
  { match: /^\/analytics$/, draw: analyticsPage },
  { match: /^\/accounts$/, draw: accountsPage },
];

const NAV: { to: string; icon: string; label: string; badge?: (d: Overview) => number }[] = [
  { to: '/', icon: '🗂️', label: 'My series' },
  { to: '/review', icon: '👀', label: 'Review', badge: (d) => d.reels.filter((r) => r.status === 'rendered').length },
  { to: '/crew', icon: '🤖', label: 'AI crew' },
  { to: '/analytics', icon: '📈', label: 'Analytics' },
  { to: '/accounts', icon: '🔗', label: 'Accounts' },
];

const REFRESH_MS = 8000;

const view = document.getElementById('view')!;
const side = document.getElementById('side')!;
const toasts = document.getElementById('toasts')!;

const path = () => location.hash.replace(/^#/, '') || '/';

const page: Page = {
  data: { me: { name: '', admin: false }, floors: [], series: [], reels: [], crew: [], media: { voice: '…', images: '…' }, connected: [] },
  loaded: false,
  toast(text, bad = false) {
    const t = h('div.rs-toast', { class: bad ? 'bad' : undefined, role: bad ? 'alert' : 'status' }, h('span', {}, bad ? '⚠️' : '✓'), text);
    toasts.append(t);
    setTimeout(() => t.classList.add('out'), bad ? 6500 : 3000);
    setTimeout(() => t.remove(), bad ? 7000 : 3500);
  },
  async act<T>(to: string, body: Record<string, unknown>, done?: string) {
    try {
      const r = await api.post<T>(to, body);
      if (done) page.toast(done);
      await page.refresh();
      return r;
    } catch (e) {
      page.toast((e as Error).message, true);
      return undefined;
    }
  },
  async refresh() {
    try {
      page.data = await api.overview();
      page.loaded = true;
    } catch (e) {
      page.toast(`Can't reach the office: ${(e as Error).message}`, true);
      return;
    }
    draw(false);
  },
  go(to) {
    if (path() === to) draw(true);
    else location.hash = to;
  },
};

/** Whether someone is in the middle of a form, so a refresh would lose what they typed. */
const editing = () => {
  const a = document.activeElement;
  return !!a && view.contains(a) && a.matches('input, textarea, select');
};

function drawSide() {
  const d = page.data;
  const here = path();
  const free = (s: string) => (s === 'kokoro' || s === 'pollinations' ? 'Free' : s === 'placeholder' ? 'Off' : 'Paid');
  side.replaceChildren(
    h('a.rs-brand', { href: '#/' }, h('span.rs-logo', {}, '🎬'), h('span', {}, 'Reels', h('b', {}, 'Studio'))),
    h('a.rs-btn.primary.rs-new', { href: '#/new' }, h('span', {}, '＋'), h('span.rs-new-label', {}, 'Create series')),
    h(
      'nav.rs-nav',
      {},
      ...NAV.map((n) => {
        const on = n.to === '/' ? here === '/' || here.startsWith('/series/') : here === n.to;
        const count = n.badge?.(d) ?? 0;
        return h('a.rs-nav-item', { href: `#${n.to}`, class: on ? 'on' : undefined, 'aria-current': on ? 'page' : undefined }, h('span.rs-nav-icon', {}, n.icon), h('span.rs-nav-label', {}, n.label), count ? h('span.rs-badge', {}, count) : null);
      }),
    ),
    h(
      'div.rs-side-foot',
      {},
      h('div.rs-engine', {}, h('span', {}, '🎙️ Voice'), h('b', { class: free(d.media.voice) }, `${d.media.voice} · ${free(d.media.voice)}`)),
      h('div.rs-engine', {}, h('span', {}, '🎨 Images'), h('b', { class: free(d.media.images) }, `${d.media.images} · ${free(d.media.images)}`)),
      h('a.rs-back', { href: '/' }, '← Back to the office'),
    ),
  );
}

let drawnPath = '';
let drawnSig = '';

/** Draws the page. `force` draws it even when it's one that's left alone, or someone's typing. */
function draw(force: boolean) {
  drawSide();
  const p = path();
  const route = ROUTES.find((r) => r.match.test(p));
  if (!route) return page.go('/');
  const moved = p !== drawnPath;
  if (!moved && !force && (route.still || editing())) return;
  const next = route.draw(page, ...(route.match.exec(p)!.slice(1)));
  // A page whose videos haven't changed keeps the ones there (so one that's playing goes on playing).
  const sig = next.getAttribute('data-sig') ?? '';
  if (!moved && !force && sig && sig === drawnSig) {
    const old = view.firstElementChild;
    const playing = old && [...old.querySelectorAll('video')].some((v) => !v.paused);
    if (playing) return;
  }
  view.replaceChildren(next);
  drawnPath = p;
  drawnSig = sig;
  if (moved) window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => draw(true));
void page.refresh();
setInterval(() => {
  if (!document.hidden) void page.refresh();
}, REFRESH_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void page.refresh();
});
