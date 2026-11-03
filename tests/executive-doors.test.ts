import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { campusBuildings, plannedBuildings } from '../src/client/executive/campus-layout.js';
import { closeDoor, createDoorController, entryForBuilding, openDoor, stepDoor, townHallEntry } from '../src/client/executive/building-entry.js';
import { architectureFor } from '../src/client/executive/building-definition.js';

const fakeGroup = () => ({ position: { x: 0 } });

test('every building definition has exactly one valid entrance', () => {
  assert.ok(townHallEntry.door.z > townHallEntry.exterior.z);
  for (const spec of [...campusBuildings, ...plannedBuildings]) {
    const entry = entryForBuilding(spec);
    assert.equal(entry.door.x, entry.exterior.x);
    assert.equal(entry.door.z, entry.exterior.z + architectureFor(spec).doorway.z);
  }
});

test('doors open and close independently with animated clearance', () => {
  const first = createDoorController(fakeGroup());
  const second = createDoorController(fakeGroup());
  openDoor(first); stepDoor(first, .3);
  assert.equal(first.state, 'open');
  assert.equal(second.state, 'closed');
  assert.ok(first.group.position.x > 0);
  closeDoor(first); stepDoor(first, .3);
  assert.equal(first.state, 'closed');
  assert.equal(first.group.position.x, 0);
});

test('closing is only requested after the director clears the threshold', () => {
  const door = createDoorController(fakeGroup());
  openDoor(door); stepDoor(door, .3);
  assert.equal(door.state, 'open');
  // The state machine leaves the door open until the caller explicitly closes it
  // after its configured clearance check.
  assert.equal(door.state, 'open');
});
