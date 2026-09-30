/**
 * The keyboard: every key press goes down the chain in ctx.keys (see Keys): the guards, what you're
 * in the middle of, the emotes, then the office's own keys, bound with what they do.
 */
import type { Ctx } from '../core/context';
import type { Parts } from '../core/parts';
import { DESK_KEYS } from '../interaction';
import { isTyping } from '../player';
import { modalOpen } from '../ui/dom';

/**
 * The office's own parts of the key chain. Install it right after the telescope's guard (looking
 * through it, no key does anything else) and before anything else's, so within a stage they come first.
 */
export function installKeyGuards(ctx: Ctx, parts: Pick<Parts, 'focus'>) {
  const { player } = ctx;
  // A window's open or you're typing somewhere, or it's a shortcut: the key isn't the office's.
  ctx.keys.add('guard', (e) => modalOpen() || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey);
  // Closing the last window didn't give you the mouse back: any key but Esc takes it (see backToGame).
  ctx.keys.add('guard', (e) => {
    if (parts.focus.relookOnKey() && e.key !== 'Escape' && player.canLock) player.lock();
    return false;
  });
  // Whatever you're in the middle of has first go (see each activity's key).
  ctx.keys.add('activity', (e) => ctx.activities.key(e));
}

/**
 * Listens for keys on the window and hands each down the chain; the ball's and the emote wheel's own
 * keys and mouse button; and binds the keys that use what you're facing.
 */
export function installKeyboard(ctx: Ctx, parts: Pick<Parts, 'hoops' | 'emotes' | 'pointer'>) {
  const { player } = ctx;
  // Every key press goes down the chain in ctx.keys: the guards, what you're in the middle of, the
  // emotes, then the office's own keys (bound with what they do). One of those clears the walking keys.
  window.addEventListener('keydown', (e) => {
    if (ctx.keys.handle(e) === 'bound') player.clearKeys();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyG') parts.emotes.emoteWheel.release();
    if (e.code === 'KeyE') parts.hoops.letFly();
  });
  window.addEventListener('blur', () => parts.hoops.stopWinding());
  // First person with the mouse captured, the button winds up a shot like E does (see player.onClick).
  window.addEventListener('pointerup', (e) => {
    if (e.button === 0 && parts.hoops.winding() && player.locked) parts.hoops.letFly();
  });

  // Keys that use what you're facing: at a desk, each does something else (see interact).
  ctx.keys.bind({
    code: Object.keys(DESK_KEYS),
    run: (e) => {
      const deskKey = DESK_KEYS[e.code as keyof typeof DESK_KEYS];
      const handled = parts.pointer.use(parts.pointer.target(), deskKey);
      // P and L open a text box, which the key mustn't land in.
      if (handled && (deskKey === 'P' || deskKey === 'L')) e.preventDefault();
      return handled;
    },
  });
}
