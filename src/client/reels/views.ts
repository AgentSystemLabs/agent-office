// The studio's other pages: the AI crew and hiring it, the numbers, and the accounts it posts to.

import { h } from '../ui/dom';
import { PLATFORMS, ROLES, short, when, type Platform, type ReelRow } from './api';
import { openReel } from './modal';
import type { Page } from './main';

const ROLE: Record<(typeof ROLES)[number], { emoji: string; title: string; what: string; color: string }> = {
  scout: { emoji: '🔭', title: 'Scout', what: 'Finds story ideas that will stop the scroll', color: '#e0f2fe' },
  writer: { emoji: '✍️', title: 'Writer', what: 'Turns ideas into tight 60-second scripts', color: '#fce7f3' },
  editor: { emoji: '🎬', title: 'Editor', what: 'Watches every video and approves the good ones', color: '#ede9fe' },
  analyst: { emoji: '📈', title: 'Analyst', what: 'Reads the numbers and tells the crew what works', color: '#dcfce7' },
};

const STATUS_WORDS: Record<string, string> = { working: 'Working…', idle: 'Ready', done: 'Ready', needs_input: 'Needs you', starting: 'Starting', exited: 'Resting', offline: 'Offline', gone: 'Left' };

export function crewPage(p: Page): HTMLElement {
  const d = p.data;
  const seriesName = (id?: string) => (id ? d.series.find((s) => s.id === id)?.name ?? id : 'Every series');
  const cards = ROLES.map((role) => {
    const r = ROLE[role];
    const members = d.crew.filter((c) => c.role === role);
    return h(
      'article.rs-crew-card',
      { style: `--role:${r.color}` },
      h('div.rs-crew-avatar', {}, r.emoji),
      h('h3', {}, r.title),
      h('p.rs-sub', {}, r.what),
      members.length
        ? h('div.rs-crew-members', {}, ...members.map((m) => h('div.rs-member', {}, h('b', {}, m.name), h('span.rs-mood', { class: m.status }, STATUS_WORDS[m.status] ?? m.status), h('small', {}, seriesName(m.seriesId)))))
        : h('div.rs-member.vacant', {}, h('b', {}, 'Nobody yet'), h('small', {}, 'Hire one below')),
    );
  });

  const series = h('select.rs-input', { 'aria-label': 'Works on' }, h('option', { value: '' }, 'Every series'), ...d.series.map((s) => h('option', { value: s.id }, s.name)));
  const floor = h('select.rs-input', { 'aria-label': 'Floor' }, ...d.floors.map((f) => h('option', { value: f.id }, f.name)));
  const picks = ROLES.map((role) => h('label.rs-chip-check', {}, h('input', { type: 'checkbox', value: role, checked: !d.crew.some((c) => c.role === role) }), `${ROLE[role].emoji} ${ROLE[role].title}`));
  const hire = h('button.rs-btn.primary', { type: 'button' }, '🤝 Hire');
  hire.addEventListener('click', async () => {
    const roles = picks.map((l) => l.querySelector('input')!).filter((i) => i.checked).map((i) => i.value);
    if (!roles.length) return p.toast('Pick at least one role', true);
    hire.disabled = true;
    await p.act('/crew', { roles, series: series.value || undefined, floor: floor.value }, 'Hired: they’re at their desks and getting to work');
    hire.disabled = false;
  });

  return h(
    'section.rs-page',
    {},
    h('header.rs-page-head', {}, h('div', {}, h('h1', {}, 'Your AI crew'), h('p.rs-sub', {}, 'Four agents run your pages. Each sits at a desk in the office, where you can watch them work and talk to them.'))),
    h('div.rs-crew-grid', {}, ...cards),
    h('div.rs-panel', {}, h('h3', {}, 'Hire crew'), h('div.rs-row', {}, ...picks), h('div.rs-two', {}, h('label.rs-field', {}, h('span', {}, 'Works on'), series), d.floors.length > 1 ? h('label.rs-field', {}, h('span', {}, 'Sits on the floor'), floor) : h('span')), h('div.rs-row', {}, hire, h('span.rs-sub.small', {}, 'Roles someone already has are skipped.'))),
  );
}

const viewsOf = (r: ReelRow) => (r.posts ?? []).reduce((n, x) => n + (x.views ?? 0), 0);

export function analyticsPage(p: Page): HTMLElement {
  const d = p.data;
  const posted = d.reels.filter((r) => r.status === 'posted' || r.posts?.length);
  const total = posted.reduce((n, r) => n + viewsOf(r), 0);
  const best = [...posted].sort((a, b) => viewsOf(b) - viewsOf(a));
  const top = viewsOf(best[0] ?? ({} as ReelRow)) || 1;
  const fetchBtn = h('button.rs-btn.primary', { type: 'button' }, '🔄 Refresh numbers');
  fetchBtn.addEventListener('click', async () => {
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Asking the platforms…';
    await p.act('/stats', {}, 'Numbers updated');
    fetchBtn.disabled = false;
    fetchBtn.textContent = '🔄 Refresh numbers';
  });
  const byPlatform = (pl: Platform) => posted.reduce((n, r) => n + (r.posts?.find((x) => x.platform === pl)?.views ?? 0), 0);
  // The payout bars: TikTok's Creator Rewards and YouTube's Partner Program, by views (followers aren't read yet).
  const goal = (label: string, have: number, need: number, what: string) => h('div.rs-goal', {}, h('div.rs-row.between', {}, h('b', {}, label), h('span', {}, `${short(have)} / ${short(need)}`)), h('div.rs-bar', {}, h('i', { style: `width:${Math.min(100, (have / need) * 100).toFixed(1)}%` })), h('small', {}, what));

  return h(
    'section.rs-page',
    {},
    h('header.rs-page-head', {}, h('div', {}, h('h1', {}, 'Analytics'), h('p.rs-sub', {}, `Last checked ${when(d.lastStats)}. Your analyst checks once a day.`)), fetchBtn),
    h('div.rs-kpis', {}, ...[['Total views', short(total)], ['Videos posted', posted.length], ['TikTok views', short(byPlatform('tiktok'))], ['YouTube views', short(byPlatform('youtube'))]].map(([l, v]) => h('div.rs-kpi', {}, h('b', {}, v), h('span', {}, l)))),
    h('div.rs-panel', {}, h('h3', {}, '💰 On the way to getting paid'), goal('TikTok Creator Rewards', byPlatform('tiktok'), 100_000, 'Also needs 10k followers, and videos over a minute'), goal('YouTube Partner Program (Shorts)', byPlatform('youtube'), 10_000_000, 'Views in 90 days; also needs 1,000 subscribers')),
    posted.length
      ? h(
          'div.rs-panel',
          {},
          h('h3', {}, '🏆 Top videos'),
          h(
            'ol.rs-top',
            {},
            ...best.slice(0, 10).map((r) =>
              h('li', {}, h('button.rs-top-row', { type: 'button', onclick: () => void openReel(p, r.id) }, h('span.rs-top-title', {}, r.title), h('span.rs-top-bar', {}, h('i', { style: `width:${((viewsOf(r) / top) * 100).toFixed(1)}%` })), h('b', {}, short(viewsOf(r))))),
            ),
          ),
        )
      : h('div.rs-empty', {}, h('div.rs-big-emoji', {}, '📊'), h('h2', {}, 'No numbers yet'), h('p', {}, 'Once videos are posted, their views, likes and comments show up here.')),
  );
}

export function accountsPage(p: Page): HTMLElement {
  const info: Record<Platform, { name: string; cls: string; how: string }> = {
    tiktok: { name: 'TikTok', cls: 'tt', how: 'Needs a TikTok developer app with the Content Posting API. Until TikTok audits it, posts go out as private.' },
    instagram: { name: 'Instagram', cls: 'ig', how: 'Needs a Business or Creator account and a Meta developer app that can publish.' },
    youtube: { name: 'YouTube', cls: 'yt', how: 'Needs a Google Cloud app with the YouTube Data API, signed in to your channel.' },
  };
  return h(
    'section.rs-page',
    {},
    h('header.rs-page-head', {}, h('div', {}, h('h1', {}, 'Accounts'), h('p.rs-sub', {}, 'Where your videos get posted. Each platform is connected once, by whoever runs the office.'))),
    h(
      'div.rs-accounts',
      {},
      ...PLATFORMS.map((pl) => {
        const on = p.data.connected.includes(pl);
        return h('article.rs-account', { class: on ? 'on' : undefined }, h('span.rs-pf.big', { class: info[pl].cls }, info[pl].name), h('div.rs-account-state', {}, h('span.rs-dot', { class: on ? 'on' : 'off' }), on ? 'Connected' : 'Not connected'), h('p.rs-sub', {}, on ? 'Approved videos post here on each series’ schedule.' : info[pl].how));
      }),
    ),
    h('div.rs-panel', {}, h('h3', {}, 'How to connect'), h('p.rs-sub', {}, 'The sign-ins go in .agent-office/reels/accounts.json on the office’s computer. The step-by-step for each platform is in docs/reels.md. No agent can read them: the crew only sees which platforms are connected.')),
  );
}
