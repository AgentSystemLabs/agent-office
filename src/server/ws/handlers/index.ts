// Every message a browser can send, by type, and the features that keep something per person on a
// floor. A new feature adds its handler file and a line here.
import type { ClientMsg } from '../../../shared/protocol.js';
import { accountsHandlers } from './accounts.js';
import { ballHandlers, ballHooks, ballView } from './ball.js';
import { cabinetHandlers, cabinetHooks, cabinetView } from './cabinet.js';
import { carHandlers, carHooks, carsView } from './car.js';
import { changesHandlers, changesHooks } from './changes.js';
import { decorHandlers, decorView } from './decor.js';
import { dogHandlers, dogView } from './dog.js';
import { floorHandlers, projectView } from './floors.js';
import { githubHandlers, issuesView, pullsView } from './github.js';
import { jukeboxHandlers, jukeboxView } from './jukebox.js';
import { meetingHandlers, meetingView } from './meetings.js';
import { planHandlers, planView } from './plan.js';
import { presenceHandlers } from './presence.js';
import { queueHandlers, queueView } from './queue.js';
import { rooftopHandlers } from './rooftop.js';
import { servicesView, settingsHandlers } from './settings.js';
import { signinsHandlers } from './signins.js';
import { teamHandlers } from './team.js';
import { usageHandlers } from './usage.js';
import { whiteboardHandlers, whiteboardHooks, whiteboardView } from './whiteboard.js';
import { jailView, workerHandlers, workerHooks, workersView } from './workers.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

/** Each domain's handlers put together, in alphabetical order. */
export const handlers: HandlerMap<ClientMsg> = {
  ...accountsHandlers,
  ...ballHandlers,
  ...cabinetHandlers,
  ...carHandlers,
  ...changesHandlers,
  ...decorHandlers,
  ...dogHandlers,
  ...floorHandlers,
  ...githubHandlers,
  ...jukeboxHandlers,
  ...meetingHandlers,
  ...planHandlers,
  ...presenceHandlers,
  ...queueHandlers,
  ...rooftopHandlers,
  ...settingsHandlers,
  ...signinsHandlers,
  ...teamHandlers,
  ...usageHandlers,
  ...whiteboardHandlers,
  ...workerHandlers,
};

/**
 * The features that keep something per person on a floor, in the order they let go of it when
 * someone leaves the floor or the office (see FeatureHooks): the order the office has always done it in.
 */
export const features: readonly FeatureHooks[] = [workerHooks, changesHooks, whiteboardHooks, ballHooks, carHooks, cabinetHooks];

/** What someone arriving on a floor is sent (see office/views.ts): a piece from each feature, in the order it has always gone out. */
export const views: ViewPieces = {
  project: projectView,
  workers: workersView,
  issues: issuesView,
  pulls: pullsView,
  queue: queueView,
  decor: decorView,
  plan: planView,
  services: servicesView,
  dog: dogView,
  ball: ballView,
  cars: carsView,
  jail: jailView,
  jukebox: jukeboxView,
  whiteboard: whiteboardView,
  meeting: meetingView,
  cabinet: cabinetView,
};
