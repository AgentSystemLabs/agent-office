// The web servers the workers are running, for `agent-office tunnel` (tunnel/), which opens each
// one on the computer it runs on.
import type { Ctx } from '../../office/context.js';
import { FORWARDS_PATH, type ForwardList } from '../../tunnel/wire.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

/** Every floor's: a port is the machine's, whichever floor its worker sits on. */
function forwards(ctx: Ctx): ForwardList {
  const items = ctx.services.list().map((s) => {
    const floor = ctx.workerFloor(s.workerId);
    return { port: s.port, title: s.title || s.command, command: s.command, worker: floor?.workers.get(s.workerId)?.name, floor: floor?.def.name };
  });
  return { port: ctx.cfg.port, items };
}

export const serviceRoutes = {
  forwards: { method: 'GET', path: FORWARDS_PATH, auth: 'session', handle: (ctx, { res }) => send(res, 200, forwards(ctx)) },
} satisfies Record<string, Route>;
