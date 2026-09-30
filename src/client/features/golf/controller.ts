import * as THREE from 'three';
import { BALCONY, GOLF_HOLE } from '../../../shared/layout';
import { isTyping, type PlayerController } from '../../player';
import { $, h, modalOpen } from '../../ui/dom';
import { IMPACT, type Person } from '../../world/character';
import { AIM_MAX, LOFT_MAX, LOFT_MIN, PIN_DISTANCE, PIN_YAW, TEE_BALL, stance, type Flight, type Shot } from './world';

// Teeing off from the balcony (E at the tee): you stand over the ball with a club, and the camera
// goes down low behind the ball, looking down the line at the hole. The mouse (or A and D) aims, W
// and S pick the loft, and holding Space takes the club back while the power meter runs up and down:
// let go to hit it. The camera follows the ball out to wherever it stops, then comes back to the tee
// for the next one. E puts the club back in the bag.

/** The power meter runs from nothing to full in this long, then back down again. */
const METER = 1.3;
/** A and D (and the arrow keys) turn the aim this fast, in radians a second; W and S change the loft. */
const TURN = 0.3;
const LOFT_RATE = THREE.MathUtils.degToRad(25);
export const LOFT_START = THREE.MathUtils.degToRad(42);
/** How far off line (radians) and off the power meter (a fraction of it) a shot can come off the club, either way in all. */
const MISHIT_AIM = THREE.MathUtils.degToRad(1.4);
const MISHIT_POWER = 0.025;
/** The office takes one shot from you at a time, this far apart (in ms): no swinging again before then. */
const BETWEEN_SHOTS = 1000;
/** Let go with the meter under this and it's a practice swing: nothing happens. */
const MIN_POWER = 0.03;
/** How long the camera stays over a ball that's stopped, before going back to the tee. */
const LINGER = 2.6;
const LINGER_HOLED = 4.5;
/** Following the ball: this far behind it, and this far up. */
const CHASE_BACK = 4.5;
const CHASE_UP = 1.7;
/** Behind the ball on the tee: back along the line (as far as the wall lets it), out to the right (away from the golfer), and up. */
const TEE_BACK = 1.38;
const TEE_SIDE = 0.35;
const TEE_UP = 1;
/** As high as it goes, to see the green from far up the building: under the balcony above. */
const TEE_UP_MAX = 6;

export type GolfStage = 'aim' | 'charge' | 'swing' | 'watch';

export interface GolfHooks {
  /** You're at the tee with a club, or put it back: everyone else sees it. */
  holding(on: boolean): void;
  /** You hit it: off it goes, here and for everyone else. */
  hit(shot: Shot): void;
  /** Your ball on its way, or where it stopped (`still` seconds ago), for the camera to follow. */
  ball(): { at: THREE.Vector3; flight: Flight; still: number } | null;
  /** How far down the street is from this floor (see streetBelow). */
  street(): number;
  /** The club's back in the bag. */
  done(): void;
}

const lookAt = new THREE.Matrix4();
const want = new THREE.Vector3();
const target = new THREE.Vector3();
const turn = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Wraps an angle into -π..π. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Golfer {
  private stage: GolfStage | null = null;
  /** Which way you aim (a heading: 0 is south, +z, and it turns toward +x), and the loft you've picked. */
  aim = PIN_YAW;
  loft = LOFT_START;
  /** When the power meter started running (performance.now()), while Space is held down. */
  private chargeAt = 0;
  /** How hard the last shot was hit, marked on the meter. */
  private lastPower = -1;
  /** The shot on its way down through the ball, and how far into the downswing that is. */
  private shot: Shot | null = null;
  private swingT = 0;
  /** When the last one was hit (performance.now()). */
  private hitAt = -Infinity;
  /** The camera's own place and turn, while it's the golf camera. */
  private camPos = new THREE.Vector3();
  private camQuat = new THREE.Quaternion();
  private readonly panel: HTMLElement;
  /** Covers the meter from the right, down to how hard you'd hit it. */
  private readonly rest: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly info: HTMLElement;
  private shown = '';

  constructor(
    private readonly player: PlayerController,
    private readonly me: Person,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly hooks: GolfHooks,
  ) {
    this.rest = h('span.golf-rest');
    this.mark = h('span.golf-last');
    this.info = h('div.golf-info');
    this.panel = h('div.golf.panel.hidden', { id: 'golf', 'aria-label': 'Golf' }, h('div.golf-title', {}, `⛳ Hole 1 · ${Math.round(PIN_DISTANCE)} m · Par 1`), h('div.golf-meter', {}, this.rest, this.mark), this.info);
    $('hud').append(this.panel);
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    // Tabbed away mid-swing: the key never comes back up, so it's no swing.
    window.addEventListener('blur', () => this.stage === 'charge' && this.putBack());
  }

  get active(): boolean {
    return this.stage !== null;
  }

  /** What you're doing at the tee, or null when you're not at it. */
  get doing(): GolfStage | null {
    return this.stage;
  }

  /** How far the power meter is up right now (0–1), while Space is held. */
  get power(): number {
    if (this.stage !== 'charge') return 0;
    const p = ((performance.now() - this.chargeAt) / 1000 / METER) % 2;
    return p > 1 ? 2 - p : p;
  }

  /** Up to the tee with a club, over the ball, aiming at the pin. */
  start(): void {
    if (this.stage) return;
    this.stage = 'aim';
    this.aim = PIN_YAW;
    const p = this.player;
    p.rig = () => this.stand();
    this.stand();
    p.camYaw = this.aim + Math.PI;
    this.camPos.copy(this.camera.position);
    this.camQuat.copy(this.camera.quaternion);
    this.me.setGolf(true);
    this.hooks.holding(true);
    this.panel.classList.remove('hidden');
    this.shown = '';
  }

  /** The club back in the bag, and you back on your feet beside the tee. */
  stop(): void {
    if (!this.stage) return;
    this.stage = null;
    this.shot = null;
    const p = this.player;
    p.rig = null;
    p.lookPitch = -0.08;
    // In third person, the camera goes round behind you, looking along the balcony.
    if (p.view === 'third') p.camYaw = p.facing + Math.PI;
    this.me.setGolf(false);
    this.hooks.holding(false);
    this.panel.classList.add('hidden');
    this.hooks.done();
  }

  /** Every frame, once the player has moved: aiming, the swing, and the camera. */
  update(dt: number): void {
    if (!this.stage) return;
    const p = this.player;
    if (this.stage === 'aim' || this.stage === 'charge') {
      // The mouse turns your view as it always does (camYaw); that's the aim, along with the keys.
      let aim = wrap(p.camYaw - Math.PI);
      if (p.holding('KeyA', 'ArrowLeft')) aim += TURN * dt;
      if (p.holding('KeyD', 'ArrowRight')) aim -= TURN * dt;
      this.aim = THREE.MathUtils.clamp(aim, -AIM_MAX, AIM_MAX);
      if (p.holding('KeyW', 'ArrowUp')) this.loft = Math.min(LOFT_MAX, this.loft + LOFT_RATE * dt);
      if (p.holding('KeyS', 'ArrowDown')) this.loft = Math.max(LOFT_MIN, this.loft - LOFT_RATE * dt);
    }
    p.camYaw = this.aim + Math.PI;
    if (this.stage === 'charge') this.me.golfBack(this.power);
    if (this.stage === 'swing') {
      this.swingT += dt;
      if (this.swingT >= IMPACT && this.shot) {
        this.hitAt = performance.now();
        this.hooks.hit(this.shot);
        this.shot = null;
        this.stage = 'watch';
      }
    }
    if (this.stage === 'watch') {
      const b = this.hooks.ball();
      if (!b || b.still > (b.flight.holed ? LINGER_HOLED : LINGER)) this.backToTee();
    }
    this.placeCamera(dt);
    this.render();
  }

  /** Where you stand for the aim you've got: square to the line, over the ball. */
  private stand() {
    const s = stance(this.aim);
    const p = this.player;
    p.pos.set(s.x, 0, s.z);
    p.facing = s.facing;
    p.moving = false;
  }

  private key(e: KeyboardEvent, down: boolean) {
    if (!this.stage || e.code !== 'Space') return;
    if (down && (e.repeat || isTyping(e) || modalOpen() || e.metaKey || e.ctrlKey || e.altKey)) return;
    if (down && this.stage === 'aim') {
      if (performance.now() - this.hitAt < BETWEEN_SHOTS) return;
      this.stage = 'charge';
      this.chargeAt = performance.now();
    } else if (down && this.stage === 'watch') this.backToTee();
    else if (!down && this.stage === 'charge') {
      const power = this.power;
      if (power < MIN_POWER) return this.putBack();
      // Nobody hits it exactly the same way twice: a touch off line, a touch more or less.
      const yaw = this.aim + (Math.random() - 0.5) * MISHIT_AIM;
      this.shot = { yaw, loft: this.loft, power: Math.min(1, power * (1 + (Math.random() - 0.5) * MISHIT_POWER)) };
      this.lastPower = power;
      this.stage = 'swing';
      this.swingT = 0;
      this.me.golfHit();
    }
  }

  /** A swing you didn't follow through: the club goes back down to the ball. */
  private putBack() {
    this.stage = 'aim';
    this.me.golfBack(0);
  }

  private backToTee() {
    this.stage = 'aim';
    this.player.camYaw = this.aim + Math.PI;
  }

  private placeCamera(dt: number) {
    const b = this.stage === 'watch' ? this.hooks.ball() : null;
    // A ball that never left the balcony is watched from the tee.
    const chase = b && b.flight.lie !== 'deck' ? b : null;
    if (chase && chase.still >= 0 && Number.isFinite(chase.flight.fromPin)) {
      // Down: back from it and the pin, from the tee's side, far enough to see both (and the whole flag, when it's in).
      const street = this.hooks.street();
      const holed = chase.flight.holed;
      target.set((chase.at.x + GOLF_HOLE.x) / 2, street + (holed ? 1.4 : 0.4), (chase.at.z + GOLF_HOLE.z) / 2);
      const back = Math.min(22, (holed ? 8 : 5) + chase.flight.fromPin * 0.9);
      want.set(target.x - Math.sin(PIN_YAW) * back, street + 2 + back * 0.35, target.z - Math.cos(PIN_YAW) * back);
    } else if (chase) {
      // Behind the ball the way it was hit, a little above it, looking at it.
      const { yaw } = chase.flight.shot;
      want.set(chase.at.x - Math.sin(yaw) * CHASE_BACK, chase.at.y + CHASE_UP, chase.at.z - Math.cos(yaw) * CHASE_BACK);
      target.copy(chase.at);
    } else {
      // Down low behind the ball on the tee, looking down the line: the ball at the bottom of the view, the hole further up it.
      // From higher up the building, higher: enough to see down past the balcony's edge to the green.
      const sin = Math.sin(this.aim);
      const cos = Math.cos(this.aim);
      const depth = TEE_BALL.y - this.hooks.street();
      const edge = (BALCONY.maxZ - TEE_BALL.z + cos * TEE_BACK) / Math.max(0.3, cos);
      const reach = PIN_DISTANCE + TEE_BACK;
      const up = THREE.MathUtils.clamp((edge * depth) / (reach - edge) + 0.5, TEE_UP, TEE_UP_MAX);
      want.set(TEE_BALL.x - sin * TEE_BACK - cos * TEE_SIDE, TEE_BALL.y + up, TEE_BALL.z - cos * TEE_BACK + sin * TEE_SIDE);
      const down = (y: number, d: number) => Math.atan2(y - want.y, d);
      // Between the two, a little nearer the hole: the panel at the top covers more than the hint at the bottom.
      const pitch = THREE.MathUtils.lerp(down(TEE_BALL.y, TEE_BACK), down(this.hooks.street(), PIN_DISTANCE + TEE_BACK), 0.56);
      target.set(want.x + sin * Math.cos(pitch), want.y + Math.sin(pitch), want.z + cos * Math.cos(pitch));
    }
    const k = 1 - Math.exp(-dt * (chase ? 5 : 7));
    this.camPos.lerp(want, k);
    lookAt.lookAt(this.camPos, target, UP);
    turn.setFromRotationMatrix(lookAt);
    this.camQuat.slerp(turn, k);
    this.camera.position.copy(this.camPos);
    this.camera.quaternion.copy(this.camQuat);
  }

  /** The power meter, the loft, and where you're aiming. */
  private render() {
    const power = this.stage === 'charge' ? this.power : this.stage === 'aim' ? 0 : this.lastPower;
    this.rest.style.width = `${(1 - Math.max(0, power)) * 100}%`;
    this.mark.style.left = `${this.lastPower * 100}%`;
    this.mark.classList.toggle('hidden', this.lastPower < 0);
    const off = THREE.MathUtils.radToDeg(this.aim - PIN_YAW);
    const aim = Math.abs(off) < 0.5 ? 'at the pin' : `${Math.abs(off).toFixed(0)}° ${off > 0 ? 'left' : 'right'}`;
    const text = `Loft ${THREE.MathUtils.radToDeg(this.loft).toFixed(0)}° · Aim ${aim}`;
    if (text === this.shown) return;
    this.shown = text;
    this.info.textContent = text;
  }
}
