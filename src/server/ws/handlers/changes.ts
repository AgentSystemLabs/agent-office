// The Changes window at a desk: what a worker changed, and committing, discarding or opening a pull
// request for it.
import { childEnv } from '../../workers.js';
import type { ChangesClientMsg } from '../../../shared/protocol.js';
import { repoOf, str } from '../../office/input.js';
import { workerOf } from './common.js';
import type { FeatureHooks, HandlerMap } from './types.js';

export const changesHandlers = {
  'changes.watch'(ctx, c, msg) {
    const w = workerOf(ctx, msg.workerId);
    if (w) w.floor.changes.watch(w.wid, c.id, repoOf(msg.repo));
  },
  'changes.unwatch'(ctx, c, msg) {
    const wid = str(msg.workerId, 32);
    // Its worker may have gone home already; stop watching wherever it was.
    for (const f of ctx.floors.values()) f.changes.unwatch(wid, c.id, repoOf(msg.repo));
  },
  'changes.diff'(ctx, c, msg) {
    const workerId = str(msg.workerId, 32);
    const file = str(msg.path, 4096);
    const repo = repoOf(msg.repo);
    const floor = ctx.workerFloor(workerId);
    if (!floor) {
      ctx.sendTo(c, { t: 'changes.diff', workerId, repo, path: file, diff: '', truncated: false, error: 'No such worker' });
      return;
    }
    void floor.changes.diff(workerId, file, repo).then((r) => {
      if (typeof r === 'string') ctx.sendTo(c, { t: 'changes.diff', workerId, repo, path: file, diff: '', truncated: false, error: r });
      else ctx.sendTo(c, { t: 'changes.diff', workerId, repo, path: file, ...r });
    });
  },
  'changes.commit'(ctx, c, msg) {
    const who = c.peer.name;
    const w = workerOf(ctx, msg.workerId);
    // Committed as whoever pressed it: their GitHub name and email, once they've signed in to it.
    const env = c.accountId ? ctx.signins.apply(c.accountId, childEnv(), [], 'github') : undefined;
    if (w) void w.floor.changes.commit(w.wid, str(msg.message, 5000), who, env, repoOf(msg.repo)).then((err) => ctx.warn(c, err));
  },
  'changes.discard'(ctx, c, msg) {
    const who = c.peer.name;
    const w = workerOf(ctx, msg.workerId);
    if (w) void w.floor.changes.discard(w.wid, typeof msg.path === 'string' ? str(msg.path, 4096) : undefined, who, repoOf(msg.repo)).then((err) => ctx.warn(c, err));
  },
  'changes.pr'(ctx, c, msg) {
    const who = c.peer.name;
    const w = workerOf(ctx, msg.workerId);
    if (w) ctx.withGitHub(c, (as) => void w.floor.changes.pullRequest(w.wid, str(msg.title, 300), str(msg.body, 20000), who, as?.env, repoOf(msg.repo)).then((err) => ctx.warn(c, err)));
  },
} satisfies HandlerMap<ChangesClientMsg>;

export const changesHooks: FeatureHooks = {
  leaving(_ctx, c, was) {
    if (was) was.changes.unwatchAll(c.id);
  },
  closedOn: (_ctx, c, floor) => floor.changes.unwatchAll(c.id),
};
