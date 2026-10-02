import { LOBBY } from '../../../shared/lobby.js';
// Files a floor's windows show or take: pictures on the walls and the whiteboard, files dropped into
// a terminal, changed pictures in the Changes window, and the bookshelf's Markdown.
import type { Floor } from '../../floor.js';
import { WB_MAX_FILE_BYTES } from '../../../shared/whiteboard.js';
import { DROP_MAX_BYTES } from '../../../shared/drops.js';
import type { Ctx } from '../../office/context.js';
import { repoOf, str } from '../../office/input.js';
import { readBody, readBytes, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';

// Which floor a request is about: its boards and its workers.
export const floorParam = (ctx: Ctx, url: URL): Floor | undefined => ctx.floors.get(url.searchParams.get('floor') ?? '');

export const fileRoutes = {
  image: {
    method: 'GET',
    path: '/api/image',
    auth: 'session',
    async handle(ctx, { res, url }) {
      // A picture on the wall, fetched by the office so the 3D view can draw it (see decor.ts).
      const r = await ctx.images.get(url.searchParams.get('url') ?? '');
      if ('error' in r) return send(res, r.status, { error: r.error });
      res.writeHead(200, {
        'content-type': r.type,
        'content-length': String(r.body.length),
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        // Opened on its own (an SVG, say), it still can't run anything on the office's origin.
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'cross-origin-resource-policy': 'same-origin',
      });
      res.end(r.body);
    },
  },
  whiteboardFile: {
    path: '/api/whiteboard/file',
    auth: 'session',
    async handle(ctx, { req, res, url }) {
      const floor = url.searchParams.get('floor') === LOBBY ? ctx.lobby : floorParam(ctx, url);
      // Pictures on the whiteboard. Their ids are hashes of what's in them, so they never change.
      if (!floor) return send(res, 404, { error: 'No such floor' });
      if (req.method === 'GET') {
        const f = floor.whiteboard.file(url.searchParams.get('id') ?? '');
        if (!f) return send(res, 404, { error: 'No such picture' });
        return send(res, 200, f, { 'cache-control': 'private, max-age=31536000, immutable' });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, WB_MAX_FILE_BYTES + 4096));
      } catch (err) {
        if ((err as Error).message === 'too large') return send(res, 413, { error: 'That picture is too big for the whiteboard' });
        return send(res, 400, { error: 'Bad request' });
      }
      const error = floor.whiteboard.addFile(body);
      return error ? send(res, 400, { error }) : send(res, 200, { ok: true });
    },
  },
  termDrop: {
    path: '/api/term/drop',
    auth: 'session',
    async handle(ctx, { req, res, url }) {
      const floor = floorParam(ctx, url);
      // A file dropped or pasted into a worker's terminal, kept on this machine for the terminal to type its path.
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const workerId = str(url.searchParams.get('worker'), 32);
      if (!floor.workers.get(workerId)) return send(res, 404, { error: 'No such worker' });
      const tooBig = `That file is too big to drop into a terminal (${DROP_MAX_BYTES / 1024 / 1024} MB at most)`;
      if (Number(req.headers['content-length']) > DROP_MAX_BYTES) return send(res, 413, { error: tooBig });
      let body: Buffer;
      try {
        body = await readBytes(req, DROP_MAX_BYTES);
      } catch (err) {
        return (err as Error).message === 'too large' ? send(res, 413, { error: tooBig }) : send(res, 400, { error: 'Bad request' });
      }
      const file = floor.workers.drop(workerId, str(url.searchParams.get('name'), 256), str(req.headers['content-type'], 128), body);
      return file ? send(res, 200, { path: file }) : send(res, 500, { error: 'The office could not keep that file' });
    },
  },
  changedFile: {
    path: '/api/changes/file',
    auth: 'session',
    async handle(ctx, { req, res, url }) {
      const floor = floorParam(ctx, url);
      // A changed picture in the Changes window at a desk: before (old) or after (new) the worker's edits.
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      const workerId = str(url.searchParams.get('worker'), 32);
      const file = str(url.searchParams.get('path'), 4096);
      const side = url.searchParams.get('side');
      if (!workerId || !file || (side !== 'old' && side !== 'new')) return send(res, 400, { error: 'Bad request' });
      if (!floor) return send(res, 404, { error: 'No such floor' });
      if (!floor.workers.get(workerId)) return send(res, 404, { error: 'No such worker' });
      const r = await floor.changes.file(workerId, file, side, repoOf(url.searchParams.get('repo')));
      if ('error' in r) return send(res, r.status, { error: r.error });
      res.writeHead(200, {
        'content-type': r.type,
        'content-length': String(r.body.length),
        // The worker may change it again any moment.
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'cross-origin-resource-policy': 'same-origin',
      });
      res.end(r.body);
    },
  },
  docs: {
    method: 'GET',
    prefix: '/api/docs',
    auth: 'session',
    async handle(ctx, { res, url, path: p }) {
      const floor = floorParam(ctx, url);
      // The bookshelf: the project's Markdown files, one to read, and the pictures in it (see docs.ts).
      if (!floor) return send(res, 404, { error: 'No such floor' });
      if (p === '/api/docs') return send(res, 200, await floor.docs.list());
      const file = str(url.searchParams.get('path'), 4096);
      if (!file) return send(res, 400, { error: 'Bad request' });
      if (p === '/api/docs/file') {
        const r = await floor.docs.read(file);
        return 'error' in r ? send(res, r.status, { error: r.error }) : send(res, 200, r);
      }
      if (p === '/api/docs/picture') {
        const r = await floor.docs.picture(file);
        if ('error' in r) return send(res, r.status, { error: r.error });
        res.writeHead(200, {
          'content-type': r.type,
          'content-length': String(r.body.length),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
          'cross-origin-resource-policy': 'same-origin',
        });
        res.end(r.body);
        return;
      }
      return send(res, 404, { error: 'Not found' });
    },
  },
} satisfies Record<string, Route>;
