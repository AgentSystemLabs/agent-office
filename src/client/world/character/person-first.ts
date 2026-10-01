import type * as THREE from 'three';
import type { PersonRig } from './rig';

/**
 * How far behind the camera your body stands in first person, so looking down you see it, not its
 * inside; how slim the torso gets (across, front to back), so it doesn't hide your legs; and how far
 * forward of it your legs come, so you see your feet.
 */
const BACK = 0.22;
const SLIM = { x: 0.8, z: 0.6 };
const LEGS = 0.08;

/**
 * You in first person: your own character with its head and arms off (your hands are drawn on their
 * own, see world/hands.ts) and whatever floats over it (name, bubbles, the mic), stood a little back,
 * so looking down you see your shirt, legs and feet walking, or your legs out in front sitting down.
 */
export class FirstPersonBody {
  /** What was showing before, to put back on the way out. */
  private saved: Map<THREE.Object3D, boolean> | null = null;

  constructor(private rig: PersonRig) {}

  set(on: boolean) {
    if (on === !!this.saved) return;
    const { root, body, legL, legR } = this.rig;
    if (on) {
      const saved = (this.saved = new Map());
      // Of the body: the torso (its first part) and the legs; and nothing else hung off the root.
      const keep = new Set<THREE.Object3D>([body.children[0], legL, legR]);
      for (const o of body.children) if (!keep.has(o)) saved.set(o, o.visible);
      for (const o of root.children) if (o !== body) saved.set(o, o.visible);
      for (const o of saved.keys()) o.visible = false;
      body.position.z = -BACK;
      body.children[0].scale.set(SLIM.x, 1, SLIM.z);
      for (const leg of [legL, legR]) leg.position.z = LEGS;
    } else {
      for (const [o, v] of this.saved!) o.visible = v;
      this.saved = null;
      body.position.z = 0;
      body.children[0].scale.set(1, 1, 1);
      for (const leg of [legL, legR]) leg.position.z = 0;
    }
  }
}
