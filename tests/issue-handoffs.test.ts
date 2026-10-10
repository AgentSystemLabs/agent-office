import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import { IssueHandoffs } from '../src/server/issue-handoffs.js';
import { officeQueue } from '../src/server/hooks/office-queue.js';
import { workerHandlers } from '../src/server/ws/handlers/workers.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';
import { formatDirectHandoffs } from '../bin/issue-handoffs.js';

const worker = (status: WorkerInfo['status'] = 'working') => ({ id: 'w1', name: 'Pixel', kind: 'agent', status } as WorkerInfo);

test('direct handoffs survive restart, protect waiting-for-input work and finish without queuing', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'office-handoff-'));
  try {
    const file = path.join(dir, 'handoffs.json');
    const store = new IssueHandoffs(file);
    store.take(70, worker(), 'Kajo');
    const restored = new IssueHandoffs(file);
    assert.equal(restored.list([worker('needs_input')])[0].status, 'active');
    assert.equal(restored.list([worker('offline')])[0].status, 'active', 'restore has not yet resumed the worker: preserve the direct assignment');
    assert.equal(restored.list([worker()])[0].status, 'active');
    restored.changed(worker('done'));
    // A new unrelated prompt must not revive the old issue assignment.
    assert.equal(new IssueHandoffs(file).list([worker()])[0].status, 'done');
    restored.take(90, worker(), 'Kajo');
    restored.take(180, worker(), 'Kajo');
    assert.deepEqual(restored.list([worker()]).map((r) => r.status), ['done', 'superseded', 'active']);
    restored.take(185, worker('done'), 'Kajo');
    assert.equal(restored.list([worker('done')]).at(-1)?.status, 'pending', 'prompt submission precedes provider working event');
    restored.changed(worker());
    assert.equal(restored.list([worker()]).at(-1)?.status, 'active');
    restored.changed('w1');
    assert.equal(restored.list([]).at(-1)?.status, 'stopped');
    assert.match(formatDirectHandoffs(restored.list([])), /Direct issue handoffs \(not queued\)/);
    assert.match(formatDirectHandoffs(restored.list([])), /issue #185.*stopped.*Pixel \(w1\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Issues agent queue writes are denied before any mutation, while reads include direct handoffs', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'office-queue-permission-'));
  mkdirSync(path.join(dir, '.agent-office'));
  try {
    const floor = {
      dir, workers: { authenticate: () => ({ ...worker(), deskId: 'station-issues' }), list: () => [worker()] },
      queue: { state: () => ({ maxWorkers: 0, tasks: [] }), add: () => assert.fail('unauthorized queue add'), remove: () => assert.fail('unauthorized queue remove') },
    };
    const ctx = { workerFloor: () => floor } as unknown as Ctx;
    for (const method of ['POST', 'DELETE', 'GET']) {
      let status = 0; let body = '';
      const req = { method, headers: { authorization: 'Bearer test' } } as http.IncomingMessage;
      const res = { writeHead: (n: number) => { status = n; }, end: (s: string) => { body = s; } } as unknown as http.ServerResponse;
      await officeQueue(ctx, req, res, new URL('http://localhost/office/queue?worker=w1'));
      assert.equal(status, method === 'GET' ? 200 : 403);
      if (method === 'GET') assert.deepEqual(JSON.parse(body).directHandoffs, []);
      else assert.match(JSON.parse(body).error, /Only the human chooses/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('successful card handoff passes the chosen worker ID; a refused prompt does not claim the issue', () => {
  let error: string | undefined;
  const claimed: unknown[][] = [];
  const floor = { workers: { get: () => worker(), prompt: () => error } };
  const ctx = { workerFloor: () => floor, warn: () => {}, toastFloor: () => {}, takeIssue: (...args: unknown[]) => claimed.push(args) } as unknown as Ctx;
  const client = { peer: { name: 'Kajo' } } as Client;
  workerHandlers['worker.prompt'](ctx, client, { t: 'worker.prompt', workerId: 'w1', issue: 70, prompt: 'Fix it' });
  assert.equal(claimed.length, 1);
  assert.deepEqual(claimed[0].slice(2), [70, 'w1']);
  error = 'Worker is busy';
  workerHandlers['worker.prompt'](ctx, client, { t: 'worker.prompt', workerId: 'w1', issue: 90, prompt: 'Fix it' });
  assert.equal(claimed.length, 1);
});
