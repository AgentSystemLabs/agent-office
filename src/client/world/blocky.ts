import * as THREE from 'three';

// Square-edged stand-ins for round primitives, so props built from cylinders, balls and cones come
// out as chunky blocks like the voxel people (see vox.ts). Same leading arguments as the three.js
// shapes they replace; the rest are ignored.

/** A post or drum: a square block as wide as the cylinder's average diameter, a little under it. */
export function blockCylinder(top: number, bottom: number, height: number, ..._rest: unknown[]): THREE.BufferGeometry {
  const w = (top + bottom) * 0.88;
  return new THREE.BoxGeometry(w, height, w);
}

/** A ball: a cube of about the same volume. */
export function blockBall(r: number, ..._rest: unknown[]): THREE.BufferGeometry {
  const s = r * 1.6;
  return new THREE.BoxGeometry(s, s, s);
}

/** A cone: a four-sided pyramid with its corners on the old radius. */
export function blockCone(r: number, height: number, _s?: number, _h?: number, open?: boolean, ..._rest: unknown[]): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r, height, 4, 1, open).rotateY(Math.PI / 4);
}

/** A capsule: a block the same length. */
export function blockCapsule(r: number, length: number, ..._rest: unknown[]): THREE.BufferGeometry {
  return new THREE.BoxGeometry(r * 1.8, length + r * 2, r * 1.8);
}

/** A ring seen from above: a flat square slab. */
export function blockRing(R: number, r: number, ..._rest: unknown[]): THREE.BufferGeometry {
  return new THREE.BoxGeometry(R * 1.9, r * 2, R * 1.9);
}
