import type { Route } from '../router.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Ctx } from '../../office/context.js';

async function edit(ctx: Ctx, req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, accountId: string | undefined, action: (body: unknown) => string | undefined) {
  if (!ctx.meOf(accountId).admin) return send(res, 403, { error: 'Only admins can configure the office' });
  if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Origin mismatch' });
  let body: unknown;
  try { body = JSON.parse(await readBody(req, 8192)); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
  const error = action(body);
  if (error) return send(res, 400, { error });
  return send(res, 200, ctx.structure.snapshot());
}

export const structureRoutes = {
  zones: { method: 'GET', path: '/api/zones', auth: 'session', handle: (ctx, { res }) => send(res, 200, ctx.structure.snapshot()) },
  departments: { method: 'GET', path: '/api/departments', auth: 'session', handle: (ctx, { res }) => send(res, 200, ctx.structure.snapshot().departments) },
  addDepartment: { method: 'POST', path: '/api/departments', auth: 'session', handle: (ctx, { req, res, session }) => edit(ctx, req, res, session.account?.id, (body) => ctx.structure.addDepartment(body, session.account?.id ?? 'shared-password-admin')) },
  updateDepartment: {
    method: 'PATCH', prefix: '/api/departments/', auth: 'session',
    handle: (ctx, { req, res, path, session }) => edit(ctx, req, res, session.account?.id, (body) => ctx.structure.updateDepartment(path.slice('/api/departments/'.length), body, session.account?.id ?? 'shared-password-admin')),
  },
  assignFloor: {
    method: 'POST', path: '/api/floor-department', auth: 'session',
    handle: (ctx, { req, res, session }) => edit(ctx, req, res, session.account?.id, (body) => {
      if (!body || typeof body !== 'object' || !('floorId' in body) || !('departmentId' in body) || typeof body.floorId !== 'string' || typeof body.departmentId !== 'string') return 'Invalid assignment';
      return ctx.structure.assignFloor(body.floorId, body.departmentId, session.account?.id ?? 'shared-password-admin');
    }),
  },
} satisfies Record<string, Route>;
