import type { Ctx } from '../../core/context';
import { Arcade, type ArcadeDeps } from './ui';

/** The boss's monitor upstairs: Boss Worker Control System, from the boss's chair (the chair's E opens it, see features/seating). */
export function installArcade(ctx: Ctx, deps?: ArcadeDeps): Arcade {
  // The boss's monitor upstairs: Boss Worker Control System, from the boss's chair.
  const arcade = new Arcade(ctx.office.bossScreen, ctx.net, deps);
  ctx.ticks.add('play', ({ dt }) => arcade.update(ctx.camera, dt));
  // With the camera up at the monitor, the system has the screen: no hands drawn over it.
  ctx.view.add({ covers: () => arcade.zoomed });
  return arcade;
}
