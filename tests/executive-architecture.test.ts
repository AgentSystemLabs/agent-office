import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { architectureFor } from '../src/client/executive/building-definition.js';
import { buildExecutiveBuilding } from '../src/client/executive/building-kit.js';

test('standard architecture derives the interior from the exterior footprint', () => {
  const a = architectureFor({ kind: 'standard' });
  assert.deepEqual([a.exteriorWidth, a.exteriorDepth], [5.6, 4.4]);
  assert.equal(a.interiorWidth, a.exteriorWidth - a.wallThickness * 2);
  assert.equal(a.interiorDepth, a.exteriorDepth - a.wallThickness * 2);
  assert.equal(a.roomOrientation, 'front-facing');
});

test('Town Hall keeps its enlarged synchronized footprint', () => {
  const a = architectureFor({ kind: 'town' });
  assert.deepEqual([a.exteriorWidth, a.exteriorDepth], [10, 7]);
  assert.equal(a.interiorWidth, 9.6);
  assert.equal(a.interiorDepth, 6.6);
});

test('doorway geometry is shared and leaves a real opening in the front façade', () => {
  const a = architectureFor({ kind: 'standard' });
  const building = buildExecutiveBuilding({ id: 'research', name: 'Research', x: 0, z: 0, color: '#4f86d9', kind: 'standard' });
  assert.equal(building.door.position.z, a.doorway.z);
  assert.equal(a.exteriorThreshold.x, a.interiorThreshold.x);
  assert.ok(a.doorway.width > 1);
  assert.ok(a.doorSlideDistance > a.doorway.width * 2);
  assert.equal(building.group.getObjectByName('town-glass-transom'), undefined);
});

test('Town Hall exposes the matching glass façade sections around its doorway', () => {
  const building = buildExecutiveBuilding({ id: 'town-hall', name: 'Town Hall', x: 0, z: 0, color: '#203c53', kind: 'town' });
  assert.ok(building.group.getObjectByName('town-glass-facade-left'));
  assert.ok(building.group.getObjectByName('town-glass-facade-right'));
  assert.ok(building.group.getObjectByName('town-glass-transom'));
});
