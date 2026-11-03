import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { capacityState, representedRoomCapacities, type RoomCapacityEstimate } from '../src/client/executive/capacity.js';

const withCounts = (base: RoomCapacityEstimate, managers: number, workers: number): RoomCapacityEstimate => ({
  ...base,
  currentManagerCount: managers,
  currentWorkerCount: workers,
});

test('every represented room has a clearly estimated capacity record', () => {
  assert.deepEqual(representedRoomCapacities.map(room => room.roomId).sort(), [
    'build-workshop', 'design-studio', 'financial-markets', 'intake-routing', 'research',
  ]);
  assert.ok(representedRoomCapacities.every(room => room.estimated && room.width === 5.6 && room.depth === 4.4));
  assert.ok(representedRoomCapacities.every(room => capacityState(room) === 'comfortable'));
  assert.equal(representedRoomCapacities.reduce((total, room) => total + room.comfortableWorkerCapacity, 0), 6);
});

test('capacity states distinguish comfortable, crowded and insufficient occupancy', () => {
  const finance = representedRoomCapacities.find(room => room.roomId === 'financial-markets')!;
  assert.equal(capacityState(withCounts(finance, 1, 2)), 'comfortable');
  assert.equal(capacityState(withCounts(finance, 1, 3)), 'crowded');
  assert.equal(capacityState(withCounts(finance, 1, 4)), 'insufficient');
  assert.equal(capacityState(withCounts(finance, 2, 0)), 'insufficient');
});
