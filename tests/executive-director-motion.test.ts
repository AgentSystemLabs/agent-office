import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import * as THREE from 'three';
import { moveDirector } from '../src/client/executive/director-motion.js';

test('Director motion is camera-relative, normalized, bounded, and obstacle-aware', () => {
  const position = new THREE.Vector3(0, 0, 0);
  const result = moveDirector(position, 0, 1, 1, 1, { minX: -2, maxX: 2, minZ: -2, maxZ: 2 });
  assert.equal(result.moving, true);
  assert.ok(position.z > 0 && position.x > 0);
  moveDirector(position, 0, 1, 0, 10, { minX: -2, maxX: 2, minZ: -2, maxZ: 2 });
  assert.ok(position.z >= -2);
  const blocked = new THREE.Vector3(0, 0, 0);
  moveDirector(blocked, 0, 0, 1, 1, { minX: -4, maxX: 4, minZ: -4, maxZ: 4 }, 4.6, [{ minX: 0.2, maxX: 2, minZ: -1, maxZ: 1 }]);
  assert.equal(blocked.x, 0);
});
