import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getWalkabilityDoorType, isDoorFrameOrMarker, isWalkabilityDoorName } from '../src/client/townhall/door-classification.ts';
import { openHingedDoor, openSlidingDoor } from '../src/client/townhall/door-motion.ts';

test('door panel names are recognized independent of case and separators', () => {
  assert.equal(isWalkabilityDoorName('Gallery lobby door leaf 1.001'), true);
  assert.equal(isWalkabilityDoorName('DOOR_ext_slide_main'), true);
});

test('unmarked door leaves and left/right panels are treated as hinged', () => {
  assert.equal(getWalkabilityDoorType('Gallery_lobby_door_leaf_1001'), 'hinged');
  assert.equal(getWalkabilityDoorType('North room door 1 leaf 1.001'), 'hinged');
  assert.equal(getWalkabilityDoorType('Entry door right'), 'hinged');
  assert.equal(getWalkabilityDoorType('Door_Main_Left'), 'hinged');
});

test('explicit sliding names and elevator doors are treated as sliding', () => {
  assert.equal(getWalkabilityDoorType('DOOR_ext_slide_main'), 'sliding');
  assert.equal(getWalkabilityDoorType('CIRC_Elevator_Door_F1'), 'sliding');
});

test('custom Blender door type takes precedence over the name', () => {
  assert.equal(getWalkabilityDoorType('Door leaf left', { door_type: 'sliding' }), 'sliding');
});

test('ambiguous doors are left unchanged and frames, handles, and anchors are excluded', () => {
  assert.equal(getWalkabilityDoorType('DOOR_security_F3'), null);
  assert.equal(isDoorFrameOrMarker('Gallery lobby door frame head.001'), true);
  assert.equal(isDoorFrameOrMarker('Gallery lobby door handle 1.001'), true);
  assert.equal(isDoorFrameOrMarker('Elevator anchor F1'), true);
});

test('hinged panels rotate around their edge instead of their centered mesh origin', () => {
  const door = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.08), new THREE.MeshBasicMaterial());
  door.name = 'Entry door left';
  door.position.set(2, 0, 3);
  door.updateMatrixWorld(true);
  const hingeBefore = door.localToWorld(new THREE.Vector3(-0.5, 0, 0));

  openHingedDoor(door);

  const hingeAfter = door.localToWorld(new THREE.Vector3(-0.5, 0, 0));
  assert.ok(hingeAfter.distanceTo(hingeBefore) < 1e-6);
  assert.ok(Math.abs(door.rotation.y) > 1);
});

test('sliding panels move along their doorway width axis', () => {
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2, 1), new THREE.MeshBasicMaterial());
  const start = door.position.clone();

  openSlidingDoor(door);

  assert.ok(door.position.z > start.z + 1);
  assert.equal(door.position.x, start.x);
});
