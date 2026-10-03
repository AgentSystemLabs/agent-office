/**
 * Floats a mesh a little over a meter in front of the headset, facing you, and carries it with the
 * locomotion rig so it stays put as you walk.
 */
import * as THREE from 'three';

const head = new THREE.Vector3();
const look = new THREE.Vector3();

/** Places `mesh` in front of `camera`, parented to `rig`, at `distance` meters (before rig scale). */
export function placeInFront(
  mesh: THREE.Object3D,
  rig: THREE.Group,
  camera: THREE.Camera,
  scene: THREE.Scene,
  opts: { distance?: number; y?: number; pitch?: number } = {},
) {
  const distance = opts.distance ?? 1.1;
  const y = opts.y ?? -0.15;
  const pitch = opts.pitch ?? 0;
  rig.updateMatrixWorld(true);
  const s = rig.scale.x;
  camera.getWorldPosition(head);
  camera.getWorldDirection(look).setY(0);
  if (look.lengthSq() < 1e-4) look.set(0, 0, -1);
  look.normalize();
  scene.add(mesh);
  mesh.position.copy(head).addScaledVector(look, distance * s);
  mesh.position.y += y * s;
  mesh.scale.setScalar(s);
  mesh.lookAt(head);
  if (pitch) mesh.rotateX(pitch);
  rig.attach(mesh);
}
