// The 🔎 search, across chat and the terminals of a floor's workers.
import type { Floor } from '../../floor.js';
import type { SearchResults } from '../../../shared/protocol.js';
import { SEARCH_MAX, SEARCH_MIN, searchKey } from '../../../shared/search.js';
import type { Ctx } from '../../office/context.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { floorParam } from './files.js';

/** The most chat lines, and lines per worker's terminal, a search answers with. */
const SEARCH_CHAT_HITS = 50;
const SEARCH_TERMINAL_HITS = 25;

/** The 🔎 search: chat lines, and lines of the terminals of every worker on that floor, with the words in them. */
function search(ctx: Ctx, q: string, floor: Floor | undefined): SearchResults {
  q = q.slice(0, SEARCH_MAX);
  const needle = searchKey(q);
  if (needle.length < SEARCH_MIN) return { q, chat: [], terminals: [], more: false };
  const said = ctx.chat.search(needle, SEARCH_CHAT_HITS);
  const shown = floor?.workers.search(needle, SEARCH_TERMINAL_HITS) ?? { hits: [], more: false };
  return { q, chat: said.hits, terminals: shown.hits, more: said.more || shown.more };
}

export const searchRoutes = {
  search: { method: 'GET', path: '/api/search', auth: 'session', handle: (ctx, { res, url }) => send(res, 200, search(ctx, url.searchParams.get('q') ?? '', floorParam(ctx, url))) },
} satisfies Record<string, Route>;
