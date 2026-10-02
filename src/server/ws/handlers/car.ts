import { socialFloor, type SocialFloor } from '../../lobby.js';
// The cars in every floor's garage.
import type { CarClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import { num } from '../../office/input.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

export const carsView: ViewPieces['cars'] = (_ctx, floor) => floor?.garage.state() ?? [];
export const carsChanged = (ctx: Ctx, floor: SocialFloor) => ctx.toFloor(floor, { t: 'cars', cars: floor.garage.state() });

/** Getting into a car, or out of one. */
function seat(ctx: Ctx, c: Client, msg: Extract<CarClientMsg, { t: 'car.enter' | 'car.leave' }>) {
  const floor = socialFloor(ctx, c);
  if (!floor) return;
  const changed = msg.t === 'car.enter' ? floor.garage.enter(c.id, Math.trunc(num(msg.car)), msg.seat) : floor.garage.leave(c.id);
  // They hear back either way: someone who didn't get in (someone beat them to the seat) learns who did.
  if (changed) ctx.toNeighbors(c, { t: 'cars', cars: floor.garage.state() });
  ctx.sendTo(c, { t: 'cars', cars: floor.garage.state(), answer: true });
}

export const carHandlers = {
  'car.enter': seat,
  'car.leave': seat,
  'car.drive'(ctx, c, msg) {
    const floor = socialFloor(ctx, c);
    const car = Math.trunc(num(msg.car));
    const now = floor?.garage.drive(c.id, car, { x: num(msg.x), z: num(msg.z), rotY: num(msg.rotY), speed: num(msg.speed), steer: num(msg.steer) });
    if (now) ctx.toNeighbors(c, { t: 'car.move', car, ...now }, true);
  },
  'car.honk'(ctx, c) {
    const car = socialFloor(ctx, c)?.garage.honk(c.id);
    if (car !== undefined) ctx.toNeighbors(c, { t: 'car.honk', car });
  },
} satisfies HandlerMap<CarClientMsg>;

export const carHooks: FeatureHooks = {
  leaving(ctx, c, was) {
    const source = was ?? socialFloor(ctx, c);
    // So does a car they were in, parked where they left it.
    const carLeft = !!source?.garage.leave(c.id);
    if (carLeft && source) return () => carsChanged(ctx, source);
  },
  closed(ctx, c) {
    if (ctx.lobby.garage.leave(c.id)) carsChanged(ctx, ctx.lobby);
  },
  closedOn(ctx, c, floor) {
    if (floor.garage.leave(c.id)) carsChanged(ctx, floor);
  },
};
