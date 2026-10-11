import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { readXrContext, readXrRequirements, selectXrPlaytests } from '../../../shared/xr-playtests.js';
import type { PlaytestState } from '../../../shared/playtests.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';
/** A browser preview is not verified headset telemetry. No checklist writes or device commands. */
export const xrPlaytestRoute: Route = {
  path: '/api/playtests/session-preview', auth: 'session',
  async handle(ctx, { req, res, url }) {
    const floor = floorParam(ctx, url);
    if (!floor) return send(res, 404, { error: 'No such floor' });
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
    if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
    let context, requirements;
    try {
      const body = JSON.parse(await readBody(req, 64000));
      context = readXrContext(body.context); requirements = readXrRequirements(body.requirements);
    } catch { return send(res, 400, { error: 'Invalid session preview' }); }
    try {
      const file = path.join(floor.dir, '.agent-office', 'playtests.json');
      const state: PlaytestState = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) : { items: [] };
      if (!Array.isArray(state.items) || state.items.length > 2000) throw new Error('Invalid checklist');
      return send(res, 200, { preview: true, deviceVerified: false, build: context.build, ...selectXrPlaytests(state.items, context, requirements) });
    } catch { return send(res, 500, { error: 'Could not read checklist; no data was changed' }); }
  },
};
