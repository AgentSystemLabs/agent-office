/**
 * Windows and the game taking turns with the keyboard and the mouse: a window opening lets go of both
 * (and tells everyone what you have open), and closing the last one puts you straight back into
 * mouse-look, with no extra click (see backToGame).
 */
import type { Ctx } from '../core/context';
import type { CoreState } from '../core/ctx';
import type { Parts } from '../core/parts';
import { isTyping } from '../player';
import { $, doingNow, modalOpen, onDoingChange, onModalChange, readingNow } from '../ui/dom';

/** Listens for windows opening and closing, what they say you're doing, the mouse and keys (captured) and pointer lock. */
export function installFocus(ctx: Ctx, core: CoreState, parts: Pick<Parts, 'telescope' | 'walking'>) {
  const { player, me, hands, canvas, net } = ctx;
  /** A mouse you point with (not a finger on a touch screen). */
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  /** What you last told the office you have open (see PeerInfo.doing), and whether you're reading. */
  let doingSent: string | undefined;
  let readingSent = false;
  /** Tells everyone what you have open now, for the line under your name tag. A reconnected office has forgotten. */
  function sendDoing(reconnected = false) {
    if (reconnected) {
      doingSent = undefined;
      readingSent = false;
    }
    const reading = readingNow();
    let what = doingNow();
    // The office keeps 60 UTF-16 units of it: cut it short here instead, between whole characters.
    if (what && what.length > 60) {
      let cut = '';
      for (const ch of what) {
        if (cut.length + ch.length >= 60) break;
        cut += ch;
      }
      what = `${cut}…`;
    }
    if (what === doingSent && reading === readingSent) return;
    doingSent = what;
    readingSent = reading;
    net.send({ t: 'doing', what, reading });
  }
  onDoingChange(() => sendDoing());

  /**
   * Set when closing the last window may not have given you the mouse back, so the next key you press
   * takes it instead (a key counts for the browser, where the Esc that closed the window doesn't).
   */
  let relookOnKey = false;
  /** Whether the last thing you pressed was a mouse button rather than a key (see backToGame). Captured, before a window acts on it. */
  let pressedMouse = false;
  window.addEventListener('pointerdown', () => (pressedMouse = true), true);
  window.addEventListener('keydown', () => (pressedMouse = false), true);
  onModalChange((open) => {
    if (open) parts.telescope.exit();
    player.enabled = !open;
    player.clearKeys();
    sendDoing();
    // Reading off the bookshelf: an open book in your hands, and your character's.
    const reading = readingNow();
    me.read(reading);
    hands.read(reading);
    // Opening something on the way over to someone is stopping there.
    if (open && !core.trip) parts.walking.stopWalkingTo();
    if (open) {
      // What lets go when a window opens: the shot you were winding up, the emote wheel.
      ctx.windowOpened.run();
      // A phone has no mouse to take back afterwards.
      if (finePointer) player.yieldMouse();
      else player.unlock();
      $('hint').classList.add('hidden');
    } else {
      // A tick later, so closing one window to open the next (Settings → character) doesn't grab the mouse in between.
      setTimeout(backToGame, 0);
    }
    ctx.hint.invalidate();
  });

  /** Once the last window is closed, the game has the keyboard again and, in first person, the mouse. */
  function backToGame() {
    if (modalOpen()) return;
    if (!isTyping()) canvas.focus({ preventScroll: true });
    if (!player.canLock || player.hasMouse) return;
    // The browser lets a page re-capture the mouse it let go of itself (see yieldMouse), even on Esc
    // (which it doesn't count as a click or key), and any time after a click, like one on ✕. When it
    // won't (nothing of yours opened the window, or a stricter browser), the next key you press does.
    // Closed with a click (Send home, ✕), the view waits for the hand that clicked to come to rest.
    player.lock(pressedMouse);
    relookOnKey = true;
  }
  document.addEventListener('pointerlockchange', () => {
    if (player.locked) relookOnKey = false;
  });

  return { sendDoing, backToGame, relookOnKey: () => relookOnKey, finePointer };
}
