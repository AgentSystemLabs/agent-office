import * as THREE from 'three';
import { EMOTE_BY_ID, type Emote, type EmoteId } from '../../shared/emotes';
import type { CarriedIssue, Theme } from '../../shared/protocol';
import type { Drink } from '../../shared/rooftop';
import { OpenBook } from '../features/bookshelf/book';
import { HeldCard } from '../features/carrying/card';
import { REACH_TIME, SMOKE_CYCLE, cigarette, coffeeMug, dragCurve, drinkGlass, emoteEnvelope, putDownGlass, reachCurve } from './character';
import { UNDEAD_SKIN, raggedCuff, warlockHand, witchFire } from './costumes';
import { mesh, toon, toonUnique } from './toon';
import { ballMesh } from '../features/basketball/world';

export interface HandsInput {
  yaw: number;
  pitch: number;
  walkPhase: number;
  walking: boolean;
  airborne: boolean;
  /** 0 (steady) to 1: one coffee too many. */
  jitter: number;
  /** Holding on to the ladder (hand over hand, in time with walkPhase) or a fire pole (both hands on it, off to the left). */
  grip?: 'ladder' | 'pole' | null;
}

/** Lifting the mug for a sip and lowering it again, in seconds. */
const SIP_TIME = 1.1;

interface Arm {
  group: THREE.Group;
  base: THREE.Vector3;
  baseRot: THREE.Euler;
  side: 1 | -1;
  /** The white cuff at the wrist. */
  cuff: THREE.Mesh;
  /** The cartoon hand: palm, thumb, and on the right hand the pointing finger. */
  mitten: THREE.Mesh[];
  finger: THREE.Mesh | null;
  /** A holiday hand in place of the mitten (see setCostume), and the witch-fire round it. */
  dressed: THREE.Group | null;
  fire: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> | null;
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
  private wantsMug = false;
  /** A drink from the rooftop bar, held where the mug goes (and in its place). */
  private glass: { id: string; group: THREE.Group } | null = null;
  /** An issue card off the board, held low in front of you in both hands. */
  private holder = new THREE.Group();
  private card: HeldCard;
  /** A book off the bookshelf, open in both hands while you read (see read). */
  private bookHolder = new THREE.Group();
  private book: OpenBook | null = null;
  /** 0 → 1 as the card (or the book) comes up into view and the hands close in on it. */
  private carryK = 0;
  /** The basketball, held low in front of you in both hands (see holdBall). */
  private ball: THREE.Mesh;
  private wantsBall = false;
  /** 0 → 1 as the ball comes up into your hands. */
  private ballK = 0;
  /** How far into winding up a shot (0–1), and seconds into the follow-through after one (or -1). */
  private wind = 0;
  private shootT = -1;
  /** Seconds into a sip (negative while it waits for the reach to finish), or null. */
  private sipT: number | null = null;
  private sway = new THREE.Vector2();
  private last: { yaw: number; pitch: number } | null = null;
  private air = 0;
  private walk = 0;
  private ladderK = 0;
  private poleK = 0;
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
  /** Your shirt and skin, under whatever costume the hands wear. */
  private shirt: string;
  private skinTone: string;
  /** An undead warlock's hands for Halloween, mittens for Christmas (see setCostume). */
  private costume: Theme | null = null;
  private rags = toonUnique('#24123a');

  constructor(shirt: string, skin: string) {
    this.shirt = shirt;
    this.skinTone = skin;
    this.sleeve = toonUnique(shirt);
    this.skin = toonUnique(skin);
    this.rags.side = THREE.DoubleSide;
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
    // Tipped back, so you look down onto its front.
    this.holder.rotation.x = -0.35;
    this.scene.add(this.holder);
    this.card = new HeldCard(this.holder, 0.24);
    // Tipped further back than a card, so you look down into its pages.
    this.bookHolder.rotation.x = -0.8;
    this.bookHolder.scale.setScalar(0.7);
    this.scene.add(this.bookHolder);
    this.ball = ballMesh();
    this.ball.visible = false;
    this.scene.add(this.ball);
  }

  /** The basketball in both hands, or not. The mug waits while your hands are full. */
  holdBall(on: boolean) {
    if (on === this.wantsBall) return;
    this.wantsBall = on;
    if (on) this.ballK = 0;
    this.holdMug(this.wantsMug);
  }

  /** Winding up a shot, 0 (not yet) to 1 (as hard as you throw): the ball comes down and in, ready to go. */
  windUp(k: number) {
    this.wind = k;
  }

  /** The shot: both hands up and out after the ball. */
  shoot() {
    this.shootT = 0;
    this.wind = 0;
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
    this.shirt = shirt;
    this.paint();
  }

  setSkin(skin: string) {
    this.skinTone = skin;
    this.paint();
  }

  /**
   * Dresses your hands up for a holiday: an undead warlock's for Halloween (grey-green and bony, with
   * black claws, ragged purple sleeves and green witch-fire round them), red sleeves and green mittens
   * for Christmas. Null gives you your own back.
   */
  setCostume(theme: Theme | null) {
    if (theme === this.costume) return;
    this.costume = theme;
    const warlock = theme === 'halloween';
    for (const arm of [this.right, this.left]) {
      if (arm.dressed) {
        arm.dressed.removeFromParent();
        arm.dressed.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        // The witch-fire's material is its own (its glow texture is shared, see glowTexture).
        arm.fire?.material.dispose();
        arm.dressed = arm.fire = null;
      }
      for (const m of arm.mitten) m.visible = !warlock && !(theme === 'christmas' && m === arm.finger);
      arm.cuff.visible = !warlock;
      // A mitten's fluffy cuff.
      arm.cuff.scale.set(theme === 'christmas' ? 1.3 : 1, theme === 'christmas' ? 1.3 : 1, theme === 'christmas' ? 1.9 : 1);
      if (!warlock) continue;
      const g = new THREE.Group();
      g.add(warlockHand(arm.side, this.skin), raggedCuff(this.rags));
      arm.fire = witchFire(10);
      g.add(arm.fire);
      arm.group.add(g);
      arm.dressed = g;
    }
    this.paint();
  }

  private paint() {
    const c = this.costume;
    this.sleeve.color.set(c === 'halloween' ? '#3b1d5a' : c === 'christmas' ? '#d62828' : this.shirt);
    this.skin.color.set(c === 'christmas' ? '#2e9e48' : this.skinTone);
    if (c === 'halloween') this.skin.color.lerp(UNDEAD_SKIN, 0.8);
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
    this.wantsMug = on;
    const full = this.card.held || !!this.book || this.wantsBall;
    this.mug.visible = on && !full && !this.glass;
    if (this.glass) this.glass.group.visible = !full;
  }

  /** A drink from the rooftop bar in the left hand, or none (null). */
  holdDrink(d: Drink | null) {
    if ((d?.id ?? null) === (this.glass?.id ?? null)) return;
    if (this.glass) {
      putDownGlass(this.glass.group);
      this.glass = null;
    }
    if (d) {
      const group = drinkGlass(d);
      group.position.set(0.09, -0.035, -0.03);
      group.quaternion.setFromEuler(this.left.baseRot).invert();
      this.left.group.add(group);
      this.glass = { id: d.id, group };
    }
    this.holdMug(this.wantsMug);
  }

  /** An issue card in both hands, or none (null). The mug waits while the hands are full. */
  carry(card: CarriedIssue | null) {
    const was = this.card.held;
    this.card.set(card);
    if (!was) this.carryK = 0;
    this.holdMug(this.wantsMug);
  }

  /** An open book in both hands, its pages turning, or none. A card you carry waits. */
  read(on: boolean) {
    if (on === !!this.book) return;
    if (on) {
      this.book = new OpenBook();
      this.bookHolder.add(this.book.group);
      this.carryK = 0;
    } else {
      this.bookHolder.remove(this.book!.group);
      this.book!.dispose();
      this.book = null;
    }
    this.holder.visible = !on;
    this.holdMug(this.wantsMug);
  }

  /** Turns a page of the book you're reading now. */
  turnPage() {
    this.book?.turn();
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
    const cuff = mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.045, 18).rotateX(Math.PI / 2), toon('#fffaf3'), 0, 0, 0.075, false);
    group.add(cuff);
    // Cartoon mitten: a chunky palm, a thumb on the inside, and a pointing finger on the right hand.
    const palm = mesh(new THREE.SphereGeometry(0.062, 18, 14), this.skin, 0, 0, 0, false);
    palm.scale.set(1, 0.78, 1.18);
    group.add(palm);
    const thumb = mesh(new THREE.CapsuleGeometry(0.02, 0.03, 4, 10).rotateX(Math.PI / 2), this.skin, -side * 0.05, 0.014, -0.02, false);
    thumb.rotation.y = side * 0.55;
    group.add(thumb);
    const finger = side === 1 ? mesh(new THREE.CapsuleGeometry(0.019, 0.05, 4, 10).rotateX(Math.PI / 2), this.skin, -0.016, 0.022, -0.085, false) : null;
    if (finger) group.add(finger);
    const base = new THREE.Vector3(side * 0.25, -0.185, -0.44);
    const baseRot = new THREE.Euler(0.2, side * 0.22, side * -0.25);
    group.position.copy(base);
    group.rotation.copy(baseRot);
    this.scene.add(group);
    return { group, base, baseRot, side, cuff, mitten: [palm, thumb, ...(finger ? [finger] : [])], finger, dressed: null, fire: null };
  }

  /** Witch-fire curling up round your fingers, and flickering. */
  private burn(t: number) {
    for (const arm of [this.right, this.left]) {
      const fire = arm.fire;
      if (!fire) continue;
      const pos = fire.geometry.attributes.position as THREE.BufferAttribute;
      const n = pos.count;
      for (let i = 0; i < n; i++) {
        const rise = (t * 0.45 + i / n) % 1;
        const a = t * 2.4 * arm.side + (i / n) * Math.PI * 2;
        const r = 0.055 + Math.sin(t * 3 + i * 1.7) * 0.012 - rise * 0.02;
        pos.setXYZ(i, Math.cos(a) * r, -0.015 + rise * 0.11, -0.05 + Math.sin(a) * r * 1.3);
      }
      pos.needsUpdate = true;
      fire.material.opacity = 0.6 + 0.25 * Math.sin(t * 9 + arm.side) + 0.1 * Math.sin(t * 23);
      fire.material.size = 0.028 + 0.006 * Math.sin(t * 5 + arm.side);
    }
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
    this.air += ((s.airborne && !s.grip ? 1 : 0) - this.air) * Math.min(1, dt * 8);
    this.ladderK += ((s.grip === 'ladder' ? 1 : 0) - this.ladderK) * Math.min(1, dt * 10);
    this.poleK += ((s.grip === 'pole' ? 1 : 0) - this.poleK) * Math.min(1, dt * 10);
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
    this.carryK += ((this.card.held || this.book ? 1 : 0) - this.carryK) * Math.min(1, dt * 7);
    const carry = this.carryK;
    this.ballK += ((this.wantsBall ? 1 : 0) - this.ballK) * Math.min(1, dt * 9);
    const held = this.ballK;
    let throwK = 0;
    if (this.shootT >= 0) {
      this.shootT += dt;
      throwK = reachCurve(this.shootT / 0.45);
      if (this.shootT >= 0.45) this.shootT = -1;
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
      p.x += shake * Math.sin(t * 97 + side);
      p.y += shake * Math.sin(t * 131 + side * 2);
      arm.group.rotation.copy(arm.baseRot);
      arm.group.rotation.x += this.air * 0.2;
      // Holding the card: both hands in on its bottom corners, palms turned toward it, so the title shows.
      p.x -= side * 0.08 * carry;
      p.z -= 0.03 * carry;
      arm.group.rotation.z += side * 0.35 * carry;
      // Holding the ball: a hand on either side of it, palms in, lower and closer as the shot winds up.
      p.x -= side * 0.1 * held;
      p.y -= (0.09 + 0.06 * this.wind) * held;
      p.z += (-0.08 + 0.05 * this.wind) * held;
      arm.group.rotation.z += side * 0.7 * held;
      // The follow-through: up and out after it.
      p.x -= side * 0.06 * throwK;
      p.y += 0.22 * throwK;
      p.z -= 0.16 * throwK;
      arm.group.rotation.x += 0.9 * throwK;
    }
    // Up the ladder, hand over hand; round a pole, both hands on it, one over the other.
    const climb = Math.sin(s.walkPhase);
    for (const [arm, side] of [
      [this.right, 1],
      [this.left, -1],
    ] as const) {
      const g = arm.group;
      const lk = this.ladderK;
      g.position.x += (side * 0.19 - g.position.x) * lk;
      g.position.y += (0.06 + side * climb * 0.09 - g.position.y) * lk;
      g.position.z += (-0.46 - g.position.z) * lk;
      g.rotation.x += -0.55 * lk;
      // The pole's a little to your left: the left hand on it, the right reaching across to it from
      // below, its sleeve angled away so it doesn't cross your view.
      const pk = this.poleK;
      g.position.x += ((side > 0 ? 0.03 : -0.18) - g.position.x) * pk;
      g.position.y += ((side > 0 ? 0.02 : -0.04) - g.position.y) * pk;
      g.position.z += ((side > 0 ? -0.56 : -0.47) - g.position.z) * pk;
      g.rotation.x += (side > 0 ? 0.45 : 0.25) * pk;
      g.rotation.y += (side > 0 ? 0.55 : 0) * pk;
    }
    // The ball rides between them, coming up from below as you pick it up.
    this.ball.visible = this.wantsBall && held > 0.02;
    this.ball.position.set(this.sway.x + step * 0.008, this.sway.y + breathe + bounce + this.air * 0.05 - 0.28 - 0.06 * this.wind - 0.3 * (1 - held), -0.54 + 0.05 * this.wind);
    // The card rides along with the hands, coming up from below as you take it; so does the book.
    this.holder.position.set(this.sway.x + step * 0.008, this.sway.y + breathe + bounce + this.air * 0.05 - 0.115 - 0.3 * (1 - carry), -0.5);
    if (this.book) {
      this.bookHolder.position.set(this.holder.position.x, this.holder.position.y, -0.48);
      this.book.update(dt);
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
    if (this.costume === 'halloween') this.burn(t);
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
