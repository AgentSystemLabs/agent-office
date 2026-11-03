import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as THREE from 'three';
import { buildExecutiveBuilding } from '../src/client/executive/building-kit.js';
import { architectureFor } from '../src/client/executive/building-definition.js';
import { createTownInterior } from '../src/client/executive/town-interior.js';
import { readFileSync } from 'node:fs';

test('Town Hall keeps the entry and adds the reference architectural language', () => {
  const town = buildExecutiveBuilding({ id: 'town-hall', name: 'Town Hall', x: 0, z: -28, color: '#203c53', kind: 'town' });
  assert.equal(town.door.name, 'front-door');
  assert.ok(town.group.getObjectByName('town-roof-slab'));
  assert.ok(town.group.getObjectByName('town-glass-facade-left'));
  assert.ok(town.group.getObjectByName('town-glass-facade-right'));
  assert.ok(town.group.getObjectByName('town-glass-transom'));
  assert.ok(town.group.getObjectByName('town-rounded-boardroom-wing'));
  assert.ok(town.group.getObjectByName('town-operations-deck'));
  assert.ok(town.group.getObjectByName('town-upper'));
});

test('Town Hall interior resets to a clean shared architectural shell', () => {
  const architecture = architectureFor({ kind: 'town' });
  const interior = createTownInterior();
  assert.equal(architecture.exteriorWidth, 10);
  assert.equal(architecture.exteriorDepth, 7);
  assert.equal(architecture.interiorWidth, 9.6);
  assert.equal(architecture.interiorDepth, 6.6);
  for (const name of ['town-entrance-atrium','town-boardroom','town-operations-office','town-director-interface','town-report-wall','town-stair-elevator-core','town-upper-operations-deck']) assert.equal(interior.getObjectByName(name), undefined);
  assert.equal(interior.children.length, 0, 'Town Hall no longer creates a duplicate interior render scene');
  assert.equal(interior.getObjectByName('town-interior-door'), undefined);
});

test('Town Hall canonical door keeps shared world-space dimensions without parent distortion', () => {
  const town = buildExecutiveBuilding({ id: 'town-hall', name: 'Town Hall', x: 0, z: -28, color: '#203c53', kind: 'town' });
  const architecture = architectureFor({ kind: 'town' });
  town.door.updateWorldMatrix(true, false);
  const worldScale = new THREE.Vector3();
  town.door.getWorldScale(worldScale);
  assert.equal(town.door.userData.canonical, true);
  assert.equal(town.door.userData.doorwayWidth * worldScale.x, architecture.doorway.width);
  assert.equal(town.door.userData.doorwayHeight * worldScale.y, architecture.doorway.height);
  assert.equal(town.door.scale.x, 1);
  assert.equal(town.door.scale.y, 1);
});

test('Town Hall interior visibility preserves global scene lighting', () => {
  const source = readFileSync(new URL('../src/client/executive/preview.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('outsideGeometryRoots'));
  assert.ok(source.includes('root instanceof THREE.Light'));
  assert.ok(source.includes('new THREE.HemisphereLight'));
  assert.ok(source.includes('new THREE.DirectionalLight'));
});
