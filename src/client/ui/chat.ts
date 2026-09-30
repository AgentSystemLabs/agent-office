// The chat in the corner: the latest lines, each fading away a while after it came in.

import { store } from '../state';
import type { ChatLine } from '../../shared/protocol';
import { $, h } from './dom';

/** How long a chat line stays up before it fades away. Hovering the chat, or typing in it, brings them all back. */
const CHAT_LINGER = 12_000;
/** When this page first showed each line. */
const chatSeen = new WeakMap<ChatLine, number>();

export function renderChat() {
  const log = $('chat-log');
  const now = performance.now();
  log.replaceChildren(
    ...store.chat.slice(-60).map((c) => {
      const seen = chatSeen.get(c) ?? now;
      chatSeen.set(c, seen);
      // Older lines start their fade in the past, so they're already gone.
      return h(
        'li',
        { style: `animation-delay:${Math.round(CHAT_LINGER - (now - seen))}ms` },
        h('b', { style: `color:${c.color}`, title: c.account ? `${c.name}, signed in with their own account` : undefined }, c.name),
        c.account ? h('span.acct', {}, ' ✓') : null,
        ': ',
        c.text,
      );
    }),
  );
  log.scrollTop = log.scrollHeight;
}
