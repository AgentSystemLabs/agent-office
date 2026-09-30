import * as THREE from 'three';
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type Look } from '../../../shared/avatar';
import { EMOTE_BY_ID, type EmoteId } from '../../../shared/emotes';
import type { CarriedIssue, Theme } from '../../../shared/protocol';
import type { BarGame } from '../../../shared/bargames';
import type { Drink } from '../../../shared/rooftop';
import { HIPS, type PersonRig } from './rig';
import { axeModel, dartModel } from '../../features/bargames/world';
import { OpenBook } from '../../features/bookshelf/book';
import { HeldCard } from '../../features/carrying/card';
import { UNDEAD_SKIN, santaHat, warlockHat } from '../costumes';
import { disposeSprite, mesh, textSprite, toon, toonUnique } from '../toon';
import { EXHALE_AT, REACH_TIME, SMOKE_CYCLE, dragCurve, reachCurve } from './curves';
import { cigarette, coffeeMug, drinkGlass, putDownGlass, undress } from './props';
import { styleHair } from './person-hair';
import { clubSwing, strike, swingStep, type Golf } from './person-golf';
import { propPosition, throwStep, type Oche } from './person-throw';
import { poseEmote, type Emoting } from './person-emote';

export type Pose = 'stand' | 'walk' | 'sit' | 'type';

/** Voice loudness (RMS) above which someone counts as speaking. */
const SPEAKING = 0.04;

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

/** Where the line under a person's name tag sits, just over their hair, and how far it lifts the name tag. */
const DOING_Y = 1.95;
const DOING_LIFT = 0.25;

/** A chibi cartoon person — used for every human in the office. Forward is +z. */
export class Person {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  /** Its moving parts, for what poses them from the other files here (a golf swing, a throw, an emote). */
  private rig: PersonRig;
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
  /** Held in the left hand, kept upright however the arm swings: a mug of coffee or a drink. */
  private mug = new THREE.Group();
  private cup: THREE.Group;
  private wantsMug = false;
  /** A drink from the rooftop bar, in the mug's place. */
  private glass: { id: string; group: THREE.Group } | null = null;
  /** An issue card off the board, held out in front in both hands. */
  private card: HeldCard;
  private cardHolder = new THREE.Group();
  /** A book off the bookshelf, open in both hands while they read (see read). */
  private book: OpenBook | null = null;
  private bookHolder = new THREE.Group();
  /** The basketball in both hands (the ball itself is the floor's, see features/basketball/world.ts), and seconds into a shot, or -1. */
  private ball = false;
  private shootT = -1;
  pose: Pose = 'stand';
  private cig: THREE.Group;
  private ember: THREE.MeshToonMaterial;
  /** Seconds into a smoke break, or -1 when not on one. */
  private smokeT = -1;
  private wispIn = 0;
  /** Where smoke comes off: the lit end (a wisp) or the mouth, blowing it out along `dir`. */
  onSmoke: ((kind: 'wisp' | 'exhale', at: THREE.Vector3, dir: THREE.Vector3) => void) | null = null;
  /** The emote being played, how far into it (seconds), and its emoji over their head. */
  private emoting: Emoting | null = null;
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
  /**
   * At the golf tee with a club (see setGolf): the club's swing, how far back it's been taken (and
   * `want`, where it's going), and a swing under way (`swingT` seconds in, from `top`), or -1.
   * `autoT` is a whole swing playing by itself (golfSwing), taken back to `power`.
   */
  private golf: Golf | null = null;
  /**
   * At the dart board's oche or the axe lane's line (see setThrowing): the dart or axe in hand, how
   * far it's been drawn back (`back`, easing to `want`), a throw under way (`throwT` seconds in, from
   * `top`) or taking it back all by itself first (`autoT`), and how long until the next is in hand.
   */
  private oche: Oche | null = null;
  /** Dressed up for a holiday (see setCostume): a warlock's hat and undead skin, or a Santa hat. */
  private costume: Theme | null = null;
  private hat: THREE.Object3D[] = [];
  /** A hand on someone's shoulder, marching them along (see holdOn). */
  private gripping = false;
  /** Something they're saying (see say), and for how many more seconds. */
  private speech: { sprite: THREE.Sprite; left: number } | null = null;

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
    const cup = (this.cup = coffeeMug(1.4));
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
    const holder = this.cardHolder;
    holder.position.set(0, 0.8, 0.36);
    holder.rotation.x = -0.1;
    this.body.add(holder);
    this.card = new HeldCard(holder, 0.46);
    // Held out at chest height, turned round and tipped up so the pages face their eyes, top edge
    // away from them, with the hands on its bottom corners.
    this.bookHolder.position.set(0, 1, 0.48);
    this.bookHolder.rotation.set(0.85, Math.PI, 0);
    this.bookHolder.scale.setScalar(1.25);
    this.body.add(this.bookHolder);
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

    this.rig = { root: this.root, body: this.body, head: this.head, armL: this.armL, armR: this.armR, legL: this.legL, legR: this.legR };
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
    this.hairMat.color.set(HAIR_COLORS[look.hair]);
    if (restyle) this.buildHair();
    this.dress();
  }

  /** Dresses up for a holiday: a crooked warlock's hat and undead skin for Halloween, a Santa hat for Christmas. Null takes it off. */
  setCostume(theme: Theme | null) {
    if (theme === this.costume) return;
    this.costume = theme;
    undress(this.hat);
    const hat = theme === 'halloween' ? warlockHat() : theme === 'christmas' ? santaHat() : null;
    if (hat) {
      hat.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.head.add(hat);
      this.hat.push(hat);
    }
    this.dress();
  }

  /** The skin and hair under the costume: hair that would poke through a hat's crown hides under it. */
  private dress() {
    this.skin.color.set(SKIN_TONES[this.look.skin]);
    if (this.costume === 'halloween') this.skin.color.lerp(UNDEAD_SKIN, 0.7);
    const style = HAIR_STYLES[this.look.style];
    this.hair.visible = !this.costume || !(style === 'Spiky' || style === 'Bun' || style === 'Curly');
  }

  /** Hair is a set of shapes on the head (see styleHair). */
  private buildHair() {
    styleHair(this.hair, this.hairMat, this.look.style);
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

  /** Puts something on them to stay: on their head (a helm), their body, or in their right hand or their left (a halberd). */
  wear(o: THREE.Object3D, on: 'head' | 'body' | 'hand' | 'offhand') {
    o.traverse((m) => ((m as THREE.Mesh).castShadow = true));
    // Forward is +z, so the character's right arm is the one on -x (see reach).
    (on === 'head' ? this.head : on === 'hand' ? this.armL : on === 'offhand' ? this.armR : this.body).add(o);
  }

  /** Keeps a hand out in front, on the shoulder of someone they're marching along (or lets go). */
  holdOn(on: boolean) {
    this.gripping = on;
  }

  /** Says something in a bubble over their head for `seconds` (the one before goes). */
  say(text: string, seconds = 3.5) {
    this.hush();
    this.speech = { sprite: textSprite(text, { bg: '#fffaf3', size: 34 }), left: seconds };
    this.speech.sprite.position.y = this.bubbleY;
    this.root.add(this.speech.sprite);
  }

  private hush() {
    if (!this.speech) return;
    this.root.remove(this.speech.sprite);
    disposeSprite(this.speech.sprite);
    this.speech = null;
  }

  /** A mug of coffee in the left hand, or not. */
  holdMug(on: boolean) {
    this.wantsMug = on;
    this.cup.visible = !this.glass;
    this.mug.visible = (on || !!this.glass) && !this.card.held && !this.book && !this.ball && this.oche?.game !== 'axe';
  }

  /** A drink from the rooftop bar in the left hand (in place of a mug), or none (null). */
  holdDrink(d: Drink | null) {
    if ((d?.id ?? null) === (this.glass?.id ?? null)) return;
    if (this.glass) {
      putDownGlass(this.glass.group);
      this.glass = null;
    }
    if (d) {
      const group = drinkGlass(d, 1.4);
      group.position.set(0.02, -0.08, 0.1);
      this.mug.add(group);
      this.glass = { id: d.id, group };
    }
    this.holdMug(this.wantsMug);
  }

  /** Carries an issue card in both hands, or puts it down (null). The mug waits while the hands are full. */
  carry(card: CarriedIssue | null | undefined) {
    this.card.set(card);
    this.holdMug(this.wantsMug);
  }

  /** Opens a book in both hands and reads it, turning the pages (or closes it). A card they carry waits. */
  read(on: boolean) {
    if (on === !!this.book) return;
    if (on) {
      this.book = new OpenBook();
      this.bookHolder.add(this.book.group);
    } else {
      this.bookHolder.remove(this.book!.group);
      this.book!.dispose();
      this.book = null;
    }
    this.cardHolder.visible = !on;
    this.holdMug(this.wantsMug);
  }

  /** Turns a page of the book they're reading now. */
  turnPage() {
    this.book?.turn();
  }

  /** Holds the basketball out in front in both hands, or not. */
  holdBall(on: boolean) {
    if (on === this.ball) return;
    this.ball = on;
    this.holdMug(this.wantsMug);
  }

  /** Shoots: both arms up over the head and after the ball. */
  shoot() {
    this.shootT = 0;
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

  /** Poses the emote over whatever the arms were doing (see poseEmote), and puts it away once it's over. */
  private emoteStep(dt: number, still: number) {
    if (!poseEmote(this.rig, this.emoting!, dt, still, this.emojiLift)) this.endEmote();
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

  /** At the golf tee with a club in both hands, over the ball (the ball in front of their feet, the hole off to their left), or not. */
  setGolf(on: boolean) {
    if (on === !!this.golf) return;
    if (!on) {
      const { swing } = this.golf!;
      this.body.remove(swing);
      swing.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.golf = null;
      // The swing turned the arms and legs every which way; standing, they only swing back and forth.
      for (const limb of [this.armL, this.armR, this.legL, this.legR]) limb.rotation.set(0, 0, 0);
      return;
    }
    const swing = clubSwing();
    this.body.add(swing);
    this.golf = { swing, back: 0, want: 0, top: 0, swingT: -1, autoT: -1, power: 0 };
  }

  /** Taking the club back, `k` of the way (0 at the ball, 1 as far as it goes), the harder to hit it. */
  golfBack(k: number) {
    const g = this.golf;
    if (g && g.swingT < 0) g.want = THREE.MathUtils.clamp(k, 0, 1);
  }

  /** Down through the ball from wherever it was taken back to, up into the finish, and back to the ball. */
  golfHit() {
    const g = this.golf;
    if (!g) return;
    strike(g);
  }

  /** A whole swing, all by itself: back `power` of the way over BACKSWING_TIME, then through (someone else's shot). */
  golfSwing(power: number) {
    const g = this.golf;
    if (!g) return;
    g.swingT = -1;
    g.autoT = 0;
    g.power = THREE.MathUtils.clamp(power, 0, 1);
  }

  /** The golf swing, over whatever the arms and legs were doing (see swingStep). */
  private golfStep(dt: number) {
    swingStep(this.rig, this.golf!, dt);
  }

  /** At the oche with a dart in the right hand, or the axe lane's line with an axe in both, or neither (null). */
  setThrowing(game: BarGame | null) {
    if (game === (this.oche?.game ?? null)) return;
    if (this.oche) {
      this.oche.prop.removeFromParent();
      this.oche.prop.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.oche = null;
      for (const limb of [this.armL, this.armR]) limb.rotation.set(0, 0, 0);
    }
    if (game) {
      const prop = game === 'darts' ? dartModel(this.shirt.color.getStyle()) : axeModel();
      this.body.add(prop);
      this.oche = { game, prop, back: 0, want: 0, top: 0, throwT: -1, autoT: -1, reload: 0, release: null };
    }
    this.holdMug(this.wantsMug);
  }

  /** Drawing the dart or axe back, `k` of the way (0 aiming, 1 as far as it goes). */
  tossBack(k: number) {
    const o = this.oche;
    if (o && o.throwT < 0 && o.autoT < 0) o.want = THREE.MathUtils.clamp(k, 0, 1);
  }

  /** Throws from wherever it's drawn back to. `release` is told where it left the hand (and how an axe was turned, see AXE), as it does. */
  toss(release: (from: THREE.Vector3, turn: number) => void) {
    const o = this.oche;
    if (!o) return;
    o.release = release;
    o.top = o.back;
    o.throwT = 0;
    o.autoT = -1;
  }

  /** A whole throw on its own, drawing back first (someone else's). */
  tossAuto(release: (from: THREE.Vector3, turn: number) => void) {
    const o = this.oche;
    if (!o) return release(this.root.localToWorld(new THREE.Vector3(0, 1.4, 0.3)), 0);
    // One still on its way out of the hand goes first.
    o.release?.(this.propWorld(new THREE.Vector3()), o.prop.rotation.x);
    o.release = release;
    o.throwT = -1;
    o.autoT = 0;
  }

  private propWorld(out: THREE.Vector3): THREE.Vector3 {
    return propPosition(this.rig, this.oche!, out);
  }

  /** The throwing arm (or arms), and the dart or axe in hand, over whatever they were doing (see throwStep). */
  private ocheStep(dt: number) {
    throwStep(this.rig, this.oche!, dt);
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
    if (this.book) {
      // Both arms out in front, hands under the book's bottom corners.
      this.armL.rotation.set(-1.5, 0, 0.32);
      this.armR.rotation.set(-1.5, 0, -0.32);
      this.book.update(dt);
    } else if (this.card.held || this.ball) {
      // Both arms out in front, hands on the card's edges (or either side of the ball): they don't swing while they walk.
      this.armL.rotation.set(-1.25, 0, 0.3);
      this.armR.rotation.set(-1.25, 0, -0.3);
    }
    if (this.shootT >= 0) {
      this.shootT += dt;
      const k = reachCurve(this.shootT / 0.5);
      for (const [arm, side] of [
        [this.armL, 1],
        [this.armR, -1],
      ] as const) {
        arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -2.75, k);
        arm.rotation.z = THREE.MathUtils.lerp(arm.rotation.z, side * 0.12, k);
      }
      if (this.shootT >= 0.5) this.shootT = -1;
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
    if (this.gripping && !this.book && !this.card.held && !this.ball) {
      // The right arm out and a little down, onto the shoulder of whoever's in front.
      this.armL.rotation.x = THREE.MathUtils.lerp(this.armL.rotation.x, -1.15, Math.min(1, dt * 10));
      this.armL.rotation.z = THREE.MathUtils.lerp(this.armL.rotation.z, 0.3, Math.min(1, dt * 10));
    }
    if (this.speech) {
      this.speech.left -= dt;
      if (this.speech.left <= 0) this.hush();
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
    // Reading, they look down into the book.
    this.head.rotation.x = -this.mouthOpen * 0.08 + (this.book ? 0.32 : 0);
    this.head.rotation.y = this.head.rotation.z = 0;
    this.body.rotation.y = this.body.rotation.z = 0;
    if (this.emoting) this.emoteStep(dt, moving || airborne ? 0 : 1 - sit);
    if (this.golf && !sit && !airborne) this.golfStep(dt);
    if (this.oche && !sit) this.ocheStep(dt);
  }
}
