// Reviewing the new videos one at a time, like a feed: watch it, then approve it (A or →) or send it
// back with a note for the writer (S, then type). The next one comes in on its own.

import { h } from '../ui/dom';
import { api, type Reel } from './api';
import type { Page } from './main';

/** The ones skipped this visit, so they come round again last. */
const skipped = new Set<string>();
let keys: ((e: KeyboardEvent) => void) | undefined;

export function reviewPage(p: Page): HTMLElement {
  const root = h('section.rs-page.rs-deck-page');
  const queue = () => {
    const waiting = p.data.reels.filter((r) => r.status === 'rendered');
    return [...waiting.filter((r) => !skipped.has(r.id)), ...waiting.filter((r) => skipped.has(r.id))];
  };
  let done = 0;

  const draw = async () => {
    const list = queue();
    if (keys) document.removeEventListener('keydown', keys);
    keys = undefined;
    if (!list.length) {
      root.replaceChildren(
        h('header.rs-page-head', {}, h('div', {}, h('h1', {}, 'Review'), h('p.rs-sub', {}, 'New videos wait here for a yes or a no before they post.'))),
        h('div.rs-empty.rs-all-done', {}, h('div.rs-big-emoji', {}, done ? '🎉' : '🍿'), h('h2', {}, done ? `All caught up: ${done} reviewed` : 'Nothing to review'), h('p', {}, done ? 'Approved videos post on each series’ schedule.' : 'New videos show up here as soon as they’re made.'), h('a.rs-btn.primary', { href: '#/' }, 'Back to my series')),
      );
      return;
    }
    const row = list[0];
    let reel: Reel;
    try {
      reel = await api.reel(row.id);
    } catch (e) {
      p.toast((e as Error).message, true);
      return;
    }
    const series = p.data.series.find((s) => s.id === reel.seriesId);
    const video = h('video.rs-deck-video', { src: api.videoUrl(reel.id, reel.updatedAt), controls: true, autoplay: true, playsinline: true, preload: 'auto' });
    const note = h('textarea.rs-input', { rows: 2, placeholder: 'What should the writer fix? e.g. “the hook is too slow”', 'aria-label': 'Note for the writer' });
    const noteBox = h('div.rs-sendback', { hidden: true }, note, h('div.rs-row', {}, h('button.rs-btn.danger', { type: 'button', onclick: () => void decide(false) }, 'Send back'), h('button.rs-btn.ghost', { type: 'button', onclick: () => ((noteBox.hidden = true), approve.focus()) }, 'Cancel')));
    const approve = h('button.rs-btn.primary.big', { type: 'button' }, '✅ Approve', h('kbd', {}, 'A'));
    const reject = h('button.rs-btn.big.soft-danger', { type: 'button' }, '✏️ Send back', h('kbd', {}, 'S'));
    const skip = h('button.rs-btn.ghost', { type: 'button' }, 'Skip for now');
    const card = h('div.rs-deck-card');

    const decide = async (yes: boolean) => {
      if (!yes && !note.value.trim()) {
        noteBox.hidden = false;
        note.focus();
        return;
      }
      approve.disabled = reject.disabled = true;
      card.classList.add(yes ? 'fly-right' : 'fly-left');
      const ok = await p.act('/review', { reel: reel.id, approve: yes, note: note.value }, yes ? 'Approved: it posts on schedule' : 'Sent back to the writer');
      if (ok === undefined) {
        card.classList.remove('fly-right', 'fly-left');
        approve.disabled = reject.disabled = false;
        return;
      }
      done++;
      skipped.delete(reel.id);
      void draw();
    };
    approve.addEventListener('click', () => void decide(true));
    reject.addEventListener('click', () => void decide(false));
    skip.addEventListener('click', () => {
      skipped.add(reel.id);
      void draw();
    });
    keys = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches('input, textarea, select') || !root.isConnected) return;
      if (e.key === 'a' || e.key === 'ArrowRight') void decide(true);
      else if (e.key === 's' || e.key === 'ArrowLeft') {
        e.preventDefault();
        noteBox.hidden = false;
        note.focus();
      }
    };
    document.addEventListener('keydown', keys);

    card.append(
      h('div.rs-deck-video-wrap', {}, video),
      h(
        'div.rs-deck-side',
        {},
        h('div.rs-deck-count', {}, `${list.length} to review`),
        h('span.rs-eyebrow', {}, series?.name ?? 'Series'),
        h('h2.rs-deck-title', {}, reel.title),
        reel.hook ? h('p.rs-deck-hook', {}, `“${reel.hook}”`) : null,
        h('div.rs-deck-actions', {}, approve, reject),
        noteBox,
        h('details.rs-fold.rs-deck-more', {}, h('summary', {}, 'Script and caption'), h('ol.rs-scenes', {}, ...(reel.scenes ?? []).map((s) => h('li', {}, s.narration))), reel.postCaption ? h('pre.rs-caption', {}, reel.postCaption) : null),
        h('p.rs-sub.small', {}, `Written by ${reel.scriptedBy ?? reel.addedBy} · ${Math.round(reel.duration ?? 0)}s · `, skip),
      ),
    );
    root.replaceChildren(h('header.rs-page-head', {}, h('div', {}, h('h1', {}, 'Review'), h('p.rs-sub', {}, 'Watch it, then approve or send it back. Approved videos post on schedule.'))), card);
  };
  void draw();
  return root;
}
