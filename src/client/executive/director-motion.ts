import * as THREE from 'three';

export interface DirectorMotionBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface DirectorObstacle { minX: number; maxX: number; minZ: number; maxZ: number }

export function moveDirector(
  position: THREE.Vector3,
  cameraYaw: number,
  forward: number,
  side: number,
  dt: number,
  bounds: DirectorMotionBounds,
  speed = 4.6,
  obstacles: DirectorObstacle[] = [],
): { moving: boolean; facing: number } {
  if (!forward && !side) return { moving: false, facing: Math.atan2(Math.sin(cameraYaw + Math.PI), Math.cos(cameraYaw + Math.PI)) };
  const length = Math.hypot(forward, side);
  const f = forward / length;
  const s = side / length;
  const sin = Math.sin(cameraYaw);
  const cos = Math.cos(cameraYaw);
  const dx = f * cos + s * sin;
  const dz = -f * sin + s * cos;
  const nextX = THREE.MathUtils.clamp(position.x + dx * speed * dt, bounds.minX, bounds.maxX);
  if (!obstacles.some((o) => nextX > o.minX && nextX < o.maxX && position.z > o.minZ && position.z < o.maxZ)) position.x = nextX;
  const nextZ = THREE.MathUtils.clamp(position.z + dz * speed * dt, bounds.minZ, bounds.maxZ);
  if (!obstacles.some((o) => position.x > o.minX && position.x < o.maxX && nextZ > o.minZ && nextZ < o.maxZ)) position.z = nextZ;
  return { moving: true, facing: Math.atan2(dx, dz) };
}
