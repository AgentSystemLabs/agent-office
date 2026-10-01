/** The office telescope up on the loft, overlooking the worker floor: E looks through it. */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { TelescopeView } from './controller';
import { $, modalOpen } from '../../ui/dom';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    telescope: true;
  }
}

export interface TelescopeDeps {
  /** Lets go of what you were pointing at (see the aim tick in input/pointer.ts). */
  clearTarget(): void;
  /** Gives the game the keyboard and, in first person, the mouse back (see backToGame in input/focus.ts). */
  backToGame(): void;
}

/** Registers the first of the key guards: install it before any other. */
export function installTelescope(ctx: Ctx, deps: TelescopeDeps): TelescopeView {
  /** The scope has had the mouse captured, so losing it means leaving the scope (see pointerlockchange). */
  let scopeHadMouse = false;
  const telescope = new TelescopeView(
    ctx.camera,
    $('telescope-view'),
    $('telescope-exit'),
    window,
    () => {
      const player = ctx.player;
      player.enabled = false;
      player.clearKeys();
      player.stopWalking();
      // The mouse turns the scope, as far as you like: captured, with no cursor to run into the edge.
      player.keepMouse = true;
      player.lock();
      document.body.classList.add('telescope-active');
      $('telescope-view').setAttribute('aria-hidden', 'false');
      deps.clearTarget();
      ctx.hint.invalidate();
    },
    () => {
      const player = ctx.player;
      player.keepMouse = false;
      scopeHadMouse = false;
      // Back as you were: looking round in first person, or with the cursor in third.
      if (!player.canLock) player.unlock();
      document.body.classList.remove('telescope-active');
      $('telescope-view').setAttribute('aria-hidden', 'true');
      ctx.player.enabled = !modalOpen() && !ctx.trip();
      ctx.player.clearKeys();
      ctx.hint.invalidate();
      if (!modalOpen()) setTimeout(deps.backToGame, 0);
    },
  );
  // The browser let go of the mouse the scope had (its own Esc): out of the scope too, not left without a cursor.
  document.addEventListener('pointerlockchange', () => {
    if (!telescope.active) return;
    if (ctx.player.locked) scopeHadMouse = true;
    else if (scopeHadMouse) telescope.exit();
  });
  // Looking through the telescope, Esc, E or F takes you away from it, and no key does anything else.
  ctx.keys.add('guard', (e) => {
    if (!telescope.active) return false;
    if (e.code === 'Escape' || e.code === 'KeyE' || e.code === 'KeyF') telescope.exit();
    e.preventDefault();
    return true;
  });
  ctx.interactions.define('telescope', {
    reach: 3.5,
    hint: () => ({ k: '', parts: [hintTitle('🔭 Office telescope'), aside('overlooks the worker floor'), key('E', 'Look through')] }),
    use: onE(() => telescope.enter()),
  });
  // Looking through it, the view is the telescope's (once you've moved and the camera's followed), and
  // it has the screen to itself: no hands drawn over it.
  ctx.view.add({ update: () => telescope.update(), covers: () => telescope.active });
  return telescope;
}
