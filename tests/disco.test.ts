import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildDanceFloor } from '../src/client/world/disco.js';
import { FLOOR, TV } from '../src/shared/layout.js';

// disco.ts reads the browser's motion preference when it builds; Node has no matchMedia.
(globalThis as { window?: unknown }).window = { matchMedia: () => ({ matches: false }) };

test('the dance floor sits in front of the TV and comes out or goes away on command', () => {
  const floor = buildDanceFloor();
  assert.equal(floor.showing(), true, 'it is out to begin with');
  assert.equal(floor.group.visible, true);

  // One grid of tiles, the size the lounge floor has room for.
  const min = new THREE.Vector3(Infinity, 0, Infinity);
  const max = new THREE.Vector3(-Infinity, 0, -Infinity);
  const corner = new THREE.Vector3();
  const at = new THREE.Matrix4();
  let grids = 0;
  let tiles = 0;
  floor.group.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh) return;
    grids++;
    tiles = im.count;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, at);
      corner.setFromMatrixPosition(at);
      min.min(corner);
      max.max(corner);
    }
  });
  assert.equal(grids, 1, 'one floor of tiles');
  assert.ok(tiles >= 8, `a grid of tiles, got ${tiles}`);

  // Between the coffee table and the wall, along the TV's own width, inside the room.
  assert.ok(min.x > 13.8, `clear of the coffee table, got ${min.x}`);
  assert.ok(max.x < FLOOR.maxX, `inside the east wall, got ${max.x}`);
  assert.ok(min.z >= TV.z - TV.width / 2 && max.z <= TV.z + TV.width / 2, 'along the TV, in front of it');

  // Away and back: the group and its lights go with it, and the animation copes either way.
  floor.setOn(false);
  assert.equal(floor.showing(), false);
  assert.equal(floor.group.visible, false);
  floor.update(12.3);
  floor.setOn(true);
  assert.equal(floor.showing(), true);
  floor.update(12.3);
});
