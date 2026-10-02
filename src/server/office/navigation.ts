import { LOBBY } from '../../shared/lobby.js';
import type { Floor } from '../floor.js';
import { elevatorSpot } from '../../shared/layout.js';
import { ROOF } from '../../shared/rooftop.js';
import { features } from '../ws/handlers/index.js';
import type { Ctx, Navigation } from './context.js';
import type { Client } from './client.js';
import type { Spot } from './input.js';
import { floorView, roofView, screensOf } from './views.js';

/** Taking people between the floors, the roof and the lobby. */
export function navigation(ctx: Ctx): Navigation {
  /**
   * Takes `c` to another floor: everyone sees them leave and arrive, and they get the new floor's
   * everything. They arrive in the elevator, or `at` the spot they came by.
   */
  const goToFloor = (c: Client, floor: Floor, at?: Spot) => {
    if (c.peer.floor === floor.id) return;
    const left = leave(c, at);
    Object.assign(c.peer, { floor: floor.id });
    ctx.sendTo(c, { t: 'floor.enter', peers: [...ctx.clients.values()].map((o) => o.peer), ...floorView(ctx, floor) });
    screensOf(ctx, c, floor);
    arrived(c, left);
    floor.arrived();
    floor.workers.wakeAll();
    ctx.floorsChanged();
  };

  /** Up to the rooftop bar, by elevator. */
  const goToRoof = (c: Client) => {
    if (c.peer.floor === ROOF) return;
    const left = leave(c);
    c.peer.floor = ROOF;
    ctx.sendTo(c, { t: 'floor.enter', peers: [...ctx.clients.values()].map((o) => o.peer), ...roofView(ctx) });
    arrived(c, left);
    ctx.floorsChanged();
  };

  /** Back to the permanent public lobby on the ground floor. */
  const toLobby = (c: Client, at?: Spot) => {
    if (c.peer.floor === LOBBY) return;
    const left = leave(c, at);
    c.peer.floor = LOBBY;
    ctx.sendTo(c, { t: 'floor.enter', peers: [...ctx.clients.values()].map((o) => o.peer), ...floorView(ctx, undefined) });
    arrived(c, left);
    ctx.floorsChanged();
  };

  /** Off the floor (or the roof) `c` was on, to `at` on the next one, or into its elevator car. */
  const leave = (c: Client, at?: Spot) => {
    const was = ctx.floorOf(c);
    // Each feature lets go of what they had there (see FeatureHooks); some tell that floor once
    // they're off it, in arrived.
    const after = features.map((f) => f.leaving?.(ctx, c, was)).filter((a) => typeof a === 'function');
    const spot = at ?? { ...elevatorSpot(), y: 0, rotY: 0 };
    Object.assign(c.peer, { x: spot.x, y: spot.y, z: spot.z, rotY: spot.rotY, moving: false });
    delete c.peer.seat;
    delete c.peer.golfing;
    delete c.peer.throwing;
    // An issue card belongs to the board it came off, which is on the floor they left; a drink stays at the bar.
    delete c.peer.carrying;
    delete c.peer.drink;
    return after;
  };

  const arrived = (c: Client, after: ReturnType<typeof leave>) => {
    ctx.broadcast({ t: 'peer.update', peer: c.peer }, c.id);
    for (const then of after) then();
  };

  return { goToFloor, goToRoof, toLobby };
}
