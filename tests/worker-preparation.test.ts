import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WorkerManager } from '../src/server/workers/manager.js';
import { WorkerPreparation } from '../src/server/workers/preparation.js';
import { restoreWorkers, saveWorkers } from '../src/server/workers/persist.js';
import { TaskQueue } from '../src/server/queue.js';

function fixture(t: any) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-preparation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let settle: (value: any) => void;
  let signal: AbortSignal | undefined;
  let launches = 0;
  let queue: TaskQueue | undefined;
  // Exercise the real spawn/resume/kill paths without starting external AI CLIs.
  const manager = Object.create(WorkerManager.prototype) as any;
  const events = { update: (w: any) => queue?.onWorker(w), toast() {}, remove() {} };
  Object.assign(manager, {
    dir, workers: new Map(), defaultProvider: 'claude', wing: () => 0,
    ledger: {}, closing: false, events, tasks: { notePrompt() {}, forget() {} },
    scrollback: { remove() {} }, drops: { remove() {} }, persist() {},
    launch(w: any) { launches++; w.info.status = 'working'; },
    trees: { fetch() {}, createAsync(_slug: string, s: AbortSignal) {
      signal = s;
      return new Promise((resolve) => { settle = resolve; s.addEventListener('abort', () => resolve('cancelled'), { once: true }); });
    } },
  });
  const ctx: any = { dir, workers: manager.workers, events, closing: false, persist() {},
    setStatus(w: any, status: string) { w.info.status = status; events.update(w.info); }, emit(w: any) { events.update(w.info); } };
  manager.preparation = new WorkerPreparation(ctx);
  queue = new TaskQueue(dir, manager, true, { ...events, update() {}, claimIssue: async () => undefined, refreshGitHub() {}, hiringPaused: () => undefined, emptied() {} });
  queue.setLimit(1);
  t.after(() => queue!.shutdown());
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  return { manager, queue, ctx, dir, tick, signal: () => signal, launches: () => launches,
    settle: (value: any) => settle!(value), ref: { path: '.agent-office/worktrees/test', branch: 'office/test', base: 'abc' } };
}

test('queue reserves one slot while preparing and launches only after checkout, then records the branch', async (t) => {
  const f = fixture(t);
  f.queue.add('first selected task', 'Tester'); f.queue.add('second selected task', 'Tester');
  await f.tick();
  const w = f.manager.list()[0];
  assert.equal(w.status, 'starting'); assert.equal(f.launches(), 0);
  assert.equal(f.queue.state().tasks[1].status, 'queued');
  assert.match(f.manager.spawn(w.deskId, 'Tester', 'duplicate', true), /taken/);
  assert.match(f.manager.resume(w.id), /preparing/);
  f.queue.pump(); assert.equal(f.manager.list().length, 1);
  f.settle(f.ref); await f.tick();
  assert.equal(f.launches(), 1); assert.equal(w.status, 'working');
  assert.equal(f.queue.state().tasks[0].branch, 'office/test');
  assert.equal(f.queue.state().tasks[1].status, 'queued');
});

test('sending home a preparing worker cancels Git and never launches the agent or deletes partial files', async (t) => {
  const f = fixture(t);
  const w = f.manager.spawn('desk-1', 'Tester', 'task', true);
  await f.tick();
  const result = await f.manager.kill(w.id, 'all');
  assert.equal(f.signal()!.aborted, true); assert.equal(f.launches(), 0);
  assert.match(result.note, /Kept partial checkout/); assert.equal(f.manager.list().length, 0);
});

test('failed checkout cannot launch or resume in the shared project, even after persistence and restore', async (t) => {
  const f = fixture(t);
  const w = f.manager.spawn('desk-1', 'Tester', 'task', true);
  await f.tick(); f.settle('Could not create: disk error'); await f.tick();
  assert.equal(w.status, 'exited'); assert.equal(f.launches(), 0);
  assert.match(f.manager.resume(w.id), /incomplete/);
  const file = path.join(f.dir, 'workers-test.json');
  saveWorkers(file, f.manager.workers.values(), false);
  f.manager.workers.clear();
  restoreWorkers(file, f.manager.workers, 'claude', () => false);
  assert.match(f.manager.resume(w.id), /incomplete/);
  assert.equal(f.launches(), 0);
});

test('shutdown cancels preparation without launching after success arrives', async (t) => {
  const f = fixture(t);
  f.manager.spawn('desk-1', 'Tester', 'task', true); await f.tick();
  f.ctx.closing = true; f.manager.preparation.shutdown(); await f.tick();
  assert.equal(f.signal()!.aborted, true); assert.equal(f.launches(), 0);
});
