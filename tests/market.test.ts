import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSymbol, isCoin, MAX_SYMBOLS, parseSymbols } from '../src/shared/market.js';
import { news, quotes } from '../src/server/market.js';

test('symbols are cleaned, and anything that could reach past the sources is refused', () => {
  assert.equal(cleanSymbol(' aapl '), 'AAPL');
  assert.equal(cleanSymbol('brk.b'), 'BRK.B');
  assert.equal(cleanSymbol('btc-usd'), 'BTC-USD');
  for (const bad of ['', '../quote', 'AAPL?token=x', 'A B', 'http://x', 'BTC-USD/../x', '%2F', 'TOOLONGSYMBOL1']) assert.equal(cleanSymbol(bad), null, bad);
  assert.ok(isCoin('ETH-USD'));
  assert.ok(!isCoin('AAPL'));
  assert.deepEqual(parseSymbols('aapl, AAPL,,nope!,btc-usd'), ['AAPL', 'BTC-USD']);
  assert.equal(parseSymbols(Array.from({ length: 50 }, (_, i) => `S${i}`).join(',')).length, MAX_SYMBOLS);
});

/** Swaps in a fetch that answers from `answer`, and records which URLs and headers were asked. */
function fakeFetch(answer: (url: string) => unknown) {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
    asked.push({ url, headers: init?.headers ?? {} });
    const body = answer(url);
    return new Response(JSON.stringify(body), { status: body === undefined ? 404 : 200 });
  }) as typeof fetch;
  return { asked, restore: () => (globalThis.fetch = real) };
}

test('without a key, coins are priced from Coinbase and stocks say what they need', async () => {
  delete process.env.AGENT_OFFICE_FINNHUB_KEY;
  const f = fakeFetch(() => ({ open: '100', high: '120', low: '90', last: '110' }));
  try {
    const a = await quotes(['NOKEY', 'DOGE-USD']);
    assert.equal(a.stocks, false);
    assert.deepEqual(a.missing, [{ symbol: 'NOKEY', why: 'Stocks need a Finnhub key' }]);
    assert.equal(a.quotes[0].price, 110);
    assert.equal(a.quotes[0].changePct, 10);
    assert.deepEqual(f.asked.map((x) => new URL(x.url).host), ['api.exchange.coinbase.com']);
    assert.deepEqual(await news(), { items: [], stocks: false });
  } finally {
    f.restore();
  }
});

test('with a key, it goes in a header to Finnhub only, and headlines keep only web links', async () => {
  process.env.AGENT_OFFICE_FINNHUB_KEY = 'test-key';
  const f = fakeFetch((url) => {
    if (url.includes('/quote?symbol=ZZZ')) return { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 };
    if (url.includes('/quote')) return { c: 210.5, d: 2.5, dp: 1.2019, h: 211, l: 207, o: 208, pc: 208, t: 1_700_000_000 };
    return [
      { id: 1, headline: 'Stocks rise', source: 'Wire', summary: 's', url: 'https://example.com/a', datetime: 1_700_000_100 },
      { id: 2, headline: 'Sneaky', source: 'Wire', summary: 's', url: 'javascript:alert(1)', datetime: 1_700_000_200 },
    ];
  });
  try {
    const a = await quotes(['MSFT', 'ZZZ']);
    assert.equal(a.quotes[0].price, 210.5);
    assert.equal(a.quotes[0].at, 1_700_000_000_000);
    assert.deepEqual(a.missing, [{ symbol: 'ZZZ', why: 'Unknown symbol' }]);
    const n = await news();
    assert.deepEqual(n.items.map((x) => x.url), ['https://example.com/a']);
    for (const x of f.asked) {
      assert.equal(new URL(x.url).host, 'finnhub.io');
      assert.ok(!x.url.includes('test-key'), 'the key is never in a URL');
      assert.equal(x.headers['x-finnhub-token'], 'test-key');
    }
  } finally {
    f.restore();
    delete process.env.AGENT_OFFICE_FINNHUB_KEY;
  }
});

test('the office asks Finnhub at most 50 times a minute, however many symbols are asked for', async () => {
  process.env.AGENT_OFFICE_FINNHUB_KEY = 'test-key';
  const f = fakeFetch(() => ({ c: 1, d: 0, dp: 0, h: 1, l: 1, o: 1, pc: 1, t: 1 }));
  try {
    const why: string[] = [];
    for (let round = 0; round < 4; round++) {
      const a = await quotes(Array.from({ length: 20 }, (_, i) => `B${round}X${i}`));
      why.push(...a.missing.map((m) => m.why));
    }
    assert.ok(f.asked.length <= 50, `asked ${f.asked.length} times`);
    assert.ok(why.length >= 30 && why.every((w) => w === 'Busy, try again in a minute'));
  } finally {
    f.restore();
    delete process.env.AGENT_OFFICE_FINNHUB_KEY;
  }
});

test('holdings come from a broker-style CSV or a typed line, and are priced with the quotes', async () => {
  const { parseHoldingsCsv, parseHoldingCommand, valueHoldings, merge } = await import('../src/client/features/market/portfolio.js');
  const csv = '﻿Account summary\r\n"Symbol","Name","Quantity","Average Cost"\r\nAAPL,"Apple, Inc.",10,"$150.00"\r\nBTC-USD,Bitcoin,0.5,"$60,000.00"\r\naapl,Apple,5,$180\r\nTOTAL,,,\r\n../x,Bad,3,1\r\n';
  const got = parseHoldingsCsv(csv);
  assert.deepEqual(got.holdings, [
    { symbol: 'AAPL', qty: 15, cost: 160 },
    { symbol: 'BTC-USD', qty: 0.5, cost: 60000 },
  ]);
  assert.equal(got.skipped, 2);
  assert.match(parseHoldingsCsv('a,b\n1,2').error ?? '', /Symbol/);
  assert.deepEqual(parseHoldingCommand('msft 3 @ $400'), { symbol: 'MSFT', qty: 3, cost: 400 });
  assert.deepEqual(parseHoldingCommand('MSFT 0'), { symbol: 'MSFT', qty: 0 });
  assert.equal(parseHoldingCommand('AAPL'), null);
  assert.deepEqual(merge([{ symbol: 'X', qty: 1 }, { symbol: 'X', qty: 2, cost: 5 }]), [{ symbol: 'X', qty: 3, cost: 5 }]);
  const q = (symbol: string, price: number, change: number) => ({ symbol, price, change, changePct: 0, high: 0, low: 0, open: 0, at: 0, source: 'finnhub' as const });
  const v = valueHoldings(got.holdings, new Map([['AAPL', q('AAPL', 200, 2)]]));
  assert.equal(v.value, 3000);
  assert.equal(v.day, 30);
  assert.equal(v.gain, 600);
  assert.equal(v.gainPct, 25);
  assert.equal(v.priced, 1);
});
