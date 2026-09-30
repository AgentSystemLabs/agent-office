// Workers at their desks and the board agents at their kiosks: hiring them, their terminals, their
// worktrees and pull requests.
import type { FeatureHooks } from './types.js';

export const workerHooks: FeatureHooks = {
  leaving(_ctx, c, was) {
    if (was) was.workers.detachAll(c.id);
    c.attached.clear();
    c.typingAt.clear();
    c.stale.clear();
  },
  closedOn: (_ctx, c, floor) => floor.workers.detachAll(c.id),
};
