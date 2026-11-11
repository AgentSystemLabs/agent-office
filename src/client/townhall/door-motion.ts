import * as THREE from 'three';

function getPanelBounds(door: THREE.Mesh) {
  const { geometry } = door;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingBox) throw new Error(`Door mesh "${door.name}" has no bounding box.`);
  return geometry.boundingBox;
}

function getPanelHorizontalAxis(door: THREE.Mesh) {
  const bounds = getPanelBounds(door);
  const size = bounds.getSize(new THREE.Vector3());
  const isX = size.x >= size.z;
  const axisName: 'x' | 'z' = isX ? 'x' : 'z';
  return {
    bounds,
    axis: new THREE.Vector3(isX ? 1 : 0, 0, isX ? 0 : 1),
    axisName,
    width: isX ? size.x : size.z,
  };
}

function hingeSide(name: string, userData: Record<string, unknown>) {
  const configured = userData.hinge_side ?? userData.hingeSide;
  if (typeof configured === 'string') {
    if (configured.toLowerCase() === 'right') return 1;
    if (configured.toLowerCase() === 'left') return -1;
  }

  const normalized = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  if (/(^|_)RIGHT(_|$)/.test(normalized) || /(?:LEAF|PANEL)_2(?:_|$)/.test(normalized) || /(?:LEAF|PANEL)_2001(?:_|$)/.test(normalized)) return 1;
  return -1;
}

export function openHingedDoor(door: THREE.Mesh, angle = Math.PI / 2) {
  const { bounds, axis, axisName } = getPanelHorizontalAxis(door);
  const side = hingeSide(door.name, door.userData);
  const localHinge = bounds.getCenter(new THREE.Vector3());
  localHinge[axisName] = side < 0 ? bounds.min[axisName] : bounds.max[axisName];

  door.updateWorldMatrix(true, false);
  const hingeBefore = door.localToWorld(localHinge.clone());
  door.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), angle);
  door.updateWorldMatrix(true, false);
  const hingeAfter = door.localToWorld(localHinge.clone());

  const parent = door.parent;
  if (parent) {
    const beforeParent = parent.worldToLocal(hingeBefore);
    const afterParent = parent.worldToLocal(hingeAfter);
    door.position.add(beforeParent.sub(afterParent));
  } else {
    door.position.add(hingeBefore.sub(hingeAfter));
  }
  door.updateMatrixWorld(true);
}

export function openSlidingDoor(door: THREE.Mesh) {
  const { axis, width } = getPanelHorizontalAxis(door);
  const worldDirection = axis.applyQuaternion(door.getWorldQuaternion(new THREE.Quaternion()));
  worldDirection.y = 0;
  worldDirection.normalize();

  const worldPosition = door.getWorldPosition(new THREE.Vector3()).addScaledVector(worldDirection, Math.max(1.2, width) * 1.5);
  if (door.parent) door.parent.worldToLocal(worldPosition);
  door.position.copy(worldPosition);
  door.updateMatrixWorld(true);
}
