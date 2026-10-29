import { createReadStream } from 'node:fs';
import type { Route } from '../router.js';
import { send } from '../util.js';
import { readBody } from '../util.js';

function unavailable(ctx: Parameters<Extract<Route, { auth: 'session' }>['handle']>[0], res: Parameters<Extract<Route, { auth: 'session' }>['handle']>[1]['res']) {
  return send(res, 503, { error: 'Editorial subsystem is disabled. Set EDITORIAL_ENABLED=1 on Node 22.5+.' });
}

export const editorialRoutes = {
  page: {
    path: '/editorial', auth: 'session', handle(ctx, { res }) {
      if (!ctx.editorial) return unavailable(ctx, res);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' });
      return createReadStream(`${ctx.publicDir}/editorial.html`).pipe(res);
    },
  },
  api: {
    prefix: '/api/editorial', auth: 'session', async handle(ctx, { req, res, path, url }) {
      if (!ctx.editorial) return unavailable(ctx, res);
      if (req.method === 'GET' && (path === '/api/editorial' || path === '/api/editorial/overview')) return send(res, 200, ctx.editorial.snapshot());
      if (req.method === 'GET' && path === '/api/editorial/health') return send(res, 200, { ok: true, enabled: true, provider: ctx.editorial.provider.id, configured: ctx.editorial.provider.configured });
      if (req.method === 'POST' && path === '/api/editorial/projects') {
        const body = JSON.parse(await readBody(req, 32 * 1024)) as Record<string, unknown>;
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        if (!title) return send(res, 400, { error: 'title is required' });
        const project = ctx.editorial.createProject({ provisionalTitle: title, authorName: typeof body.authorName === 'string' ? body.authorName : undefined, collaborators: [], language: 'es', locale: 'es-419', desiredFormats: ['epub', 'pdf'] });
        return send(res, 201, project);
      }
      return send(res, 404, { error: 'Editorial endpoint not found' });
    },
  },
  artifact: {
    method: 'GET', path: '/api/editorial/artifact', auth: 'session', handle(ctx, { res, url }) {
      if (!ctx.editorial) return unavailable(ctx, res);
      const artifactId = url.searchParams.get('id');
      if (!artifactId) return send(res, 400, { error: 'id is required' });
      const artifact = ctx.editorial.snapshot().projects.flatMap((project) => ctx.editorial!.repo.listArtifacts(project.id)).find((candidate) => candidate.id === artifactId);
      if (!artifact) return send(res, 404, { error: 'Artifact not found' });
      const bytes = ctx.editorial.storage.read(artifact.path);
      res.writeHead(200, { 'content-type': mime(artifact.type), 'content-length': String(bytes.byteLength), 'content-disposition': `attachment; filename="${artifact.id}-${artifact.type}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      return res.end(bytes);
    },
  },
} satisfies Record<string, Route>;

function mime(type: string): string {
  if (type === 'epub') return 'application/epub+zip';
  if (type === 'pdf_interior') return 'application/pdf';
  if (type === 'illustration' || type === 'cover_digital' || type === 'cover_print') return 'image/png';
  if (type === 'release_package') return 'application/zip';
  return 'text/plain; charset=utf-8';
}
