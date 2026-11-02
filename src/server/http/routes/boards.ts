import { send, readBody } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

export const boardRoutes = {
  boards: {
    method: 'GET',
    prefix: '/api/boards/',
    auth: 'session',
    async handle(ctx, { res, url, path: p }) {
      const floor = floorParam(ctx, url) ?? ctx.floors.values().next().value;
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const boardId = url.searchParams.get('board') ?? '';
      try {
        if (p === '/api/boards/list') {
          return send(res, 200, { boards: floor.boardsState() });
        }
        if (!boardId) return send(res, 400, { error: 'Missing board parameter' });
        if (p === '/api/boards/cards') {
          return send(res, 200, { cards: await floor.listBoardCards(boardId) });
        }
        if (p === '/api/boards/card') {
          const cardId = url.searchParams.get('id') ?? '';
          if (!cardId) return send(res, 400, { error: 'Missing card id' });
          const card = await floor.getBoardCardDetail(boardId, cardId);
          if (!card) return send(res, 404, { error: 'Card not found' });
          return send(res, 200, card);
        }
        if (p === '/api/boards/config') {
          const cfg = await floor.getBoardConfig(boardId);
          return send(res, 200, { config: cfg ?? {} });
        }
      } catch (err) {
        return send(res, 502, { error: (err as Error).message });
      }
      return send(res, 404, { error: 'Not found' });
    },
  },
  boardConfigSave: {
    method: 'POST',
    path: '/api/boards/config',
    auth: 'session',
    async handle(ctx, { res, url, req }) {
      const floor = floorParam(ctx, url) ?? ctx.floors.values().next().value;
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const boardId = url.searchParams.get('board') ?? '';
      if (!boardId) return send(res, 400, { error: 'Missing board parameter' });
      try {
        const body = JSON.parse(await readBody(req));
        await floor.saveBoardConfig(boardId, body.config ?? body);
        return send(res, 200, { ok: true });
      } catch (err) {
        return send(res, 400, { error: (err as Error).message });
      }
    },
  },
  boardRefresh: {
    method: 'POST',
    path: '/api/boards/refresh',
    auth: 'session',
    async handle(ctx, { res, url }) {
      const floor = floorParam(ctx, url) ?? ctx.floors.values().next().value;
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const boardId = url.searchParams.get('board') ?? '';
      if (!boardId) return send(res, 400, { error: 'Missing board parameter' });
      try {
        const state = await floor.refreshBoard(boardId);
        return send(res, 200, state);
      } catch (err) {
        return send(res, 500, { error: (err as Error).message });
      }
    },
  },
  boardAssign: {
    method: 'POST',
    path: '/api/boards/assign',
    auth: 'session',
    async handle(ctx, { res, url, req }) {
      const floor = floorParam(ctx, url) ?? ctx.floors.values().next().value;
      if (!floor) return send(res, 404, { error: 'No such floor' });
      const boardId = url.searchParams.get('board') ?? '';
      const cardId = url.searchParams.get('id') ?? '';
      if (!boardId || !cardId) return send(res, 400, { error: 'Missing board or card id' });
      try {
        const body = JSON.parse(await readBody(req).catch(() => '{}'));
        const card = await floor.assignBoardCard(boardId, cardId, body?.assignee);
        return send(res, 200, { ok: true, card });
      } catch (err) {
        return send(res, 500, { error: (err as Error).message });
      }
    },
  },
} satisfies Record<string, Route>;
