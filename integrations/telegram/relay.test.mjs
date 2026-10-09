import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authorizedUpdate, configFrom, createRelay, parseCommand, validExport } from './relay.mjs';
import { connectorConfig, processJob } from './connector.mjs';
const config = { token: '123:test', secret: 'a'.repeat(40), relayToken: 'b'.repeat(40), userId: '123', chatId: '123' };
const update = () => ({ update_id: 1, message: { chat: { type: 'private', id: 123 }, from: { id: 123, is_bot: false }, text: '/ask viniela-design halo Pixel' } });
async function fixture(t, api = async () => ({})) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telegram-relay-'));
  const server = createRelay({ ...config, dataDir }, api);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const webhook = (data, secret = config.secret) => fetch(origin + '/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(data) });
  const call = async (route, data) => {
    const response = await fetch(origin + '/connector/' + route, { method: data ? 'POST' : 'GET', headers: { authorization: `Bearer ${config.relayToken}`, 'content-type': 'application/json' }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { code: response.status, body: await response.json() };
  };
  return { origin, webhook, call, dataDir };
}
test('only paired private human owner can enqueue', () => {
  assert.equal(authorizedUpdate(update(), config), true);
  for (const changed of [{ ...update(), update_id: -1 }, { ...update(), message: { ...update().message, from: { id: 999 } } }, { ...update(), message: { ...update().message, chat: { id: 123, type: 'group' } } }, { ...update(), message: { ...update().message, from: { id: 123, is_bot: true } } }]) assert.equal(authorizedUpdate(changed, config), false);
});
test('commands need explicit context and exports cannot read credentials', () => {
  assert.deepEqual(parseCommand('/report viniela-design'), { kind: 'report', brand: 'viniela-design' });
  assert.equal(parseCommand('/report'), null);
  assert.equal(parseCommand('/ask buat'), null);
  assert.equal(parseCommand('/design viniela-design camp v06').version, 'v06');
  assert.equal(parseCommand('/design viniela-design camp ../../'), null);
  assert.equal(validExport('.agent-office/artiq-studio/brands/viniela-design/results/camp/v06/feed-1080x1350.png'), true);
  for (const file of ['.agent-office/homes/token.json', '.agent-office/artiq-studio/brands/viniela-design/results/camp/v06/../../accounts.json', '.agent-office/artiq-studio/brands/viniela-design/reports/camp/private.json']) assert.equal(validExport(file), false);
});
test('short report command delivers the sole report or asks for a campaign', async () => {
  const cfg = { office: 'http://127.0.0.1:4600', relay: 'https://example.com', localToken: 'local', relayToken: 'relay' };
  const job = { id: 'tg-1', status: 'queued', command: { kind: 'report', brand: 'viniela-design' } };
  for (const campaigns of [[], ['camp-a'], ['camp-a', 'camp-b']]) {
    const calls = []; let delivery;
    await processJob(cfg, job, async (_origin, _token, route, data) => {
      calls.push(route);
      if (route.includes('/reports?')) return { campaigns };
      if (route.includes('/export?')) return Buffer.from('report');
      delivery = data; return { status: 'completed' };
    });
    assert.equal(delivery.files.length, campaigns.length === 1 ? 1 : 0);
    assert.equal(calls.some((p) => p.includes('/export?')), campaigns.length === 1);
    if (campaigns.length > 1) assert.match(delivery.text, /\/report viniela-design camp-b/);
    if (campaigns.length === 1) assert.match(delivery.files[0].path, /reports\/camp-a\/report.md$/);
  }
});
test('webhook authentication, owner isolation and durable duplicate suppression', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.webhook(update(), 'wrong')).status, 403);
  await f.webhook({ ...update(), message: { ...update().message, from: { id: 999 } } });
  assert.equal((await f.call('jobs')).body.jobs.length, 0);
  await f.webhook(update()); await f.webhook(update());
  assert.equal((await f.call('jobs')).body.jobs.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.dataDir, 'queue.json'))).jobs.length, 1);
  assert.equal((await fetch(f.origin + '/connector/jobs')).status, 403);
});
test('preview photo and uncompressed document delivered once', async (t) => {
  const calls = []; const f = await fixture(t, async (method) => { calls.push(method); return {}; });
  await f.webhook({ ...update(), message: { ...update().message, text: '/design viniela-design camp v06' } });
  const base = '.agent-office/artiq-studio/brands/viniela-design/results/camp/v06/';
  const data = { id: 'tg-1', text: 'Owner review; Posting OFF', files: ['preview-mobile360.png', 'feed-1080x1350.png'].map((name) => ({ path: base + name, base64: Buffer.from('test-file').toString('base64') })) };
  assert.equal((await f.call('complete', data)).body.status, 'completed'); await f.call('complete', data);
  assert.deepEqual(calls, ['sendMessage', 'sendPhoto', 'sendDocument']);
});
test('uncertain delivery is retained without blind retry', async (t) => {
  let calls = 0; const f = await fixture(t, async () => { calls++; throw new Error('timeout'); }); await f.webhook(update());
  const data = { id: 'tg-1', text: 'reply', files: [] };
  assert.equal((await f.call('complete', data)).body.status, 'uncertain'); await f.call('complete', data); assert.equal(calls, 1);
});
test('reply exports cannot cross the requested brand', async (t) => {
  const f = await fixture(t); await f.webhook(update());
  assert.equal((await f.call('complete', { id: 'tg-1', text: 'reply', files: [{ path: '.agent-office/artiq-studio/brands/rumatemu/reports/camp/report.md', base64: 'dGVzdA==' }] })).code, 400);
});
test('connector waits for a real leader response', async () => {
  const calls = []; const cfg = { office: 'http://127.0.0.1:4600', relay: 'https://example.com', localToken: 'local', relayToken: 'relay' };
  const job = { id: 'tg-1', status: 'queued', command: { kind: 'ask', brand: 'viniela-design', text: 'hello' } };
  const call = async (_origin, _token, route) => { calls.push(route); return route.endsWith('/prompt') ? { status: 'accepted' } : { reply: null }; };
  assert.equal((await processJob(cfg, job, call)).status, 'waiting_reply');
  assert.deepEqual(calls, ['/api/telegram/prompt', '/connector/wait', '/api/telegram/reply?id=tg-1']);
});
test('config fails closed and office remains loopback', () => {
  assert.throws(() => configFrom({}), /BOT_TOKEN/);
  assert.throws(() => connectorConfig({ TELEGRAM_RELAY_URL: 'https://example.com', AGENT_OFFICE_TELEGRAM_OFFICE_URL: 'http://remote.example.com', TELEGRAM_RELAY_TOKEN: 'a'.repeat(40), AGENT_OFFICE_TELEGRAM_LOCAL_TOKEN: 'b'.repeat(40) }), /loopback/);
});
test('connector reports a leader permission gate without waiting or approving', async () => {
  const calls = []; const cfg = { office: 'http://127.0.0.1:4600', relay: 'https://example.com', localToken: 'local', relayToken: 'relay' };
  const job = { id: 'tg-1', status: 'queued', command: { kind: 'ask', brand: 'artiq-studio', text: 'yes' } };
  await processJob(cfg, job, async (_origin, _token, route, data) => {
    calls.push(route);
    if (route.endsWith('/prompt')) return { status: 'needs_input' };
    assert.match(data.text, /terminal Office lokal/); assert.deepEqual(data.files, []); return { status: 'completed' };
  });
  assert.deepEqual(calls, ['/api/telegram/prompt', '/connector/complete']);
});
