import * as THREE from 'three';
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type Look } from '../../shared/avatar';
import type { WorkerStatus, WorkerTask } from '../../shared/protocol';
import { isAsleep } from '../../shared/status';
import { HIPS } from '../player';
import { cardSprite, disposeSprite, mesh, textSprite, toon, toonUnique } from './toon';

export type Pose = 'stand' | 'walk' | 'sit' | 'type';

/** Voice loudness (RMS) above which someone counts as speaking. */
const SPEAKING = 0.04;

/** How long reaching out to use something takes, in seconds. */
export const REACH_TIME = 0.42;

/** 0 → 1 → 0 over a reach (p = 0..1): a quick jab out, a beat at full stretch, an easy return. */
export function reachCurve(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.28) return 1 - (1 - p / 0.28) ** 3;
  if (p < 0.5) return 1;
  const u = (p - 0.5) / 0.5;
  return 1 - u * u * (3 - 2 * u);
}

/** A full mug of coffee standing on y = 0, with its handle on the -x side. */
export function coffeeMug(scale = 1): THREE.Group {
  const mug = new THREE.Group();
  const r = 0.05 * scale;
  const height = 0.1 * scale;
  const china = toon('#fffaf3');
  mug.add(mesh(new THREE.CylinderGeometry(r, r * 0.88, height, 16), china, 0, height / 2, 0, false));
  mug.add(mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, height * 0.04, 16), toon('#6f4518'), 0, height, 0, false));
  mug.add(mesh(new THREE.TorusGeometry(height * 0.28, r * 0.2, 6, 12), china, -r, height / 2, 0, false));
  return mug;
}

/** On a smoke break, one drag every this many seconds. */
export const SMOKE_CYCLE = 6;
/** When, in a smoke cycle, the smoke is blown out. */
export const EXHALE_AT = 2.5;

/** How far the cigarette hand is up at the mouth (0..1), `c` seconds into a smoke cycle. */
export function dragCurve(c: number): number {
  const ease = (x: number) => x * x * (3 - 2 * x);
  if (c < 0.7) return ease(c / 0.7);
  if (c < 1.7) return 1;
  if (c < 2.3) return 1 - ease((c - 1.7) / 0.6);
  return 0;
}

/** A cigarette, lit end toward +z, and the material of its glowing tip. */
export function cigarette(): { group: THREE.Group; ember: THREE.MeshToonMaterial } {
  const group = new THREE.Group();
  group.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 8).rotateX(Math.PI / 2), toon('#fffaf3'), 0, 0, 0.01, false));
  group.add(mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.045, 8).rotateX(Math.PI / 2), toon('#e9a03b'), 0, 0, -0.07, false));
  const ember = toonUnique('#ff6a2b');
  ember.emissive = new THREE.Color('#ff3b00');
  ember.emissiveIntensity = 0.3;
  group.add(mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.02, 8).rotateX(Math.PI / 2), ember, 0, 0, 0.078, false));
  return { group, ember };
}

/**
 * An open cardboard box with someone's desk things in it: a plant, a photo, a mug, a rubber duck and
 * some papers. It stands on y = 0 with its front toward +z.
 */
export function boxOfStuff(): THREE.Group {
  const g = new THREE.Group();
  const W = 0.52;
  const H = 0.26;
  const D = 0.3;
  const T = 0.02;
  const card = toon('#c8955c');
  g.add(mesh(new THREE.BoxGeometry(W, T, D), card, 0, T / 2, 0));
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.BoxGeometry(W, H, T), card, 0, H / 2, s * (D - T) / 2));
    g.add(mesh(new THREE.BoxGeometry(T, H, D - 2 * T), card, s * (W - T) / 2, H / 2, 0));
  }
  // Full to the brim.
  g.add(mesh(new THREE.BoxGeometry(W - 2 * T, 0.01, D - 2 * T), toon('#8b6a47'), 0, H * 0.7, 0, false));
  // Flaps: the front one hangs down over the front, the side ones stick up and out.
  const flapMat = toon('#b5824c');
  const front = new THREE.Group();
  front.position.set(0, H, D / 2);
  front.rotation.x = 1.2;
  front.add(mesh(new THREE.BoxGeometry(W, T, 0.14), flapMat, 0, 0, 0.07));
  g.add(front);
  for (const s of [-1, 1]) {
    const flap = new THREE.Group();
    flap.position.set((s * W) / 2, H, 0);
    flap.rotation.z = s * 0.95;
    flap.add(mesh(new THREE.BoxGeometry(0.13, T, D), flapMat, s * 0.065, 0, 0));
    g.add(flap);
  }

  // A potted plant in the back corner.
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.11, 10), toon('#e76f51'), -0.15, H - 0.03, -0.04, false));
  for (const [x, y, z, r, c] of [
    [-0.15, 0.1, -0.04, 0.07, '#5fb760'],
    [-0.2, 0.07, 0.0, 0.05, '#3f8f45'],
    [-0.11, 0.15, -0.07, 0.05, '#6fcf6a'],
  ] as const)
    g.add(mesh(new THREE.SphereGeometry(r, 10, 8), toon(c), x, H + y, z, false));
  // Papers sticking up at the back.
  for (const [x, rz] of [
    [-0.01, 0.16],
    [0.05, -0.1],
  ]) {
    const paper = mesh(new THREE.BoxGeometry(0.17, 0.22, 0.004), toon('#fffaf3'), x, H - 0.01, -0.1, false);
    paper.rotation.set(-0.1, 0, rz);
    g.add(paper);
  }
  // A framed photo, leaning back.
  const photo = new THREE.Group();
  photo.add(mesh(new THREE.BoxGeometry(0.16, 0.13, 0.02), toon('#2b2d42'), 0, 0, 0, false));
  photo.add(mesh(new THREE.BoxGeometry(0.12, 0.09, 0.005), toon('#8ecae6'), 0, 0, 0.011, false));
  photo.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), toon('#ffd166'), 0.03, 0.02, 0.014, false));
  photo.position.set(0.1, H + 0.04, -0.05);
  photo.rotation.set(-0.3, 0, -0.12);
  g.add(photo);
  // A mug and the rubber duck, up front.
  const mug = coffeeMug(0.9);
  mug.position.set(0.0, H - 0.07, 0.07);
  g.add(mug);
  const duck = new THREE.Group();
  const duckBody = mesh(new THREE.SphereGeometry(0.05, 10, 8), toon('#ffd166'), 0, 0, 0, false);
  duckBody.scale.y = 0.8;
  duck.add(duckBody);
  duck.add(mesh(new THREE.SphereGeometry(0.032, 10, 8), toon('#ffd166'), 0, 0.055, 0.02, false));
  duck.add(mesh(new THREE.ConeGeometry(0.014, 0.03, 6).rotateX(Math.PI / 2), toon('#f4a261'), 0, 0.05, 0.06, false));
  duck.position.set(0.16, H + 0.01, 0.06);
  duck.rotation.y = -0.4;
  g.add(duck);
  return g;
}

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

/** A chibi cartoon person — used for every human in the office. Forward is +z. */
export class Person {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private legL: THREE.Object3D;
  private legR: THREE.Object3D;
  private armL: THREE.Object3D;
  private armR: THREE.Object3D;
  private shirt: THREE.MeshToonMaterial;
  private skin: THREE.MeshToonMaterial;
  private hairMat: THREE.MeshToonMaterial;
  private hair = new THREE.Group();
  private look: Look;
  private label: THREE.Sprite | null = null;
  private speaking = false;
  private mic: THREE.Mesh;
  private head: THREE.Group;
  private smile: THREE.Mesh;
  private mouth: THREE.Mesh;
  private voiceLevel = 0;
  /** 0 = lips together, 1 = wide open. Follows the voice's loudness. */
  private mouthOpen = 0;
  /** Keep the talking mouth up through the short gaps between words. */
  private talkUntil = 0;
  private walkPhase = 0;
  private reachT = -1;
  /** Held in the left hand, kept upright however the arm swings. */
  private mug = new THREE.Group();
  pose: Pose = 'stand';
  private cig: THREE.Group;
  private ember: THREE.MeshToonMaterial;
  /** Seconds into a smoke break, or -1 when not on one. */
  private smokeT = -1;
  private wispIn = 0;
  /** Where smoke comes off: the lit end (a wisp) or the mouth, blowing it out along `dir`. */
  onSmoke: ((kind: 'wisp' | 'exhale', at: THREE.Vector3, dir: THREE.Vector3) => void) | null = null;
  /** Hips this high above the feet while sitting (on the seat), or null on their feet. */
  private hips: number | null = null;
  /** The last seat's, so getting up eases back down from it. */
  private seatHips = HIPS;
  /** 0 standing … 1 sitting, eased between so sitting down and getting up take a moment. */
  private sitK = 0;

  constructor(
    private name: string,
    color: string,
    look: Look,
  ) {
    this.look = { ...look };
    this.shirt = toonUnique(color);
    const skin = (this.skin = toonUnique(SKIN_TONES[look.skin]));
    this.hairMat = toonUnique(HAIR_COLORS[look.hair]);
    this.hairMat.side = THREE.DoubleSide;
    const pants = toon('#3d405b');
    const ink = toon('#1d1d1d');

    this.root.add(this.body);
    // Torso
    this.body.add(mesh(new THREE.CapsuleGeometry(0.26, 0.28, 6, 12), this.shirt, 0, 0.72, 0));
    // Head
    const head = (this.head = new THREE.Group());
    head.position.y = 1.32;
    head.add(mesh(new THREE.SphereGeometry(0.34, 20, 16), skin));
    head.add(this.hair);
    this.buildHair();
    for (const sx of [-1, 1]) {
      head.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), ink, sx * 0.12, 0.02, 0.3, false));
      head.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), toon('#ff9f9f'), sx * 0.2, -0.08, 0.27, false));
    }
    const smile = (this.smile = mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12, Math.PI), ink, 0, -0.08, 0.32, false));
    smile.rotation.z = Math.PI;
    head.add(smile);
    // Talking mouth: a flattened ball pressed into the face, scaled open and shut with the voice.
    this.mouth = mesh(new THREE.SphereGeometry(1, 16, 12), toon('#7a2635'), 0, -0.1, 0.295, false);
    const tongue = mesh(new THREE.SphereGeometry(1, 12, 10), toon('#ff8fa3'), 0, -0.5, 0, false);
    tongue.scale.set(0.6, 0.45, 1.15);
    this.mouth.add(tongue);
    this.mouth.visible = false;
    head.add(this.mouth);
    this.body.add(head);

    const limb = (len: number, r: number, mat: THREE.Material, x: number, y: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.add(mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat, 0, -len / 2 - r / 2, 0));
      this.body.add(pivot);
      return pivot;
    };
    this.legL = limb(0.22, 0.1, pants, -0.12, HIPS);
    this.legR = limb(0.22, 0.1, pants, 0.12, HIPS);
    this.armL = limb(0.24, 0.08, this.shirt, -0.33, 0.9);
    this.armR = limb(0.24, 0.08, this.shirt, 0.33, 0.9);
    for (const arm of [this.armL, this.armR]) arm.add(mesh(new THREE.SphereGeometry(0.085, 12, 10), skin, 0, -0.38, 0));
    // Forward is +z, so the character's left arm is the one on +x. The handle faces the hand.
    const cup = coffeeMug(1.4);
    cup.position.set(0.02, -0.08, 0.1);
    cup.rotation.y = -Math.PI / 2;
    this.mug.add(cup);
    this.mug.position.set(0, -0.38, 0);
    this.mug.visible = false;
    this.armR.add(this.mug);
    // For smoke breaks: a cigarette sticking out of the right fist (the arm on -x, see reach), lit end
    // pointing down at your side and up and away when it's at your mouth.
    const cig = cigarette();
    this.cig = cig.group;
    this.ember = cig.ember;
    const along = new THREE.Vector3(0, -0.9, -0.44).normalize();
    this.cig.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along);
    this.cig.position.set(0, -0.38, 0).addScaledVector(along, 0.07);
    this.cig.visible = false;
    this.armL.add(this.cig);

    // Little mic icon that pops up while speaking
    this.mic = mesh(new THREE.SphereGeometry(0.09, 10, 8), toon('#7cf29a', { emissive: '#2a9d4b' }), 0, 2.25, 0, false);
    this.mic.visible = false;
    this.root.add(this.mic);

    this.setLabel(name, false);
  }

  setColor(color: string) {
    this.shirt.color.set(color);
  }

  get skinColor(): string {
    return SKIN_TONES[this.look.skin];
  }

  setLook(look: Look) {
    const restyle = look.style !== this.look.style;
    this.look = { ...look };
    this.skin.color.set(SKIN_TONES[look.skin]);
    this.hairMat.color.set(HAIR_COLORS[look.hair]);
    if (restyle) this.buildHair();
  }

  /** Hair is a set of shapes on the head (whose center is 0,0,0; the face looks down +z). */
  private buildHair() {
    for (const o of this.hair.children) (o as THREE.Mesh).geometry.dispose();
    this.hair.clear();
    const m = this.hairMat;
    const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => {
      const part = mesh(geo, m, x, y, z);
      part.rotation.set(rx, 0, rz);
      this.hair.add(part);
      return part;
    };
    const cap = () => add(new THREE.SphereGeometry(0.355, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), 0, 0.02, -0.02, -0.25);
    switch (HAIR_STYLES[this.look.style]) {
      case 'Short':
        cap();
        break;
      case 'Long': {
        cap();
        // A curtain down the back, open at the front so the face shows.
        // Around the head from ear to ear the back way, leaving the face open (phi = π/2 is the face).
        const back = add(new THREE.SphereGeometry(0.37, 20, 14, Math.PI * 0.93, Math.PI * 1.14, Math.PI * 0.3, Math.PI * 0.5), 0, -0.06, -0.03);
        back.scale.set(1.02, 1.35, 1);
        break;
      }
      case 'Bun':
        cap();
        add(new THREE.SphereGeometry(0.14, 14, 12), 0, 0.3, -0.2);
        break;
      case 'Spiky':
        cap();
        // Two rows of spikes fanned out over the crown.
        for (const [row, n, z, tilt] of [
          [0, 5, 0.08, 0.35],
          [1, 4, -0.12, -0.3],
        ] as const) {
          for (let i = 0; i < n; i++) {
            const a = -0.85 + (i / (n - 1)) * 1.7;
            const spike = add(new THREE.ConeGeometry(0.1, 0.3, 8), Math.sin(a) * 0.24, 0.33 - Math.abs(a) * 0.08 - row * 0.02, z);
            spike.rotation.set(tilt, 0, -a * 0.9);
          }
        }
        break;
      case 'Curly': {
        // Little puffs spread over the top and back of the head, leaving the face clear.
        const n = 70;
        for (let i = 0; i < n; i++) {
          const y = 1 - (i / (n - 1)) * 2;
          const r = Math.sqrt(1 - y * y);
          const th = i * 2.39996;
          const px = Math.cos(th) * r;
          const pz = Math.sin(th) * r;
          if (y < -0.15 || (pz > 0.35 && y < 0.55)) continue;
          add(new THREE.SphereGeometry(0.1, 8, 6), px * 0.36, y * 0.36 + 0.04, pz * 0.36 - 0.02);
        }
        break;
      }
      case 'Ponytail': {
        cap();
        add(new THREE.SphereGeometry(0.075, 10, 8), 0, 0.12, -0.34);
        const tail = add(new THREE.CapsuleGeometry(0.085, 0.3, 6, 10), 0, -0.1, -0.42, 0.35);
        tail.scale.set(1, 1, 0.8);
        break;
      }
      case 'Bald':
        break;
    }
    this.hair.traverse((o) => ((o as THREE.Mesh).castShadow = true));
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

  /** How loud this person is talking right now (0 when silent); drives the mic badge and the mouth. */
  setVoiceLevel(level: number) {
    this.voiceLevel = level;
    this.speaking = level > SPEAKING;
    this.mic.visible = this.speaking;
  }

  showLabel(v: boolean) {
    if (this.label) this.label.visible = v;
  }

  /** Reach out with the right hand, as if pressing or grabbing something in front of you. */
  reach() {
    this.reachT = 0;
  }

  /** A mug of coffee in the left hand, or not. */
  holdMug(on: boolean) {
    this.mug.visible = on;
  }

  get smoking(): boolean {
    return this.smokeT >= 0;
  }

  /** Lights a cigarette (or puts it out): it's in their right hand, and they take a drag every few seconds. */
  setSmoking(on: boolean) {
    if (on === this.smoking) return;
    this.smokeT = on ? 0 : -1;
    this.cig.visible = on;
  }

  /** A drag: up to the mouth, hold while the tip glows, back down, then blow the smoke out. */
  private smokeStep(dt: number, walking: boolean, airborne: boolean) {
    const prev = this.smokeT % SMOKE_CYCLE;
    this.smokeT += dt;
    const c = this.smokeT % SMOKE_CYCLE;
    const k = walking || airborne ? 0 : dragCurve(c);
    if (!airborne) {
      this.armL.rotation.x = THREE.MathUtils.lerp(-0.9, -2.6, k);
      this.armL.rotation.z = THREE.MathUtils.lerp(0.15, 0.6, k);
    }
    const glow = k > 0.9 ? 1.4 : 0.3;
    this.ember.emissiveIntensity += (glow - this.ember.emissiveIntensity) * Math.min(1, dt * 6);
    if (!this.onSmoke) return;
    this.wispIn -= dt;
    const exhale = prev < EXHALE_AT && c >= EXHALE_AT;
    if (this.wispIn > 0 && !exhale) return;
    this.root.updateMatrixWorld(true);
    if (this.wispIn <= 0) {
      this.wispIn = 0.16 + Math.random() * 0.12;
      this.onSmoke('wisp', this.cig.localToWorld(v1.set(0, 0, 0.09)), v2.set(0, 1, 0));
    }
    if (exhale) {
      const dir = v2.set(0, 0.25, 1).applyQuaternion(this.root.quaternion).normalize();
      this.onSmoke('exhale', this.head.localToWorld(v1.set(0, -0.1, 0.36)), dir);
    }
  }

  /** Sits down with the hips `hips` above the feet, on a couch or a chair, or gets up (null). */
  sit(hips: number | null) {
    this.hips = hips;
    if (hips !== null) this.seatHips = hips;
    this.pose = hips === null ? 'stand' : 'sit';
  }

  /** `pace` speeds up the walk cycle for someone walking faster than usual. */
  update(dt: number, t: number, moving: boolean, airborne: boolean, pace = 1) {
    const target = moving ? 1 : 0;
    this.walkPhase += dt * 11 * target * pace;
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
    this.sitK += ((this.hips === null ? 0 : 1) - this.sitK) * Math.min(1, dt * 10);
    const sit = this.sitK > 0.001 ? this.sitK : 0;
    if (sit) {
      // Legs out over the edge of the seat, hands in the lap (a cigarette still comes up for a drag).
      for (const leg of [this.legL, this.legR]) leg.rotation.x = THREE.MathUtils.lerp(leg.rotation.x, -1.35, sit);
      for (const arm of [this.armL, this.armR]) arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -0.55, sit);
    }
    if (this.smokeT >= 0) this.smokeStep(dt, moving, airborne);
    let reach = 0;
    if (this.reachT >= 0) {
      this.reachT += dt;
      reach = reachCurve(this.reachT / REACH_TIME);
      // Forward is +z, so the character's right arm is the one on -x.
      this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, -1.65, reach);
      this.armL.rotation.z = THREE.MathUtils.lerp(this.armL.rotation.z, 0.22, reach);
      if (this.reachT >= REACH_TIME) this.reachT = -1;
    }
    // Lean into the reach a little.
    this.body.rotation.x = reach * 0.12;
    if (this.mug.visible) this.mug.quaternion.copy(this.armR.quaternion).invert();
    this.body.position.y = moving && !airborne ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : 0;
    // Down onto (or up onto) the seat: the hips go where it puts them.
    if (sit) this.body.position.y = THREE.MathUtils.lerp(this.body.position.y, this.seatHips - HIPS, sit);
    if (this.speaking) this.mic.scale.setScalar(1 + Math.sin(t * 14) * 0.2);

    // Lip flap: pop open fast on each syllable, close a little slower.
    const want = THREE.MathUtils.clamp((this.voiceLevel - 0.02) / 0.12, 0, 1);
    this.mouthOpen += (want - this.mouthOpen) * Math.min(1, dt * (want > this.mouthOpen ? 35 : 15));
    if (this.voiceLevel > SPEAKING * 0.75) this.talkUntil = t + 0.4;
    const talking = t < this.talkUntil;
    this.smile.visible = !talking;
    this.mouth.visible = talking;
    if (talking) this.mouth.scale.set(0.07 * (1 - this.mouthOpen * 0.2), 0.01 + this.mouthOpen * 0.045, 0.05);
    this.head.rotation.x = -this.mouthOpen * 0.08;
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

/** Status pill on a worker's task card: [text, background, text color]. */
const TASK_CHIP: Record<string, [string, string, string]> = {
  starting: ['⏳ STARTING', STATUS_BULB.starting, '#2b2d42'],
  idle: ['💬 READY', STATUS_BULB.idle, '#2b2d42'],
  working: ['⌨️ WORKING', STATUS_BULB.working, '#2b2d42'],
  needs_input: ['❗ NEEDS YOU', STATUS_BULB.needs_input, '#ffffff'],
  done: ['✅ DONE', STATUS_BULB.done, '#2b2d42'],
  exited: ['💤 ASLEEP', STATUS_BULB.exited, '#ffffff'],
  offline: ['💤 ASLEEP', STATUS_BULB.offline, '#ffffff'],
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
  /** The bubble is a task card: it hangs from its tail instead of floating. */
  private bubbleIsCard = false;
  private task: WorkerTask | undefined;
  private nameTag: THREE.Sprite | null = null;
  private eyes: THREE.Mesh[] = [];
  private blinkAt = Math.random() * 4;
  status: WorkerStatus = 'starting';
  bouncing = false;
  /** You're close enough to read its card: it lands the hop it's in and stands still until you walk away. */
  held = false;
  private bounceT = 0;
  private spawnT = 0;
  /** Seconds left jumping for joy (its pull request just merged). */
  private cheerT = 0;
  private pupils: THREE.Mesh[] = [];
  private feet: THREE.Mesh[] = [];
  /** Sent home: the box of its things in its arms, and how far into its waddle it is. */
  private leaving: { box: THREE.Group; boxT: number; stride: number } | null = null;
  /** Sent home and on its way out: it waddles along instead of standing. */
  walking = false;

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
      this.pupils.push(pupil);
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
    for (const sx of [-1, 1]) {
      const foot = mesh(new THREE.CapsuleGeometry(0.06, 0.1, 4, 8), skin, sx * 0.12, 0.2, 0.05);
      this.body.add(foot);
      this.feet.push(foot);
    }

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

  setStatus(status: WorkerStatus, bounce: boolean) {
    this.status = status;
    this.bouncing = bounce;
    const c = STATUS_BULB[status] ?? '#adb5bd';
    this.bulb.color.set(c);
    this.bulb.emissive.set(c).multiplyScalar(0.7);
    this.drawBubble();
  }

  /** Jumps for joy, arms up, for a few seconds. */
  cheer(seconds = 3) {
    this.cheerT = seconds;
  }

  /** What it's working on, shown on a card over its head in place of the status bubble. */
  setTask(task: WorkerTask | undefined) {
    this.task = task;
    this.drawBubble();
  }

  /** Sent home: its light goes out, its face falls, and its things pop into a box in its arms. `farewell` goes over its head. */
  leave(farewell: string) {
    if (this.leaving) return;
    this.bouncing = false;
    this.cheerT = 0;
    this.bounceT = 0;
    this.bulb.color.set(STATUS_BULB.exited);
    this.bulb.emissive.set('#000000');
    if (this.bubble) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
    }
    this.bubbleKey = 'leaving';
    this.bubbleIsCard = false;
    this.bubble = textSprite(farewell, { bg: '#e9ecef', size: 34 });
    this.root.add(this.bubble);
    // Looking down, brows up in the middle.
    for (const p of this.pupils) p.position.y -= 0.035;
    for (const sx of [-1, 1]) {
      const brow = mesh(new THREE.CapsuleGeometry(0.014, 0.08, 4, 6), toon('#1d1d1d'), sx * 0.11, 0.83, 0.228, false);
      brow.rotation.z = Math.PI / 2 - sx * 0.4;
      this.body.add(brow);
    }
    // Hugged to its belly, the arms round the sides.
    const box = boxOfStuff();
    box.position.set(0, 0.22, 0.33);
    box.scale.setScalar(0.001);
    this.body.add(box);
    this.leaving = { box, boxT: 0, stride: 0 };
  }

  private drawBubble() {
    if (this.leaving) return;
    const { status, bouncing: bounce, task } = this;
    const hot = status === 'needs_input' || (status === 'done' && bounce);
    const bg = hot ? (status === 'done' ? '#caffbf' : '#ffd6e0') : status === 'working' ? '#ffec99' : '#fffaf3';
    const bubble =
      status === 'needs_input' ? '❗ needs you' : status === 'done' && bounce ? '✅ done!' : status === 'working' ? '⌨️ working' : isAsleep(status) ? '💤' : '';
    const key = task ? `${status}|${bounce}|${task.name}|${task.summary}` : bubble;
    if (key === this.bubbleKey) return;
    this.bubbleKey = key;
    if (this.bubble) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
      this.bubble = null;
    }
    this.bubbleIsCard = !!task;
    if (task) {
      const [text, chipBg, color] = TASK_CHIP[status] ?? TASK_CHIP.idle;
      this.bubble = cardSprite({ chip: { text, bg: chipBg, color }, title: task.name, body: task.summary, bg: isAsleep(status) ? '#e9ecef' : bg });
    } else if (bubble) this.bubble = textSprite(bubble, { bg, size: 38 });
    if (this.bubble) this.root.add(this.bubble);
  }

  update(dt: number, t: number) {
    if (this.leaving) return this.carry(this.leaving, dt, t);
    this.cheerT = Math.max(0, this.cheerT - dt);
    // Jump up and down when done / waiting on a human (except while held), or cheering.
    if (this.bouncing || this.cheerT > 0) {
      const landAt = Math.ceil(this.bounceT / Math.PI) * Math.PI;
      this.bounceT += dt * 7;
      if (this.held && !this.cheerT && this.bounceT >= landAt) this.bounceT = 0;
    } else this.bounceT = 0;
    const hopping = this.bounceT > 0;
    const working = this.status === 'working' && !hopping;
    // Pop-in when hired
    this.spawnT = Math.min(1, this.spawnT + dt * 2.5);
    const pop = this.spawnT < 1 ? 1 + Math.sin(this.spawnT * Math.PI) * 0.35 : 1;
    // Typing arms
    if (working) {
      this.armL.rotation.x = -1.2 + Math.sin(t * 22) * 0.25;
      this.armR.rotation.x = -1.2 + Math.sin(t * 22 + 1.7) * 0.25;
    } else {
      this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, hopping || this.bouncing ? -2.6 : -0.3, 0.2);
      this.armR.rotation.x = THREE.MathUtils.lerp(this.armR.rotation.x, hopping || this.bouncing ? -2.6 : -0.3, 0.2);
    }
    if (hopping) {
      const s = Math.abs(Math.sin(this.bounceT));
      this.body.position.y = s * 0.55;
      const squash = s < 0.15 ? 1 - (0.15 - s) * 1.6 : 1;
      this.body.scale.set(pop * (2 - squash), pop * squash, pop * (2 - squash));
      this.body.rotation.y = Math.sin(this.bounceT * 0.5) * 0.3;
    } else {
      this.body.position.y = working ? Math.abs(Math.sin(t * 11)) * 0.02 : Math.sin(t * 2) * 0.015;
      this.body.scale.setScalar(pop);
      this.body.rotation.y = THREE.MathUtils.lerp(this.body.rotation.y, 0, 0.1);
    }
    this.blink(dt);
    this.bulbMesh.scale.setScalar(this.status === 'needs_input' ? 1 + Math.abs(Math.sin(t * 8)) * 0.5 : 1);
    if (isAsleep(this.status)) this.body.rotation.z = Math.sin(t * 1.5) * 0.08;
    if (this.bubble) this.bubble.position.y = (this.bubbleIsCard ? 1.74 : 1.95) + (hopping ? this.body.position.y : 0) + Math.sin(t * 3) * 0.03;
    if (this.nameTag) this.nameTag.position.y = 1.55 + (hopping ? this.body.position.y : 0);
  }

  /** Sent home: head hung, the box in its arms, waddling along while `walking`. */
  private carry(l: NonNullable<Worker['leaving']>, dt: number, t: number) {
    // The box pops in, overshooting a little.
    l.boxT = Math.min(1, l.boxT + dt * 2.5);
    const u = l.boxT - 1;
    l.box.scale.setScalar(Math.max(0.001, 1 + 2.7 * u * u * u + 1.7 * u * u));
    const k = Math.min(1, dt * 10);
    this.armL.rotation.x += (-1 - this.armL.rotation.x) * k;
    this.armR.rotation.x += (-1 - this.armR.rotation.x) * k;
    this.armL.rotation.z += (0.12 - this.armL.rotation.z) * k;
    this.armR.rotation.z += (-0.12 - this.armR.rotation.z) * k;
    if (this.walking) l.stride += dt * 9;
    const s = this.walking ? Math.sin(l.stride) : 0;
    this.feet.forEach((f, i) => {
      const step = i ? -s : s;
      f.position.z = 0.05 + step * 0.08;
      f.position.y = 0.2 + Math.max(0, step) * 0.05;
    });
    this.body.position.y = Math.abs(s) * 0.05;
    this.body.rotation.z = s * 0.1;
    this.body.rotation.x += (0.15 - this.body.rotation.x) * Math.min(1, dt * 4);
    this.body.rotation.y += -this.body.rotation.y * k;
    this.body.scale.setScalar(1);
    this.bulbMesh.scale.setScalar(1);
    this.blink(dt);
    if (this.bubble) this.bubble.position.y = 1.95 + Math.sin(t * 3) * 0.03;
    if (this.nameTag) this.nameTag.position.y = 1.55;
  }

  private blink(dt: number) {
    this.blinkAt -= dt;
    const blinking = this.blinkAt < 0.12 && this.blinkAt > 0;
    if (this.blinkAt < 0) this.blinkAt = 2 + Math.random() * 4;
    for (const e of this.eyes) e.scale.y = blinking ? 0.1 : 1;
  }

  dispose() {
    if (this.bubble) disposeSprite(this.bubble);
    if (this.nameTag) disposeSprite(this.nameTag);
  }
}
