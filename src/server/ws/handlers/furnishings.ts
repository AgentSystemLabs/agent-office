// The wardrobe: swapping a floor's furnishings.
import { FURNISH_SLOTS, defaultFurnishings, isSlot } from '../../../shared/furnishings.js';
import type { FurnishClientMsg } from '../../../shared/protocol.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const furnishingsView: ViewPieces['furnishings'] = (_ctx, floor) => floor?.furnishings.get() ?? defaultFurnishings();

export const furnishingsHandlers = {
  'furnish.set'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const v = floor.furnishings.set(msg.slot, msg.variant);
    if (v === null) return;
    if (typeof v === 'string') return ctx.warn(c, v);
    ctx.toFloor(floor, { t: 'furnishings', furnishings: floor.furnishings.get() });
    if (isSlot(msg.slot)) ctx.toastFloor(floor, `🧥 ${c.peer.name} swapped the ${FURNISH_SLOTS[msg.slot].label.toLowerCase()}: ${v.label}`);
  },
} satisfies HandlerMap<FurnishClientMsg>;
