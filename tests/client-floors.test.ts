import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR, WING, WING_DESKS, wingMinZ } from '../src/shared/layout.js';
import type { FloorInfo } from '../src/shared/protocol.js';
import { builtFloors, floorWings, pastTheWing, seatBuilt } from '../src/client/core/floors.js';
import { store } from '../src/client/state/index.js';

const floor = (id: string, extra: Partial<FloorInfo> = {}) => ({ id, name: id, waiting: 0, people: 0, palette: 0, ...extra }) as FloorInfo;

test('the built floors leave out the ones still being cloned', () => {
  store.floors = [floor('a'), floor('b', { cloning: true }), floor('c')];
  assert.deepEqual(
    builtFloors().map((f) => f.id),
    ['a', 'c'],
  );
});

test("each floor's back office goes as far as its own, the one you're on as its plan has it", () => {
  const floors = [floor('a', { wing: 2 }), floor('b'), floor('c', { wing: 1 })];
  store.floor = 'b';
  store.floorPlan = { wing: 1, labels: {} };
  assert.deepEqual(floorWings(floors), [2, 1, 1]);
  store.floor = null;
  assert.deepEqual(floorWings(floors), [2, 0, 1]);
});

test("a back office desk is there to sit at once the floor's built out that far; any other seat always is", () => {
  const first = WING_DESKS.find((d) => d.wing === 1)!;
  const second = WING_DESKS.find((d) => d.wing === 2)!;
  store.floorPlan = { wing: 0, labels: {} };
  assert.equal(seatBuilt(first.id), false);
  assert.equal(seatBuilt('no-such-desk'), true);
  store.floorPlan = { wing: 1, labels: {} };
  assert.equal(seatBuilt(first.id), true);
  assert.equal(seatBuilt(second.id), false);
  store.floorPlan = { wing: WING.rows, labels: {} };
  assert.equal(seatBuilt(second.id), true);
});

test("past the wing: standing where the back office would be, further back than this floor's goes", () => {
  const x = (WING.minX + WING.maxX) / 2;
  const deep = wingMinZ(WING.rows) + 0.5;
  assert.equal(pastTheWing({ x, y: 0, z: deep }, 0), true);
  assert.equal(pastTheWing({ x, y: 0, z: deep }, WING.rows), false);
  // In the room itself, down in the garage or up on the roof, it's not the back office.
  assert.equal(pastTheWing({ x, y: 0, z: FLOOR.minZ + 1 }, 0), false);
  assert.equal(pastTheWing({ x, y: -3, z: deep }, 0), false);
  assert.equal(pastTheWing({ x, y: 5, z: deep }, 0), false);
  assert.equal(pastTheWing({ x: WING.minX - 1, y: 0, z: deep }, 0), false);
});
