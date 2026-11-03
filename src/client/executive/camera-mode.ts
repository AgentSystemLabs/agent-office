import * as THREE from 'three';

export type ExecutiveCameraMode = 'overview' | 'first' | 'third';

export function nextExecutiveCameraMode(mode: ExecutiveCameraMode): ExecutiveCameraMode {
  return mode === 'overview' ? 'first' : mode === 'first' ? 'third' : 'overview';
}

export function thirdCameraPosition(target: THREE.Vector3, yaw: number, pitch: number, distance: number): THREE.Vector3 {
  const horizontal = Math.cos(pitch) * distance;
  return new THREE.Vector3(
    target.x + Math.sin(yaw) * horizontal,
    target.y + 1.8 + Math.sin(pitch) * distance,
    target.z + Math.cos(yaw) * horizontal,
  );
}

export function clampThirdDistance(distance: number, delta: number): number {
  return THREE.MathUtils.clamp(distance + delta, 4, 24);
}
