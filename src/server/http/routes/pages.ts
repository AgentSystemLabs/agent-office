// The office's pages and the rest of the client bundle.
import path from 'node:path';
import { publicFile, serveFile } from '../static.js';
import { readBody, send } from '../util.js';
import type { Route, RouteRequest } from '../router.js';
import type { ProjectConfig } from '../../plugins/types.js';
import type { Ctx } from '../../office/context.js';

/** One of the bundle's own pages, never cached, so a new version is picked up at once. */
const page = (name: string) => (ctx: Ctx, { res }: RouteRequest) => serveFile(res, path.join(ctx.publicDir, name), false);

export const pageRoutes = {
  health: { path: '/api/health', auth: 'public', handle: (_ctx, { res }) => send(res, 200, { ok: true }) },
  assets: {
    prefix: '/assets/',
    auth: 'public',
    handle(ctx, { res, path: p }) {
      const file = publicFile(ctx.publicDir, p);
      if (file) return serveFile(res, file, true);
      res.writeHead(404).end();
    },
  },
  login: { path: ['/login', '/login.html'], auth: 'public', handle: page('login.html') },
  claim: { path: ['/claim', '/claim.html'], auth: 'public', handle: page('claim.html') },
  join: { path: ['/join', '/join.html'], auth: 'public', handle: page('join.html') },
  favicon: { path: '/favicon.svg', auth: 'public', handle: page('favicon.svg') },
  /**
   * A plugin's own files (its settings page and whatever that page loads), under /plugins/<id>/.
   * The office serves the file and knows nothing about it: any plugin can bring its own UI, and one
   * that ships none is simply never asked for.
   */
  pluginFiles: {
    prefix: '/plugins/',
    auth: 'session',
    handle(ctx, { res, path: p }) {
      const slash = p.indexOf('/', '/plugins/'.length);
      const id = slash > 0 ? p.slice('/plugins/'.length, slash) : p.slice('/plugins/'.length);
      const rest = slash > 0 ? p.slice(slash + 1) : '';
      const file = rest ? ctx.plugins?.settingsPagePathOf(id, rest) : undefined;
      if (!file) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('No such plugin file');
        return;
      }
      return serveFile(res, file, false);
    },
  },
  /**
   * The projects a plugin's settings page reads and writes for the floor you are on: the page
   * (see pluginFiles) asks here, and the office hands it to whichever plugin lists them. Nothing
   * about the projects themselves is known to the office.
   */
  pluginProjects: {
    method: 'GET',
    prefix: '/api/plugins/',
    auth: 'session',
    async handle(ctx, { res, url, path: p }) {
      const rest = p.slice('/api/plugins/'.length);
      const slash = rest.indexOf('/');
      const id = slash > 0 ? rest.slice(0, slash) : rest;
      const what = slash > 0 ? rest.slice(slash + 1) : '';
      if (what !== 'projects' || !id || !ctx.plugins?.has(id)) return send(res, 404, { error: 'No such plugin' });
      const floor = ctx.floors.get(url.searchParams.get('floor') ?? '');
      const projects = await ctx.plugins.listPluginProjects(id, floor);
      if (projects === null) return send(res, 404, { error: `No projects to list for ${id}` });
      return send(res, 200, { projects });
    },
  },
  pluginProjectsSave: {
    method: 'POST',
    prefix: '/api/plugins/',
    auth: 'session',
    async handle(ctx, { res, url, req, path: p }) {
      const rest = p.slice('/api/plugins/'.length);
      const slash = rest.indexOf('/');
      const id = slash > 0 ? rest.slice(0, slash) : rest;
      const what = slash > 0 ? rest.slice(slash + 1) : '';
      if (what !== 'projects' || !id || !ctx.plugins?.has(id)) return send(res, 404, { error: 'No such plugin' });
      const floor = ctx.floors.get(url.searchParams.get('floor') ?? '');
      let body: { projects?: unknown };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { error: 'Send JSON: {"projects": [...]}' });
      }
      const projects = Array.isArray(body?.projects) ? (body.projects as ProjectConfig[]) : undefined;
      if (!projects) return send(res, 400, { error: 'A list of projects is required' });
      const ok = await ctx.plugins.savePluginProjects(id, floor, projects);
      if (!ok) return send(res, 400, { error: `No plugin took those projects (no floor picked, or ${id} keeps its projects elsewhere)` });
      return send(res, 200, { projects });
    },
  },
  office: { path: ['/', '/index.html'], auth: 'session', handle: page('index.html') },
  // The 2D view: the workers, their terminals and the boards, without the 3D office (lite.ts).
  lite: { path: ['/lite', '/lite.html'], auth: 'session', handle: page('lite.html') },
  /** Anything else in the bundle; last, since it answers every path. */
  bundle: {
    prefix: '/',
    auth: 'session',
    handle(ctx, { res, path: p }) {
      const file = publicFile(ctx.publicDir, p);
      if (file) return serveFile(res, file, false);
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    },
  },
} satisfies Record<string, Route>;
