import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { TaskNamer } from '../src/server/tasks.js';

test('task naming handles synchronous spawn failure and releases the scheduler slot', async () => {
  let named = 0;
  const namer = new TaskNamer('invalid\0executable', {}, () => 'test', () => { named++; });
  namer.request('worker', { prompts: ['local test'], tools: [], epoch: 0 });
  await setTimeout(950);
  assert.equal(named, 0);
  assert.equal((namer as any).running.size, 0);
  assert.equal((namer as any).fails, 1);
  namer.forget('worker');
});
