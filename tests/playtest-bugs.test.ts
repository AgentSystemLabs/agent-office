import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Playtests } from '../src/server/playtests.js';
import { bugDescription, playtestBugPrompt, sendBugReport } from '../src/server/playtest-bugs.js';
import { playtestBugRoute } from '../src/server/http/routes/playtest-bugs.js';
import { requestHandler } from '../src/server/http/router.js';
import type { Ctx } from '../src/server/office/context.js';

const input = { title: 'Guest grip', steps: 'Join and pick up pistol', expected: 'Gun sits in hand', source: 'https://github.com/example/game/pull/12', category: 'Rift' };
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-bug-')); mkdirSync(path.join(dir, '.agent-office'));
  t.after(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
test('report requires actual failure and explicitly gives no queue or worker permission', t => {
  for (const bad of ['', '   ', null, 'x'.repeat(4001)]) assert.throws(() => bugDescription(bad));
  const item = new Playtests(path.join(fixture(t), '.agent-office')).add(input, 'Worker');
  const prompt = playtestBugPrompt(item, 'Pistol floats left', 'Build 42', 'Kajo', 'report');
  assert.match(prompt, /Do NOT enqueue, assign, start implementation/); assert.match(prompt, /human owner decides/);
  assert.match(prompt, /Pistol floats left/); assert.match(prompt, /Gun sits in hand/); assert.match(prompt, /Build 42/);
});
test('retries deliver once; rejected handoffs are retryable; ambiguous dispatch is not repeated', t => {
  const dir = fixture(t); let calls = 0;
  const dispatch = () => { calls++; return undefined; };
  assert.equal(sendBugReport(dir, 'same', dispatch).repeated, false);
  assert.equal(sendBugReport(dir, 'same', dispatch).repeated, true); assert.equal(calls, 1);
  assert.throws(() => sendBugReport(dir, 'retry', () => 'Needs input'));
  assert.equal(sendBugReport(dir, 'retry', dispatch).repeated, false);
  assert.throws(() => sendBugReport(dir, 'uncertain', () => { throw Error('disconnected'); }));
  assert.throws(() => sendBugReport(dir, 'uncertain', dispatch), /may already/); assert.equal(calls, 2);
});
test('authenticated same-origin report reaches only the floor Issue agent and preserves checklist', async t => {
  const dir = fixture(t); const reports: string[] = [];
  const floor = { dir, workers: { list: () => [], officeDefault: { provider: 'claude' }, station: (desk: string, actor: string, prompt: string, owner: string) => {
    assert.equal(desk, 'station-issues'); assert.equal(actor, 'Kajo'); assert.equal(owner, 'owner'); reports.push(prompt); return { info: {}, hired: false };
  } } };
  const ctx = { cfg: { port: 0, trustProxy: false }, services: { lookup: () => undefined },
    claudeFor: () => 'claude', signins: { claudeReady: () => true }, floors: new Map([['one', floor]]),
    auth: { fromRequest: (req: http.IncomingMessage) => req.headers.cookie === 'session=yes' ? { account: { id: 'owner', name: 'Kajo' } } : undefined },
  } as unknown as Ctx;
  const item = new Playtests(path.join(dir, '.agent-office')).add(input, 'Worker');
  const before = new Playtests(path.join(dir, '.agent-office')).state();
  const server = http.createServer(requestHandler(ctx, [playtestBugRoute]));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const url = `${base}/api/playtests/bug?floor=one`;
  const headers = { cookie: 'session=yes', origin: base, 'content-type': 'application/json' };
  const body = JSON.stringify({ id: item.id, revision: 1, reportId: '0123456789abcdef', notes: 'unsaved tester notes', description: 'Pistol floats left' });
  assert.equal((await fetch(url, { method: 'POST', body })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, origin: 'https://evil.invalid' }, body })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers, body: body.replace('Pistol floats left', ' ') })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 200);
  assert.equal((await fetch(url, { method: 'POST', headers, body })).status, 200);
  assert.equal(reports.length, 1); assert.match(reports[0], /unsaved tester notes/);
  assert.deepEqual(new Playtests(path.join(dir, '.agent-office')).state(), before);
});

import { officeWorkers } from '../src/server/hooks/office-workers.js';
import { officeQueue } from '../src/server/hooks/office-queue.js';
test('the Issue agent can read the queue but cannot add or remove tasks', async t => {
  let writes = 0;
  const floor = { workers: { authenticate: () => ({ deskId: 'station-issues', id: 'issue-agent', name: 'Issues' }) }, queue: { state: () => ({ maxWorkers: 2, tasks: [] }), add: () => { writes++; }, remove: () => { writes++; } } };
  const ctx = { workerFloor: () => floor } as unknown as Ctx;
  const server = http.createServer((req, res) => void (req.url?.startsWith('/office/workers') ? officeWorkers : officeQueue)(ctx, req, res, new URL(req.url!, 'http://localhost')));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/office/queue?worker=issue-agent';
  const headers = { authorization: 'Bearer valid' };
  assert.equal((await fetch(url, { headers })).status, 200);
  for (const method of ['POST', 'DELETE']) assert.equal((await fetch(url, { method, headers, body: method === 'POST' ? '{}' : undefined })).status, 403);
  for (const action of ['', '/tell', '/home', '/pr']) assert.equal((await fetch(url.replace('/office/queue', '/office/workers' + action), { method: 'POST', headers, body: '{}' })).status, 403);
  assert.equal(writes, 0);
});
