/**
 * A worker flinching from the whip: a jolt back and a hop, a squash, its head shaking, a "💢 Ow!" over
 * it and stars going round its head. The jolt is put on the worker's root after its own update each
 * frame (see update) and taken back off before the next one (see restore), so whatever else moves the
 * root (a walk about the court, a dance, a departure) never sees it.
 */
import * as THREE from 'three';
import { pick } from '../../sound/dsp';
import type { Worker } from '../../world/character';
import { disposeSprite, textSprite } from '../../world/toon';

/** How long the jolt lasts, and how long the bubble and the stars stay up (seconds). */
const JOLT = 1.1;
const BUBBLE = 1.7;
const STARS = 1.3;

const SAYS = ['💢 Ow!', '💢 Yow!', '💢 Ouch!', '😣 On it!', '💦 Yes boss!', '😖 Optimizing!'];

interface Flinch {
  model: Worker;
  /** Seconds in (negative while it waits for the lash to land). */
  t: number;
  /** Small: just the squash, no hop or shake (the system asks for less motion). */
  gentle: boolean;
  /** The root as its own update left it, while the jolt's on it; null while it isn't. */
  base: { pos: THREE.Vector3; rot: THREE.Euler; scale: THREE.Vector3 } | null;
  bubble: THREE.Sprite | null;
  stars: THREE.Sprite[];
}

const head = new THREE.Vector3();
const scl = new THREE.Vector3();
const right = new THREE.Vector3();

export class Flinches {
  private live = new Map<Worker, Flinch>();

  constructor(
    private readonly scene: THREE.Object3D,
    private readonly camera: THREE.Camera,
  ) {}

  /** `model` flinches, `delay` seconds from now (when the lash lands). Again while it's flinching starts it over. */
  add(model: Worker, gentle: boolean, delay = 0) {
    const was = this.live.get(model);
    if (was) {
      // Its root still has this frame's jolt on it: keep what it was underneath.
      was.t = -delay;
      was.gentle = gentle;
      this.clearSprites(was);
      return;
    }
    this.live.set(model, { model, t: -delay, gentle, base: null, bubble: null, stars: [] });
  }

  /** Takes the jolt back off every root it's on, before anything moves them this frame. */
  restore() {
    for (const f of this.live.values()) {
      if (!f.base) continue;
      const r = f.model.root;
      r.position.copy(f.base.pos);
      r.rotation.copy(f.base.rot);
      r.scale.copy(f.base.scale);
      f.base = null;
    }
  }

  /** Once the workers have had their own update this frame: the jolt goes on, the bubbles and stars follow. */
  update(dt: number) {
    this.camera.getWorldDirection(right).cross(this.camera.up).normalize();
    for (const [model, f] of this.live) {
      f.t += dt;
      if (f.t < 0) continue;
      const r = model.root;
      const s = r.getWorldScale(scl).y;
      r.getWorldPosition(head);
      if (!f.bubble) this.pop(f);
      if (f.t < JOLT) this.jolt(f, f.t);
      this.follow(f, f.t, s);
      if (f.t >= Math.max(JOLT, BUBBLE, STARS)) {
        this.clearSprites(f);
        this.live.delete(model);
      }
    }
  }

  private pop(f: Flinch) {
    f.bubble = textSprite(pick(SAYS), { bg: '#fffaf3', size: 40, border: '#ef476f' });
    f.bubble.scale.multiplyScalar(0.7);
    f.bubble.renderOrder = 11;
    this.scene.add(f.bubble);
    for (let i = 0; i < 3; i++) {
      const star = textSprite('⭐', { size: 40 });
      star.scale.multiplyScalar(0.6);
      star.renderOrder = 11;
      this.scene.add(star);
      f.stars.push(star);
    }
  }

  /** The jolt on the root, `t` seconds after the lash landed. */
  private jolt(f: Flinch, t: number) {
    const r = f.model.root;
    f.base = { pos: r.position.clone(), rot: r.rotation.clone(), scale: r.scale.clone() };
    const fade = Math.exp(-5 * t);
    // A squash as it's hit, springing back.
    const squash = (f.gentle ? 0.1 : 0.24) * Math.exp(-6 * t) * Math.cos(22 * t);
    r.scale.set(r.scale.x * (1 + squash * 0.5), r.scale.y * (1 - squash), r.scale.z * (1 + squash * 0.5));
    if (f.gentle) return;
    // A hop, a jolt back (forward is +z) and a shake of the head.
    if (t < 0.32) r.position.y += 0.22 * Math.sin((Math.PI * t) / 0.32);
    r.rotation.x -= 0.42 * fade * (1 - Math.exp(-40 * t));
    r.rotation.z += 0.2 * Math.exp(-4 * t) * Math.sin(45 * t);
  }

  /** The bubble rising off to one side of its head and fading, and the stars going round its head. */
  private follow(f: Flinch, t: number, s: number) {
    const b = f.bubble!;
    b.visible = t < BUBBLE;
    // Off to the side of its head, clear of the card over it.
    b.position.copy(head).addScaledVector(right, 0.75 * s);
    b.position.y += (1.15 + 0.3 * Math.min(1, t / BUBBLE)) * s;
    b.material.opacity = Math.min(1, (BUBBLE - t) / 0.4);
    f.stars.forEach((star, i) => {
      star.visible = t < STARS;
      const a = t * 7 + (i * Math.PI * 2) / 3;
      star.position.set(head.x + Math.cos(a) * 0.32 * s, head.y + (1.3 + 0.04 * Math.sin(a * 2)) * s, head.z + Math.sin(a) * 0.32 * s);
      star.material.opacity = Math.min(1, (STARS - t) / 0.3);
    });
  }

  private clearSprites(f: Flinch) {
    for (const sp of [f.bubble, ...f.stars]) {
      if (!sp) continue;
      sp.removeFromParent();
      disposeSprite(sp);
    }
    f.bubble = null;
    f.stars = [];
  }
}
