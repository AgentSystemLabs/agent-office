import type { Floor } from '../floor.js';
import { ROOF } from '../../shared/rooftop.js';
import type { FloorView } from '../../shared/protocol.js';
import { views } from '../ws/handlers/index.js';
import type { Ctx } from './context.js';
import type { Client } from './client.js';

/** Everything on a floor, for whoever just arrived there: each feature's piece (see ws/handlers/index.ts). */
export const floorView = (ctx: Ctx, floor: Floor | undefined): FloorView => {
  const view: Record<string, unknown> = { floor: floor?.id ?? null };
  for (const [key, piece] of Object.entries(views)) view[key] = piece(ctx, floor);
  return view as unknown as FloorView;
};
/** The rooftop bar: nobody works up there, so it has none of a floor's things. */
export const roofView = (ctx: Ctx): FloorView => ({ ...floorView(ctx, undefined), floor: ROOF });
export const screensOf = (ctx: Ctx, c: Client, floor: Floor | undefined) => {
  for (const { workerId, frame } of floor?.workers.fullScreens() ?? []) ctx.sendTo(c, { t: 'screen', workerId, ...frame, full: true });
};
