import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BUILTIN_MAPS, planOf } from '../src/shared/maps/index.js';
import { EXECUTIVE_FLOOR_MAP, executiveFloorFor } from '../src/shared/executive-floor-map.js';

test('Executive World registration exposes the standard map-world contract inputs', () => {
  const config = BUILTIN_MAPS.find((map) => map.id === 'executive');
  assert.ok(config);
  const plan = planOf('executive');
  assert.equal(plan.id, 'executive');
  assert.equal(plan.style, 'executive');
  assert.ok(plan.bounds.maxX > plan.bounds.minX);
  assert.ok(plan.desks.length > 0);
  assert.ok(plan.obstacles);
});

test('Executive World exposes explicit floor mappings and planned fallbacks', () => {
  assert.ok(EXECUTIVE_FLOOR_MAP.length >= 19);
  assert.equal(executiveFloorFor('town-hall')?.displayName, 'Town Hall');
  assert.ok(EXECUTIVE_FLOOR_MAP.every((entry) => entry.connected || entry.fallback === 'planned-not-connected'));
  assert.ok(EXECUTIVE_FLOOR_MAP.every((entry) => entry.agentOfficeFloorId === null || entry.connected));
});

test('Executive World location records never invent a floor connection', () => {
  assert.ok(EXECUTIVE_FLOOR_MAP.every((entry) => entry.connected === Boolean(entry.agentOfficeFloorId)));
  assert.ok(EXECUTIVE_FLOOR_MAP.every((entry) => entry.connected || entry.fallback === 'planned-not-connected'));
});
