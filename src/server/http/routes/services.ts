// The web servers the workers are running, for `agent-office tunnel` (tunnel/), which opens each
// one on the computer it runs on.
import type { Ctx } from '../../office/context.js';
import { FORWARDS_PATH, type ForwardList } from '../../tunnel/wire.js';
import { readBody, send } from '../util.js';
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
  start: {
    method: 'POST',
    path: '/api/services/start',
    auth: 'session',
    async handle(ctx, { req, res }) {
      let body: { floor?: string; name?: string };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { error: 'Invalid JSON' });
      }
      const floor = ctx.floors.get(body.floor ?? '') ?? ctx.floors.get(ctx.building.list()[0]?.id ?? '');
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const ok = await ctx.plugins?.startService(floor, body.name);
      return send(res, ok ? 200 : 500, { ok });
    },
  },
  stop: {
    method: 'POST',
    path: '/api/services/stop',
    auth: 'session',
    async handle(ctx, { req, res }) {
      let body: { floor?: string; name?: string };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { error: 'Invalid JSON' });
      }
      const floor = ctx.floors.get(body.floor ?? '') ?? ctx.floors.get(ctx.building.list()[0]?.id ?? '');
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const ok = await ctx.plugins?.stopService(floor, body.name);
      return send(res, ok ? 200 : 500, { ok });
    },
  },
  logs: {
    method: 'GET',
    prefix: '/api/services/logs',
    auth: 'session',
    async handle(ctx, { url, res }) {
      const floorId = url.searchParams.get('floor') ?? '';
      const name = url.searchParams.get('name') ?? undefined;
      const floor = ctx.floors.get(floorId) ?? ctx.floors.get(ctx.building.list()[0]?.id ?? '');
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const logs = await ctx.plugins?.getServiceLogs(floor, name);
      return send(res, 200, { logs: logs ?? [] });
    },
  },
} satisfies Record<string, Route>;
