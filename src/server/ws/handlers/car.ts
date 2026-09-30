// The cars in every floor's garage.
import type { Floor } from '../../floor.js';
import type { Ctx } from '../../office/context.js';

export const carsChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'cars', cars: floor.garage.state() });
