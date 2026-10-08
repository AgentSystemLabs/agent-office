/**
 * Up on the roof: the roof itself, built the first time anyone goes up there and standing on as many
 * floors as the building has. The café counter and its menu are features/bar's, and the games up there
 * are features/bargames'.
 */
import { roofDrop } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import { builtFloors, floorWings } from '../../core/floors';
import { noOutline } from '../../core/outline';
import { store } from '../../state';
import { buildRooftop, type Rooftop } from './world';

export function installRooftop(ctx: Ctx) {
  /** Up on the roof: built the first time anyone goes up there. */
  let roof: Rooftop | null = null;
  function theRoof(): Rooftop {
    if (!roof) {
      roof = buildRooftop(ctx.office.night, roofFloors());
      roof.setFloors(roofFloors(), floorWings(builtFloors()));
      roof.group.visible = false;
      roof.games.onDrop = (at) => ctx.sound.toss('drop', at);
      ctx.scene.add(roof.group);
      noOutline(roof.group);
    }
    return roof;
  }
  /** How many floors the roof stands on: every one that's built. */
  function roofFloors(): number {
    return Math.max(1, builtFloors().length);
  }
  /** Floors come and go: the roof goes up or down with them, and the street's that much further down from it. */
  function syncRoof() {
    if (!roof) return;
    const floors = roofFloors();
    roof.setFloors(floors, floorWings(builtFloors()));
    if (ctx.upTop()) ctx.sky.setRoof(true, roofDrop(floors));
  }
  store.on('floors', syncRoof);
  ctx.ticks.add('env', ({ dt, t }) => {
    if (ctx.upTop() && roof) roof.update(t, dt, { dark: ctx.sky.lampsOn, motion: !ctx.reduceMotion.matches });
  });

  return { roof: () => roof, theRoof, roofFloors, syncRoof };
}
