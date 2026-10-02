import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';

/**
 * Indoors the light that casts shadows comes from the lamps overhead, not the street's sun: the office is
 * lit as if it had no roof, so the sun's shadows fell across the walls from nowhere anyone could see.
 * INDOOR_LIGHT is where that light comes from (nearly straight down, a little off so walls aren't
 * side-on to it), how dark its shadows are, and how bright and warm it is once the lamps are on.
 */
const INDOOR_LIGHT = { dir: new THREE.Vector3(0.22, 1, 0.14).normalize(), shadow: 0.7, lamp: 0.7, color: new THREE.Color('#ffe2b8') };

/** Indoors in the office, after the sky's had its say (core/loop.ts's env tick): the shadows come from overhead and the walls take none. */
export function installLamplight(ctx: Ctx, parts: Pick<Parts, 'stage' | 'place'>) {
  /** 0 outdoors to 1 indoors, eased as you come in or go out. */
  let indoorness = 0;
  /**
   * The office's outside walls, the back office's too (tagged `userData.wall` in world/office/shell.ts):
   * indoors they take no shadows, or the light from overhead would streak them down from the hoop, the TV
   * and the boards hanging on them, and speckle the wall itself, nearly side-on to it.
   */
  let wallsShaded = true;
  /** How far the back office was built out when the walls were last gone over: building it out makes new ones. */
  let wing = -1;
  const from = new THREE.Vector3();

  ctx.ticks.add('env', ({ dt }) => {
    const { sun } = parts.stage;
    const { sky } = ctx;
    // A map of its own (the castle) lights itself (see World.mood), and the roof's out under the sky.
    const inside = ctx.inOffice() && !ctx.upTop() && parts.place.indoors();
    indoorness += ((inside ? 1 : 0) - indoorness) * (1 - Math.exp(-dt * 3));
    if (indoorness > 0.001) {
      from.copy(sun.position).sub(sun.target.position).normalize();
      sun.position.copy(sun.target.position).addScaledVector(from.lerp(INDOOR_LIGHT.dir, indoorness).normalize(), 45);
      const lamp = INDOOR_LIGHT.lamp * sky.lampsOn;
      if (lamp > sun.intensity) {
        sun.color.lerp(INDOOR_LIGHT.color, indoorness * Math.min(1, (lamp - sun.intensity) / lamp));
        sun.intensity += (lamp - sun.intensity) * indoorness;
      }
    }
    sun.shadow.intensity = 1 + (INDOOR_LIGHT.shadow - 1) * indoorness;
    if (wallsShaded !== indoorness < 0.5 || wing !== ctx.office.wing.level) {
      wallsShaded = indoorness < 0.5;
      wing = ctx.office.wing.level;
      ctx.office.group.traverse((o) => {
        if (o.userData.wall) o.receiveShadow = wallsShaded;
      });
    }
  });
}
