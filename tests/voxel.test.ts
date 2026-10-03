import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { voxelBox, voxelCapsule, voxelGeometry } from '../src/client/world/voxel';
import { fineChair, laptopKeys } from '../src/client/world/office/voxel-furniture';
import { finePlant, fineSofa } from '../src/client/world/office/voxel-props';

test('solid voxel volumes emit the outside surface, with outward triangles and exact bounds', () => {
  const geometry = voxelBox(0.1, 0.1, 0.1, 0.025);
  // Four cells along each edge: six sides, sixteen exposed faces per side, six vertices each.
  assert.equal(geometry.getAttribute('position').count, 6 * 16 * 6);
  assert.deepEqual(geometry.boundingBox!.min.toArray().map((v) => Number(v.toFixed(4))), [-0.05, -0.05, -0.05]);
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  for (let i = 0; i < positions.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(positions, i);
    const b = new THREE.Vector3().fromBufferAttribute(positions, i + 1);
    const c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
    assert.ok(b.sub(a).cross(c.sub(a)).dot(new THREE.Vector3().fromBufferAttribute(normals, i)) > 0);
  }
});

test('fine capsules retain rig dimensions and each cached copy owns its geometry', () => {
  const a = voxelCapsule(0.08, 0.24), b = voxelCapsule(0.08, 0.24);
  assert.notEqual(a, b);
  assert.notEqual(a.getAttribute('position').array, b.getAttribute('position').array);
  a.translate(2, 0, 0); a.dispose();
  assert.ok(b.boundingBox!.max.x <= 0.08001);
  assert.ok(b.boundingBox!.max.y <= 0.20001);
  assert.throws(() => voxelGeometry('box', 1, 1, 1, 0));
});

test('refined furniture preserves seating heights, leaf hooks, and batches keycaps', () => {
  const chair = fineChair('#66aa99');
  const chairBounds = new THREE.Box3().setFromObject(chair);
  assert.ok(chairBounds.max.x <= 0.35 && chairBounds.min.x >= -0.35);
  const sofaBounds = new THREE.Box3().setFromObject(fineSofa());
  assert.ok(sofaBounds.max.x <= 2.10001 && sofaBounds.min.x >= -2.10001);
  assert.equal(laptopKeys().children.length, 1);
  const plant = finePlant('monstera');
  assert.ok(plant.getObjectByName('monstera_leaves'));
});
