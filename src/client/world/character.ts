import * as THREE from 'three';
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type Look } from '../../shared/avatar';
import { EMOTE_BY_ID, type Emote, type EmoteId } from '../../shared/emotes';
import type { CarriedIssue, WorkerAction, WorkerStatus, WorkerTask } from '../../shared/protocol';
import { isAsleep } from '../../shared/status';
import { HIPS } from '../player';
import { HeldCard } from './card';
import { cardSprite, disposeSprite, mesh, roundedBox, textSprite, toon, toonUnique } from './toon';

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

/** 0 → 1 → 0 over an emote `t` seconds into it: eased in quickly, out a little slower at the end. */
export function emoteEnvelope(t: number, seconds: number): number {
  const k = THREE.MathUtils.clamp(Math.min(t / 0.18, (seconds - t) / 0.3), 0, 1);
  return k * k * (3 - 2 * k);
}

/** Overshoots 1 a little on the way there (p = 0..1), for things that pop in. */
export function popCurve(p: number): number {
  const u = Math.min(1, p) - 1;
  return 1 + 2.7 * u * u * u + 1.7 * u * u;
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

/** Where the line under a person's name tag sits, just over their hair, and how far it lifts the name tag. */
const DOING_Y = 1.95;
const DOING_LIFT = 0.25;

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
  /** The smaller line under the name tag: what they have open, or where they are (see whereabouts). */
  private doing: THREE.Sprite | null = null;
  private doingText = '';
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
  private wantsMug = false;
  /** An issue card off the board, held out in front in both hands. */
  private card: HeldCard;
  pose: Pose = 'stand';
  private cig: THREE.Group;
  private ember: THREE.MeshToonMaterial;
  /** Seconds into a smoke break, or -1 when not on one. */
  private smokeT = -1;
  private wispIn = 0;
  /** Where smoke comes off: the lit end (a wisp) or the mouth, blowing it out along `dir`. */
  onSmoke: ((kind: 'wisp' | 'exhale', at: THREE.Vector3, dir: THREE.Vector3) => void) | null = null;
  /** The emote being played, how far into it (seconds), and its emoji over their head. */
  private emoting: { emote: Emote; t: number; pop: THREE.Sprite; size: THREE.Vector2 } | null = null;
  /** A thumb up and a pointing finger on the right hand, out only for those emotes. */
  private thumb: THREE.Mesh;
  private finger: THREE.Mesh;
  /** How much higher (meters) an emote's emoji pops up, to clear a chat bubble over their head. */
  emojiLift = 0;
  /** Hips this high above the feet while sitting (on the seat), or null on their feet. */
  private hips: number | null = null;
  /** The last seat's, so getting up eases back down from it. */
  private seatHips = HIPS;
  /** 0 standing … 1 sitting, eased between so sitting down and getting up take a moment. */
  private sitK = 0;
  /** Holding on to the ladder or a fire pole (see setGrip). */
  private grip: 'ladder' | 'pole' | null = null;

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
    // Between the hands when both arms are out in front (see update), its front to whoever they walk up to.
    const holder = new THREE.Group();
    holder.position.set(0, 0.8, 0.36);
    holder.rotation.x = -0.1;
    this.body.add(holder);
    this.card = new HeldCard(holder, 0.46);
    // Along the arm (the fist's -y) the finger points; the thumb sticks out of the front of the fist,
    // which is up once the arm is out in front.
    this.thumb = mesh(new THREE.CapsuleGeometry(0.035, 0.07, 4, 8).rotateX(Math.PI / 2), skin, 0, -0.38, 0.1, false);
    this.finger = mesh(new THREE.CapsuleGeometry(0.03, 0.09, 4, 8), skin, 0, -0.5, 0.02, false);
    for (const m of [this.thumb, this.finger]) {
      m.visible = false;
      this.armL.add(m);
    }

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
    this.root.add(this.label);
    this.placeLabels();
  }

  /** Puts a smaller line under the name tag, like "💻 in Pixel's terminal"; none (or '') takes it away. */
  setDoing(text: string | undefined) {
    text ??= '';
    if (text === this.doingText) return;
    this.doingText = text;
    if (this.doing) {
      this.root.remove(this.doing);
      disposeSprite(this.doing);
      this.doing = null;
    }
    if (text) {
      this.doing = textSprite(text, { bg: '#e9ecef', size: 26 });
      this.doing.position.y = DOING_Y;
      this.doing.visible = this.label?.visible ?? true;
      this.root.add(this.doing);
    }
    this.placeLabels();
  }

  /** Where a chat bubble goes: over the name tag, however high it sits. */
  get bubbleY(): number {
    return 2.45 + (this.doing ? DOING_LIFT : 0);
  }

  /** The name tag and the mic badge move up out of the way of the line under them. */
  private placeLabels() {
    const lift = this.doing ? DOING_LIFT : 0;
    if (this.label) this.label.position.y = 2.0 + lift;
    this.mic.position.y = 2.25 + lift;
  }

  /** How loud this person is talking right now (0 when silent); drives the mic badge and the mouth. */
  setVoiceLevel(level: number) {
    this.voiceLevel = level;
    this.speaking = level > SPEAKING;
    this.mic.visible = this.speaking;
  }

  showLabel(v: boolean) {
    if (this.label) this.label.visible = v;
    if (this.doing) this.doing.visible = v;
  }

  /** Reach out with the right hand, as if pressing or grabbing something in front of you. */
  reach() {
    this.reachT = 0;
  }

  /** A mug of coffee in the left hand, or not. */
  holdMug(on: boolean) {
    this.wantsMug = on;
    this.mug.visible = on && !this.card.held;
  }

  /** Carries an issue card in both hands, or puts it down (null). The mug waits while the hands are full. */
  carry(card: CarriedIssue | null | undefined) {
    this.card.set(card);
    this.holdMug(this.wantsMug);
  }

  /** Waves, gives a thumbs up, claps…: the gesture, with its emoji popping up over their head. */
  emote(id: EmoteId) {
    const emote = EMOTE_BY_ID.get(id);
    if (!emote) return;
    this.endEmote();
    const pop = textSprite(emote.emoji, { size: 72 });
    const size = new THREE.Vector2(pop.scale.x, pop.scale.y);
    pop.scale.set(0.001, 0.001, 1);
    this.root.add(pop);
    this.emoting = { emote, t: 0, pop, size };
    this.thumb.visible = id === 'thumbs';
    this.finger.visible = id === 'point';
  }

  /** The emote playing now, if any. */
  get emoteId(): EmoteId | null {
    return this.emoting?.emote.id ?? null;
  }

  private endEmote() {
    const e = this.emoting;
    if (!e) return;
    this.root.remove(e.pop);
    disposeSprite(e.pop);
    this.emoting = null;
    this.thumb.visible = this.finger.visible = false;
  }

  /**
   * Poses the emote over whatever the arms were doing (walking, sitting, a drag on a cigarette),
   * `k` of the way. The dance's bounce and steps only happen with both feet on the floor (`still`).
   */
  private emoteStep(dt: number, still: number) {
    const e = this.emoting!;
    e.t += dt;
    const { seconds, id } = e.emote;
    if (e.t >= seconds) return this.endEmote();
    const k = emoteEnvelope(e.t, seconds);
    const u = e.t;
    const pose = (arm: THREE.Object3D, x: number, z: number) => {
      arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, x, k);
      arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, z, k);
    };
    // Forward is +z, so the character's right arm is the one on -x (armL), as in reach.
    switch (id) {
      case 'wave':
        pose(this.armL, -0.35, -2.55 + Math.sin(u * 12) * 0.35);
        this.head.rotation.z = -0.1 * k;
        break;
      case 'thumbs':
        // Out in front, with a little pump that settles.
        pose(this.armL, -1.75 - Math.exp(-u * 3) * Math.sin(u * 14) * 0.25, 0.2);
        this.head.rotation.z = -0.08 * k;
        break;
      case 'clap': {
        // Both hands out in front, meeting in the middle about three times a second.
        const c = 0.5 - 0.5 * Math.cos(u * 19);
        pose(this.armL, -1.25, 0.3 + 0.42 * c);
        pose(this.armR, -1.25, -0.3 - 0.42 * c);
        this.body.position.y += Math.abs(Math.sin(u * 9.5)) * 0.02 * k * still;
        break;
      }
      case 'dance': {
        // Two beats a second: arms up by turns, a hop on every beat, hips swaying, a knee up.
        const b = u * Math.PI * 2;
        const s = Math.sin(b);
        pose(this.armL, -0.3, THREE.MathUtils.lerp(-0.35, -2.7, (s + 1) / 2));
        pose(this.armR, -0.3, THREE.MathUtils.lerp(0.35, 2.7, (1 - s) / 2));
        const m = k * still;
        this.body.position.y += Math.abs(Math.sin(b)) * 0.08 * m;
        this.body.rotation.z = s * 0.12 * m;
        this.body.rotation.y = Math.sin(b / 2) * 0.45 * m;
        this.legL.rotation.x = THREE.MathUtils.lerp(this.legL.rotation.x, -Math.max(0, s) * 0.7, m);
        this.legR.rotation.x = THREE.MathUtils.lerp(this.legR.rotation.x, -Math.max(0, -s) * 0.7, m);
        this.head.rotation.z = -s * 0.1 * k;
        break;
      }
      case 'point':
        // Arm straight out at whatever you face, with a jab to start.
        pose(this.armL, -1.6 - Math.exp(-u * 4) * Math.sin(u * 16) * 0.15, 0.05);
        break;
      case 'facepalm':
        // Hand to the face, head down and shaking slowly.
        pose(this.armL, -2.4, 0.62);
        this.body.rotation.x += 0.1 * k;
        this.head.rotation.x += 0.3 * k;
        this.head.rotation.y = Math.sin(u * 5) * 0.15 * k;
        break;
    }
    // The emoji pops in over their head, rises a little, wobbles, and fades at the end.
    const pop = popCurve(u / 0.3);
    e.pop.scale.set(e.size.x * pop, e.size.y * pop, 1);
    e.pop.position.y = 2.42 + this.emojiLift + Math.min(u, 1.5) * 0.12;
    e.pop.material.rotation = Math.sin(u * 7) * 0.12;
    e.pop.material.opacity = THREE.MathUtils.clamp((seconds - u) / 0.4, 0, 1);
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

  /**
   * On the ladder (hand over hand, as they climb) or a fire pole (hanging on with both arms up, legs
   * wrapped round it: it's on their left, the +x side), or neither.
   */
  setGrip(grip: 'ladder' | 'pole' | null) {
    this.grip = grip;
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
    if (this.card.held) {
      // Both arms out in front, hands on the card's edges: it doesn't swing while they walk.
      this.armL.rotation.set(-1.25, 0, 0.3);
      this.armR.rotation.set(-1.25, 0, -0.3);
    }
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
    this.body.rotation.z = 0;
    if (this.grip === 'ladder') {
      const c = Math.sin(this.walkPhase);
      this.armL.rotation.set(-2.55 + c * 0.35, 0, -0.12);
      this.armR.rotation.set(-2.55 - c * 0.35, 0, 0.12);
      this.legL.rotation.set(-0.55 - c * 0.45, 0, 0);
      this.legR.rotation.set(-0.55 + c * 0.45, 0, 0);
      this.body.rotation.x = -0.08;
    } else if (this.grip === 'pole') {
      this.armL.rotation.set(0, 0, 2.95);
      this.armR.rotation.set(0, 0, 2.45);
      this.legL.rotation.set(-0.35, 0, 0.25);
      this.legR.rotation.set(-1.15, 0, 0.35);
      this.body.rotation.z = -0.16;
    }
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
    this.head.rotation.y = this.head.rotation.z = 0;
    this.body.rotation.y = this.body.rotation.z = 0;
    if (this.emoting) this.emoteStep(dt, moving || airborne ? 0 : 1 - sit);
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

/**
 * What a worker's body is doing: resting, arms up for joy, arms crossed waiting on you, typing, or
 * acting out its latest tool call.
 */
type Act = 'rest' | 'up' | 'waiting' | 'type' | WorkerAction;

/** One way of holding itself, blended into the next over a moment (see Worker.update). */
interface Stance {
  /** Arms swung forward (x below 0 reaches toward the desk, -2.6 is straight up) and in toward the middle (z). The left arm is the one on -x. */
  armLx: number;
  armRx: number;
  armLz: number;
  armRz: number;
  /** 0..1: shoulders brought forward and in, for arms that wrap round the front (crossed, or holding its head). */
  reach: number;
  /** Shoulders lowered, so crossed arms sit on its belly and not under its eyes. */
  drop: number;
  /** Leaning toward the desk (+) or back (-), turned, tipped to the side, bobbing up. */
  lean: number;
  turn: number;
  roll: number;
  lift: number;
  /** How far its right foot is lifted, tapping, and both feet stretched out in front. */
  tap: number;
  kick: number;
  /** Eyes open (1) or narrowed, and looking up (+) or down (-). */
  lid: number;
  look: number;
}

const STANCE_KEYS = ['armLx', 'armRx', 'armLz', 'armRz', 'reach', 'drop', 'lean', 'turn', 'roll', 'lift', 'tap', 'kick', 'lid', 'look'] as const;

function stanceOf(act: Act, t: number, s: Stance): Stance {
  s.armLx = s.armRx = -0.3;
  s.armLz = s.armRz = s.reach = s.drop = s.lean = s.turn = s.roll = s.tap = s.kick = s.look = 0;
  s.lift = Math.sin(t * 2) * 0.015;
  s.lid = 1;
  switch (act) {
    case 'up':
      s.armLx = s.armRx = -2.6;
      s.lift = 0;
      break;
    case 'type':
      s.armLx = -1.2 + Math.sin(t * 22) * 0.25;
      s.armRx = -1.2 + Math.sin(t * 22 + 1.7) * 0.25;
      s.lift = Math.abs(Math.sin(t * 11)) * 0.02;
      break;
    case 'edit':
      // Hunched over the keys, typing flat out.
      s.armLx = -1.25 + Math.sin(t * 34) * 0.34;
      s.armRx = -1.25 + Math.sin(t * 34 + 1.9) * 0.34;
      s.lean = 0.16;
      s.lift = Math.abs(Math.sin(t * 17)) * 0.035;
      s.look = -0.02;
      break;
    case 'read':
      // The papers held up in front, eyes running down the page.
      s.armLx = s.armRx = -2.05;
      s.armLz = 0.3;
      s.armRz = -0.3;
      s.lean = -0.06;
      s.look = -0.01 - ((t * 0.9) % 1) * 0.03;
      break;
    case 'test':
      // Leaning back, hands behind its head, feet out: watching the bar fill.
      s.armLx = s.armRx = -3.3;
      s.armLz = 0.55;
      s.armRz = -0.55;
      s.lean = -0.32;
      s.roll = Math.sin(t * 1.3) * 0.04;
      s.kick = 0.08;
      s.look = 0.025;
      s.lift = 0;
      break;
    case 'web':
      // Scrolling with one hand, looking up at the globe.
      s.armLx = -1.2 + Math.sin(t * 9) * 0.15;
      s.armRx = -0.8;
      s.lean = -0.1;
      s.look = 0.03;
      break;
    case 'failing':
      // Head in its hands, shaking it slowly.
      s.armLx = s.armRx = -2;
      s.armLz = 0.45;
      s.armRz = -0.45;
      s.reach = 1;
      s.lean = 0.38;
      s.turn = Math.sin(t * 2.4) * 0.16;
      s.lid = 0.55;
      s.look = -0.035;
      s.lift = 0;
      break;
    case 'waiting': {
      // Arms crossed, hip cocked, tapping a foot.
      const tap = Math.max(0, Math.sin(t * 16));
      s.armLx = -1.05;
      s.armRx = -1.2;
      s.armLz = 1;
      s.armRz = -1;
      s.reach = 1;
      s.drop = 0.11;
      s.roll = 0.07;
      s.tap = tap;
      s.lift = tap * 0.012;
      s.lid = 0.6;
      break;
    }
  }
  return s;
}

/** How long a worker keeps acting something out before the next thing, so quick tool calls don't flicker. */
const ACT_MIN = 1.2;
/** Head in its hands lasts at least this long, so you catch it. */
const DESPAIR_MIN = 4;
/** Waiting on you: it jumps this long (seconds), then taps its foot with its arms crossed until the cycle comes round. */
const WAIT_HOPS = 2;
const WAIT_CYCLE = 4.6;
/** A full spin when it finishes, this long. */
const TWIRL_TIME = 0.9;

const ease = (x: number) => x * x * (3 - 2 * x);
/** 0 → 1 with a little overshoot, for props popping in. */
const popIn = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2);

/** A stack of papers held up to read, bound at the top; its top sheet flips over. The sheets face -z. */
function papers(): { group: THREE.Group; page: THREE.Group } {
  const group = new THREE.Group();
  const W = 0.34;
  const H = 0.44;
  const paper = toon('#fffaf3');
  const ink = toon('#8d99ae');
  ['#f1ece2', '#f7f3ea', '#fffaf3'].forEach((c, i) => {
    const sheet = mesh(new THREE.BoxGeometry(W, H, 0.008), toon(c), (i - 1) * 0.012, -H / 2 - i * 0.006, 0.02 - i * 0.012, false);
    sheet.rotation.z = (i - 1) * 0.04;
    group.add(sheet);
  });
  const lines = (on: THREE.Object3D, z: number) => {
    for (let i = 0; i < 6; i++) {
      const short = i % 3 === 2;
      on.add(mesh(new THREE.BoxGeometry(W * (short ? 0.45 : 0.72), 0.018, 0.004), ink, short ? -W * 0.135 : 0, -0.07 - i * 0.055, z, false));
    }
  };
  lines(group, -0.01);
  // The top sheet hangs from the binding, so it flips up over the top.
  const page = new THREE.Group();
  page.add(mesh(new THREE.BoxGeometry(W, H, 0.008), paper, 0, -H / 2, -0.016, false));
  lines(page, -0.022);
  group.add(page);
  group.add(mesh(new THREE.BoxGeometry(W * 0.5, 0.05, 0.05), toon('#adb5bd'), 0, 0, 0, false));
  return { group, page };
}

/** A progress bar that fills from left to right, its own +z toward whoever's watching. */
function progressBar(): { group: THREE.Group; fill: THREE.Mesh } {
  const group = new THREE.Group();
  group.add(mesh(roundedBox(0.92, 0.2, 0.06, 0.07), toon('#2b2d42'), 0, 0, 0, false));
  const geo = new THREE.BoxGeometry(0.8, 0.1, 0.04);
  geo.translate(0.4, 0, 0);
  const fill = mesh(geo, toon('#7cf29a', { emissive: '#1f7a3a' }), -0.4, 0, 0.02, false);
  group.add(fill);
  return { group, fill };
}

/** A little globe: blue sea, green blobs of land and a gold ring round its middle. */
function globe(): { group: THREE.Group; ball: THREE.Group; ring: THREE.Mesh } {
  const group = new THREE.Group();
  const ball = new THREE.Group();
  const r = 0.26;
  ball.add(mesh(new THREE.SphereGeometry(r, 20, 14), toon('#4cc9f0'), 0, 0, 0, false));
  const land = toon('#6fcf6a');
  for (const [lat, lon, size] of [
    [0.5, 0.2, 0.5],
    [0.1, 0.9, 0.4],
    [-0.4, 0.5, 0.45],
    [0.3, 2.4, 0.6],
    [-0.2, 3.3, 0.4],
    [0.6, 4.4, 0.45],
    [-0.5, 5.2, 0.35],
  ]) {
    const blob = mesh(new THREE.SphereGeometry(size * r, 10, 8), land, Math.cos(lat) * Math.sin(lon) * r * 0.86, Math.sin(lat) * r * 0.86, Math.cos(lat) * Math.cos(lon) * r * 0.86, false);
    blob.scale.set(1.2, 0.8, 1.2);
    ball.add(blob);
  }
  ball.rotation.z = 0.41;
  group.add(ball);
  const ring = mesh(new THREE.TorusGeometry(r * 1.35, 0.016, 6, 32), toon('#ffd166', { emissive: '#7a5b00' }), 0, 0, 0, false);
  ring.rotation.x = Math.PI / 2 - 0.2;
  group.add(ring);
  return { group, ball, ring };
}

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
  /** On its way out (sent home) or in (called to a meeting): it waddles along instead of standing. */
  walking = false;
  /** What its latest tool call was (see setAction), and what it's acting out right now. */
  private nextAction: WorkerAction | undefined;
  private action: WorkerAction | undefined;
  private actionT = 0;
  /** How much of each act is in its stance right now, blending from one to the next. */
  private acts = new Map<Act, number>();
  private stance = {} as Stance;
  private blend = {} as Stance;
  /** Seconds it has been waiting on you, for the jump / tap-its-foot cycle. */
  private waitT = 0;
  private turnY = 0;
  /** Seconds into its finishing spin, or -1. */
  private twirlT = -1;
  private flipT = 0;
  private papers: ReturnType<typeof papers>;
  private bar: ReturnType<typeof progressBar>;
  private globe: ReturnType<typeof globe>;
  /** Beside its laptop, where the bar and the globe float (see setPropSpot). */
  private spot = new THREE.Vector3(-1, 1.1, 1.3);
  /** How far through its stride it is, walking in. */
  private stride = 0;

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

    // What it acts out with: papers in its hands, and beside its laptop a progress bar or a globe.
    this.papers = papers();
    this.papers.group.position.set(0, 0.86, 0.4);
    this.papers.group.rotation.x = 0.35;
    this.body.add(this.papers.group);
    this.bar = progressBar();
    this.globe = globe();
    for (const prop of [this.papers.group, this.bar.group, this.globe.group]) prop.visible = false;
    this.root.add(this.bar.group, this.globe.group);

    this.setName(name);
  }

  /** Where the progress bar and the globe float, in its own space: beside its laptop, where the card over its head doesn't hide them. */
  setPropSpot(at: THREE.Vector3) {
    this.spot.copy(at);
  }

  /** What its latest tool call was, to act out while it's working. */
  setAction(action: WorkerAction | undefined) {
    this.nextAction = action;
  }

  /** Just finished: a quick spin and a hop. */
  celebrate() {
    this.twirlT = 0;
    this.cheer(1.2);
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
    this.twirlT = -1;
    for (const prop of [this.papers.group, this.bar.group, this.globe.group]) prop.visible = false;
    this.armL.position.set(-0.3, 0.55, 0.05);
    this.armR.position.set(0.3, 0.55, 0.05);
    this.feet.forEach((f, i) => f.position.set(i ? 0.12 : -0.12, 0.2, 0.05));
    for (const p of this.pupils) p.position.y = 0.7;
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

  /** `eye` is the camera, for the progress bar to face. */
  update(dt: number, t: number, eye?: THREE.Vector3) {
    if (this.leaving) return this.carry(this.leaving, dt, t);
    this.cheerT = Math.max(0, this.cheerT - dt);
    // Waiting on you: a couple of seconds of jumping, then arms crossed and a tapping foot, and round again.
    this.waitT = this.status === 'needs_input' ? this.waitT + dt : 0;
    const tapping = this.status === 'needs_input' && (this.held || this.waitT % WAIT_CYCLE >= WAIT_HOPS);
    // Jump up and down when done / waiting on a human (except while held or tapping), or cheering.
    if (this.bouncing || this.cheerT > 0) {
      const landAt = Math.ceil(this.bounceT / Math.PI) * Math.PI;
      this.bounceT += dt * 7;
      if ((this.held || tapping) && !this.cheerT && this.bounceT >= landAt) this.bounceT = 0;
    } else this.bounceT = 0;
    const hopping = this.bounceT > 0;
    // Pop-in when hired
    this.spawnT = Math.min(1, this.spawnT + dt * 2.5);
    const pop = this.spawnT < 1 ? 1 + Math.sin(this.spawnT * Math.PI) * 0.35 : 1;

    this.actionT += dt;
    if (this.nextAction !== this.action && this.actionT >= (this.action === 'failing' ? DESPAIR_MIN : ACT_MIN)) {
      this.action = this.nextAction;
      this.actionT = 0;
    }
    const act: Act =
      hopping || (this.bouncing && this.status === 'done') ? 'up'
      : this.status === 'needs_input' ? 'waiting'
      : this.status === 'working' ? (this.action ?? 'type')
      : 'rest';
    const s = this.pose(act, dt, t);

    this.armL.rotation.set(s.armLx, 0, s.armLz);
    this.armR.rotation.set(s.armRx, 0, s.armRz);
    this.armL.position.set(-0.3 + s.reach * 0.07, 0.55 - s.drop, 0.05 + s.reach * 0.12);
    this.armR.position.set(0.3 - s.reach * 0.07, 0.55 - s.drop + s.reach * 0.04, 0.05 + s.reach * 0.14);
    this.feet.forEach((f, i) => f.position.set(i ? 0.12 : -0.12, 0.2 + (i ? s.tap * 0.07 : 0), 0.05 + s.kick + (i ? s.tap * 0.03 : 0)));
    for (const p of this.pupils) p.position.y = 0.7 + s.look;
    this.body.rotation.x = s.lean;
    let twirl = 0;
    if (this.twirlT >= 0) {
      this.twirlT += dt;
      twirl = ease(Math.min(1, this.twirlT / TWIRL_TIME)) * Math.PI * 2;
      if (this.twirlT >= TWIRL_TIME) this.twirlT = -1;
    }
    if (hopping) {
      const h = Math.abs(Math.sin(this.bounceT));
      this.body.position.y = h * 0.55;
      const squash = h < 0.15 ? 1 - (0.15 - h) * 1.6 : 1;
      this.body.scale.set(pop * (2 - squash), pop * squash, pop * (2 - squash));
      this.turnY = Math.sin(this.bounceT * 0.5) * 0.3;
    } else {
      this.body.position.y = s.lift;
      this.body.scale.setScalar(pop);
      this.turnY += (s.turn - this.turnY) * Math.min(1, dt * 6);
    }
    this.body.rotation.y = this.turnY + twirl;
    this.body.rotation.z = isAsleep(this.status) ? Math.sin(t * 1.5) * 0.08 : s.roll;
    this.props(dt, t, eye);
    this.blink(dt, s.lid);
    this.bulbMesh.scale.setScalar(this.status === 'needs_input' ? 1 + Math.abs(Math.sin(t * 8)) * 0.5 : 1);
    if (this.bubble) this.bubble.position.y = (this.bubbleIsCard ? 1.74 : 1.95) + (hopping ? this.body.position.y : 0) + Math.sin(t * 3) * 0.03;
    if (this.nameTag) this.nameTag.position.y = 1.55 + (hopping ? this.body.position.y : 0);
    // Walking in to a meeting: the same waddle as on the way out, without the box.
    if (this.walking || this.stride) {
      this.stride = this.walking ? this.stride + dt * 9 : 0;
      const s = Math.sin(this.stride);
      this.feet.forEach((f, i) => {
        const step = i ? -s : s;
        f.position.z = 0.05 + step * 0.08;
        f.position.y = 0.2 + Math.max(0, step) * 0.05;
      });
      this.body.position.y += Math.abs(s) * 0.05;
      this.body.rotation.z = s * 0.1;
    }
  }

  /** Eases toward `act`'s stance, out of whatever it was doing before. */
  private pose(act: Act, dt: number, t: number): Stance {
    const k = Math.min(1, dt * 8);
    if (!this.acts.has(act)) this.acts.set(act, 0);
    const out = this.blend;
    for (const key of STANCE_KEYS) out[key] = 0;
    let total = 0;
    for (const [a, w0] of this.acts) {
      const w = w0 + ((a === act ? 1 : 0) - w0) * k;
      if (a !== act && w < 0.01) {
        this.acts.delete(a);
        continue;
      }
      this.acts.set(a, w);
      const s = stanceOf(a, t, this.stance);
      for (const key of STANCE_KEYS) out[key] += s[key] * w;
      total += w;
    }
    for (const key of STANCE_KEYS) out[key] /= total;
    return out;
  }

  /** The papers, the progress bar and the globe come and go with the act they belong to. */
  private props(dt: number, t: number, eye?: THREE.Vector3) {
    const show = (prop: THREE.Object3D, act: Act) => {
      const w = this.acts.get(act) ?? 0;
      prop.visible = w > 0.02;
      if (prop.visible) prop.scale.setScalar(Math.max(0.001, popIn(w)));
      return prop.visible;
    };
    if (show(this.papers.group, 'read')) {
      // A page every second or so, flipped up and over the top.
      this.flipT = (this.flipT + dt) % 1.1;
      const f = Math.min(1, this.flipT / 0.45);
      this.papers.page.rotation.x = -ease(f) * Math.PI * 1.1;
      this.papers.page.visible = f < 1;
    }
    if (show(this.bar.group, 'test')) {
      // Fills over a couple of seconds, holds full for a beat, starts over.
      const c = t % 3;
      this.bar.fill.scale.x = Math.max(0.02, ease(Math.min(1, c / 2.4)));
      this.bar.group.position.copy(this.spot).y += Math.sin(t * 2) * 0.02;
      if (eye) {
        this.root.worldToLocal(v1.copy(eye));
        this.bar.group.rotation.y = Math.atan2(v1.x - this.bar.group.position.x, v1.z - this.bar.group.position.z);
      }
    }
    if (show(this.globe.group, 'web')) {
      this.globe.group.position.copy(this.spot).y += Math.sin(t * 2) * 0.03;
      this.globe.ball.rotation.y = t * 2.2;
      this.globe.ring.rotation.z = t * 0.6;
    }
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

  /** `lid` narrows the eyes (1 = wide open) between blinks. */
  private blink(dt: number, lid = 1) {
    this.blinkAt -= dt;
    const blinking = this.blinkAt < 0.12 && this.blinkAt > 0;
    if (this.blinkAt < 0) this.blinkAt = 2 + Math.random() * 4;
    for (const e of this.eyes) e.scale.y = blinking ? 0.1 : lid;
  }

  dispose() {
    if (this.bubble) disposeSprite(this.bubble);
    if (this.nameTag) disposeSprite(this.nameTag);
  }
}
