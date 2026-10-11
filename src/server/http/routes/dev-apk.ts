import type { Route } from '../router.js';
import { sameOrigin, send } from '../util.js';
import { floorParam } from './files.js';
import { start, view } from '../../dev-apk/manager.js';
import { configFor, parseKind, BuildError } from '../../dev-apk/config.js';
import { download } from '../../dev-apk/download.js';
import { projectFor, rootFor } from '../../dev-apk/storage.js';
export const devApkRoute: Route = {
  path: ['/api/dev-apk', '/api/dev-apk/download'], auth: 'session',
  async handle(ctx, { req, res, url, path, session }) {
    const floor = floorParam(ctx, url); if (!floor) return send(res, 404, { error: 'Projekt nicht gefunden.' });
    try {
      const kind = parseKind(url.searchParams.get('kind'));
      if (path.endsWith('/download')) {
        if (!['GET', 'HEAD'].includes(req.method ?? '')) return send(res, 405, { error: 'GET oder HEAD verwenden.' });
        const config = configFor(ctx.cfg.dataDir, floor.def.repo);
        if (!config) return send(res, 404, { error: 'Kein APK-Download eingerichtet.' });
        return await download(rootFor(ctx.cfg.dataDir), projectFor(config.repo), url.searchParams.get('id'), req, res, kind);
      }
      if (req.method === 'GET') return send(res, 200, view(ctx.cfg.dataDir, floor.def.repo, session, kind));
      if (req.method !== 'POST') return send(res, 405, { error: 'GET oder POST verwenden.' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Build im Office starten.' });
      // No command, path, ref, or launch arguments are accepted from a browser.
      const job = start(ctx.cfg.dataDir, floor.def.repo, session, undefined, kind); return send(res, 202, job);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      return send(res, error instanceof BuildError ? error.status : 500, { error: error instanceof BuildError ? error.message : 'APK konnte nicht verarbeitet werden. Serverprotokoll prüfen.' });
    }
  },
};
