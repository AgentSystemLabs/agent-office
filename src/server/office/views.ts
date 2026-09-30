import type { Floor } from '../floor.js';
import { EMPTY_PLAN } from '../../shared/floorplan.js';
import { JUKEBOX_TUNES } from '../../shared/jukebox.js';
import { ROOF } from '../../shared/rooftop.js';
import type { FloorView } from '../../shared/protocol.js';
import { cabinetFrame, cabinetState } from '../ws/handlers/cabinet.js';
import { drawing } from '../ws/handlers/whiteboard.js';
import type { Ctx } from './context.js';
import type { Client } from './client.js';

/** Everything on a floor, for whoever just arrived there. */
export const floorView = (ctx: Ctx, floor: Floor | undefined): FloorView => ({
  floor: floor?.id ?? null,
  project: floor?.project ?? null,
  workers: floor?.workers.list() ?? [],
  issues: floor?.github.issues ?? { items: [], fetchedAt: 0, loading: false },
  pulls: floor?.github.pulls ?? { items: [], fetchedAt: 0, loading: false },
  queue: floor?.queue.state() ?? { tasks: [], maxWorkers: 0 },
  decor: floor?.decor.list() ?? [],
  plan: floor?.plan.state() ?? EMPTY_PLAN,
  services: ctx.servicesState(floor),
  dog: floor?.dog.view() ?? null,
  ball: floor?.court.state() ?? {},
  cars: floor?.garage.state() ?? [],
  jail: floor?.jail.state() ?? { prisoners: [], bones: 0 },
  jukebox: floor?.jukebox.state() ?? { on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now(), elapsed: 0 },
  whiteboard: { elements: floor?.whiteboard.scene() ?? [], people: floor ? drawing(ctx, floor) : [] },
  meeting: floor?.meetings.state() ?? { current: null, past: [] },
  cabinet: { ...cabinetState(ctx, floor), frame: cabinetFrame(ctx, floor) },
});
/** The rooftop bar: nobody works up there, so it has none of a floor's things. */
export const roofView = (ctx: Ctx): FloorView => ({ ...floorView(ctx, undefined), floor: ROOF });
export const screensOf = (ctx: Ctx, c: Client, floor: Floor | undefined) => {
  for (const { workerId, frame } of floor?.workers.fullScreens() ?? []) ctx.sendTo(c, { t: 'screen', workerId, ...frame, full: true });
};
