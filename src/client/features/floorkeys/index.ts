/**
 * Shift+1 to Shift+9: straight to that floor, numbered from the bottom up as the elevator's panel
 * numbers them, the way the floor list takes you there. Shift, because the digits on their own are the
 * emotes, and Ctrl or Alt with a digit is the browser's (switching tabs, on Windows and Linux). By the
 * key's place on the keyboard, so it's the same keys on any layout.
 */
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { clip, toast } from '../../ui/dom';

export interface FloorKeysDeps {
  /** Straight to another floor (see switchFloor in core/travel.ts). */
  switchFloor(floorId: string): void;
}

const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];

/** Registers Shift+1 to Shift+9. */
export function installFloorKeys(ctx: Ctx, deps: FloorKeysDeps) {
  ctx.keys.bind({
    code: DIGITS,
    repeat: false,
    run: (e) => {
      // The digit on its own (7 to 9; 1 to 6 are the emotes') isn't one of these.
      if (!e.shiftKey) return false;
      const n = DIGITS.indexOf(e.code) + 1;
      const floor = store.floors[n - 1];
      if (!floor) return void toast(`There's no floor ${n}: the building has ${store.floors.length}`, 'warn');
      if (floor.cloning) return void toast(`${clip(floor.name, 32)} is still being cloned`, 'warn');
      deps.switchFloor(floor.id);
    },
  });
}
