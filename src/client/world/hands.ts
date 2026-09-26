import * as THREE from 'three';
import { REACH_TIME, reachCurve } from './character';
import { mesh, toon, toonUnique } from './toon';

export interface HandsInput {
  yaw: number;
  pitch: number;
  walkPhase: number;
  walking: boolean;
  airborne: boolean;
}

interface Arm {
  group: THREE.Group;
  base: THREE.Vector3;
  baseRot: THREE.Euler;
}

/**
 * Your own hands in first person. They live in their own small scene, drawn over the world with
 * a cleared depth buffer, so they never poke through desks or walls. Camera space: -z is forward.
 */
export class Hands {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.01, 5);
  private sleeve: THREE.MeshToonMaterial;
  private skin: THREE.MeshToonMaterial;
  private right: Arm;
  private left: Arm;
  private reachT = -1;
  private sway = new THREE.Vector2();
  private last: { yaw: number; pitch: number } | null = null;
  private air = 0;
  private walk = 0;

  constructor(shirt: string, skin: string) {
    this.sleeve = toonUnique(shirt);
    this.skin = toonUnique(skin);
    this.scene.add(new THREE.HemisphereLight('#fff5e6', '#c9a27a', 1.5));
    this.scene.add(new THREE.AmbientLight('#ffffff', 0.5));
    const sun = new THREE.DirectionalLight('#fff1d6', 2);
    sun.position.set(-0.6, 1.4, 0.9);
    this.scene.add(sun);
    this.right = this.arm(1);
    this.left = this.arm(-1);
  }

  setColor(shirt: string) {
    this.sleeve.color.set(shirt);
  }

  setSkin(skin: string) {
    this.skin.color.set(skin);
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Reach out with the right hand. */
  reach() {
    this.reachT = 0;
  }

  private arm(side: 1 | -1): Arm {
    const group = new THREE.Group();
    // Sleeve runs from the wrist back past the camera, so its far end is always off screen.
    group.add(mesh(new THREE.CapsuleGeometry(0.058, 0.42, 6, 14).rotateX(Math.PI / 2), this.sleeve, 0, 0, 0.34, false));
    group.add(mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.045, 18).rotateX(Math.PI / 2), toon('#fffaf3'), 0, 0, 0.075, false));
    // Cartoon mitten: a chunky palm, a thumb on the inside, and a pointing finger on the right hand.
    const palm = mesh(new THREE.SphereGeometry(0.062, 18, 14), this.skin, 0, 0, 0, false);
    palm.scale.set(1, 0.78, 1.18);
    group.add(palm);
    const thumb = mesh(new THREE.CapsuleGeometry(0.02, 0.03, 4, 10).rotateX(Math.PI / 2), this.skin, -side * 0.05, 0.014, -0.02, false);
    thumb.rotation.y = side * 0.55;
    group.add(thumb);
    if (side === 1) group.add(mesh(new THREE.CapsuleGeometry(0.019, 0.05, 4, 10).rotateX(Math.PI / 2), this.skin, -0.016, 0.022, -0.085, false));
    const base = new THREE.Vector3(side * 0.25, -0.185, -0.44);
    const baseRot = new THREE.Euler(0.2, side * 0.22, side * -0.25);
    group.position.copy(base);
    group.rotation.copy(baseRot);
    this.scene.add(group);
    return { group, base, baseRot };
  }

  update(dt: number, t: number, s: HandsInput) {
    // Hands lag a touch behind quick turns of the head.
    if (this.last && dt > 0) {
      const dyaw = Math.atan2(Math.sin(s.yaw - this.last.yaw), Math.cos(s.yaw - this.last.yaw));
      const dpitch = s.pitch - this.last.pitch;
      const tx = THREE.MathUtils.clamp((dyaw / dt) * 0.012, -0.05, 0.05);
      const ty = THREE.MathUtils.clamp((-dpitch / dt) * 0.01, -0.04, 0.04);
      this.sway.x += (tx - this.sway.x) * Math.min(1, dt * 10);
      this.sway.y += (ty - this.sway.y) * Math.min(1, dt * 10);
    }
    this.last = { yaw: s.yaw, pitch: s.pitch };
    this.air += ((s.airborne ? 1 : 0) - this.air) * Math.min(1, dt * 8);
    this.walk += ((s.walking ? 1 : 0) - this.walk) * Math.min(1, dt * 8);

    const breathe = Math.sin(t * 1.7) * 0.004;
    const step = Math.sin(s.walkPhase) * this.walk;
    const bounce = Math.sin(s.walkPhase * 2) * 0.006 * this.walk;
    const k = this.reachT >= 0 ? reachCurve(this.reachT / REACH_TIME) : 0;
    if (this.reachT >= 0) {
      this.reachT += dt;
      if (this.reachT >= REACH_TIME) this.reachT = -1;
    }

    for (const [arm, side] of [
      [this.right, 1],
      [this.left, -1],
    ] as const) {
      const p = arm.group.position.copy(arm.base);
      p.x += this.sway.x + side * this.air * 0.03 + step * 0.008;
      p.y += this.sway.y + breathe + bounce + this.air * 0.05;
      // Arms swing opposite each other while walking.
      p.z += side * step * 0.025;
      arm.group.rotation.copy(arm.baseRot);
      arm.group.rotation.x += this.air * 0.2;
    }
    // The reach: the right hand jabs out toward the crosshair, the left pulls back a little.
    const r = this.right.group;
    r.position.x -= 0.16 * k;
    r.position.y += 0.09 * k;
    r.position.z -= 0.2 * k;
    r.rotation.x += 0.3 * k;
    r.rotation.y += 0.15 * k;
    r.rotation.z += 0.22 * k;
    this.left.group.position.y -= 0.025 * k;
    this.left.group.position.z += 0.03 * k;
  }
}
