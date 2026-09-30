// Every message a browser can send, by type, and the features that keep something per person on a
// floor. A new feature adds its handler file and a line here.
import type { ClientMsg } from '../../../shared/protocol.js';
import { ballHandlers, ballHooks } from './ball.js';
import { cabinetHandlers, cabinetHooks } from './cabinet.js';
import { carHandlers, carHooks } from './car.js';
import { changesHooks } from './changes.js';
import { decorHandlers } from './decor.js';
import { dogHandlers } from './dog.js';
import { jukeboxHandlers } from './jukebox.js';
import { rooftopHandlers } from './rooftop.js';
import { whiteboardHandlers, whiteboardHooks } from './whiteboard.js';
import { workerHooks } from './workers.js';
import type { FeatureHooks, HandlerMap } from './types.js';

/** Each domain's handlers put together, in alphabetical order. */
export const handlers: Partial<HandlerMap<ClientMsg>> = {
  ...ballHandlers,
  ...cabinetHandlers,
  ...carHandlers,
  ...decorHandlers,
  ...dogHandlers,
  ...jukeboxHandlers,
  ...rooftopHandlers,
  ...whiteboardHandlers,
};

/**
 * The features that keep something per person on a floor, in the order they let go of it when
 * someone leaves the floor or the office (see FeatureHooks): the order the office has always done it in.
 */
export const features: readonly FeatureHooks[] = [workerHooks, changesHooks, whiteboardHooks, ballHooks, carHooks, cabinetHooks];
