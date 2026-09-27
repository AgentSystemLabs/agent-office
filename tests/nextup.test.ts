import test from 'node:test';
import assert from 'node:assert/strict';
import { NextUp, waitingInOrder, waitingLabel } from '../src/client/nextup.js';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

function worker(id: string, status: WorkerStatus, waitingSince?: number, acked = false): WorkerInfo {
  return { id, kind: 'agent', deskId: `desk-${id}`, name: id, color: '#fff', status, acked, waitingSince, createdBy: 'test', createdAt: 0, cols: 80, rows: 24, viewers: [] };
}

test('three workers waiting: N three times visits each of them, oldest first, then starts over', () => {
  const workers = new Map(
    [worker('b', 'needs_input', 200), worker('busy', 'working'), worker('a', 'done', 100), worker('c', 'needs_input', 300), worker('seen', 'done', 50, true)].map((w) => [w.id, w]),
  );
  assert.deepEqual(waitingInOrder(workers.values()).map((w) => w.id), ['a', 'b', 'c']);
  const n = new NextUp();
  assert.deepEqual([1, 2, 3, 4].map(() => n.next(workers.values())?.id), ['a', 'b', 'c', 'a']);
});

test('a worker someone got to drops out, and one that starts waiting again is new to the round', () => {
  const workers = new Map([worker('a', 'needs_input', 100), worker('b', 'needs_input', 200), worker('c', 'done', 300)].map((w) => [w.id, w]));
  const n = new NextUp();
  assert.equal(n.next(workers.values())?.id, 'a');
  // Someone answered b: it's back at work, so the next press skips to c.
  workers.set('b', worker('b', 'working'));
  assert.equal(n.next(workers.values())?.id, 'c');
  // a asks something else: it has waited least now, but this round hasn't been to that wait yet.
  workers.set('a', worker('a', 'needs_input', 400));
  assert.equal(n.next(workers.values())?.id, 'a');
  assert.equal(n.next(workers.values())?.id, 'c');
});

test("N skips the worker you're standing at, unless it's the only one waiting", () => {
  const workers = [worker('a', 'needs_input', 100), worker('b', 'done', 200)];
  assert.equal(new NextUp().next(workers, 'a')?.id, 'b');
  assert.equal(new NextUp().next([workers[0]], 'a')?.id, 'a');
  assert.equal(new NextUp().next([worker('x', 'working')]), undefined);
});

test('an office from before waitingSince goes by who was hired first', () => {
  const old = { ...worker('old', 'done'), createdAt: 10 };
  const young = { ...worker('young', 'done'), createdAt: 20 };
  assert.deepEqual(waitingInOrder([young, old]).map((w) => w.id), ['old', 'young']);
});

test('the Workers panel counts who needs input and who is done', () => {
  assert.equal(waitingLabel(waitingInOrder([worker('a', 'needs_input', 1), worker('b', 'needs_input', 2), worker('c', 'done', 3)])), '🙋 2 waiting · ✅ 1 done');
  assert.equal(waitingLabel([worker('c', 'done', 3)]), '✅ 1 done');
  assert.equal(waitingLabel([]), '');
});
