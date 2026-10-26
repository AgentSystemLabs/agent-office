import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';
import { loadWorkerProfiles, profilePrompt } from '../../worker-profiles.js';
import { DESK_BY_ID, deskBuilt } from '../../../shared/layout.js';
import path from 'node:path';

export const workerProfileRoutes = {
  profiles: {
    path: '/api/worker-profiles', auth: 'session',
    async handle(ctx, { req, res, url, session }) {
      const floor = floorParam(ctx, url);
      if (!floor) return send(res, 404, { error: 'No such floor' });
      try {
        const profiles = loadWorkerProfiles(path.join(floor.dir, '.agent-office'));
        if (req.method === 'GET') return send(res, 200, { profiles });
        if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
        if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
        const body = JSON.parse(await readBody(req, 24_000));
        const profile = profiles.find(profile => profile.id === body.id);
        if (!profile?.enabled || !profile.provider || !profile.model) return send(res, 409, { error: 'This profile is held; its route was not substituted' });
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
        if (!prompt || prompt.length > 20_000) return send(res, 400, { error: 'Enter a task for this worker' });
        if (floor.workers.list().some(worker => worker.name === profile.name)) return send(res, 409, { error: 'This worker already has a desk' });
        await floor.workers.fetchBase();
        if (floor.workers.list().some(worker => worker.name === profile.name)) return send(res, 409, { error: 'This worker already has a desk' });
        const desk = [...DESK_BY_ID.values()].find(desk => !desk.station && !desk.room && deskBuilt(desk, floor.plan.wing) && !floor.workers.deskOccupied(desk.id));
        if (!desk) return send(res, 409, { error: 'No free desk; expand the office or send a worker home' });
        const result = floor.workers.spawn(desk.id, session.account?.name || 'Office', profilePrompt(profile, prompt), true,
          'agent', profile.provider, profile.model, profile.effort, undefined, session.account?.id, [], undefined, profile.name);
        if (typeof result === 'string') return send(res, 409, { error: result });
        return send(res, 201, { workerId: result.id, name: result.name });
      } catch (error) { return send(res, 400, { error: (error as Error).message }); }
    },
  },
} satisfies Record<string, Route>;
