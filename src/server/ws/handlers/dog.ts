// The dog on every floor.
import type { DogClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import { here } from './common.js';
import { DOG_BREED_NAMES, DOG_COAT_NAMES } from '../../../shared/dog.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const dogView: ViewPieces['dog'] = (_ctx, floor) => floor?.dog.view() ?? null;

export const dogHandlers = {
  'dog.pet'(ctx, c) {
    ctx.floorOf(c)?.dog.pet(c.peer);
  },
  'dog.name'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const name = floor.dog.rename(str(msg.name, 200));
    ctx.toastFloor(floor, `🐶 ${who} named the dog ${name}`);
  },
  'dog.breed'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const breed = floor.dog.setBreed(msg.breed);
    if (breed) ctx.toastFloor(floor, `🐶 ${c.peer.name} made ${floor.dog.dogName} a ${DOG_BREED_NAMES[breed].replace(/^\S+ /, '')}`);
  },
  'dog.coat'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    if (floor.dog.setCoat(msg.coat)) ctx.toastFloor(floor, `🐶 ${c.peer.name} gave ${floor.dog.dogName} a ${(DOG_COAT_NAMES[msg.coat] ?? '').toLowerCase()} coat`);
  },
} satisfies HandlerMap<DogClientMsg>;
