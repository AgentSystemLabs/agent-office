import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { str } from '../office/input.js';
import { readBody, send } from '../http/util.js';
import { crewBrief } from './crew.js';
import { hireCrew } from './hire.js';
import { studioOf } from './index.js';
import { CREW_ROLES, type CrewRole } from './types.js';

const ROUTES = ['', '/reel', '/brief', '/series', '/series/set', '/idea', '/script', '/review', '/remake', '/post', '/stats', '/note', '/crew', '/crew/join'];

/**
 * The reels studio, for any worker in the office (bin/office-reels.js is the command and MCP server
 * that call it): GET for how everything stands, a reel in full or a crew brief, and a POST for each
 * thing the crew does. The worker's own hook token says who's asking; everyone hears what they did.
 */
export async function officeReels(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(workerId);
  const me = floor?.workers.authenticate(workerId, token);
  if (!floor || !me) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  const studio = studioOf(ctx);
  const who = me.name;
  const action = url.pathname.slice('/office/reels'.length);
  if (!ROUTES.includes(action)) return send(res, 404, { error: `No /office/reels${action}` });
  const answer = (r: unknown) => (typeof r === 'string' ? send(res, 400, { error: r }) : send(res, 200, r));

  if (req.method === 'GET') {
    if (action === '') return send(res, 200, { you: { id: me.id, name: who, crew: studio.store.state.crew.filter((c) => c.workerId === me.id).map((c) => c.role) }, ...studio.overview() });
    if (action === '/reel') return answer(studio.show(url.searchParams.get('id') ?? ''));
    if (action === '/brief') {
      const role = url.searchParams.get('role') as CrewRole;
      if (!CREW_ROLES.includes(role)) return send(res, 400, { error: `role is one of ${CREW_ROLES.join(', ')}` });
      const s = url.searchParams.get('series');
      const series = s ? studio.store.series(s) : undefined;
      if (s && !series) return send(res, 404, { error: `No series ${s}` });
      return send(res, 200, { brief: crewBrief(role, series) });
    }
    return send(res, 405, { error: `POST to /office/reels${action}` });
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST' });
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse((await readBody(req)) || '{}');
    body = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return send(res, 400, { error: 'Send JSON' });
  }

  switch (action) {
    case '/series':
      return answer(studio.addSeries(body, who));
    case '/series/set':
      return answer(studio.setSeries(body.series, body, who));
    case '/idea':
      return answer(studio.addIdea(body.series, body, who));
    case '/script':
      return answer(studio.script(body.reel, body.series, body, who));
    case '/review':
      return answer(studio.review(body.reel, body.approve === true, str(body.note, 1000), who));
    case '/remake':
      return answer(studio.remake(body.reel));
    case '/post':
      return answer(await studio.postNow(body.reel, who));
    case '/stats':
      return answer(await studio.stats().catch((e: Error) => `Fetching the numbers failed: ${e.message}`));
    case '/note':
      return answer(studio.note(body.series, body.text, who));
    case '/crew/join': {
      const role = body.role as CrewRole;
      if (!CREW_ROLES.includes(role)) return send(res, 400, { error: `role is one of ${CREW_ROLES.join(', ')}` });
      const series = body.series ? studio.store.series(str(body.series, 64)) : undefined;
      if (body.series && !series) return send(res, 404, { error: `No series ${String(body.series)}` });
      studio.addCrew({ role, workerId: me.id, floorId: floor.id, name: who, hiredAt: Date.now(), ...(series ? { seriesId: series.id } : {}) });
      ctx.toastFloor(floor, `🎬 ${who} joined the reels crew as ${role}`);
      return send(res, 200, { ok: true, brief: crewBrief(role, series) });
    }
    case '/crew': {
      const r = hireCrew(ctx, floor, who, floor.workers.ownerOf(me.id), body);
      return send(res, r.status, r.body);
    }
  }
  return send(res, 405, { error: `GET /office/reels${action}` });
}
