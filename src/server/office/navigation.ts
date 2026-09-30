import type { Floor } from '../floor.js';
import { elevatorSpot } from '../../shared/layout.js';
import { ROOF } from '../../shared/rooftop.js';
import { stopPlaying } from '../ws/handlers/cabinet.js';
import { drawingChanged } from '../ws/handlers/whiteboard.js';
import { ballChanged } from '../ws/handlers/ball.js';
import { carsChanged } from '../ws/handlers/car.js';
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

  /** Out to the lobby, where the elevator has nowhere to go: the building's last floor was taken off. */
  const toLobby = (c: Client) => {
    const left = leave(c);
    delete c.peer.floor;
    ctx.sendTo(c, { t: 'floor.enter', peers: [...ctx.clients.values()].map((o) => o.peer), ...floorView(ctx, undefined) });
    arrived(c, left);
  };

  /** Off the floor (or the roof) `c` was on, to `at` on the next one, or into its elevator car. */
  const leave = (c: Client, at?: Spot) => {
    const was = ctx.floorOf(c);
    if (was) {
      was.workers.detachAll(c.id);
      was.changes.unwatchAll(c.id);
    }
    // The ball stays on its floor, back under the hoop. That floor hears so once they're off it (see
    // arrived), or their own page would put it down before it knew they'd gone.
    const ballLeft = !!was?.court.left(c.id);
    // So does a car they were in, parked where they left it.
    const carLeft = !!was?.garage.leave(c.id);
    c.attached.clear();
    c.typingAt.clear();
    c.stale.clear();
    // The whiteboard downstairs stays downstairs, and so does the arcade.
    const wasDrawing = c.whiteboard;
    c.whiteboard = false;
    stopPlaying(ctx, c, was);
    const spot = at ?? { ...elevatorSpot(), y: 0, rotY: 0 };
    Object.assign(c.peer, { x: spot.x, y: spot.y, z: spot.z, rotY: spot.rotY, moving: false });
    delete c.peer.seat;
    delete c.peer.golfing;
    delete c.peer.throwing;
    // An issue card belongs to the board it came off, which is on the floor they left; a drink stays at the bar.
    delete c.peer.carrying;
    delete c.peer.drink;
    return { was, wasDrawing, ballLeft, carLeft };
  };

  const arrived = (c: Client, left: ReturnType<typeof leave>) => {
    ctx.broadcast({ t: 'peer.update', peer: c.peer }, c.id);
    if (left.wasDrawing) drawingChanged(ctx, left.was);
    if (left.ballLeft && left.was) ballChanged(ctx, left.was);
    if (left.carLeft && left.was) carsChanged(ctx, left.was);
  };

  return { goToFloor, goToRoof, toLobby };
}
