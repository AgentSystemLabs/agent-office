/** The wardrobe by the balcony doors: swaps the floor's plants, rugs, lamps and sofa, for everyone on it. */
import { FURNISH_SLOTS, FURNISH_SLOT_IDS, variantOf, type Furnishings } from '../../../shared/furnishings';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { applyFurnishings, spinLamps } from './apply';
import { openWardrobe } from './ui';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    wardrobe: true;
  }
}

export function installWardrobe(ctx: Ctx) {
  let was: Furnishings | undefined;
  store.on('furnishings', () => {
    applyFurnishings(ctx.office, store.furnishings, was);
    was = { ...store.furnishings };
  });
  ctx.ticks.add('world', ({ dt }) => spinLamps(ctx.office, dt));

  function showWardrobe() {
    if (!store.floor) return toast('Take the elevator to a floor first');
    openWardrobe({ send: (msg) => ctx.net.send(msg) });
  }

  ctx.interactions.define('wardrobe', {
    reach: 4,
    hint: () => {
      const f = store.furnishings;
      const now = FURNISH_SLOT_IDS.map((s) => `${FURNISH_SLOTS[s].icon} ${variantOf(s, f[s])?.label ?? ''}`).join(' ');
      return { k: now, parts: [hintTitle('🧥 Wardrobe'), aside(now), key('E', 'Swap the furnishings')] };
    },
    use: onE(() => showWardrobe()),
  });

  return { showWardrobe };
}
