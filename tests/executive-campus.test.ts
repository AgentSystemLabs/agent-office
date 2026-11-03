import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { campusBuildings, civicCore, districtPlots, expansionZones, primaryRoads, transitRoute } from '../src/client/executive/campus-layout.js';

test('master campus reserves six distinct district zones', () => {
  assert.equal(districtPlots.length, 6);
  assert.equal(new Set(districtPlots.map(plot => plot.id)).size, 6);
  assert.deepEqual(districtPlots.map(plot => plot.id).sort(), [
    'administration', 'build-design', 'finance', 'personal-planning', 'security-audit', 'venture-lab',
  ]);
});

test('civic core keeps Town Hall dominant, with plaza and Brain directly adjacent', () => {
  assert.ok(civicCore.townHall.z < civicCore.plaza.z);
  assert.ok(civicCore.plaza.z < civicCore.brain.z);
  assert.ok(civicCore.plaza.width >= 18);
  assert.equal(primaryRoads.some(route => route.id === 'town-hall-boulevard'), true);
});

test('active buildings have unique placements inside their assigned district plots', () => {
  assert.equal(new Set(campusBuildings.map(building => building.id)).size, campusBuildings.length);
  for (const building of campusBuildings) {
    const plot = districtPlots.find(item => item.id === building.districtId)!;
    assert.ok(plot.activeRoomIds.includes(building.id));
    assert.ok(Math.abs(building.x - plot.x) <= plot.width / 2);
    assert.ok(Math.abs(building.z - plot.z) <= plot.depth / 2);
  }
});

test('expansion and transit reservations remain explicit', () => {
  assert.ok(expansionZones.some(zone => zone.status === 'active'));
  assert.ok(expansionZones.some(zone => zone.status === 'future'));
  assert.ok(expansionZones.some(zone => zone.status === 'connection'));
  assert.ok(expansionZones.some(zone => zone.status === 'transit'));
  assert.ok(transitRoute.points.length >= 4);
});
