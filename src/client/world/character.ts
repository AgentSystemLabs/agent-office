import * as THREE from 'three';
import { disposeSprite, mesh, textSprite, toon, toonUnique } from './toon';

const SKIN = ['#ffd7b5', '#f1c27d', '#e0ac69', '#c68642', '#8d5524'];
const HAIR = ['#2b2d42', '#6f4e37', '#e9c46a', '#d62828', '#9d4edd', '#264653'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type Pose = 'stand' | 'walk' | 'sit' | 'type';

/** A chibi cartoon person — used for every human in the office. Forward is +z. */
export class Person {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private legL: THREE.Object3D;
  private legR: THREE.Object3D;
  private armL: THREE.Object3D;
  private armR: THREE.Object3D;
  private shirt: THREE.MeshToonMaterial;
  private label: THREE.Sprite | null = null;
  private speaking = false;
  private mic: THREE.Mesh;
  private walkPhase = 0;
  pose: Pose = 'stand';

  constructor(
    private name: string,
    color: string,
    seed = name,
  ) {
    const h = hash(seed);
    this.shirt = toonUnique(color);
    const skin = toon(SKIN[h % SKIN.length]);
    const hair = toon(HAIR[(h >> 3) % HAIR.length]);
    const pants = toon('#3d405b');
    const ink = toon('#1d1d1d');

    this.root.add(this.body);
    // Torso
    this.body.add(mesh(new THREE.CapsuleGeometry(0.26, 0.28, 6, 12), this.shirt, 0, 0.72, 0));
    // Head
    const head = new THREE.Group();
    head.position.y = 1.32;
    head.add(mesh(new THREE.SphereGeometry(0.34, 20, 16), skin));
    const cap = mesh(new THREE.SphereGeometry(0.355, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), hair, 0, 0.02, -0.02);
    cap.rotation.x = -0.25;
    head.add(cap);
    for (const sx of [-1, 1]) {
      head.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), ink, sx * 0.12, 0.02, 0.3, false));
      head.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), toon('#ff9f9f'), sx * 0.2, -0.08, 0.27, false));
    }
    const smile = mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12, Math.PI), ink, 0, -0.08, 0.32, false);
    smile.rotation.z = Math.PI;
    head.add(smile);
    this.body.add(head);

    const limb = (len: number, r: number, mat: THREE.Material, x: number, y: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.add(mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat, 0, -len / 2 - r / 2, 0));
      this.body.add(pivot);
      return pivot;
    };
    this.legL = limb(0.22, 0.1, pants, -0.12, 0.42);
    this.legR = limb(0.22, 0.1, pants, 0.12, 0.42);
    this.armL = limb(0.24, 0.08, this.shirt, -0.33, 0.9);
    this.armR = limb(0.24, 0.08, this.shirt, 0.33, 0.9);

    // Little mic icon that pops up while speaking
    this.mic = mesh(new THREE.SphereGeometry(0.09, 10, 8), toon('#7cf29a', { emissive: '#2a9d4b' }), 0, 2.25, 0, false);
    this.mic.visible = false;
    this.root.add(this.mic);

    this.setLabel(name, false);
  }

  setColor(color: string) {
    this.shirt.color.set(color);
  }

  setLabel(name: string, muted: boolean | null) {
    this.name = name;
    if (this.label) {
      this.root.remove(this.label);
      disposeSprite(this.label);
    }
    const suffix = muted === null ? '' : muted ? ' 🔇' : ' 🎙️';
    this.label = textSprite(`${name}${suffix}`, { bg: '#fffaf3', size: 40 });
    this.label.position.y = 2.0;
    this.root.add(this.label);
  }

  setSpeaking(on: boolean) {
    this.speaking = on;
    this.mic.visible = on;
  }

  showLabel(v: boolean) {
    if (this.label) this.label.visible = v;
  }

  update(dt: number, t: number, moving: boolean, airborne: boolean) {
    const target = moving ? 1 : 0;
    this.walkPhase += dt * 11 * target;
    const swing = Math.sin(this.walkPhase) * 0.7 * target;
    if (airborne) {
      this.legL.rotation.x = -0.5;
      this.legR.rotation.x = 0.3;
      this.armL.rotation.z = -2.4;
      this.armR.rotation.z = 2.4;
      this.armL.rotation.x = this.armR.rotation.x = 0;
    } else {
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.armL.rotation.x = -swing;
      this.armR.rotation.x = swing;
      this.armL.rotation.z = THREE.MathUtils.lerp(this.armL.rotation.z, -0.1, 0.3);
      this.armR.rotation.z = THREE.MathUtils.lerp(this.armR.rotation.z, 0.1, 0.3);
    }
    this.body.position.y = moving && !airborne ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : 0;
    if (this.speaking) this.mic.scale.setScalar(1 + Math.sin(t * 14) * 0.2);
  }
}

// -----------------------------------------------------------------------------------------------

const STATUS_BULB: Record<string, string> = {
  starting: '#adb5bd',
  idle: '#8ecae6',
  working: '#ffd166',
  needs_input: '#ef476f',
  done: '#06d6a0',
  exited: '#6c757d',
  offline: '#6c757d',
};

/** The little Claude worker that sits at a desk. Forward is +z. */
export class Worker {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private bulb: THREE.MeshToonMaterial;
  private bulbMesh: THREE.Mesh;
  private armL: THREE.Object3D;
  private armR: THREE.Object3D;
  private bubble: THREE.Sprite | null = null;
  private bubbleKey = '';
  private nameTag: THREE.Sprite | null = null;
  private eyes: THREE.Mesh[] = [];
  private blinkAt = Math.random() * 4;
  status = 'starting';
  bouncing = false;
  private bounceT = 0;
  private spawnT = 0;

  constructor(name: string, color: string) {
    const skin = toonUnique(color);
    const white = toon('#ffffff');
    const ink = toon('#1d1d1d');

    this.root.add(this.body);
    // Bean-shaped body
    const bean = mesh(new THREE.CapsuleGeometry(0.28, 0.3, 8, 16), skin, 0, 0.55, 0);
    this.body.add(bean);
    // Big cartoon eyes
    for (const sx of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.09, 12, 10), white, sx * 0.11, 0.7, 0.23, false);
      eye.scale.z = 0.6;
      this.body.add(eye);
      const pupil = mesh(new THREE.SphereGeometry(0.045, 10, 8), ink, sx * 0.11, 0.7, 0.29, false);
      this.body.add(pupil);
      this.eyes.push(eye, pupil);
    }
    // Headset: band + mic
    const band = mesh(new THREE.TorusGeometry(0.29, 0.025, 6, 20, Math.PI), toon('#2b2d42'), 0, 0.72, 0, false);
    band.rotation.y = Math.PI / 2;
    this.body.add(band);
    for (const sx of [-1, 1]) this.body.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), toon('#2b2d42'), sx * 0.29, 0.72, 0, false));
    // Antenna with status bulb
    this.body.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 6), toon('#2b2d42'), 0, 1.07, 0, false));
    this.bulb = toonUnique(STATUS_BULB.starting);
    this.bulb.emissive = new THREE.Color(STATUS_BULB.starting).multiplyScalar(0.6);
    this.bulbMesh = mesh(new THREE.SphereGeometry(0.075, 12, 10), this.bulb, 0, 1.2, 0, false);
    this.body.add(this.bulbMesh);

    const arm = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.55, 0.05);
      pivot.add(mesh(new THREE.CapsuleGeometry(0.055, 0.16, 4, 8), skin, 0, -0.12, 0));
      this.body.add(pivot);
      return pivot;
    };
    this.armL = arm(-0.3);
    this.armR = arm(0.3);
    for (const sx of [-1, 1]) this.body.add(mesh(new THREE.CapsuleGeometry(0.06, 0.1, 4, 8), skin, sx * 0.12, 0.2, 0.05));

    this.setName(name);
  }

  setName(name: string) {
    if (this.nameTag) {
      this.root.remove(this.nameTag);
      disposeSprite(this.nameTag);
    }
    this.nameTag = textSprite(name, { bg: '#2b2d42', color: '#fffaf3', size: 36, border: '#fffaf3' });
    this.nameTag.position.y = 1.55;
    this.root.add(this.nameTag);
  }

  setStatus(status: string, bounce: boolean) {
    this.status = status;
    this.bouncing = bounce;
    const c = STATUS_BULB[status] ?? '#adb5bd';
    this.bulb.color.set(c);
    this.bulb.emissive.set(c).multiplyScalar(0.7);
    const bubble =
      status === 'needs_input' ? '❗ needs you' : status === 'done' && bounce ? '✅ done!' : status === 'working' ? '⌨️ working' : status === 'offline' || status === 'exited' ? '💤' : '';
    if (bubble !== this.bubbleKey) {
      this.bubbleKey = bubble;
      if (this.bubble) {
        this.root.remove(this.bubble);
        disposeSprite(this.bubble);
        this.bubble = null;
      }
      if (bubble) {
        const hot = status === 'needs_input' || (status === 'done' && bounce);
        this.bubble = textSprite(bubble, { bg: hot ? (status === 'done' ? '#caffbf' : '#ffd6e0') : '#fffaf3', size: 38 });
        this.bubble.position.y = 1.95;
        this.root.add(this.bubble);
      }
    }
  }

  update(dt: number, t: number) {
    const working = this.status === 'working';
    // Pop-in when hired
    this.spawnT = Math.min(1, this.spawnT + dt * 2.5);
    const pop = this.spawnT < 1 ? 1 + Math.sin(this.spawnT * Math.PI) * 0.35 : 1;
    // Typing arms
    if (working) {
      this.armL.rotation.x = -1.2 + Math.sin(t * 22) * 0.25;
      this.armR.rotation.x = -1.2 + Math.sin(t * 22 + 1.7) * 0.25;
    } else {
      this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, this.bouncing ? -2.6 : -0.3, 0.2);
      this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, this.bouncing ? -2.6 : -0.3, 0.2);
    }
    // Jump up and down when done / waiting on a human
    if (this.bouncing) {
      this.bounceT += dt * 7;
      const s = Math.abs(Math.sin(this.bounceT));
      this.body.position.y = s * 0.55;
      const squash = s < 0.15 ? 1 - (0.15 - s) * 1.6 : 1;
      this.body.scale.set(pop * (2 - squash), pop * squash, pop * (2 - squash));
      this.body.rotation.y = Math.sin(this.bounceT * 0.5) * 0.3;
    } else {
      this.bounceT = 0;
      this.body.position.y = working ? Math.abs(Math.sin(t * 11)) * 0.02 : Math.sin(t * 2) * 0.015;
      this.body.scale.setScalar(pop);
      this.body.rotation.y = THREE.MathUtils.lerp(this.body.rotation.y, 0, 0.1);
    }
    // Blink
    this.blinkAt -= dt;
    const blinking = this.blinkAt < 0.12 && this.blinkAt > 0;
    if (this.blinkAt < 0) this.blinkAt = 2 + Math.random() * 4;
    for (const e of this.eyes) e.scale.y = blinking ? 0.1 : 1;
    const sleepy = this.status === 'offline' || this.status === 'exited';
    this.bulbMesh.scale.setScalar(this.status === 'needs_input' ? 1 + Math.abs(Math.sin(t * 8)) * 0.5 : 1);
    if (sleepy) this.body.rotation.z = Math.sin(t * 1.5) * 0.08;
    if (this.bubble) this.bubble.position.y = 1.95 + (this.bouncing ? this.body.position.y : 0) + Math.sin(t * 3) * 0.03;
    if (this.nameTag) this.nameTag.position.y = 1.55 + (this.bouncing ? this.body.position.y : 0);
  }

  dispose() {
    if (this.bubble) disposeSprite(this.bubble);
    if (this.nameTag) disposeSprite(this.nameTag);
  }
}
