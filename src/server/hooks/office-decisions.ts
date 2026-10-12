import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { readBody, send } from '../http/util.js';
import { DecisionError } from '../decisions/store.js';
import { floorDecisions } from '../decisions/context.js';
export async function officeDecisions(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const id = url.searchParams.get('worker') ?? '', token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(id), worker = floor?.workers.authenticate(id, token);
  if (!floor || !worker) return send(res, 401, { error: 'Worker-Anmeldung fehlt.' });
  try {
    const pool = floorDecisions(ctx, floor);
    if (req.method === 'GET') return send(res, 200, { items: pool.list() });
    if (req.method !== 'POST') return send(res, 405, { error: 'GET oder POST verwenden.' });
    const body = JSON.parse(await readBody(req, 24000));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DecisionError('Entscheidungsfrage fehlt.');
    if (body.action === 'report') {
      if (worker.deskId !== 'station-issues') throw new DecisionError('Nur der Issues Agent darf den Umsetzungsabgleich melden.', 403);
      if (typeof body.id !== 'string' || !Number.isSafeInteger(body.answerAt)) throw new DecisionError('Entscheidung und Antwortversion fehlen.');
      const item = pool.report(body.id, body.answerAt, body, id);
      return send(res, 200, { item });
    }
    if ('answer' in body || 'status' in body || 'owner' in body || 'followup' in body) throw new DecisionError('Worker dürfen Fragen erfassen, aber keine menschlichen Antworten setzen.', 403);
    const item = pool.add(body, { name: worker.name, owner: floor.workers.ownerOf(id), worker: { id, name: worker.name } });
    return send(res, 200, { item });
  } catch (e) { return send(res, e instanceof DecisionError ? e.status : e instanceof SyntaxError ? 400 : 500, { error: e instanceof DecisionError ? e.message : 'Entscheidung konnte nicht gespeichert werden.' }); }
}
