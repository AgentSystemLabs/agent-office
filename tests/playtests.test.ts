import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Playtests, PlaytestError } from '../src/server/playtests.js';
import { playtestMarkdown } from '../src/shared/playtests.js';
import { playtestRoute } from '../src/server/http/routes/playtests.js';
import { officePlaytests } from '../src/server/hooks/office-playtests.js';
import { requestHandler } from '../src/server/http/router.js';
import type { Ctx } from '../src/server/office/context.js';

const input = { title: 'Recenter during a run', category: 'VR', steps: 'Recenter, then remove and put on the headset.', expected: 'Portal remains anchored.', source: 'https://github.com/example/game/pull/12' };
const fixture = (t: test.TestContext) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-playtests-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('human checkmarks and notes survive restarts, duplicate handoffs and reopening', t => {
  const dir = fixture(t); const store = new Playtests(dir);
  const original = store.add(input, 'Worker');
  const checked = store.update({ id: original.id, revision: 1, done: true, notes: 'Build 42: looks good.' }, 'Kajo');
  assert.equal(checked.checkedBy, 'Kajo'); assert.ok(checked.checkedAt);
  const reopened = new Playtests(dir);
  assert.deepEqual(reopened.add(input, 'Another worker'), checked);
  assert.equal(reopened.state().items.length, 1);
  assert.throws(() => reopened.update({ id: original.id, revision: 1, notes: 'stale' }, 'Other'), (e: unknown) => e instanceof PlaytestError && e.status === 409);
  const undone = reopened.update({ id: original.id, revision: 2, done: false }, 'Kajo');
  assert.equal(undone.done, false); assert.equal(undone.checkedAt, undefined); assert.equal(undone.notes, checked.notes);
  assert.match(playtestMarkdown([checked]), /\[x\] Recenter/);
  assert.match(playtestMarkdown([undone]), /\[ \] Recenter/);
});

test('invalid input and damaged storage never overwrite existing checks', t => {
  const dir = fixture(t); const store = new Playtests(dir); store.add(input, 'Worker');
  const before = readFileSync(path.join(dir, 'playtests.json'), 'utf8');
  for (const bad of [{ ...input, source: 'javascript:alert(1)' }, { ...input, title: '' }, { ...input, steps: 'x'.repeat(6001) }]) assert.throws(() => store.add(bad, 'Worker'));
  assert.equal(readFileSync(path.join(dir, 'playtests.json'), 'utf8'), before);
  writeFileSync(path.join(dir, 'playtests.json'), '{broken');
  assert.throws(() => new Playtests(dir));
  assert.equal(readFileSync(path.join(dir, 'playtests.json'), 'utf8'), '{broken');
});

test('session routes and worker handoffs share a floor checklist without queue access', async t => {
  const first = { dir: fixture(t), workers: { authenticate: (id: string, token: string) => id === 'w1' && token === 'secret' ? { name: 'Worker' } : undefined } };
  const second = { dir: fixture(t) };
  const ctx = {
    cfg: { port: 0, trustProxy: false }, services: { lookup: () => undefined },
    auth: { fromRequest: (req: http.IncomingMessage) => req.headers.cookie === 'session=yes' ? { account: { name: 'Kajo' } } : undefined },
    floors: new Map([['one', first], ['two', second]]), workerFloor: (id: string) => id === 'w1' ? first : undefined,
  } as unknown as Ctx;
  const handler = requestHandler(ctx, [playtestRoute]);
  const server = http.createServer((req, res) => req.url?.startsWith('/office/playtests') ? void officePlaytests(ctx, req, res, new URL(req.url, 'http://localhost')) : void handler(req, res));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = { cookie: 'session=yes', origin: base, 'content-type': 'application/json' };
  const endpoint = `${base}/api/playtests?floor=one`;
  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, origin: 'https://evil.invalid' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${base}/office/playtests?worker=w1`)).status, 401);
  const worker = `${base}/office/playtests?worker=w1&floor=two`;
  const added = await fetch(worker, { method: 'POST', headers: { authorization: 'Bearer secret' }, body: JSON.stringify({ action: 'add', test: { ...input, done: true } }) });
  assert.equal(added.status, 200);
  const { item } = await added.json(); assert.equal(item.done, false);
  const forbidden = await fetch(worker, { method: 'POST', headers: { authorization: 'Bearer secret' }, body: JSON.stringify({ action: 'update', id: item.id, revision: 1, done: true }) });
  assert.equal(forbidden.status, 403);
  const checked = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ action: 'update', id: item.id, revision: 1, done: true }) });
  assert.equal(checked.status, 200); assert.equal((await checked.json()).items[0].checkedBy, 'Kajo');
  const other = await (await fetch(`${base}/api/playtests?floor=two`, { headers })).json(); assert.deepEqual(other.items, []);
  // No queue, GitHub, worker hiring or status mutation APIs exist in this fixture.
});
