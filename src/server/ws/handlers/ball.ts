// The basketball by the hoop on every floor.
import type { Floor } from '../../floor.js';
import type { Ctx } from '../../office/context.js';

export const ballChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'ball', ball: floor.court.state() });
