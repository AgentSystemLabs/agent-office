import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BUILTIN_MAPS, planOf } from '../src/shared/maps/index.js';
import { EXECUTIVE_FLOOR_MAP, EXECUTIVE_SHARED_RUNTIME_LABEL, executiveFloorFor } from '../src/shared/executive-floor-map.js';

test('Executive World registration exposes the standard map-world contract inputs', () => {
  const config = BUILTIN_MAPS.find((map) => map.id === 'executive');
  assert.ok(config);
  const plan = planOf('executive');
  assert.equal(plan.id, 'executive');
  assert.equal(plan.style, 'executive');
  assert.ok(plan.bounds.maxX > plan.bounds.minX);
  assert.ok(plan.desks.length > 0);
  assert.ok(plan.obstacles);
  assert.deepEqual({ x: plan.spawn.x, z: plan.spawn.z }, { x: 0, z: 0 });
});

test('Executive World exposes explicit floor mappings and planned fallbacks', () => {
  assert.ok(EXECUTIVE_FLOOR_MAP.length >= 19);
  const townHall = executiveFloorFor('town-hall');
  assert.equal(townHall?.displayName, 'Town Hall');
  assert.equal(townHall?.agentOfficeFloorId, 'agent-office-executive-world');
  assert.equal(townHall?.destinationLabel, EXECUTIVE_SHARED_RUNTIME_LABEL);
  assert.equal(EXECUTIVE_FLOOR_MAP.filter((entry) => entry.connected).length, 1);
  assert.ok(EXECUTIVE_FLOOR_MAP.every((entry) => entry.connected || entry.fallback === 'planned-not-connected'));
  assert.ok(EXECUTIVE_FLOOR_MAP.every((entry) => entry.agentOfficeFloorId === null || entry.connected));
});

test('Executive World location records never invent a floor connection', () => {
  assert.ok(EXECUTIVE_FLOOR_MAP.every((entry) => entry.connected === Boolean(entry.agentOfficeFloorId)));
  assert.ok(EXECUTIVE_FLOOR_MAP.filter((entry) => entry.buildingId !== 'town-hall').every((entry) => !entry.connected && entry.agentOfficeFloorId === null));
  assert.ok(EXECUTIVE_FLOOR_MAP.every((entry) => entry.connected || entry.fallback === 'planned-not-connected'));
});
