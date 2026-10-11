import test from 'node:test';
import assert from 'node:assert/strict';
import { PING_PONG_TABLES } from '../src/client/features/pingpong/world.js';

test('the reclaimed lounge court has three evenly spaced pink ping-pong tables', () => {
  assert.equal(PING_PONG_TABLES.length, 3);
  assert.deepEqual(PING_PONG_TABLES.map((table) => table.z), [-6, 0, 6]);
  assert.ok(PING_PONG_TABLES.every((table) => table.x === 10.8));
});
