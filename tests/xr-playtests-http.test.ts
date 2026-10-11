import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { xrPlaytestRoute } from '../src/server/http/routes/xr-playtests.js';
import { requestHandler } from '../src/server/http/router.js';
import type { Ctx } from '../src/server/office/context.js';
test('preview authenticates, preserves checklist bytes and never presents itself as device verification', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'xr-preview-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, '.agent-office'));
  const file = path.join(dir, '.agent-office/playtests.json');
  const stored = JSON.stringify({ items: [{ id: 'explicit', revision: 2, modes: ['RB'], playStyles: [] }, { id: 'legacy', revision: 1, title: 'RIFT' }] });
  writeFileSync(file, stored);
  const ctx = { cfg: { port: 0, trustProxy: false }, services: { lookup: () => undefined },
    auth: { fromRequest: (r: http.IncomingMessage) => r.headers.cookie === 'session=yes' ? { account: { id: 'human' } } : undefined },
    floors: new Map([['one', { dir }]]) } as unknown as Ctx;
  const server = http.createServer(requestHandler(ctx, [xrPlaytestRoute]));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const url = `${base}/api/playtests/session-preview?floor=one`;
  const headers = { cookie: 'session=yes', origin: base, 'content-type': 'application/json' };
  const body = JSON.stringify({ context: { mode: 'RB', style: 'solo', phase: 'playing', build: 'test', focused: true, connected: true, sampledAt: Date.now() } });
  assert.equal((await fetch(url, { method: 'POST', body })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', body, headers: { ...headers, origin: 'https://other.invalid' } })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', body: '{}', headers })).status, 400);
  const response = await fetch(url, { method: 'POST', body, headers });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.preview, true); assert.equal(result.deviceVerified, false);
  assert.deepEqual(result.active, [{ id: 'explicit', revision: 2 }]);
  assert.deepEqual(result.excluded, [{ id: 'legacy', reason: 'classification-required' }]);
  assert.equal(readFileSync(file, 'utf8'), stored);
});
