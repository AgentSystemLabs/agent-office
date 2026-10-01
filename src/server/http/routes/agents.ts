// The models the hire dialog offers for OpenCode and Grok workers.
import { send } from '../util.js';
import type { Route } from '../router.js';
import { L } from '../../i18n.js';

export const agentRoutes = {
  openCodeModels: {
    method: 'GET',
    path: '/api/agents/opencode/models',
    auth: 'session',
    async handle(ctx, { res }) {
      try {
        return send(res, 200, { models: await ctx.openCodeModels.get() });
      } catch {
        return send(res, 502, { error: L.srv.noModels });
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
        return send(res, 502, { error: L.srv.noGrokModels });
      }
    },
  },
} satisfies Record<string, Route>;
