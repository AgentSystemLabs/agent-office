import type http from 'node:http';
import type { Ctx } from '../office/context.js';
import { floorPlaytests, PlaytestError } from '../playtests.js';
import { readBody, send } from '../http/util.js';

/** Workers may contribute checks, never claim a human played them. Auth fixes the target floor. */
export async function officePlaytests(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const id = url.searchParams.get('worker') ?? '';
  const floor = ctx.workerFloor(id);
  const me = floor?.workers.authenticate(id, (req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  if (!floor || !me) return send(res, 401, { error: 'Worker authentication required' });
  if (req.method !== 'GET' && req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST' });
  try {
    const store = floorPlaytests(floor);
    if (req.method === 'GET') return send(res, 200, store.state());
    const body = JSON.parse(await readBody(req, 24000));
    if (body?.action !== 'add') return send(res, 403, { error: 'Only a person can check off or edit a test in the Office checklist' });
    const item = store.add(body.test, me.name);
    return send(res, 200, { item });
  } catch (err) {
    const status = err instanceof PlaytestError ? err.status : err instanceof SyntaxError ? 400 : 500;
    return send(res, status, { error: status === 500 ? 'Checklist could not be saved; existing data is preserved' : (err as Error).message });
  }
}
