/**
 * Up on the roof: the roof itself, built the first time anyone goes up there and standing on as many
 * floors as the building has, and everything up there moving to the DJ's set. The bar, the DJ's booth
 * and the games up there are features/bar's and features/bargames'.
 */
import type * as THREE from 'three';
import { roofDrop } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import { builtFloors, floorWings } from '../../core/floors';
import { noOutline } from '../../core/outline';
import { djFrame, djTime } from '../../dnb';
import { store } from '../../state';
import { buildRooftop, type Rooftop } from './world';

export interface RooftopDeps {
  /** The office's lights, which the roof's strobes flash as a drop lands. */
  ambient: THREE.AmbientLight;
  hemi: THREE.HemisphereLight;
}

export function installRooftop(ctx: Ctx, deps: RooftopDeps) {
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
  /** How far into the DJ's set it is, on the office's clock, so everyone up there hears the same bar. */
  const djAt = () => djTime(store.officeNow());
  ctx.ticks.add('env', ({ dt, t }) => {
    if (ctx.upTop() && roof) {
      // Everything up there moves to the DJ's set; strobes flash the whole roof as a drop lands.
      const strobe = roof.update(t, dt, djFrame(djAt()), { dark: ctx.sky.lampsOn, motion: !ctx.reduceMotion.matches });
      deps.ambient.intensity += strobe * 1.5;
      deps.hemi.intensity += strobe * 0.8;
    }
  });

  return { roof: () => roof, theRoof, roofFloors, syncRoof, djAt };
}
