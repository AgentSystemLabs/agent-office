import { dispatch, equalSecret, exportPath, localRequest, readReply, safeFile, target } from '../../telegram/service.js';
import { readBody, send } from '../util.js';
import type { Route } from '../router.js';

/** Dedicated, disabled-by-default connector credential. Never accepts browser cookies or hook tokens. */
export const telegramRoute: Route = {
  prefix: '/api/telegram/', auth: 'public',
  async handle(ctx, { req, res, path, url }) {
    if (!localRequest(req.socket.remoteAddress, req.headers.origin) ||
      !equalSecret(req.headers.authorization, `Bearer ${process.env.AGENT_OFFICE_TELEGRAM_LOCAL_TOKEN ?? ''}`) ||
      (process.env.AGENT_OFFICE_TELEGRAM_LOCAL_TOKEN?.length ?? 0) < 32) return send(res, 403, { error: 'Forbidden' });
    try {
      const { floor, worker } = target(ctx);
      if (req.method === 'GET' && path === '/api/telegram/status') return send(res, 200, {
        leader: { id: worker.id, name: worker.name, status: worker.status },
        workers: floor.workers.list().map((w) => ({ id: w.id, name: w.name, status: w.status })),
        posting: 'OFF',
      });
      if (req.method === 'POST' && path === '/api/telegram/prompt') {
        const input = JSON.parse(await readBody(req, 20 * 1024));
        return send(res, 200, await dispatch(ctx, input));
      }
      if (req.method === 'GET' && path === '/api/telegram/reply') {
        const reply = await readReply(floor.dir, url.searchParams.get('id') ?? '');
        return send(res, 200, { reply: reply ?? null });
      }
      if (req.method === 'GET' && path === '/api/telegram/export') {
        const file = exportPath(url.searchParams.get('path'));
        const body = await safeFile(floor.dir, file);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return res.end(body);
      }
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      // Paths and exception text stay local; this endpoint does not expose credentials in errors.
      return send(res, 400, { error: 'Request unavailable; check brand, export path, reply format, or leader status' });
    }
  },
};
