// Every slice of the store, the core's included, in the one order the store runs them in: the order
// they take in each message and each floor you arrive on, and so the order their topics fire in. On
// `welcome`, after the map (see map.ts), the floor's topics fire from `floor` on down, then everyone
// else's from the top; on every other message, the topics fire top to bottom. That's the order the
// office has always fired them in, so a new slice goes at the end.
//
// Each slice's module also adds its fields and topics to Store and Topics (see ../store.ts), which only
// happens for a module that's imported: here.

import type { Slice } from '../store';
import { building, floor, me, presence } from '../core';
import { accounts } from './accounts';
import { ball } from './ball';
import { cabinet } from './cabinet';
import { cars } from './cars';
import { decor } from './decor';
import { dog } from './dog';
import { floorPlan } from './floor-plan';
import { furnishings } from './furnishings';
import { jail } from './jail';
import { jukebox } from './jukebox';
import { leaveOnMerge } from './leave-on-merge';
import { machine } from './machine';
import { map } from './map';
import { meeting } from './meeting';
import { notify } from './notify';
import { prompts } from './prompts';
import { services } from './services';
import { signins } from './signins';
import { sky } from './sky';
import { team } from './team';
import { theme } from './theme';
import { upgrade } from './upgrade';
import { usage } from './usage';
import { whiteboard } from './whiteboard';

export const SLICES: readonly Slice[] = [
  presence,
  upgrade,
  usage,
  me,
  notify,
  machine,
  building,
  sky,
  theme,
  prompts,
  leaveOnMerge,
  map,
  floor,
  meeting,
  decor,
  floorPlan,
  services,
  dog,
  jukebox,
  whiteboard,
  cabinet,
  ball,
  cars,
  jail,
  team,
  accounts,
  signins,
  furnishings,
];
