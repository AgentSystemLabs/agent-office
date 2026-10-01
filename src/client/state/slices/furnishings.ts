import { defaultFurnishings, type Furnishings } from '../../../shared/furnishings';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** What the floor's plants, rugs, lamps and sofa look like (swapped at the wardrobe). */
    furnishings: Furnishings;
  }
  interface Topics {
    furnishings: true;
  }
}

export const furnishings: Slice = {
  init(s) {
    s.furnishings = defaultFurnishings();
  },
  on: {
    furnishings(s, m) {
      s.furnishings = m.furnishings;
      return ['furnishings'];
    },
  },
  enter(s, v) {
    s.furnishings = v.furnishings;
    return ['furnishings'];
  },
};
