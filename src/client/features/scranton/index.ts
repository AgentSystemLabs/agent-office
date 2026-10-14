import type { Ctx } from '../../core/context';
import type { Room } from '../../player/camera';
import { SCRANTON, SCRANTON_HEIGHT, CORRIDORS, inScranton } from '../../../shared/scranton';
import { scrantonRoutines } from './routines';

/** Physical space and lighting are supplied by the fixture; this handles the visitor's camera. */
export function installScranton(ctx: Ctx) {
  let previous: Room | null = null;
  let applied: Room | null = null;
  let sheltered = false;

  ctx.ticks.add('pre', () => {
    const p = ctx.player.pos;
    const inside = ctx.inOffice() && !ctx.upTop() && p.y > -1 && p.y < SCRANTON_HEIGHT && inScranton(p.x, p.z);
    if (inside) {
      if (ctx.player.room !== applied) previous = ctx.player.room;
      const area = p.x < SCRANTON.maxX && p.z < SCRANTON.maxZ ? SCRANTON : (() => {
        const r = CORRIDORS.find(([x0, x1, z0, z1]) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1)!;
        return { minX: r[0], maxX: r[1], minZ: r[2], maxZ: r[3] };
      })();
      // The camera follows within the adjoining room, instead of clamping back to the old walls.
      applied = { ...area, wall: 0.18, enclosed: true };
      ctx.player.room = applied;
    } else if (applied) {
      if (ctx.player.room === applied && previous) ctx.player.room = previous;
      applied = null;
      previous = null;
    }
    if (inside === sheltered) return;
    sheltered = inside;
    ctx.sky.setIndoors(inside || (!ctx.upTop() && ctx.world().room.enclosed));
    const acoustics = ctx.world().acoustics;
    ctx.sound.setHall(inside ? { bounds: { ...SCRANTON, maxX: 22.8, maxZ: -2.85 }, gong: null, windows: [] } : acoustics ? { bounds: ctx.plan().bounds, gong: acoustics.gong ?? null, windows: acoustics.windows ?? [], vacuum: acoustics.vacuum } : null);
  });

  return scrantonRoutines(ctx.office.scranton.nav);
}
