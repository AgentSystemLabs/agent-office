import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { QueueRecovery, RECOVERY_DELAY, type RecoveryPorts } from '../src/server/queue-recovery.js';
import type { QueueTask, WorkerInfo } from '../src/shared/protocol.js';
import { testingHook } from '../src/server/workers/testing.js';
import type { WorkerHandle } from '../src/server/workers/types.js';

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-recovery-'));
  const worker = { id: 'w', sessionId: 's', kind: 'agent', status: 'done', viewers: [] } as unknown as WorkerInfo;
  const task = { id: 't', workerId: 'w', status: 'waiting', prompt: 'Already authorized' } as QueueTask;
  let now = 1000, free = true, paused = false, sent = 0, probes = 0;
  const port: RecoveryPorts = {
    workers: () => [worker], tasks: () => [task], paused: () => paused,
    hold(_id, reason) { if (worker.status === 'needs_input') return false; worker.status = reason ? 'waiting' : 'done'; worker.activity = reason; return true; },
    continue() { sent++; task.status = 'running'; }, prompt() { sent++; }, changed() {},
  };
  const open = () => new QueueRecovery(dir, port, async () => { probes++; return { free, reason: 'build lock occupied' }; }, () => now);
  const q = open(); t.after(() => { q.shutdown(); rmSync(dir, { recursive: true, force: true }); });
  return { q, dir, port, worker, task, open, now: () => now, advance: () => { now += RECOVERY_DELAY; }, free: (v: boolean) => { free = v; }, pause: () => { paused = true; }, counts: () => ({ sent, probes }) };
}
test('holds incomplete tasks for a minute, polls busy resources indefinitely, sends only once when free', async t => {
  const f = fixture(t); f.free(false); await f.q.tick(); assert.equal(f.worker.status, 'waiting');
  assert.equal(f.counts().probes, 0);
  for (let i = 0; i < 8; i++) { f.advance(); await f.q.tick(); }
  assert.equal(f.counts().sent, 0);
  f.free(true); f.advance(); await f.q.tick(); assert.equal(f.counts().sent, 1);
  for (let i = 0; i < 5; i++) { f.advance(); await f.q.tick(); }
  assert.equal(f.counts().sent, 1, 'unacknowledged prompt must not be pasted repeatedly');
});
test('permissions, stopped tasks, meetings, human viewing, paused budget and queued new work are not resumed', async t => {
  for (const kind of ['permission', 'stopped', 'meeting', 'viewer', 'budget', 'queued']) {
    const f = fixture(t);
    if (kind === 'permission') f.worker.status = 'needs_input';
    if (kind === 'stopped') f.task.outcome = 'killed';
    if (kind === 'meeting') f.worker.meeting = {} as WorkerInfo['meeting'];
    if (kind === 'viewer') f.worker.viewers = ['Kajo'];
    if (kind === 'budget') f.pause();
    if (kind === 'queued') f.task.status = 'queued';
    await f.q.tick(); f.advance(); await f.q.tick(); assert.equal(f.counts().sent, 0, kind);
  }
});
test('restart retains the retry deadline and submitted guard; delivered tasks do not continue', async t => {
  const f = fixture(t); await f.q.tick(); f.q.shutdown(); const restored = f.open();
  await restored.tick(); assert.equal(f.counts().sent, 0);
  f.advance(); await restored.tick(); assert.equal(f.counts().sent, 1); restored.shutdown();
  const again = f.open(); f.advance(); await again.tick(); assert.equal(f.counts().sent, 1); again.shutdown();
  const g = fixture(t); g.task.confirmedBy = { name: 'Kajo', at: 1 };
  await g.q.tick(); g.advance(); await g.q.tick(); assert.equal(g.counts().sent, 0);
});
test('three unchanged completed continuations stop a costly retry loop', async t => {
  const f = fixture(t); await f.q.tick();
  for (let i = 0; i < 3; i++) {
    f.advance(); await f.q.tick(); f.worker.status = 'working'; await f.q.tick();
    f.worker.status = 'done'; f.task.status = 'waiting'; await f.q.tick();
  }
  f.advance(); await f.q.tick(); assert.equal(f.counts().sent, 3);
});

test('resource checks revalidate permissions and task ownership after awaiting the probe', async t => {
  for (const change of ['permission', 'reassigned', 'cancelled']) {
    const f = fixture(t); f.q.shutdown();
    const q = new QueueRecovery(f.dir, f.port, async () => {
      if (change === 'permission') f.worker.status = 'needs_input';
      if (change === 'reassigned') f.task.workerId = 'different';
      if (change === 'cancelled') f.task.outcome = 'killed';
      return { free: true, reason: '' };
    }, f.now);
    await q.tick(); f.advance(); await q.tick(); assert.equal(f.counts().sent, 0, change); q.shutdown();
  }
});

test('explicit interruption is not retried, and busy resource reason survives intervening ticks', async t => {
  const f = fixture(t); f.free(false); await f.q.tick(); f.advance(); await f.q.tick();
  assert.match(f.worker.activity!, /build lock occupied/); await f.q.tick(); assert.match(f.worker.activity!, /build lock occupied/);
  testingHook({ info: f.worker } as WorkerHandle, 'Interrupt', { session_id: 's' });
  f.free(true); f.advance(); await f.q.tick(); assert.equal(f.counts().sent, 0);
});
