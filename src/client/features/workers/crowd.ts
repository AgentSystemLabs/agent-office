// Keeping wanderers from standing inside each other (see features/workers/wander.ts): who has a
// haunt claimed, and the per-tick nudge that sorts out whatever the nav grid collapsed together.
import type * as THREE from 'three';

/** The bits of a wanderer the crowd rules need (wander.ts's Roamer satisfies this). */
export interface RoamerLike {
  id: string;
  state: string;
  /** Where it's off to or lingering, if anywhere. */
  spot: { x: number; z: number } | null;
  model: { root: { position: THREE.Vector3 } };
}

/** Whether another worker out and about already has `x, z` as its haunt (or is on its way there). */
export function spotTaken(roamers: Iterable<RoamerLike>, self: RoamerLike, x: number, z: number): boolean {
  for (const o of roamers) {
    if (o === self || !o.spot) continue;
    if (o.state !== 'walk' && o.state !== 'linger' && o.state !== 'chat' && o.state !== 'down') continue;
    if (Math.hypot(o.spot.x - x, o.spot.z - z) < 1.0) return true;
  }
  return false;
}

/**
 * Nobody stands inside anybody else: whatever the nav grid collapsed together — a shared couch
 * place, a chat rendezvous on one cell, paths crossing — gets nudged apart until a body's width.
 * Pairs that pass within `greet` of each other get a hello first (see ambient.ts passBy).
 */
export function separate<T extends RoamerLike>(roamers: Iterable<T>, onPass?: (a: T, b: T) => void, greet = 1.5) {
  const out = [...roamers].filter((c) => c.state !== 'seated');
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i];
      const b = out[j];
      const pa = a.model.root.position;
      const pb = b.model.root.position;
      const dx = pb.x - pa.x;
      const dz = pb.z - pa.z;
      const d = Math.hypot(dx, dz);
      if (d < greet) onPass?.(a, b);
      if (d >= 0.55) continue;
      const push = (0.55 - d) / 2;
      // Dead-centre overlaps pick a stable direction from their ids, so they don't vibrate.
      const ux = d > 1e-4 ? dx / d : a.id < b.id ? 1 : -1;
      const uz = d > 1e-4 ? dz / d : 0;
      pa.x -= ux * push;
      pa.z -= uz * push;
      pb.x += ux * push;
      pb.z += uz * push;
    }
  }
}
