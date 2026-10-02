// The models the hire dialog offers for the providers whose CLI lists them (see ../../models.ts).
import { PROVIDER_META, isAgentProvider } from '../../../shared/providers.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { L } from '../../i18n.js';

export const agentRoutes = {
  /** GET /api/agents/<provider>/models */
  models: {
    method: 'GET',
    prefix: '/api/agents/',
    auth: 'session',
    async handle(ctx, { res, path }) {
      const [provider, what, ...rest] = path.slice('/api/agents/'.length).split('/');
      const catalogue = isAgentProvider(provider) && what === 'models' && !rest.length ? ctx.models[provider] : undefined;
      if (!catalogue || !isAgentProvider(provider)) return send(res, 404, { error: 'Not found' });
      try {
        return send(res, 200, { models: await catalogue.get() });
      } catch {
        return send(res, 502, { error: L.srv.noModelsOf(PROVIDER_META[provider].name) });
      }
    },
  },
} satisfies Record<string, Route>;
