import { monitorOf } from '../../domain-monitor/index.js';
import type { Route } from '../router.js';
import { send } from '../util.js';
export const domainMonitorRoutes = {
  state: { method: 'GET', path: '/api/domain-monitor', auth: 'session', handle(ctx, { res }) { res.setHeader('cache-control', 'no-store'); send(res, 200, monitorOf(ctx).snapshot()); } },
} satisfies Record<string, Route>;
