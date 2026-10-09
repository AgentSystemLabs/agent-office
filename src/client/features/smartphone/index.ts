/**
 * The player's GTA-style smartphone: J (or 📱 in the menu) opens it. Contacts are the workers on
 * this floor; a call puts you at their desk with their terminal open, and an SMS is a prompt sent
 * to their session. Both ride existing messages, so the phone keeps no server state of its own.
 */
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { openSmartphone } from './ui';

/** Binds J and opens the phone, reaching the waiting room and the desk actions only when used. */
export function installSmartphone(ctx: Ctx, parts: Pick<Parts, 'waiting' | 'actions'>) {
  function showSmartphone() {
    openSmartphone({
      net: ctx.net,
      goToWorker: (id) => parts.waiting.goToWorker(id),
      openWorkerTerminal: (id) => parts.waiting.openWorkerTerminal(id),
      fixLostWorktree: (w) => parts.actions.fixLostWorktree(w),
      sound: ctx.sound,
    });
  }
  ctx.keys.bind({
    code: 'KeyJ',
    run: () => showSmartphone(),
  });
  return { showSmartphone };
}
