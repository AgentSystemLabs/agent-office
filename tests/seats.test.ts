import test from 'node:test';
import assert from 'node:assert/strict';
import { DESK_BY_ID, vacantSeats } from '../src/shared/layout.js';

// Two floors that each have a Queue agent hired at the queue kiosk and a worker at desk 3.
const agentOffice = [
  { id: 'w-queue-a', deskId: 'station-queue' },
  { id: 'w-desk-a', deskId: 'desk-3' },
  { id: 'w-bag-a', deskId: 'beanbag-1' },
];
const survive = [
  { id: 'w-queue-b', deskId: 'station-queue' },
  { id: 'w-desk-b', deskId: 'desk-3' },
];

test('an empty floor shows every seat and kiosk free, board agents included', () => {
  assert.deepEqual(vacantSeats([]), new Set(DESK_BY_ID.keys()));
});

test('riding the elevator between floors that share a kiosk and a desk leaves neither showing free', () => {
  for (const [from, to] of [
    [agentOffice, survive],
    [survive, agentOffice],
  ]) {
    const before = vacantSeats(from);
    const after = vacantSeats(to);
    // Same kiosk, same desk, different workers: still taken, so no idle Queue agent and no '+'.
    assert.ok(!after.has('station-queue'), 'no idle Queue agent beside the hired one');
    assert.ok(!after.has('desk-3'), "no '+' over the worker at desk 3");
    for (const w of to) assert.ok(!after.has(w.deskId), `${w.deskId} is taken`);
    // A seat only the old floor used is free again; the rest are free on both.
    for (const id of DESK_BY_ID.keys()) if (!from.some((w) => w.deskId === id) && !to.some((w) => w.deskId === id)) assert.ok(before.has(id) && after.has(id), `${id} is free`);
  }
  assert.ok(vacantSeats(survive).has('beanbag-1'), 'the bean bag only agent-office uses is free on the other floor');
});

test('a kiosk shows its idle agent again only once the hired one sent home has got up', () => {
  const packing = new Set(['station-queue']);
  // Sent home: gone from the store, but still packing up at the kiosk.
  assert.ok(!vacantSeats([], (id) => packing.has(id)).has('station-queue'));
  // Up and walking off: the idle agent is back.
  packing.clear();
  assert.ok(vacantSeats([], (id) => packing.has(id)).has('station-queue'));
  // Someone new hired there while the last one was still packing: taken either way.
  packing.add('station-queue');
  assert.ok(!vacantSeats([{ deskId: 'station-queue' }], (id) => packing.has(id)).has('station-queue'));
});
