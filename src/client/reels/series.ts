// One series: its videos as a grid to filter by where they are, what's coming up, the crew's notes,
// adding an idea by hand, and its settings.

import { h } from '../ui/dom';
import { PLATFORMS, STATUS_LABEL, api, short, when, type ReelRow, type ReelStatus, type Series } from './api';
import { autopilot, cover, platformBadges } from './home';
import { openReel } from './modal';
import { FREQUENCIES, STYLES, VOICES } from './presets';
import type { Page } from './main';

const FILTERS: { id: string; label: string; statuses: ReelStatus[] }[] = [
  { id: 'all', label: 'All', statuses: [] },
  { id: 'review', label: '👀 To review', statuses: ['rendered'] },
  { id: 'ready', label: '✅ Scheduled', statuses: ['approved', 'posting'] },
  { id: 'posted', label: '🚀 Posted', statuses: ['posted'] },
  { id: 'making', label: '⚙️ In the making', statuses: ['scripted', 'rendering'] },
  { id: 'ideas', label: '💡 Ideas', statuses: ['idea', 'rejected'] },
  { id: 'failed', label: '⚠️ Failed', statuses: ['failed'] },
];
const filterOf: Record<string, string> = {};

/** One video in the grid: its first frame (or where it is, before there's a video), its title and status. */
function tile(p: Page, r: ReelRow): HTMLElement {
  const views = (r.posts ?? []).reduce((n, x) => n + (x.views ?? 0), 0);
  const thumb = r.seconds
    ? h('div.rs-thumb', {}, h('video', { src: `${api.videoUrl(r.id)}#t=1.2`, muted: true, preload: 'metadata', playsinline: true }), h('span.rs-play', {}, '▶'), h('span.rs-dur', {}, `0:${String(r.seconds).padStart(2, '0')}`))
    : h('div.rs-thumb.empty', { class: r.status }, h('span', {}, { idea: '💡', scripted: '✍️', rendering: '⚙️', rejected: '✏️', failed: '⚠️' }[r.status as string] ?? '🎬'), h('small', {}, r.status === 'rendering' ? 'Making the video…' : r.status === 'scripted' ? 'In line to be made' : r.status === 'failed' ? 'Couldn’t be made' : r.status === 'rejected' ? 'Being rewritten' : 'Waiting for a script'));
  return h(
    'button.rs-video-tile',
    { type: 'button', onclick: () => void openReel(p, r.id), title: r.title },
    thumb,
    h('span.rs-status-pill', { class: r.status }, STATUS_LABEL[r.status]),
    h('b.rs-tile-title', {}, r.title),
    h('small.rs-tile-meta', {}, views ? `👁 ${short(views)} views` : r.error ? r.error.slice(0, 60) : r.review && r.status === 'rejected' ? `Editor: ${r.review.slice(0, 60)}` : `by ${r.by}`),
  );
}

function settingsForm(p: Page, s: Series): HTMLElement {
  const input = (name: string, value = '', placeholder = '') => h('input.rs-input', { name, value, placeholder });
  const select = (name: string, value: string, options: [string, string][]) => h('select.rs-input', { name }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
  const style = STYLES.find((x) => x.prompt === s.style);
  const styleArea = h('textarea.rs-input', { name: 'style', rows: 2 });
  styleArea.value = s.style;
  const niche = h('textarea.rs-input', { name: 'niche', rows: 2 });
  niche.value = s.niche;
  const field = (label: string, el: HTMLElement, hint?: string) => h('label.rs-field', {}, h('span', {}, label), el, hint ? h('small', {}, hint) : null);
  const form = h(
    'form.rs-settings',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const f = new FormData(form);
        const v = (k: string) => String(f.get(k) ?? '').trim();
        await p.act('/series/set', { series: s.id, name: v('name'), niche: v('niche'), style: v('style'), voice: v('voice'), tone: v('tone'), cta: v('cta'), hashtags: v('hashtags'), music: v('music'), postsPerDay: Number(v('postsPerDay')), platforms: f.getAll('platforms').map(String), tiktokPrivacy: v('tiktokPrivacy'), youtubePrivacy: v('youtubePrivacy') }, 'Saved');
      },
    },
    h('div.rs-two', {}, field('Name', input('name', s.name)), field('Posts', select('postsPerDay', String(s.postsPerDay), [...FREQUENCIES.map((f) => [String(f.perDay), f.label] as [string, string]), ...(FREQUENCIES.some((f) => f.perDay === s.postsPerDay) ? [] : [[String(s.postsPerDay), `${s.postsPerDay} a day`] as [string, string]])]))),
    field('What it’s about', niche),
    h('div.rs-row.rs-style-pick', {}, ...STYLES.map((x) => h('button.rs-swatch.small', { type: 'button', title: x.name, class: x === style ? 'on' : undefined, style: `background:${x.swatch}`, onclick: () => (styleArea.value = x.prompt) }, x.emoji))),
    field('Art style', styleArea, 'Pick a swatch above, or describe your own'),
    h('div.rs-two', {}, field('Voice', select('voice', s.voice, [...VOICES.map((v) => [v.id, `${v.name} · ${v.what}`] as [string, string]), ...(VOICES.some((v) => v.id === s.voice) ? [] : [[s.voice, s.voice] as [string, string]])])), field('How it’s read', input('tone', s.tone, 'calm, low, suspenseful'))),
    h('div.rs-two', {}, field('Call to action', input('cta', s.cta, 'Follow for part 2')), field('Hashtags', input('hashtags', s.hashtags.join(' '), 'history mystery'))),
    field('Background music', input('music', s.music, 'track.mp3'), 'A file in .agent-office/reels/music on the office’s computer'),
    h('div.rs-field', {}, h('span', {}, 'Posts to'), h('div.rs-row', {}, ...PLATFORMS.map((pl) => h('label.rs-chip-check', {}, h('input', { type: 'checkbox', name: 'platforms', value: pl, checked: s.platforms.includes(pl) }), pl)))),
    h('div.rs-two', {}, field('Who sees TikTok posts', select('tiktokPrivacy', s.tiktokPrivacy, [['SELF_ONLY', 'Only me (until TikTok approves the app)'], ['FOLLOWER_OF_CREATOR', 'Followers'], ['MUTUAL_FOLLOW_FRIENDS', 'Friends'], ['PUBLIC_TO_EVERYONE', 'Everyone']])), field('YouTube', select('youtubePrivacy', s.youtubePrivacy, [['private', 'Private'], ['unlisted', 'Unlisted'], ['public', 'Public']]))),
    h('div.rs-row', {}, h('button.rs-btn.primary', { type: 'submit' }, 'Save changes')),
  );
  return form;
}

function addIdea(p: Page, s: Series): HTMLElement {
  const title = h('input.rs-input', { name: 'title', placeholder: 'A story idea, e.g. “the lighthouse keepers who vanished”', 'aria-label': 'Idea' });
  const form = h(
    'form.rs-idea',
    {
      onsubmit: async (e: Event) => {
        e.preventDefault();
        if (await p.act('/idea', { series: s.id, title: title.value }, 'Idea added: the writer picks it up next')) form.reset();
      },
    },
    title,
    h('button.rs-btn', { type: 'submit' }, '💡 Add'),
  );
  return form;
}

export function seriesPage(p: Page, id: string): HTMLElement {
  const s = p.data.series.find((x) => x.id === id);
  if (!s) return h('section.rs-page', {}, p.loaded ? h('div.rs-empty', {}, h('h2', {}, 'That series is gone'), h('a.rs-btn.primary', { href: '#/' }, 'Back to my series')) : h('div.rs-loading', {}, h('div.rs-spinner'), 'Loading…'));
  const mine = p.data.reels.filter((r) => r.series === s.id);
  const filter = FILTERS.find((f) => f.id === filterOf[s.id]) ?? FILTERS[0];
  const shown = filter.statuses.length ? mine.filter((r) => filter.statuses.includes(r.status)) : mine;
  const latest = mine.find((r) => r.seconds);
  const c = s.pipeline;
  const views = mine.reduce((n, r) => n + (r.posts ?? []).reduce((m, x) => m + (x.views ?? 0), 0), 0);
  const sig = `${mine.map((r) => r.id + r.status).join(',')}|${filter.id}|${s.paused}|${s.notes.length}`;

  const grid = shown.length
    ? h('div.rs-video-grid', {}, ...shown.map((r) => tile(p, r)))
    : h('div.rs-empty.small', {}, h('p', {}, filter.id === 'all' ? 'No videos yet: the crew is on it. Ideas show up here first, then scripts, then videos.' : 'Nothing here right now.'));

  return h(
    'section.rs-page',
    { 'data-sig': sig },
    h('a.rs-crumb', { href: '#/' }, '← My series'),
    h(
      'header.rs-series-hero',
      {},
      cover(s, latest, 'rs-hero-cover'),
      h(
        'div.rs-hero-text',
        {},
        h('div.rs-row', {}, h('h1', {}, s.name), autopilot(p, s)),
        h('p.rs-sub', {}, s.niche),
        platformBadges(s.platforms),
        h('div.rs-kpis.small', {}, kpi('Posted', c.posted), kpi('Views', short(views)), kpi('To review', c.toReview), kpi(s.paused ? 'Paused' : c.approved ? 'Next post' : 'Next post, once one’s approved', s.paused || !c.approved ? '—' : when(s.nextPostAfter && s.nextPostAfter > Date.now() ? s.nextPostAfter : Date.now()))),
      ),
    ),
    c.toReview ? h('a.rs-banner', { href: '#/review' }, h('span.rs-banner-icon', {}, '👀'), h('span', {}, h('b', {}, `${c.toReview} new video${c.toReview === 1 ? '' : 's'} to review.`), ' Nothing posts until it’s approved.'), h('span.rs-banner-go', {}, 'Review →')) : null,
    h(
      'div.rs-filters',
      { role: 'tablist' },
      ...FILTERS.map((f) => {
        const n = f.statuses.length ? mine.filter((r) => f.statuses.includes(r.status)).length : mine.length;
        if (!n && f.id !== 'all' && f.id !== filter.id) return null;
        return h('button.rs-filter', { type: 'button', role: 'tab', 'aria-selected': f === filter ? 'true' : 'false', class: f === filter ? 'on' : undefined, onclick: () => ((filterOf[s.id] = f.id), p.go(`/series/${s.id}`)) }, f.label, h('span', {}, n));
      }),
    ),
    grid,
    h('div.rs-panel', {}, h('h3', {}, '💡 Add your own idea'), h('p.rs-sub', {}, 'Got a story in mind? The writer turns it into a script.'), addIdea(p, s)),
    h('details.rs-panel.rs-fold', { open: s.notes.length > 0 && s.notes.length < 4 }, h('summary', {}, h('h3', {}, `📝 What the crew learned (${s.notes.length})`)), s.notes.length ? h('ul.rs-notes', {}, ...[...s.notes].reverse().map((n) => h('li', {}, h('p', {}, n.text), h('small', {}, `${n.by} · ${when(n.at)}`)))) : h('p.rs-sub', {}, 'Once videos are posted, your analyst writes down what works here, and the writer follows it.')),
    h('details.rs-panel.rs-fold', {}, h('summary', {}, h('h3', {}, '⚙️ Series settings')), settingsForm(p, s)),
  );
}

const kpi = (label: string, value: string | number) => h('div.rs-kpi', {}, h('b', {}, value), h('span', {}, label));
