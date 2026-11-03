import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as THREE from 'three';
import { campusBuildings, plannedBuildings } from '../src/client/executive/campus-layout.js';
import { entryForBuilding, townHallEntry } from '../src/client/executive/building-entry.js';
import { createPlaceholderInterior } from '../src/client/executive/placeholder-interior.js';
import { blockerAt } from '../src/client/player/collide.js';

test('all active campus buildings have data-driven door and interior records', () => {
  assert.equal(townHallEntry.interiorType, 'town-hall');
  for (const spec of [...campusBuildings, ...plannedBuildings]) {
    const entry = entryForBuilding(spec);
    assert.equal(entry.id, spec.id);
    assert.equal(entry.interiorType, 'placeholder');
    assert.notDeepEqual(entry.door, entry.exterior);
    assert.ok(entry.interiorBounds.minX < entry.interiorBounds.maxX);
    assert.ok(entry.interiorBounds.minZ < entry.interiorBounds.maxZ);
  }
});

test('placeholder interiors have clear entry points and solid boundaries', () => {
  const spec = campusBuildings[0];
  const interior = createPlaceholderInterior(spec);
  const body = { pos: new THREE.Vector3(interior.spawn.x, .6, interior.spawn.z), colliders: interior.colliders, grounded: false, stepOffset: 0 };
  assert.equal(blockerAt(body, interior.spawn.x, interior.spawn.z, .6), null);
  assert.ok(blockerAt(body, 0, -1.75, .6));
});
