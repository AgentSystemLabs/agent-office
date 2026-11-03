import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDoorController, doorIsPassable, openDoor, townHallEntry } from '../src/client/executive/building-entry.js';
import { architectureFor } from '../src/client/executive/building-definition.js';

test('Town Hall uses its active building name and matched thresholds', () => {
  assert.equal(townHallEntry.name, 'Town Hall');
  assert.deepEqual(townHallEntry.interiorThreshold, architectureFor({ kind: 'town' }).interiorThreshold);
  assert.equal(townHallEntry.roomName, 'Headquarters');
});

test('doorway collision is present when closed and removed while opening/open', () => {
  const door = createDoorController({ position: { x: 0 } }, townHallEntry.doorwayWidth);
  assert.equal(doorIsPassable(door), false);
  openDoor(door);
  assert.equal(doorIsPassable(door), true);
});

test('exit transition is threshold-driven rather than a teleport assignment', () => {
  const source = readFileSync(new URL('../src/client/executive/preview.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('activeEntry.interiorThreshold'));
  assert.ok(!source.includes('director.root.position.set(activeEntry.door.x'));
});
