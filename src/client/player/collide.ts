import * as THREE from 'three';
import type { Collider } from '../world/types';

// Bumping into things: where you can stand, what's in your way, and what's over your head.

const RADIUS = 0.32;
/** Top of your head above your feet, for walking under the loft. */
export const HEIGHT = 1.7;
/** The tallest ledge you walk up (or down) without jumping, like a stair. */
export const STEP = 0.3;

/** You, as what bumps into things: where your feet are, among what, and whether they're on the ground. */
export interface Body {
  pos: THREE.Vector3;
  colliders: Collider[];
  grounded: boolean;
  /** Eased out after a step up or down (see PlayerController.stepOffset). */
  stepOffset: number;
}

/** What stands in your way at (x, z) with your feet at `y`, or null. */
export function blockerAt(b: Body, x: number, z: number, y: number, allowEscape = false): Collider | null {
  let hit: Collider | null = null;
  for (const c of b.colliders) {
    // Stood on top of it, or passing beneath it.
    if (y >= c.top - 0.05 || y + HEIGHT <= (c.bottom ?? 0)) continue;
    // A spawn or height change can leave the body overlapping a solid. Only
    // allow escape toward its near side, never through it to the far side.
    if (allowEscape && touches(c, b.pos.x, b.pos.z, RADIUS)) {
      if (escapes(c, b.pos.x, b.pos.z, x, z)) continue;
    } else if (!touches(c, x, z, RADIUS)) continue;
    if (!hit || c.top > hit.top) hit = c;
  }
  return hit;
}

/** A step along one axis to (x, z): up onto a stair if there's room there, else as far as you fit. */
export function stepTo(b: Body, x: number, z: number) {
  const hit = blockerAt(b, x, z, b.pos.y, true);
  if (!hit) {
    b.pos.x = x;
    b.pos.z = z;
    return;
  }
  // A stair: step up onto it if there's room there.
  const up = hit.top - b.pos.y;
  if (b.grounded && up <= STEP && !blockerAt(b, x, z, hit.top) && b.pos.y + HEIGHT + up <= ceilingAt(b.colliders, x, z, b.pos.y)) {
    b.pos.set(x, hit.top, z);
    b.stepOffset -= up;
    return;
  }
  // Use the free part of this axis's step instead of throwing it all away.
  // The other axis can then slide along the surface, even on slower frames.
  const dx = x - b.pos.x;
  const dz = z - b.pos.z;
  let free = 0;
  let blocked = 1;
  for (let i = 0; i < 12; i++) {
    const fraction = (free + blocked) / 2;
    if (blockerAt(b, b.pos.x + dx * fraction, b.pos.z + dz * fraction, b.pos.y, true)) blocked = fraction;
    else free = fraction;
  }
  b.pos.x += dx * free;
  b.pos.z += dz * free;
}

/** Whether the whole axis step moves out of an existing overlap. */
function escapes(c: Collider, fromX: number, fromZ: number, x: number, z: number): boolean {
  if (penetration(c, x, z) >= penetration(c, fromX, fromZ) - 1e-8) return false;
  const nx = fromX - THREE.MathUtils.clamp(fromX, c.minX, c.maxX);
  const nz = fromZ - THREE.MathUtils.clamp(fromZ, c.minZ, c.maxZ);
  if (nx || nz) return nx * (x - fromX) + nz * (z - fromZ) >= 0;
  // Inside the footprint, head toward a nearest face. An endpoint with less
  // overlap alone is insufficient: a long step could cross a thin wall first.
  const nearest = Math.min(fromX - c.minX, c.maxX - fromX, fromZ - c.minZ, c.maxZ - fromZ);
  return (nearest === fromX - c.minX && x < fromX) || (nearest === c.maxX - fromX && x > fromX)
    || (nearest === fromZ - c.minZ && z < fromZ) || (nearest === c.maxZ - fromZ && z > fromZ);
}

/** Signed overlap depth, including when the center is inside the footprint. */
function penetration(c: Collider, x: number, z: number): number {
  const dx = Math.max(c.minX - x, 0, x - c.maxX);
  const dz = Math.max(c.minZ - z, 0, z - c.maxZ);
  if (dx || dz) return RADIUS - Math.hypot(dx, dz);
  return RADIUS + Math.min(x - c.minX, c.maxX - x, z - c.minZ, c.maxZ - z);
}

/** Whether a body of radius `r` at (x, z) overlaps the collider's footprint. */
function touches(c: Collider, x: number, z: number, r: number): boolean {
  const nx = THREE.MathUtils.clamp(x, c.minX, c.maxX);
  const nz = THREE.MathUtils.clamp(z, c.minZ, c.maxZ);
  return (x - nx) ** 2 + (z - nz) ** 2 < r * r;
}

/**
 * The floor under someone standing at (x, z) with their feet at `y`: the highest top they're on or
 * above (out of doors, the street's). Without `fences`, what's there only to keep people out doesn't count.
 */
export function groundAt(colliders: Collider[], x: number, z: number, y: number, fences = true): number {
  let g = -Infinity;
  for (const c of colliders) {
    if (c.top > 50 || y < c.top - 0.1 || c.top <= g || (c.fence && !fences)) continue;
    if (touches(c, x, z, RADIUS)) g = c.top;
  }
  return g;
}

/** The underside of whatever is overhead at (x, z) for feet at `y` (the loft, its roof), or Infinity. */
export function ceilingAt(colliders: Collider[], x: number, z: number, y: number): number {
  let top = Infinity;
  for (const c of colliders) {
    const b = c.bottom ?? 0;
    if (b <= y + 0.1 || b >= top) continue;
    if (touches(c, x, z, RADIUS)) top = b;
  }
  return top;
}
