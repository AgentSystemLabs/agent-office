// The wardrobe: swapping a floor's furnishings (see shared/furnishings.ts).
import type { FurnishSlotId, Furnishings } from '../furnishings.js';

export type FurnishClientMsg =
  /** Give slot `slot` on your floor variant `variant`, for everyone there. */
  { t: 'furnish.set'; slot: FurnishSlotId; variant: string };

export type FurnishServerMsg =
  /** Your floor's furnishings changed. */
  { t: 'furnishings'; furnishings: Furnishings };
