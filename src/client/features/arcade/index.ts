import type { Ctx } from '../../core/context';
import { Arcade } from './ui';

/** The boss's monitor upstairs: Minesweeper, from the boss's chair (the chair's E plays it, see features/seating). */
export function installArcade(ctx: Ctx): Arcade {
  // The boss's monitor upstairs: Minesweeper, from the boss's chair.
  const arcade = new Arcade(ctx.office.bossScreen);
  ctx.ticks.add('play', ({ dt }) => arcade.update(ctx.camera, dt));
  // With the camera up at the monitor, the game has the screen: no hands drawn over it.
  ctx.view.add({ covers: () => arcade.zoomed });
  return arcade;
}
