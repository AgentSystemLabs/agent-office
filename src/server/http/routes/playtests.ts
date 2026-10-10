import { floorPlaytests, PlaytestError } from '../../playtests.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const playtestRoute: Route = {
  path: '/api/playtests', auth: 'session',
  async handle(ctx, { req, res, url, session }) {
    const floor = floorParam(ctx, url);
    if (!floor) return send(res, 404, { error: 'No such floor' });
    if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST' });
    if (req.method === 'POST' && !sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    try {
      const store = floorPlaytests(floor);
      if (req.method === 'GET') return send(res, 200, store.state());
      const body = JSON.parse(await readBody(req, 24000));
      const actor = session.account?.name ?? 'Office user';
      if (body?.action === 'add') store.add(body.test, actor);
      else if (body?.action === 'update') store.update(body, actor);
      else throw new PlaytestError('Unknown action');
      return send(res, 200, store.state());
    } catch (err) {
      const status = err instanceof PlaytestError ? err.status : err instanceof SyntaxError ? 400 : 500;
      return send(res, status, { error: status === 500 ? 'Could not load or save the checklist. Existing data is preserved.' : (err as Error).message });
    }
  },
};
