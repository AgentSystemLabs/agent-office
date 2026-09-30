// The Changes window at a desk: what a worker changed, and committing, discarding or opening a pull
// request for it.
import type { FeatureHooks } from './types.js';

export const changesHooks: FeatureHooks = {
  leaving(_ctx, c, was) {
    if (was) was.changes.unwatchAll(c.id);
  },
  closedOn: (_ctx, c, floor) => floor.changes.unwatchAll(c.id),
};
