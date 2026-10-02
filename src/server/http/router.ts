import type http from 'node:http';
import type { Session } from '../auth.js';
import { RELAY_LOGIN, relayRequest, signInPage, stoppedPage, tunneledService } from '../relay.js';
import type { Ctx } from '../office/context.js';
import { login, loginOptions } from './routes/auth.js';
import { send } from './util.js';

/** A request a route answers: `path` is the URL's path, decoded. */
export interface RouteRequest {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  path: string;
}

/** Which requests a route answers: exactly `path` (or one of them), or every path under `prefix`. */
type Where = { path: string | readonly string[]; prefix?: never } | { prefix: string; path?: never };

interface Answers {
  /** Only requests with this method; any method when missing, and the route answers the rest itself. */
  method?: 'GET' | 'POST';
}

/**
 * One of the office's HTTP routes. `public` ones answer anyone; `session` ones only a signed-in
 * browser, after the sign-in check, which sends everyone else to the sign-in page (or a 401).
 */
export type Route = Where &
  Answers &
  (
    | { auth: 'public'; handle(ctx: Ctx, r: RouteRequest): unknown }
    | { auth: 'session'; handle(ctx: Ctx, r: RouteRequest & { session: Session }): unknown }
  );

const matches = (route: Route, method: string | undefined, p: string) =>
  (!route.method || route.method === method) && (route.prefix !== undefined ? p.startsWith(route.prefix) : typeof route.path === 'string' ? p === route.path : route.path.includes(p));

/**
 * The office's request handler: a service tunnel is relayed first, then the first route (in `routes`'
 * order) that matches answers, the public ones before the sign-in check and the rest after it.
 */
export function requestHandler(ctx: Ctx, routes: readonly Route[]) {
  const open = routes.filter((r) => r.auth === 'public');
  const signedIn = routes.filter((r) => r.auth === 'session');
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const { cfg, auth } = ctx;
    try {
      // A service tunnel (localhost:5173 -> the office): relay to that worker's server.
      const tunneled = tunneledService(req, cfg.port, cfg.tailnet, (port) => ctx.services.lookup(port));
      if (tunneled) {
        if (req.method === 'POST' && req.url === RELAY_LOGIN) return await login(ctx, req, res);
        if (!auth.fromAnyCookie(req)) return signInPage(res, tunneled.port, loginOptions(ctx));
        if (tunneled.svc === 'gone') return stoppedPage(res, tunneled.port);
        return relayRequest(req, res, tunneled.svc);
      }
      let url: URL;
      let p: string;
      try {
        url = new URL(req.url ?? '/', 'http://x');
        p = decodeURIComponent(url.pathname);
      } catch {
        return send(res, 400, { error: 'Bad request' });
      }
      const r: RouteRequest = { req, res, url, path: p };
      for (const route of open) if (route.auth === 'public' && matches(route, req.method, p)) return await route.handle(ctx, r);

      const session = auth.fromRequest(req);
      if (!session) {
        if (p.startsWith('/api/')) return send(res, 401, { error: 'Not logged in' });
        // Back to the 2D view after signing in, if that's where they were going.
        res.writeHead(302, { location: p === '/lite' ? '/login?next=/lite' : '/login' }).end();
        return;
      }
      for (const route of signedIn) if (route.auth === 'session' && matches(route, req.method, p)) return await route.handle(ctx, { ...r, session });
    } catch (err) {
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'Internal error' });
    }
  };
}
