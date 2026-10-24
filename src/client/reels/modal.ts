// A reel in full on the studio's page: its video, script, caption and posts, and what a person can
// do with it there. The window closes by its ✕, by Esc, or by a click outside it.

import { h } from '../ui/dom';
import { PLATFORMS, STATUS_LABEL, api, short, when, type Reel } from './api';
import type { Page } from './main';

let open: { el: HTMLElement; close: () => void } | undefined;

function modal(title: string, ...body: (HTMLElement | null)[]): () => void {
  open?.close();
  const x = h('button.rs-x', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const box = h('div.rs-modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, h('header.rs-modal-head', {}, h('h2', {}, title), x), h('div.rs-modal-body', {}, ...body));
  const back = h('div.rs-backdrop', {}, box);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('rs-locked');
    if (open?.el === back) open = undefined;
  };
  x.addEventListener('click', close);
  back.addEventListener('mousedown', (e) => {
    if (e.target === back) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.classList.add('rs-locked');
  document.body.append(back);
  open = { el: back, close };
  x.focus();
  return close;
}

/** Approve, or send back with a note on what to fix. */
export function reviewBox(p: Page, id: string, after?: () => void): HTMLElement {
  const note = h('textarea.rs-input', { rows: 2, placeholder: 'What to fix, if you send it back (the writer reads this)', 'aria-label': 'Note for the writer' });
  const approve = h('button.rs-btn.primary', { type: 'button' }, '✅ Approve');
  const reject = h('button.rs-btn.soft-danger', { type: 'button' }, '✏️ Send back');
  const go = async (yes: boolean) => {
    if (!yes && !note.value.trim()) {
      note.focus();
      return p.toast('Say what to fix first', true);
    }
    approve.disabled = reject.disabled = true;
    const ok = await p.act('/review', { reel: id, approve: yes, note: note.value }, yes ? 'Approved: it posts on the schedule' : 'Sent back to the writer');
    approve.disabled = reject.disabled = false;
    if (ok) after?.();
  };
  approve.addEventListener('click', () => void go(true));
  reject.addEventListener('click', () => void go(false));
  return h('div.rs-review-box', {}, note, h('div.rs-row', {}, approve, reject));
}

const section = (title: string, ...children: (HTMLElement | string | null)[]) => h('section.rs-sec', {}, h('h3', {}, title), ...children);

/** Opens a reel in full. */
export async function openReel(p: Page, id: string): Promise<void> {
  let r: Reel;
  try {
    r = await api.reel(id);
  } catch (e) {
    return p.toast((e as Error).message, true);
  }
  const series = p.data.series.find((s) => s.id === r.seriesId);
  let close = () => {};
  const actions: HTMLElement[] = [];
  const act = (label: string, path: string, done: string, primary = false) => {
    const b = h('button.rs-btn', { type: 'button', class: primary ? 'primary' : undefined }, label);
    b.addEventListener('click', async () => {
      b.disabled = true;
      if (await p.act(path, { reel: r.id }, done)) close();
      b.disabled = false;
    });
    actions.push(b);
  };
  if (r.status === 'approved') act('📲 Post now', '/post', 'Posted', true);
  if (r.scenes?.length && !['rendering', 'posting', 'posted'].includes(r.status)) act('🔁 Make the video again', '/remake', 'It’s back in line to be made');

  const video = r.videoExists ? h('video.rs-video', { src: api.videoUrl(r.id, r.updatedAt), controls: true, preload: 'metadata', playsinline: true }) : null;
  const meta = h(
    'p.rs-kicker',
    {},
    [STATUS_LABEL[r.status], series?.name, r.duration ? `${Math.round(r.duration)}s` : '', `idea by ${r.addedBy}`, r.scriptedBy ? `written by ${r.scriptedBy}` : '', r.reviewedBy ? `reviewed by ${r.reviewedBy}` : '', `updated ${when(r.updatedAt)}`].filter(Boolean).join(' · '),
  );
  const scenes = r.scenes?.length
    ? h('ol.rs-scenes', {}, ...r.scenes.map((s) => h('li', {}, h('p', {}, s.narration), h('p.rs-visual', {}, `🖼 ${s.visual}`))))
    : h('p.rs-kicker', {}, r.idea ?? 'No script yet: the writer picks ideas up in order.');
  const posts = PLATFORMS.filter((pl) => r.posts[pl]).map((pl) => {
    const post = r.posts[pl]!;
    const stats = post.stats ? ` · ${short(post.stats.views)} views, ${short(post.stats.likes)} likes, ${short(post.stats.comments)} comments` : '';
    return h('li', {}, h('b', {}, pl), ' ', post.error ? h('span.bad', {}, post.error) : post.url ? h('a', { href: post.url, target: '_blank', rel: 'noopener' }, 'open the post') : 'posted', stats);
  });

  close = modal(
    r.title,
    meta,
    r.error ? h('p.rs-alert', {}, `⚠️ ${r.error}`) : null,
    r.review ? h('p.rs-alert.info', {}, `Editor: ${r.review}`) : null,
    h('div.rs-detail', {}, video, h('div.rs-detail-text', {}, r.hook ? section('Hook', h('p.rs-hook', {}, `“${r.hook}”`)) : null, section('Script', scenes), r.postCaption ? section('Posts with', h('pre.rs-caption', {}, r.postCaption)) : null, posts.length ? section('Posts', h('ul.rs-posts', {}, ...posts)) : null)),
    r.status === 'rendered' ? section('Your call', reviewBox(p, r.id, () => close())) : null,
    actions.length ? h('div.rs-row.rs-actions', {}, ...actions) : null,
  );
}
