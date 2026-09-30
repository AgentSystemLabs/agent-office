import type { GhComment } from '../../../shared/protocol';
import type { Net } from '../../net';
import { h } from '../dom';
import { markdown } from '../markdown';
import { commentWaiters } from './api';
import { DRAFT_KEY, pref, savePref } from './prefs';

// ---- Comment box --------------------------------------------------------------------------------

export interface CommentBox {
  el: HTMLElement;
  /** Names the GitHub account the comment goes out as, once the window knows it. */
  setViewer(login: string): void;
  /** Stops waiting for an answer; the window closed. */
  dispose(): void;
}

/**
 * Where you comment on an issue or a PR's conversation. It goes out through the server's gh, so
 * as that account rather than as you. The draft is kept per item until it is posted, so Esc or a
 * closed window doesn't lose it.
 */
export function commentBox(kind: 'issue' | 'pull', number: number, itemUrl: string, net: Net, onPosted: (c: GhComment) => void): CommentBox {
  const draftKey = `${DRAFT_KEY}${itemUrl}`;
  const waitKey = `${kind}#${number}`;
  let busy = false;
  let timer = 0;
  const ta = h('textarea', { rows: 4, placeholder: 'Leave a comment. Markdown works; ⌘/Ctrl+Enter posts it.', 'aria-label': 'Comment' }) as HTMLTextAreaElement;
  ta.value = pref<string>(draftKey, '');
  const shown = h('div.gh-compose-preview.hidden');
  const write = h('button.btn.on', { type: 'button' }, 'Write');
  const preview = h('button.btn', { type: 'button' }, 'Preview');
  const who = h('span.grow', {}, "Posts to GitHub as the office's gh account");
  const post = h('button.btn.primary', { type: 'button' }, '💬 Comment');
  const result = h('div.gh-merge-result.error.hidden');
  const el = h(
    'article.gh-card.gh-compose',
    {},
    h('header', {}, h('b', {}, 'Add a comment'), h('span.grow'), h('div.seg', {}, write, preview)),
    h('div.gh-compose-body', {}, ta, shown),
    result,
    h('div.gh-compose-foot', {}, who, post),
  );

  const sync = () => {
    post.disabled = busy || !ta.value.trim();
    ta.readOnly = busy;
    post.textContent = busy ? 'Posting…' : '💬 Comment';
  };
  const saveDraft = () => {
    if (ta.value) savePref(draftKey, ta.value);
    else
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // storage blocked
      }
  };
  const setPreview = (on: boolean) => {
    write.classList.toggle('on', !on);
    preview.classList.toggle('on', on);
    ta.classList.toggle('hidden', on);
    shown.classList.toggle('hidden', !on);
    if (on) shown.replaceChildren(ta.value.trim() ? markdown(ta.value, itemUrl) : h('p.gh-quiet', {}, 'Nothing to preview.'));
    else ta.focus();
  };
  const fail = (text: string) => {
    result.textContent = text;
    result.classList.remove('hidden');
  };
  const settle = () => {
    commentWaiters.delete(waitKey);
    clearTimeout(timer);
    busy = false;
  };
  const submit = () => {
    const body = ta.value;
    if (busy || !body.trim()) return;
    busy = true;
    result.classList.add('hidden');
    sync();
    commentWaiters.set(waitKey, (msg) => {
      settle();
      if (msg.comment) {
        ta.value = '';
        saveDraft();
        setPreview(false);
        onPosted(msg.comment);
      } else fail(msg.error ?? 'GitHub did not take the comment');
      sync();
    });
    // The office drops messages while it's disconnected, and then no answer comes.
    timer = window.setTimeout(() => {
      settle();
      fail('No answer from the office. Reload the conversation to see whether the comment went through before posting it again.');
      sync();
    }, 45_000);
    net.send({ t: 'gh.comment', kind, number, body });
  };

  ta.addEventListener('input', () => (saveDraft(), sync()));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  });
  write.addEventListener('click', () => setPreview(false));
  preview.addEventListener('click', () => setPreview(true));
  post.addEventListener('click', submit);
  sync();
  return {
    el,
    setViewer(login) {
      if (login) who.textContent = `Posts to GitHub as @${login}`;
    },
    dispose: settle,
  };
}
