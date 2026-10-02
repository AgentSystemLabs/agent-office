import { LOBBY } from '../../shared/lobby.js';
import { drawing } from '../ws/handlers/whiteboard.js';
import { cabinetSnapshot } from '../ws/handlers/cabinet.js';
import type { Floor } from '../floor.js';
import { ROOF } from '../../shared/rooftop.js';
import type { FloorView } from '../../shared/protocol.js';
import { views } from '../ws/handlers/index.js';
import type { Ctx } from './context.js';
import type { Client } from './client.js';

/** Everything on a floor, for whoever just arrived there: each feature's piece (see ws/handlers/index.ts). */
export const floorView = (ctx: Ctx, floor: Floor | undefined, lobby = !floor): FloorView => {
  const view: Record<string, unknown> = { floor: floor?.id ?? null };
  for (const [key, piece] of Object.entries(views)) view[key] = piece(ctx, floor);
  if (lobby) Object.assign(view, {
    floor: LOBBY,
    whiteboard: { elements: ctx.lobby.whiteboard.scene(), people: drawing(ctx, ctx.lobby) },
    jukebox: ctx.lobby.jukebox.state(), ball: ctx.lobby.court.state(),
    cars: ctx.lobby.garage.state(), cabinet: cabinetSnapshot(ctx, ctx.lobby),
  });
  return view as unknown as FloorView;
};
/** The rooftop bar: nobody works up there, so it has none of a floor's things. */
export const roofView = (ctx: Ctx): FloorView => ({ ...floorView(ctx, undefined, false), floor: ROOF });
export const screensOf = (ctx: Ctx, c: Client, floor: Floor | undefined) => {
  for (const { workerId, frame } of floor?.workers.fullScreens() ?? []) ctx.sendTo(c, { t: 'screen', workerId, ...frame, full: true });
};
