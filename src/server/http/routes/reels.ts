// The reels studio's page (reels.html, src/client/reels/) and what it asks the office for: how
// everything stands, a reel in full, its video, and what a person does there (approve a reel, change
// a series, hire the crew…), which goes through the same studio the crew's office-reels command does.

import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { studioOf } from '../../reels/index.js';
import { hireCrew } from '../../reels/hire.js';
import { str } from '../../office/input.js';
import { serveFile } from '../static.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';
import type { Ctx } from '../../office/context.js';
import type http from 'node:http';

/** Streams a reel's video, a range at a time when the player asks for one (to seek). */
function streamVideo(req: http.IncomingMessage, res: http.ServerResponse, file: string) {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return send(res, 404, { error: 'The video is gone' });
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const head = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
  if (!range || (!range[1] && !range[2])) {
    res.writeHead(200, { ...head, 'content-length': size });
    return createReadStream(file).pipe(res);
  }
  // "bytes=-500" is the last 500 bytes.
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
    return;
  }
  res.writeHead(206, { ...head, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
  createReadStream(file, { start, end }).pipe(res);
}

/** The floors a person can hire the crew onto. */
const floorsOf = (ctx: Ctx) => [...ctx.floors.values()].map((f) => ({ id: f.id, name: f.def.name }));

export const reelsRoutes = {
  page: { path: ['/reels', '/reels.html'], auth: 'session', handle: (ctx, { res }) => serveFile(res, path.join(ctx.publicDir, 'reels.html'), false) },
  api: {
    prefix: '/api/reels',
    auth: 'session',
    async handle(ctx, { req, res, url, path: p, session }) {
      const studio = studioOf(ctx);
      const me = ctx.meOf(session.account?.id);
      // Someone on the shared office password has no account, so no name of their own.
      const who = me.account?.name ?? 'Someone in the office';
      const action = p.slice('/api/reels'.length);
      const answer = (r: unknown) => (typeof r === 'string' ? send(res, 400, { error: r }) : send(res, 200, r));

      if (req.method === 'GET') {
        if (action === '' || action === '/') return send(res, 200, { me: { name: who, admin: me.admin }, floors: floorsOf(ctx), ...studio.overview() });
        if (action === '/reel') return answer(studio.show(url.searchParams.get('id') ?? ''));
        const video = /^\/video\/([\w-]+)$/.exec(action);
        if (video) {
          const r = studio.store.reel(video[1]);
          // Only ever a file in the studio's own out folder.
          if (!r?.video || path.dirname(path.resolve(r.video)) !== path.resolve(studio.store.dir, 'out')) return send(res, 404, { error: 'No video for that reel' });
          return streamVideo(req, res, r.video);
        }
        return send(res, 404, { error: 'Not found' });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'GET or POST' });
      // Another site mustn't be able to post on a visitor's behalf.
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Not from the office' });
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
        case '/crew': {
          const floor = ctx.floors.get(str(body.floor, 64)) ?? ctx.floors.values().next().value;
          if (!floor) return send(res, 409, { error: 'There is no floor to hire onto' });
          const r = hireCrew(ctx, floor, who, session.account?.id, body);
          return send(res, r.status, r.body);
        }
      }
      return send(res, 404, { error: 'Not found' });
    },
  },
} satisfies Record<string, Route>;
