import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { playtestTriageRoute } from '../src/server/http/routes/playtest-triage.js';
import { requestHandler } from '../src/server/http/router.js';
import type { Ctx } from '../src/server/office/context.js';

test('issue transfer requires session, same origin, GitHub identity and idle queue work', async t => {
  let identity: string | undefined;
  const floor = { dir: 'unused', queue: { state: () => ({ tasks: [{ issue: 68, status: 'running' }] }) } };
  const ctx = {
    cfg: { port: 0, trustProxy: false }, services: { lookup: () => undefined },
    auth: { fromRequest: (r: http.IncomingMessage) => r.headers.cookie === 'session=yes' ? { account: { id: 'human', name: 'Kajo' } } : undefined },
    signins: { ghAs: (id: string) => { assert.equal(id, 'human'); return identity; } },
    floors: new Map([['one', floor]]),
  } as unknown as Ctx;
  const server = http.createServer(requestHandler(ctx, [playtestTriageRoute]));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const url = `${base}/api/playtests/triage?floor=one`;
  const headers = { cookie: 'session=yes', origin: base, 'content-type': 'application/json' };
  const body = JSON.stringify({ action: 'apply', number: 68, fingerprint: 'a'.repeat(64) });
  assert.equal((await fetch(url, { method: 'POST', body })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, origin: 'https://evil.invalid' }, body })).status, 403);
  assert.equal((await fetch(url, { headers })).status, 405);
  assert.equal((await fetch(url, { method: 'POST', headers, body: '{bad' })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 409);
  identity = 'Sign in to GitHub first';
  assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 403);
  // No GitHub subprocess or checklist storage is reachable in these rejected requests.
});
