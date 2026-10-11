import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestHandler } from '../src/server/http/router.js';
import { xrSessionRoute, xrBridgeRoute } from '../src/server/http/routes/xr-sessions.js';
import type { Ctx } from '../src/server/office/context.js';
test('real routes enforce owner/origin/token and preserve checklist through commands and screenshot evidence', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xr-http-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, '.agent-office')); const file = path.join(dir, '.agent-office', 'playtests.json'); writeFileSync(file, '{"items":[]}');
  const ctx = { cfg: { port: 0, trustProxy: false }, services: { lookup: () => undefined },
    auth: { fromRequest: (r: http.IncomingMessage) => r.headers.cookie ? { account: { id: r.headers.cookie } } : undefined }, floors: new Map([['lab', { dir }]]) } as unknown as Ctx;
  const server = http.createServer(requestHandler(ctx, [xrSessionRoute, xrBridgeRoute]));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`, url = base + '/api/playtests/xr-session?floor=lab';
  const headers = { cookie: 'human', origin: base, 'content-type': 'application/json' };
  const post = (body: unknown, extra = {}) => fetch(url, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await post({ action: 'start' }, { origin: 'https://evil.invalid' })).status, 403);
  const pair = await (await post({ action: 'start' })).json();
  const checklist = readFileSync(file, 'utf8');
  assert.equal(JSON.parse(checklist).items.length, 2, 'manual acceptance is added once to checklist, not a queue');
  const bridgeUrl = base + `/api/playtests/xr-bridge?floor=lab&run=${pair.id}`;
  let seq = 0;
  const feed = (results: unknown[] = [], token = pair.token, samples = true) => fetch(bridgeUrl, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ bridgeId: 'http-test-12345678', devices: [{ serial: 'one', name: 'Quest', status: 'device' }], results,
      snapshots: samples ? { one: { protocol: 1, appSession: 'app', sequence: ++seq, role: 'solo', context: { mode: 'RIFT', style: 'solo', phase: 'playing', build: 'b1', focused: true, connected: true, sampledAt: Date.now() }, signals: {}, events: [] } } : {} }) });
  assert.equal((await feed([], '0'.repeat(64), false)).status, 401);
  assert.equal((await feed([], pair.token, false)).status, 200);
  assert.equal((await post({ action: 'select', id: pair.id, value: ['one'] })).status, 200);
  assert.equal((await feed()).status, 200);
  assert.equal((await post({ action: 'command', id: pair.id, value: { device: 'one', kind: 'reserve-ammo' } })).status, 400);
  assert.equal((await post({ action: 'command', id: pair.id, value: { device: 'unselected', kind: 'screenshot' } })).status, 400);
  assert.equal((await post({ action: 'command', id: pair.id, value: { device: 'one', kind: 'screenshot' } })).status, 200);
  const command = (await (await feed()).json()).commands[0];
  assert.equal(command.build, 'b1'); assert.equal(command.appSession, 'app'); assert.ok(command.expiresInMs > 0);
  const png = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');
  assert.equal((await feed([{ id: command.id, png: png.toString('base64') }])).status, 200);
  const artifact = url + `&run=${pair.id}&artifact=${command.id}`;
  assert.equal((await fetch(artifact, { headers: { cookie: 'other' } })).status, 404);
  const download = await fetch(artifact, { headers }); assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), png);
  assert.equal((await post({ action: 'stop', id: pair.id }, { cookie: 'other' })).status, 404);
  assert.equal(readFileSync(file, 'utf8'), checklist);
});
