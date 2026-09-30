// The whiteboard on every floor: who's drawing, and what they draw.
import type { Floor } from '../../floor.js';
import type { Ctx } from '../../office/context.js';

/** Who has a floor's whiteboard open. */
export const drawing = (ctx: Ctx, floor: Floor): string[] => [...ctx.clients.values()].filter((c) => c.whiteboard && c.peer.floor === floor.id).map((c) => c.id);
export const drawingChanged = (ctx: Ctx, floor: Floor | undefined) => {
  if (floor) ctx.toFloor(floor, { t: 'wb.people', people: drawing(ctx, floor) });
};
