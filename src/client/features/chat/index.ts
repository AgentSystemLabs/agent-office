/** The chat: T or Enter to type in it, Enter sends, Esc lets go; what's said shows in the chat log. */
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { $ } from '../../ui/dom';
import { renderChat } from '../../ui/chat';

/** Registers T and Enter, and what follows the chat (store 'chat'). */
export function installChat(ctx: Ctx) {
  ctx.keys.bind({
    code: ['KeyT', 'Enter'],
    preventDefault: true,
    run: () => {
      // With the chat turned off, it shows while you type.
      $('chat').classList.add('peek');
      $('chat-input').focus();
    },
  });
  const chatInput = $('chat-input') as HTMLInputElement;
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) ctx.net.send({ t: 'chat', text });
      chatInput.value = '';
      chatInput.blur();
      e.preventDefault();
    } else if (e.key === 'Escape') chatInput.blur();
    e.stopPropagation();
  });
  chatInput.addEventListener('blur', () => $('chat').classList.remove('peek'));
  store.on('chat', renderChat);
}
