import { XrSessions } from '../../xr-playtests/store.js';
import { PlaytestError, floorPlaytests } from '../../playtests.js';
import { registerXrAcceptance } from '../../xr-playtests/acceptance.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
function error(res: Parameters<typeof send>[0], e: unknown) {
  return send(res, e instanceof PlaytestError ? e.status : e instanceof SyntaxError ? 400 : 500,
    { error: e instanceof PlaytestError ? e.message : 'Testbegleitung konnte nicht geladen oder gespeichert werden.' });
}
export const xrSessionRoute: Route = {
  path: '/api/playtests/xr-session', auth: 'session',
  async handle(ctx, { req, res, url, session }) {
    const floor = floorParam(ctx, url);
    if (!floor) return send(res, 404, { error: 'No such floor' });
    const store = new XrSessions(floor.dir), owner = session.account?.id ?? 'shared';
    try {
      if (req.method === 'GET') {
        const download = url.searchParams.get('download') === '1';
        const view = store.view(owner, url.searchParams.get('run') || undefined, Date.now(), download), artifact = url.searchParams.get('artifact');
        if (artifact) {
          const c = view.run?.commands?.find(c => c.id === artifact && c.artifact);
          if (!c) return send(res, 404, { error: 'Beleg nicht gefunden' });
          const png = readFileSync(path.join(floor.dir, '.agent-office', 'xr-evidence', view.run!.id, c.id + '.png'));
          res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'content-disposition': 'inline', 'x-content-type-options': 'nosniff' }); return res.end(png);
        }
        return send(res, 200, view, download ? { 'content-disposition': `attachment; filename="playtest-${view.run?.id ?? 'session'}.json"` } : {});
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      const body = JSON.parse(await readBody(req, 16000));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PlaytestError('Ungültige Aktion');
      if (body.action === 'start') {
        registerXrAcceptance(floorPlaytests(floor), session.account?.name ?? 'Office user');
        return send(res, 200, store.start(owner));
      }
      if (body.action === 'rule') { store.setRule(body.testId, body.rule); return send(res, 200, {}); }
      return send(res, 200, store.control(owner, body.id, body.action, body.value));
    } catch (e) { return error(res, e); }
  },
};
/** The helper has only a revocable, per-run token; it cannot write tests, issues or queue entries. */
export const xrBridgeRoute: Route = {
  path: '/api/playtests/xr-bridge', auth: 'public', method: 'POST',
  async handle(ctx, { req, res, url }) {
    const floor = floorParam(ctx, url);
    if (!floor) return send(res, 404, { error: 'No such floor' });
    const token = req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!token) return send(res, 401, { error: 'Pairing required' });
    try {
      const store = new XrSessions(floor.dir), run = url.searchParams.get('run') ?? '';
      store.verifyToken(run, token);
      const body = JSON.parse(await readBody(req, 16500000));
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PlaytestError('Invalid telemetry');
      return send(res, 200, store.ingest(run, token, body));
    } catch (e) { return error(res, e); }
  },
};
