import test from 'node:test';
import assert from 'node:assert/strict';
import { WindowsProcessCache } from '../src/server/services/windows-process-cache.js';

const snapshot = () => new Map([[10, { ppid: 1, args: 'node preview' }]]);

test('four-second polling across floors shares one WMI read per minute', async () => {
  let now = 0, calls = 0;
  const cache = new WindowsProcessCache(async () => { calls++; return snapshot(); }, () => now);
  for (now = 0; now < 60_000; now += 4000) {
    const results = await Promise.all([cache.get([10]), cache.get([10]), cache.get([10])]);
    assert.equal(results[0], results[1]);
  }
  assert.equal(calls, 1);
  await cache.get([10]);
  assert.equal(calls, 2);
});

test('new listeners refresh ancestry after bounded cooldown without a WMI storm', async () => {
  let now = 0, calls = 0;
  const cache = new WindowsProcessCache(async () => {
    calls++;
    const result = snapshot();
    if (calls > 1) result.set(20, { ppid: 10, args: 'node new-server' });
    return result;
  }, () => now);
  await cache.get([10]);
  for (now = 1000; now < 10_000; now += 1000) assert.equal((await cache.get([20])).has(20), false);
  assert.equal(calls, 1);
  assert.equal((await cache.get([20])).get(20)?.ppid, 10);
  assert.equal(calls, 2);
});

test('failed WMI queries back off and recover instead of retrying every floor tick', async () => {
  let now = 0, calls = 0;
  const cache = new WindowsProcessCache(async () => {
    if (++calls === 1) throw new Error('WMI unavailable');
    return snapshot();
  }, () => now);
  await assert.rejects(cache.get([10]), /WMI unavailable/);
  now = 4000;
  await assert.rejects(cache.get([10]), /WMI unavailable/);
  assert.equal(calls, 1);
  now = 10_000;
  assert.equal((await cache.get([10])).has(10), true);
  assert.equal(calls, 2);
});

test('a refresh replaces old ancestry rather than retaining removed or reused PIDs', async () => {
  let now = 0;
  const cache = new WindowsProcessCache(async () => now ? new Map([[10, { ppid: 99, args: 'new owner' }]]) : snapshot(), () => now);
  assert.equal((await cache.get([10])).get(10)?.ppid, 1);
  now = 60_000;
  assert.equal((await cache.get([10])).get(10)?.ppid, 99);
});
