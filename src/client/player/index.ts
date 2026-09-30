import * as THREE from 'three';
import { FLOOR, STREET_Y, WALL_T, type SeatPlace } from '../../shared/layout';
import type { ViewMode } from '../state';
import type { Collider } from '../world/types';
import { HIPS } from '../world/character/rig';
import { PlayerInput, isTyping } from './pointer';
import { HEIGHT, STEP, blockerAt, ceilingAt, groundAt, stepTo } from './collide';
import { EYE_HEIGHT, aimCamera, shakeCamera, type Room } from './camera';
import { Effects } from './effects';

// You: walking, running, jumping and sitting, bumping into things and climbing stairs, and the camera
// that follows. The keys and the mouse are PlayerInput's (pointer.ts).

const WALK = 4.6;
const RUN = 7.5;
const JUMP_V = 6.4;
const GRAVITY = 18;

// What the rest of the client takes from here, wherever it lives now: the eye height (camera.ts), the
// ground under someone (collide.ts) and isTyping (pointer.ts).
export { EYE_HEIGHT, groundAt, isTyping };
/** Keys that get you up off a seat: walking away, or jumping up. */
const GET_UP = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];

export class PlayerController extends PlayerInput {
  pos = new THREE.Vector3();
  vy = 0;
  facing = Math.PI;
  moving = false;
  grounded = true;
  /** Walk cycle phase, shared by the camera bob and the first-person hands. */
  walkPhase = 0;
  private bob = 0;
  /** Eased out after a step up or down, so the camera glides up stairs instead of popping. */
  stepOffset = 0;
  /**
   * What's going on with you (a coffee's buzz and the jitters, a few drinks): how fast you walk and
   * how high you jump, how hard the view trembles and how drunk you are (see effects.ts).
   */
  readonly effects = new Effects();
  /** How far below the floor you're on the street is: further down the higher your floor (see streetBelow). */
  street = STREET_Y;
  /**
   * The room the camera stays in while you're in it, and how thick its outside walls are: the
   * office's, unless the building's on a map of its own. `enclosed`: walled and roofed all round,
   * with no street or garage under it to see from.
   */
  room: Room = { ...FLOOR, wall: WALL_T, enclosed: false };
  /** How many rows the floor's back office is built out (see WING): the camera keeps inside it too. */
  wing = 0;
  private jitterT = 0;
  /** Where you're sitting, or null on your feet. You stay put there until you walk off or jump up. */
  seat: SeatPlace | null = null;
  /** You got up by walking off or jumping (not by stand()). */
  onStand: (() => void) | null = null;
  /** Corners still to walk through on your own (see walkPath), or null while you're steering. */
  private path: { x: number; z: number }[] | null = null;
  /** How long a walk along `path` has been getting nowhere. */
  private stuckFor = 0;
  /** A walk along a path ended: at its end, by a key of yours, or up against something. */
  onPathEnd: ((why: 'arrived' | 'cancelled' | 'stuck') => void) | null = null;
  /**
   * Something that has hold of you instead of your legs (the ladder, a fire pole): it moves you each
   * frame, with no walking, falling or bumping into things, and the camera follows.
   */
  rig: ((dt: number) => void) | null = null;
  /** The rig is a car (see features/cars/controller.ts): out on the street or in the garage, not up a shaft indoors. */
  riding = false;

  constructor(
    private camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
    /** What you bump into and stand on: the office's, or the roof's up there. */
    public colliders: Collider[],
  ) {
    super(dom);
    camera.rotation.order = 'YXZ';
  }

  setView(view: ViewMode) {
    if (view === this.view) return;
    if (view === 'first') {
      this.lookPitch = -0.08;
      this.facing = this.camYaw + Math.PI;
    } else {
      // Start the orbit camera behind where you were looking.
      this.camYaw = this.facing - Math.PI;
      this.unlock();
    }
    this.view = view;
    this.updateCamera(true);
  }

  /** Sits you down in `place`, facing the way it does. In first person you look out from it; in third the camera stays put. */
  sit(place: SeatPlace) {
    this.seat = place;
    this.pos.set(place.x, place.y, place.z);
    this.vy = 0;
    this.grounded = true;
    this.moving = false;
    this.stepOffset = 0;
    this.bob = 0;
    this.facing = place.rotY;
    if (this.view === 'first') {
      this.camYaw = place.rotY - Math.PI;
      this.lookPitch = -0.08;
    }
  }

  /** Gets you up off your seat onto the floor beside it: out in front (or behind), else wherever there's room. */
  stand() {
    const at = this.standingSpot();
    this.seat = null;
    if (at) this.pos.set(at.x, at.y, at.z);
  }

  /** Where getting up would put you (see stand), or where you're standing if you aren't sitting. Null if there's no room. */
  standingSpot(): { x: number; y: number; z: number } | null {
    const s = this.seat;
    if (!s) return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
    const ahead = s.rotY + (s.out < 0 ? Math.PI : 0);
    const d = Math.abs(s.out);
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2, Math.PI / 2, -Math.PI / 2, Math.PI]) {
      const x = s.x + Math.sin(ahead + turn) * d;
      const z = s.z + Math.cos(ahead + turn) * d;
      if (!this.blocker(x, z, s.y)) return { x, y: s.y, z };
    }
    return null;
  }

  /** Whether there's room to stand at (x, z) with your feet at `y`. */
  fits(x: number, z: number, y: number): boolean {
    return !this.blocker(x, z, y);
  }

  /** Walks you through these corners by yourself until you get there, or take a step or a jump of your own. */
  walkPath(points: { x: number; z: number }[]) {
    this.path = points.length ? points.map((p) => ({ ...p })) : null;
    this.stuckFor = 0;
  }

  stopWalking() {
    this.path = null;
  }

  /** How far sitting moves your hips (and eyes) from where they are standing. */
  private get lift(): number {
    return this.seat ? this.seat.hips - HIPS : 0;
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    if (this.rig) {
      this.rig(dt);
      this.vy = 0;
      this.grounded = false;
      this.stepOffset *= Math.exp(-dt * 16);
      this.bob = 0;
      this.jitterT += dt;
      this.updateCamera();
      return;
    }
    if (this.seat) {
      if (!this.enabled || !GET_UP.some((c) => k.has(c))) {
        this.moving = false;
        this.facing = this.seat.rotY;
        this.jitterT += dt;
        this.updateCamera();
        return;
      }
      this.stand();
      this.onStand?.();
    }
    let ix = 0;
    let iz = 0;
    if (this.enabled) {
      if (k.has('KeyW') || k.has('ArrowUp')) iz -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) iz += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
    }
    const steering = ix !== 0 || iz !== 0;
    this.moving = steering;
    if (this.path && (steering || (this.enabled && k.has('Space')))) {
      this.path = null;
      this.onPathEnd?.('cancelled');
    }
    if (this.path && this.enabled) this.followPath(dt);
    if (this.view === 'first') this.facing = Math.atan2(Math.sin(this.camYaw + Math.PI), Math.cos(this.camYaw + Math.PI));
    if (steering) {
      const len = Math.hypot(ix, iz);
      ix /= len;
      iz /= len;
      // Camera-relative: "forward" is where the camera looks.
      // Drunk, your feet wander off to one side and then the other.
      const t = this.jitterT;
      const stagger = this.effects.sway * (0.4 * Math.sin(t * 1.6) + 0.22 * Math.sin(t * 3.7 + 1));
      const sin = Math.sin(this.camYaw + stagger);
      const cos = Math.cos(this.camYaw + stagger);
      const dx = ix * cos + iz * sin;
      const dz = -ix * sin + iz * cos;
      const speed = (k.has('ShiftLeft') || k.has('ShiftRight') ? RUN : WALK) * this.effects.speed;
      this.tryMove(this.pos.x + dx * speed * dt, this.pos.z);
      this.tryMove(this.pos.x, this.pos.z + dz * speed * dt);
      if (this.view === 'third') {
        const want = Math.atan2(dx, dz);
        let diff = want - this.facing;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.facing += diff * Math.min(1, dt * 14);
      }
    }

    // Never below the street: past the edge of the grass there's nothing else to stand on.
    const ground = Math.max(groundAt(this.colliders, this.pos.x, this.pos.z, this.pos.y), this.street);
    const jump = this.enabled && k.has('Space') && this.grounded;
    if (jump) {
      this.vy = JUMP_V * this.effects.jump;
      this.grounded = false;
    } else if (this.grounded && this.pos.y > ground && this.pos.y - ground <= STEP + 0.02) {
      // Walking down a stair: stay on your feet rather than falling a step.
      this.stepOffset += this.pos.y - ground;
      this.pos.y = ground;
    }
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vy = 0;
      this.grounded = true;
    } else if (this.pos.y > ground + 0.02) {
      this.grounded = false;
    }
    const ceiling = ceilingAt(this.colliders, this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y + HEIGHT > ceiling) {
      this.pos.y = Math.max(ground, ceiling - HEIGHT);
      this.vy = Math.min(this.vy, 0);
    }
    this.stepOffset *= Math.exp(-dt * 16);
    const walking = this.moving && this.grounded;
    this.walkPhase += dt * (walking ? (k.has('ShiftLeft') || k.has('ShiftRight') ? 14 : 11) * this.effects.speed : 0);
    const bob = walking ? Math.abs(Math.sin(this.walkPhase)) * 0.035 : 0;
    this.bob += (bob - this.bob) * Math.min(1, dt * 18);
    this.jitterT += dt;
    this.updateCamera();
  }

  /** A step along `path`: toward its next corner, turning (and in first person, looking) the way you go. */
  private followPath(dt: number) {
    const path = this.path!;
    const next = path[0];
    const dx = next.x - this.pos.x;
    const dz = next.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.25) {
      path.shift();
      if (!path.length) {
        this.path = null;
        this.onPathEnd?.('arrived');
      }
      return;
    }
    // Run the long way round, walk the last few meters.
    let left = dist;
    for (let i = 1; i < path.length; i++) left += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    const step = Math.min(dist, (left > 6 ? RUN : WALK) * this.effects.speed * dt);
    const x0 = this.pos.x;
    const z0 = this.pos.z;
    this.tryMove(this.pos.x + (dx / dist) * step, this.pos.z);
    this.tryMove(this.pos.x, this.pos.z + (dz / dist) * step);
    this.moving = true;
    const want = Math.atan2(dx, dz);
    const ease = Math.min(1, dt * 8);
    if (this.view === 'first') this.camYaw += Math.atan2(Math.sin(want + Math.PI - this.camYaw), Math.cos(want + Math.PI - this.camYaw)) * ease;
    else this.facing += Math.atan2(Math.sin(want - this.facing), Math.cos(want - this.facing)) * ease;
    // Up against something the map didn't know about: give up rather than walk on the spot.
    this.stuckFor = Math.hypot(this.pos.x - x0, this.pos.z - z0) < step * 0.2 ? this.stuckFor + dt : 0;
    if (this.stuckFor > 1) {
      this.path = null;
      this.onPathEnd?.('stuck');
    }
  }

  updateCamera(snap = false) {
    aimCamera(this.camera, this, this.bob, this.lift, snap);
    this.shake();
  }

  /** The jitters: the view trembles a little, on top of wherever you're looking. Drunk, it rolls and sways. */
  private shake() {
    shakeCamera(this.camera, this.jitterT, this.effects.sway, this.effects.jitter);
  }

  /** Unit vector the character is facing, on the XZ plane. */
  forward(): THREE.Vector2 {
    return new THREE.Vector2(Math.sin(this.facing), Math.cos(this.facing));
  }

  /** What stands in your way at (x, z) with your feet at `y`, or null. */
  private blocker(x: number, z: number, y: number, allowEscape = false): Collider | null {
    return blockerAt(this, x, z, y, allowEscape);
  }

  private tryMove(x: number, z: number) {
    stepTo(this, x, z);
  }
}
