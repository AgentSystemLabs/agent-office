// The studio's home: every series on autopilot as a card, with its latest video, what's next and a
// switch to pause it; and, before there are any, how it works and the way to make the first one.

import { h } from '../ui/dom';
import { api, when, type Platform, type ReelRow, type Series } from './api';
import { STYLES } from './presets';
import type { Page } from './main';

const PLATFORM_BADGE: Record<Platform, { label: string; cls: string }> = {
  tiktok: { label: 'TikTok', cls: 'tt' },
  instagram: { label: 'Instagram', cls: 'ig' },
  youtube: { label: 'YouTube', cls: 'yt' },
};

export const platformBadges = (list: Platform[]) => h('div.rs-platforms', {}, ...list.map((p) => h('span.rs-pf', { class: PLATFORM_BADGE[p].cls, title: PLATFORM_BADGE[p].label }, PLATFORM_BADGE[p].label)));

/** The art style tile a series' style is, if it came from one. */
export const swatchOf = (s: Series) => STYLES.find((x) => x.prompt === s.style)?.swatch ?? 'linear-gradient(135deg,#7c3aed,#ec4899)';

/** A small switch: on means it makes and posts by itself. */
export function autopilot(p: Page, s: Series): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: !s.paused, 'aria-label': `Autopilot for ${s.name}` });
  input.addEventListener('change', () => void p.act('/series/set', { series: s.id, paused: !input.checked }, input.checked ? `${s.name} is on autopilot` : `${s.name} is paused`));
  return h('label.rs-switch', { title: s.paused ? 'Paused: nothing is made or posted' : 'On autopilot: it makes and posts by itself' }, input, h('span.rs-switch-track', {}, h('span.rs-switch-dot')), h('span.rs-switch-label', {}, s.paused ? 'Paused' : 'Autopilot'));
}

/** A video's first frame as its cover; the series' colors until it has one. */
export function cover(s: Series, latest: ReelRow | undefined, cls = 'rs-cover'): HTMLElement {
  const el = h(`div.${cls}` as 'div', { style: `background:${swatchOf(s)}` });
  if (latest) el.append(h('video', { src: `${api.videoUrl(latest.id)}#t=1.2`, muted: true, preload: 'metadata', playsinline: true, 'aria-hidden': 'true' }));
  else el.append(h('span.rs-cover-emoji', {}, '🎬'));
  return el;
}

function seriesCard(p: Page, s: Series): HTMLElement {
  const mine = p.data.reels.filter((r) => r.series === s.id);
  const latest = mine.find((r) => r.seconds && ['rendered', 'approved', 'posted'].includes(r.status));
  const c = s.pipeline;
  const next = s.paused ? 'Paused' : !c.approved ? (c.inPipe ? 'Making the next video' : 'Waiting for scripts') : s.nextPostAfter && s.nextPostAfter > Date.now() ? `Next post ${when(s.nextPostAfter)}` : 'Posting soon';
  return h(
    'article.rs-series-card',
    { class: s.paused ? 'paused' : undefined },
    h('a.rs-series-link', { href: `#/series/${s.id}`, 'aria-label': `Open ${s.name}` }, cover(s, latest)),
    h(
      'div.rs-series-body',
      {},
      h('div.rs-series-top', {}, h('a.rs-series-name', { href: `#/series/${s.id}` }, s.name), autopilot(p, s)),
      h('p.rs-series-niche', {}, s.niche),
      platformBadges(s.platforms),
      h('div.rs-mini-stats', {}, h('span', {}, h('b', {}, c.posted), ' posted'), h('span', {}, h('b', {}, c.inPipe), ' in the making'), c.toReview ? h('a.rs-pill.warn', { href: '#/review' }, `${c.toReview} to review`) : null),
      h('div.rs-series-next', {}, h('span.rs-dot', { class: s.paused ? 'off' : 'on' }), next),
    ),
  );
}

/** Before there's a series: what the studio does, in three steps, and the button to start. */
function welcome(): HTMLElement {
  const step = (n: number, icon: string, title: string, text: string) => h('div.rs-how', {}, h('div.rs-how-n', {}, n), h('div.rs-how-icon', {}, icon), h('h3', {}, title), h('p', {}, text));
  return h(
    'section.rs-welcome',
    {},
    h('div.rs-hero', {}, h('span.rs-eyebrow', {}, '✨ Your agents make it, you watch it grow'), h('h1', {}, 'Faceless videos ', h('span.rs-grad', {}, 'on autopilot')), h('p', {}, 'Pick a niche and a look. Your AI crew writes the stories, the studio makes the videos, and they go out to TikTok, Instagram and YouTube on a schedule.'), h('a.rs-btn.primary.big', { href: '#/new' }, '⚡ Create your first series'), h('p.rs-small', {}, 'Free to run: the voice and pictures are made without paid services.')),
    h('div.rs-how-row', {}, step(1, '🎯', 'Create a series', 'Pick a niche, like scary stories or history, or describe your own.'), step(2, '🎨', 'Make it yours', 'Choose the art style, the narrator’s voice and how often to post.'), step(3, '🚀', 'Watch it grow', 'Approve the first videos, connect your accounts, and let it run.')),
  );
}

export function homePage(p: Page): HTMLElement {
  const d = p.data;
  if (!p.loaded) return h('section.rs-loading', {}, h('div.rs-spinner'), 'Opening the studio…');
  if (!d.series.length) return welcome();
  const sig = d.reels.filter((r) => r.seconds).map((r) => r.id).join(',') + d.series.map((s) => `${s.id}${s.paused}`).join(',');
  const toReview = d.reels.filter((r) => r.status === 'rendered').length;
  const views = d.reels.reduce((n, r) => n + (r.posts ?? []).reduce((m, x) => m + (x.views ?? 0), 0), 0);
  return h(
    'section.rs-page',
    { 'data-sig': sig },
    h('header.rs-page-head', {}, h('div', {}, h('h1', {}, 'My series'), h('p.rs-sub', {}, 'Each series is one niche on autopilot. Open one to see its videos.')), h('a.rs-btn.primary', { href: '#/new' }, '＋ Create series')),
    toReview ? h('a.rs-banner', { href: '#/review' }, h('span.rs-banner-icon', {}, '👀'), h('span', {}, h('b', {}, `${toReview} video${toReview === 1 ? ' is' : 's are'} waiting for your review.`), ' Approve them and they post on schedule.'), h('span.rs-banner-go', {}, 'Review →')) : null,
    h('div.rs-kpis', {}, kpi('Series', d.series.length), kpi('Videos posted', d.series.reduce((n, s) => n + s.pipeline.posted, 0)), kpi('Total views', views.toLocaleString()), kpi('In the making', d.series.reduce((n, s) => n + s.pipeline.inPipe, 0))),
    h('div.rs-series-grid', {}, ...d.series.map((s) => seriesCard(p, s)), h('a.rs-series-card.rs-add', { href: '#/new' }, h('span.rs-add-plus', {}, '＋'), h('b', {}, 'New series'), h('span', {}, 'Another niche, another page'))),
  );
}

const kpi = (label: string, value: string | number) => h('div.rs-kpi', {}, h('b', {}, value), h('span', {}, label));
