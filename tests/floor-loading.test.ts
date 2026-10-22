import test from 'node:test';
import assert from 'node:assert/strict';
import { RideGate, EMERGENCY_MS, type Clock } from '../src/client/features/floor-loading/gate';
import { FrameBudget } from '../src/client/features/floor-loading/quality';

function fixture() {
  const jobs = new Map<unknown, () => void>();
  const clock: Clock = { set(fn, ms) { assert.equal(ms, EMERGENCY_MS); const id = {}; jobs.set(id, fn); return id; }, clear: id => { jobs.delete(id); } };
  let ready = 0, emergency = 0;
  const gate = new RideGate(() => ready++, () => emergency++, clock);
  return { gate, jobs, counts: () => ({ ready, emergency }) };
}

test('doors wait for preparation, and a finished ride clears its emergency timer', async () => {
  const f = fixture(); let finish!: () => void;
  f.gate.wait(new Promise<void>(resolve => { finish = resolve; }));
  assert.deepEqual(f.counts(), { ready: 0, emergency: 0 });
  finish(); await Promise.resolve();
  assert.deepEqual(f.counts(), { ready: 1, emergency: 0 });
  assert.equal(f.jobs.size, 0);
});

test('a stalled ride offers emergency after fifteen seconds without silently releasing controls', () => {
  assert.equal(EMERGENCY_MS, 15_000);
  const f = fixture(); [...f.jobs.values()][0]();
  assert.deepEqual(f.counts(), { ready: 0, emergency: 1 });
});

test('closing a ride aborts its work and ignores late shader completion', async () => {
  const f = fixture(); let finish!: () => void;
  f.gate.wait(new Promise<void>(resolve => { finish = resolve; }));
  f.gate.close(); f.gate.close(); finish(); await Promise.resolve();
  assert.equal(f.gate.abort.signal.aborted, true);
  assert.equal(f.jobs.size, 0);
  assert.deepEqual(f.counts(), { ready: 0, emergency: 0 });
});

test('preparation failures offer escape and do not mark the destination ready', async () => {
  const f = fixture(); f.gate.wait(Promise.reject(Error('GPU unavailable'))); await Promise.resolve();
  assert.deepEqual(f.counts(), { ready: 0, emergency: 1 }); f.gate.close();
});

test('frame budget ignores loading stalls and measures sustained rendering costs', () => {
  const budget = new FrameBudget();
  for (let i = 0; i < 59; i++) assert.equal(budget.sample(40), null);
  assert.equal(budget.sample(40), 40);
  for (let i = 0; i < 59; i++) budget.sample(40);
  assert.equal(budget.sample(2000), null);
  assert.equal(budget.sample(40), null);
});
