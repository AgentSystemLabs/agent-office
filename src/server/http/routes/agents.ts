// The models the hire dialog offers for OpenCode, Grok and Cursor workers.
import { send } from '../util.js';
import type { Route } from '../router.js';

export const agentRoutes = {
  openCodeModels: {
    method: 'GET',
    path: '/api/agents/opencode/models',
    auth: 'session',
    async handle(ctx, { res }) {
      try {
        return send(res, 200, { models: await ctx.openCodeModels.get() });
      } catch {
        return send(res, 502, { error: 'Could not load OpenCode models' });
      }
    },
  },
  grokModels: {
    method: 'GET',
    path: '/api/agents/grok/models',
    auth: 'session',
    async handle(ctx, { res }) {
      try {
        return send(res, 200, { models: await ctx.grokModels.get() });
      } catch {
        return send(res, 502, { error: 'Could not load Grok models' });
      }
    },
  },
  cursorModels: {
    method: 'GET',
    path: '/api/agents/cursor/models',
    auth: 'session',
    async handle(ctx, { res }) {
      try {
        return send(res, 200, { models: await ctx.cursorModels.get() });
      } catch {
        return send(res, 502, { error: 'Could not load Cursor models' });
      }
    },
  },
} satisfies Record<string, Route>;
