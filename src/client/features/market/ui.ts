// The 📈 market terminal's window: a watchlist that ticks, the picked symbol up close, and the
// market's headlines, amber on black. Prices come through the office (/api/market/*), never
// straight from the sources, so the office's Finnhub key stays on the server.
import './ui.css';
import { cleanSymbol, DEFAULT_WATCHLIST, MAX_SYMBOLS, type Headline, type NewsAnswer, type Quote, type QuotesAnswer } from '../../../shared/market';
import { h, openModal, timeAgo } from '../../ui/dom';

const LIST_KEY = 'agent-office.market.watchlist';
const QUOTES_EVERY = 10_000;
const NEWS_EVERY = 60_000;

function loadList(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LIST_KEY) ?? 'null');
    if (Array.isArray(v)) return v.map((s) => cleanSymbol(String(s))).filter((s): s is string => !!s).slice(0, MAX_SYMBOLS);
  } catch {
    // storage blocked
  }
  return [...DEFAULT_WATCHLIST];
}

function saveList(list: readonly string[]) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch {
    // storage blocked
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
  return j as T;
}

const price = (n: number) => (!Number.isFinite(n) ? '—' : n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : n >= 1 ? n.toFixed(2) : n.toPrecision(4));
const signed = (n: number, digits = 2) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
const dir = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

let open = false;

export function openMarket() {
  if (open) return;
  open = true;
  let list = loadList();
  let picked = list[0] ?? '';
  const last = new Map<string, Quote>();
  let missing = new Map<string, string>();
  let stocks = true;
  let headlines: Headline[] = [];
  let newsError = '';
  let updated = 0;

  const cmd = h('input.mkt-cmd', { type: 'text', placeholder: 'Symbol <GO>   e.g. AAPL or BTC-USD', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Add a symbol' });
  const status = h('span.mkt-status');
  const rows = h('tbody');
  const detail = h('div.mkt-detail');
  const newsList = h('ol.mkt-news');
  const keyNote = h('div.mkt-key');
  const el = h(
    'div.modal.market',
    { role: 'dialog', 'aria-label': 'Market terminal' },
    h('header', {}, h('h2', {}, '📈 Market terminal'), status),
    h('div.mkt-bar', {}, h('span.mkt-prompt', {}, '>'), cmd),
    keyNote,
    h(
      'div.mkt-grid',
      {},
      h('section.mkt-panel', {}, h('h3', {}, 'Watchlist'), h('table.mkt-table', {}, h('thead', {}, h('tr', {}, ...['Ticker', 'Last', 'Chg', '%Chg', 'High', 'Low', 'Time', ''].map((t) => h('th', {}, t)))), rows)),
      h('section.mkt-panel', {}, detail, h('h3', {}, 'Top news'), newsList),
    ),
    h('footer', {}, h('span.grow', {}, 'Stocks and news: Finnhub (free tier, US). Crypto: Coinbase. Prices can lag the market by a few seconds; not investment advice.')),
  );

  const renderKeyNote = () =>
    keyNote.replaceChildren(
      ...(stocks
        ? []
        : [
            'Crypto is live. For stocks and news, get a free key at ',
            h('a', { href: 'https://finnhub.io/register', target: '_blank', rel: 'noopener noreferrer' }, 'finnhub.io'),
            ' and start the office with ',
            h('code', {}, 'AGENT_OFFICE_FINNHUB_KEY'),
            ' set.',
          ]),
    );

  const renderRows = () => {
    rows.replaceChildren(
      ...list.map((s) => {
        const q = last.get(s);
        const why = missing.get(s);
        const remove = h('button.mkt-x', { type: 'button', title: `Remove ${s}`, 'aria-label': `Remove ${s}`, onclick: (e: Event) => (e.stopPropagation(), removeSymbol(s)) }, '×');
        const cells = q
          ? [h('td.num', {}, price(q.price)), h(`td.num.${dir(q.change)}`, {}, signed(q.change)), h(`td.num.${dir(q.change)}`, {}, `${signed(q.changePct)}%`), h('td.num', {}, price(q.high)), h('td.num', {}, price(q.low)), h('td.num.dim', {}, clock(q.at))]
          : [h('td.dim', { colspan: 6 }, why ?? 'Loading…')];
        return h('tr', { class: s === picked ? 'picked' : '', 'data-sym': s, onclick: () => ((picked = s), renderRows(), renderDetail()) }, h('td.sym', {}, s), ...cells, h('td', {}, remove));
      }),
    );
  };

  const renderDetail = () => {
    const q = last.get(picked);
    if (!q) return detail.replaceChildren(h('div.mkt-big.dim', {}, picked || 'Add a symbol'), h('div.dim', {}, missing.get(picked) ?? ''));
    detail.replaceChildren(
      h('div.mkt-big', {}, h('span.sym', {}, q.symbol), ' ', price(q.price)),
      h(`div.mkt-move.${dir(q.change)}`, {}, `${signed(q.change)}  (${signed(q.changePct)}%)  ${q.source === 'coinbase' ? 'vs 24h ago' : 'vs prev close'}`),
      h('div.mkt-range.dim', {}, `Open ${price(q.open)} · High ${price(q.high)} · Low ${price(q.low)} · ${q.source === 'coinbase' ? 'Coinbase' : 'Finnhub'} ${clock(q.at)}`),
    );
  };

  const renderNews = () => {
    if (newsError) return newsList.replaceChildren(h('li.dim', {}, newsError));
    if (!stocks) return newsList.replaceChildren(h('li.dim', {}, 'Headlines need a Finnhub key (see above).'));
    if (!headlines.length) return newsList.replaceChildren(h('li.dim', {}, 'Loading…'));
    newsList.replaceChildren(
      ...headlines.map((n) =>
        h(
          'li',
          {},
          h('a', { href: n.url, target: '_blank', rel: 'noopener noreferrer', title: n.summary }, n.headline),
          h('span.dim', {}, ` ${n.source} · ${timeAgo(n.at)}`),
        ),
      ),
    );
  };

  const renderStatus = () => {
    status.textContent = updated ? `Updated ${clock(updated)}` : 'Connecting…';
  };

  /** Flashes the rows whose price moved since the last update. */
  const flash = (before: Map<string, Quote>) => {
    for (const q of last.values()) {
      const was = before.get(q.symbol);
      if (!was || was.price === q.price) continue;
      const row = rows.querySelector(`tr[data-sym="${q.symbol}"]`);
      row?.classList.add(q.price > was.price ? 'tick-up' : 'tick-down');
      setTimeout(() => row?.classList.remove('tick-up', 'tick-down'), 700);
    }
  };

  let quoting = false;
  async function refreshQuotes() {
    if (quoting || !list.length) return;
    quoting = true;
    try {
      const a = await getJson<QuotesAnswer>(`/api/market/quotes?s=${encodeURIComponent(list.join(','))}`);
      const before = new Map(last);
      for (const q of a.quotes) last.set(q.symbol, q);
      missing = new Map(a.missing.map((m) => [m.symbol, m.why]));
      for (const m of a.missing) last.delete(m.symbol);
      stocks = a.stocks;
      updated = Date.now();
      renderKeyNote();
      renderRows();
      renderDetail();
      flash(before);
    } catch (err) {
      status.textContent = `Offline: ${err instanceof Error ? err.message : 'no answer'}`;
      return;
    } finally {
      quoting = false;
    }
    renderStatus();
  }

  async function refreshNews() {
    try {
      const a = await getJson<NewsAnswer>('/api/market/news');
      headlines = a.items;
      stocks = a.stocks;
      newsError = '';
    } catch (err) {
      newsError = `News is unavailable: ${err instanceof Error ? err.message : 'no answer'}`;
    }
    renderKeyNote();
    renderNews();
  }

  function removeSymbol(s: string) {
    list = list.filter((x) => x !== s);
    last.delete(s);
    if (picked === s) picked = list[0] ?? '';
    saveList(list);
    renderRows();
    renderDetail();
  }

  cmd.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const s = cleanSymbol(cmd.value);
    if (!s) {
      cmd.classList.add('bad');
      setTimeout(() => cmd.classList.remove('bad'), 500);
      return;
    }
    cmd.value = '';
    if (!list.includes(s)) {
      if (list.length >= MAX_SYMBOLS) list.pop();
      list.unshift(s);
      saveList(list);
    }
    picked = s;
    renderRows();
    renderDetail();
    void refreshQuotes();
  });

  const quoteTimer = setInterval(() => void refreshQuotes(), QUOTES_EVERY);
  const newsTimer = setInterval(() => void refreshNews(), NEWS_EVERY);
  openModal(el, {
    doing: 'checking the markets',
    onClose: () => {
      open = false;
      clearInterval(quoteTimer);
      clearInterval(newsTimer);
    },
  });
  renderRows();
  renderDetail();
  renderNews();
  renderStatus();
  void refreshQuotes();
  void refreshNews();
  cmd.focus();
}
