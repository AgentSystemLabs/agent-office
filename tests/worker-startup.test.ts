import test from 'node:test';
import assert from 'node:assert/strict';
import { noteBootTimeout } from '../src/server/workers/startup.js';

test('resource waiting stays starting and does not claim a human permission is required', () => {
  const worker: any = { info: {}, bootBlocked: false, setStatus: (status: string) => { worker.info.status = status; } };
  noteBootTimeout(worker, 'Complete login', 'Agent Office capacity guard: Waiting for capacity; no model started. remaining 2.3 GiB');
  assert.equal(worker.info.status, 'starting');
  assert.equal(worker.bootBlocked, false);
  assert.match(worker.info.activity, /Waiting for available RAM/);
  noteBootTimeout(worker, 'Complete login', 'Login required');
  assert.equal(worker.info.status, 'needs_input');
  assert.equal(worker.bootBlocked, true);
});
