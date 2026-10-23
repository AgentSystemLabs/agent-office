import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { PlanLimitsReader } from '../src/server/limits.js';

test('optional usage meter tolerates synchronous spawn rejection without unhandled promise or shell fallback', async () => {
  let reads = 0;
  let changes = 0;
  const meter = new PlanLimitsReader('invalid\0executable', {}, () => { reads++; return true; }, () => { changes++; });
  try {
    await setTimeout(80);
    assert.equal(reads, 1);
    assert.equal(changes, 0);
    assert.deepEqual(meter.state, { windows: [], at: 0 });
    assert.equal((meter as any).running, false);
  } finally { meter.close(); }
});
