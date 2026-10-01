import * as THREE from 'three';
import type { PersonRig } from './rig';

/**
 * How far behind the camera your body stands in first person, so looking down you see it, not its
 * inside; how slim the torso gets (across, front to back), so it doesn't hide your legs; and how far
 * forward of it your legs come, so you see your feet.
 */
const BACK = 0.22;
const SLIM = { x: 0.8, z: 0.6 };
const LEGS = 0.08;

const look = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * You in first person: your own character with its head and arms off (your hands are drawn on their
 * own, see world/hands.ts) and whatever floats over it (name, bubbles, the mic), stood a little back,
 * so looking down you see your shirt, legs and feet walking, or your legs out in front sitting down.
 */
export class FirstPersonBody {
  private on = false;

  constructor(private rig: PersonRig) {}

  /** In first person or not, your body stood back from where `camera` looks (seated, you can look round). */
  set(on: boolean, camera: THREE.Camera) {
    const { root, body, torso, legL, legR } = this.rig;
    if (on) {
      // The camera's heading, turned into the body's own frame.
      camera.getWorldDirection(look).setY(0).normalize().applyAxisAngle(UP, -root.rotation.y);
      body.position.set(-look.x * BACK, body.position.y, -look.z * BACK);
    }
    if (on === this.on) return;
    this.on = on;
    if (!on) body.position.set(0, body.position.y, 0);
    torso.scale.set(on ? SLIM.x : 1, 1, on ? SLIM.z : 1);
    for (const leg of [legL, legR]) leg.position.z = on ? LEGS : 0;
  }

  /**
   * For one drawing of the scene: hides all but the torso and legs (and whatever's hung on them),
   * whatever the game's shown since (the mic as you talk, a bubble, a card), and keeps what's left from
   * casting a shadow, which would have no head. Returns what puts it all back as it was.
   */
  hideExtras(): () => void {
    if (!this.on) return () => {};
    const { root, body, torso, legL, legR } = this.rig;
    const keep = new Set<THREE.Object3D>([torso, legL, legR]);
    const hidden: THREE.Object3D[] = [];
    const shadows: THREE.Object3D[] = [];
    for (const o of [...body.children.filter((c) => !keep.has(c)), ...root.children.filter((c) => c !== body)]) {
      if (o.visible) hidden.push(o);
      o.visible = false;
    }
    for (const k of keep)
      k.traverse((o) => {
        if (o.castShadow) shadows.push(o);
        o.castShadow = false;
      });
    return () => {
      for (const o of hidden) o.visible = true;
      for (const o of shadows) o.castShadow = true;
    };
  }
}
