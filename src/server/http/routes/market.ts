// The 📈 market terminal: prices and headlines, through the office so the Finnhub key stays here.
import { MAX_SYMBOLS, parseSymbols } from '../../../shared/market.js';
import { news, quotes } from '../../market.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

export const marketRoutes = {
  quotes: {
    method: 'GET',
    path: '/api/market/quotes',
    auth: 'session',
    handle: async (_ctx, { res, url }) => {
      const symbols = parseSymbols(url.searchParams.get('s') ?? '');
      if (!symbols.length) return send(res, 400, { error: `Name 1 to ${MAX_SYMBOLS} symbols, like AAPL,BTC-USD` });
      send(res, 200, await quotes(symbols));
    },
  },
  news: {
    method: 'GET',
    path: '/api/market/news',
    auth: 'session',
    handle: async (_ctx, { res }) => {
      try {
        send(res, 200, await news());
      } catch (err) {
        send(res, 502, { error: err instanceof Error ? err.message : 'News is unavailable' });
      }
    },
  },
} satisfies Record<string, Route>;
