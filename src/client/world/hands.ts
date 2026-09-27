import * as THREE from 'three';
import { EMOTE_BY_ID, type Emote, type EmoteId } from '../../shared/emotes';
import { REACH_TIME, SMOKE_CYCLE, cigarette, coffeeMug, dragCurve, emoteEnvelope, reachCurve } from './character';
import { mesh, toon, toonUnique } from './toon';

export interface HandsInput {
  yaw: number;
  pitch: number;
  walkPhase: number;
  walking: boolean;
  airborne: boolean;
  /** 0 (steady) to 1: one coffee too many. */
  jitter: number;
}

/** Lifting the mug for a sip and lowering it again, in seconds. */
const SIP_TIME = 1.1;

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
  private mug: THREE.Group;
  /** Seconds into a sip (negative while it waits for the reach to finish), or null. */
  private sipT: number | null = null;
  private sway = new THREE.Vector2();
  private last: { yaw: number; pitch: number } | null = null;
  private air = 0;
  private walk = 0;
  private cig: THREE.Group;
  private ember: THREE.MeshToonMaterial;
  /** Each light, and how bright it is where it's brightest. */
  private lights: [THREE.Light, number][] = [];
  private lightLevel = 1;
  /** Seconds into a smoke break, or -1. Runs in step with your character's (see Person.setSmoking). */
  private smokeT = -1;
  /** The emote your character is doing, and how far into it (see Person.emote). */
  private emoting: { emote: Emote; t: number } | null = null;
  /** Sticks up out of the right fist for a thumbs up. */
  private thumbUp: THREE.Mesh;

  constructor(shirt: string, skin: string) {
    this.sleeve = toonUnique(shirt);
    this.skin = toonUnique(skin);
    const sun = new THREE.DirectionalLight('#fff1d6', 2);
    sun.position.set(-0.6, 1.4, 0.9);
    for (const l of [new THREE.HemisphereLight('#fff5e6', '#c9a27a', 1.5), new THREE.AmbientLight('#ffffff', 0.5), sun]) {
      this.scene.add(l);
      this.lights.push([l, l.intensity]);
    }
    this.right = this.arm(1);
    this.left = this.arm(-1);
    // In the left hand, handle in the palm, standing upright however the arm is turned.
    this.mug = coffeeMug();
    this.mug.position.set(0.09, -0.035, -0.03);
    this.mug.quaternion.setFromEuler(this.left.baseRot).invert();
    this.mug.visible = false;
    this.left.group.add(this.mug);
    // Held between the fingers of the right hand, lit end out past the knuckles.
    const cig = cigarette();
    this.cig = cig.group;
    this.ember = cig.ember;
    this.cig.scale.setScalar(0.55);
    this.cig.rotation.set(0.35, Math.PI + 0.5, 0);
    this.cig.position.set(-0.035, 0.03, -0.075);
    this.cig.visible = false;
    this.right.group.add(this.cig);
    this.thumbUp = mesh(new THREE.CapsuleGeometry(0.027, 0.035, 4, 10), this.skin, -0.035, 0.065, -0.005, false);
    this.thumbUp.rotation.z = 0.3;
    this.thumbUp.visible = false;
    this.right.group.add(this.thumbUp);
  }

  /** Puts a lit cigarette in your right hand, or takes it away. */
  setSmoking(on: boolean) {
    if (on === this.smokeT >= 0) return;
    this.smokeT = on ? 0 : -1;
    this.cig.visible = on;
  }

  /** Where the cigarette's lit end is, in camera space (the hands' camera sits where the real one is). */
  cigTip(out: THREE.Vector3): THREE.Vector3 {
    this.right.group.updateMatrixWorld(true);
    return this.cig.localToWorld(out.set(0, 0, 0.09));
  }

  setColor(shirt: string) {
    this.sleeve.color.set(shirt);
  }

  setSkin(skin: string) {
    this.skin.color.set(skin);
  }

  /** How lit it is where you stand, 0–1 (see Sky.lightAt): your hands go dark out on a night street. */
  setLight(level: number) {
    const k = 0.25 + 0.75 * level;
    if (Math.abs(k - this.lightLevel) < 0.01) return;
    this.lightLevel = k;
    for (const [l, full] of this.lights) l.intensity = full * k;
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Reach out with the right hand. */
  reach() {
    this.reachT = 0;
  }

  /** A mug of coffee in the left hand, or not. */
  holdMug(on: boolean) {
    this.mug.visible = on;
  }

  /** Your hands' half of an emote: a wave, a thumbs up, a clap… in front of your eyes. */
  emote(id: EmoteId) {
    const emote = EMOTE_BY_ID.get(id);
    this.emoting = emote ? { emote, t: 0 } : null;
    this.thumbUp.visible = id === 'thumbs';
  }

  /** Raise the mug for a sip, once the right hand is back from the coffee machine. */
  sip() {
    this.sipT = -REACH_TIME * 0.6;
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
    let sip = 0;
    if (this.sipT !== null) {
      this.sipT += dt;
      sip = reachCurve(this.sipT / SIP_TIME);
      if (this.sipT >= SIP_TIME) this.sipT = null;
    }
    const shake = s.jitter * 0.004;

    for (const [arm, side] of [
      [this.right, 1],
      [this.left, -1],
    ] as const) {
      const p = arm.group.position.copy(arm.base);
      p.x += this.sway.x + side * this.air * 0.03 + step * 0.008;
      p.y += this.sway.y + breathe + bounce + this.air * 0.05;
      // Arms swing opposite each other while walking.
      p.z += side * step * 0.025;
      p.x += shake * Math.sin(t * 97 + side);
      p.y += shake * Math.sin(t * 131 + side * 2);
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
    // The sip: the mug comes up to your mouth and tips toward you.
    const l = this.left.group;
    l.position.x += 0.17 * sip;
    l.position.y += 0.13 * sip;
    l.position.z += 0.14 * sip;
    l.rotation.x += 0.7 * sip;
    // A drag: the cigarette hand comes up to your mouth, just under the camera, and back down.
    if (this.smokeT >= 0) {
      this.smokeT += dt;
      const d = s.walking || s.airborne ? 0 : dragCurve(this.smokeT % SMOKE_CYCLE);
      r.position.x -= 0.2 * d;
      r.position.y += 0.02 * d;
      r.position.z += 0.3 * d;
      r.rotation.x += 0.5 * d;
      this.ember.emissiveIntensity += ((d > 0.9 ? 1.4 : 0.3) - this.ember.emissiveIntensity) * Math.min(1, dt * 6);
    }
    if (this.emoting) this.emoteStep(dt, l);
  }

  /** Moves the hands (already placed for this frame) through the emote. */
  private emoteStep(dt: number, l: THREE.Group) {
    const e = this.emoting!;
    e.t += dt;
    const u = e.t;
    const { seconds, id } = e.emote;
    if (u >= seconds) {
      this.emoting = null;
      this.thumbUp.visible = false;
      return;
    }
    const k = emoteEnvelope(u, seconds);
    const r = this.right.group;
    switch (id) {
      case 'wave':
        // Up in front of your shoulder (in from the edge, clear of the sidebar), rocking side to side.
        r.position.x += (-0.09 + Math.sin(u * 12) * 0.035) * k;
        r.position.y += 0.2 * k;
        r.rotation.x += 0.9 * k;
        r.rotation.z += Math.sin(u * 12) * 0.35 * k;
        break;
      case 'thumbs':
        // Up in front of you, fist level and thumb up, with a little pump.
        r.position.x -= 0.13 * k;
        r.position.y += (0.12 + Math.exp(-u * 3) * Math.sin(u * 14) * 0.03) * k;
        r.rotation.z += 0.25 * k;
        break;
      case 'clap': {
        const c = 0.5 - 0.5 * Math.cos(u * 19);
        for (const [g, side] of [
          [r, 1],
          [l, -1],
        ] as const) {
          g.position.x -= side * (0.1 + 0.085 * c) * k;
          g.position.y += 0.06 * k;
          g.rotation.z += side * 0.9 * k;
        }
        break;
      }
      case 'dance': {
        // Up and down by turns, two beats a second.
        const s = Math.sin(u * Math.PI * 2);
        r.position.y += (0.1 + 0.1 * s) * k;
        l.position.y += (0.1 - 0.1 * s) * k;
        r.position.x += s * 0.03 * k;
        l.position.x += s * 0.03 * k;
        break;
      }
      case 'point': {
        // Out toward the crosshair, like a reach you hold.
        const jab = 1 + Math.exp(-u * 4) * Math.sin(u * 16) * 0.15;
        r.position.x -= 0.16 * k;
        r.position.y += 0.09 * k;
        r.position.z -= 0.2 * k * jab;
        r.rotation.x += 0.3 * k;
        r.rotation.y += 0.15 * k;
        break;
      }
      case 'facepalm':
        // Palm up to your face, covering a corner of the view.
        r.position.x -= 0.12 * k;
        r.position.y += (0.17 + Math.sin(u * 5) * 0.01) * k;
        r.position.z += 0.2 * k;
        r.rotation.x += 0.9 * k;
        break;
    }
  }
}
