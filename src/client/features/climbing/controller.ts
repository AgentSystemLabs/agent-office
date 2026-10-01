import * as THREE from 'three';
import { LADDER, POLE, STOREY, WALL_HEIGHT, type PoleSpot } from '../../../shared/layout';
import type { PlayerController } from '../../player';

// Getting between the floors without the elevator: up and down the ladder by the west wall, and down
// a fire pole. Either one takes hold of you (PlayerController.rig) until you're off it again.

/** Up the floor above (+1) or down to the one below (-1). */
export type Way = 1 | -1;
/** What you're holding on to. */
export type Grip = 'ladder' | 'pole';

/** How fast you go up and down the ladder, in meters a second. */
const CLIMB = 1.9;
/** Up this far on the ladder your head's through the hatch: on up to the floor above. */
const LADDER_TOP = WALL_HEIGHT - 1.15;
/** Down this far you're through the floor (your eyes just under it): on down to the floor below. */
const LADDER_BOTTOM = -1.5;
/** Where you stand once you're off the ladder: on the floor in front of its hatch. */
const OFF_X = LADDER.hatch.maxX + 0.4;
/** Stepping off takes this long, in seconds. */
const STEP_OFF = 0.45;
/** Down a pole's hole this far, your eyes go under the floor: on to the floor below. */
const POLE_BOTTOM = -1.5;
/** Sliding down: gravity, less what your hands take off it. */
const SLIDE_G = 12;
const SLIDE_MAX = 6.5;
/** How fast you come out of the ceiling onto the floor below: the dark in between takes some of it off. */
const SLIDE_IN = 3.5;
/** A twirl round a pole that doesn't go anywhere (on the bottom floor). */
const TWIRL = 1.15;
/** Swinging off a pole onto a floor it goes on down through: how long, and how far out from it you end up (past the railing). */
const SWING_OFF = 0.55;
const OFF_POLE = POLE.rail + 0.4;

/** Where you arrive on the other floor: the same spot in the office, on the other side of the ceiling. */
export interface Arrival {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

export interface ClimbHooks {
  /** The name of the floor that way, if there's one. */
  floorThere(way: Way): string | undefined;
  /** Go there, arriving at `at`; `arrived` or `abort` follows. */
  travel(way: Way, how: Grip, at: Arrival): void;
  /** Something to hear: a rung under your hands, the rush of a slide, a landing (how fast), the top of the ladder. */
  sound(kind: 'grab' | 'rung' | 'slide' | 'land' | 'bonk' | 'twirl', speed?: number): void;
  /** You're off the ladder or the pole, back on your feet. */
  done(how: Grip, landed: boolean): void;
}

type State =
  | {
      kind: 'ladder';
      /** Carrying on by itself the rest of the way, after a floor change: up (1) or down (-1) to the floor. */
      auto: 0 | Way;
      /** Waiting on the floor you're going to (the lights are down). */
      waiting: boolean;
      /** The rung your hands were on last, for its clank. */
      rung: number;
      /** Stepping off: seconds in, from where, and which way you end up facing. */
      off: { t: number; x: number; y: number; yaw: number; toYaw: number; facing: number } | null;
      bonked: boolean;
    }
  | {
      kind: 'pole';
      spot: PoleSpot;
      stage: 'hop' | 'slide' | 'wait' | 'twirl' | 'off';
      /** Where you are round the pole (0 = +z of it) and how fast you're going down. */
      angle: number;
      v: number;
      t: number;
      from: { x: number; y: number; z: number };
      /** Come down through the ceiling onto the floor below: the next stop is the mat, or off the pole beside its hole. */
      through: boolean;
      /** Swinging off: where round the pole you started from. */
      offFrom?: number;
    };

export class Climber {
  private state: State | null = null;
  /** How fast you're sliding, 0–1, for the speed lines and the wider view. */
  rush = 0;

  constructor(
    private player: PlayerController,
    private hooks: ClimbHooks,
  ) {}

  get active(): boolean {
    return !!this.state;
  }

  get grip(): Grip | null {
    return this.state?.kind ?? null;
  }

  /** On the ladder, and where: how far up it you are, which way you can go, and whether you're between floors. */
  get ladder(): { y: number; waiting: boolean; auto: boolean } | null {
    const s = this.state;
    return s?.kind === 'ladder' ? { y: this.player.pos.y, waiting: s.waiting, auto: s.auto !== 0 || !!s.off } : null;
  }

  /** Sliding (or twirling) down a pole. */
  get sliding(): 'slide' | 'twirl' | null {
    const s = this.state;
    return s?.kind === 'pole' ? (s.stage === 'twirl' ? 'twirl' : 'slide') : null;
  }

  /** Takes hold of the ladder, from the floor in front of it or wherever you are up it. */
  grabLadder() {
    if (this.state) return;
    const p = this.player;
    p.pos.y = THREE.MathUtils.clamp(p.pos.y, 0, LADDER_TOP);
    this.state = { kind: 'ladder', auto: 0, waiting: false, rung: Math.round(p.pos.y / 0.3), off: null, bonked: false };
    p.facing = -Math.PI / 2;
    if (p.view === 'first') {
      // Face the rungs, looking up them.
      p.camYaw = Math.PI / 2;
      p.lookPitch = 0.45;
    }
    p.moving = false;
    p.rig = (dt) => this.ladderStep(dt);
    this.hooks.sound('grab');
  }

  /** Grabs the pole and slides down it, through its hole to the floor below. */
  slide(spot: PoleSpot) {
    if (this.state) return;
    const p = this.player;
    const angle = Math.atan2(p.pos.x - spot.x, p.pos.z - spot.z);
    this.state = { kind: 'pole', spot, stage: 'hop', angle, v: 0, t: 0, from: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, through: false };
    p.moving = false;
    p.rig = (dt) => this.poleStep(dt);
    this.hooks.sound('grab');
  }

  /** Swings once round a pole that goes nowhere from here (the bottom floor's). */
  twirl(spot: PoleSpot) {
    if (this.state) return;
    const p = this.player;
    const angle = Math.atan2(p.pos.x - spot.x, p.pos.z - spot.z);
    this.state = { kind: 'pole', spot, stage: 'twirl', angle, v: 0, t: 0, from: { x: p.pos.x, y: p.pos.y, z: p.pos.z }, through: false };
    p.rig = (dt) => this.poleStep(dt);
    this.hooks.sound('twirl');
  }

  /** E on the ladder: off it at the floor, or let go and drop from wherever you are. */
  letGo() {
    const s = this.state;
    if (s?.kind !== 'ladder' || s.waiting || s.auto || s.off) return;
    const p = this.player;
    if (p.pos.y < -0.05) return; // down the hatch: nothing to land on but the next floor
    if (p.pos.y < 0.4) {
      this.stepOff(s);
      return;
    }
    // Drop off it: a little way out from the wall, and down you go.
    p.pos.x = LADDER.x + 0.3;
    this.release('ladder', false);
  }

  /** Now on the floor you were going to: carry on the rest of the way. */
  arrived() {
    const s = this.state;
    if (!s) return;
    const p = this.player;
    if (s.kind === 'ladder' && s.waiting) {
      // Your head was up in the hatch (or your feet down the one below): now that's this floor's.
      const way: Way = p.pos.y > 1 ? 1 : -1;
      p.pos.y += way > 0 ? -STOREY : STOREY;
      s.waiting = false;
      s.auto = way;
      s.rung = Math.round(p.pos.y / 0.3);
    } else if (s.kind === 'pole' && s.stage === 'wait') {
      p.pos.y += STOREY;
      s.stage = 'slide';
      s.through = true;
      s.v = Math.min(s.v, SLIDE_IN);
    }
  }

  /** The other floor never came: back onto this one's floor, off whatever you were on. */
  abort() {
    const s = this.state;
    if (!s) return;
    const p = this.player;
    if (s.kind === 'ladder') p.pos.set(OFF_X, 0, LADDER.z);
    else p.pos.set(s.from.x, 0, s.from.z);
    this.release(s.kind, false);
  }

  private release(how: Grip, landed: boolean) {
    this.state = null;
    this.rush = 0;
    const p = this.player;
    p.rig = null;
    p.moving = false;
    p.vy = 0;
    this.hooks.done(how, landed);
  }

  private stepOff(s: Extract<State, { kind: 'ladder' }>) {
    const p = this.player;
    // Back off the ladder and turn round to the room.
    const toYaw = -Math.PI / 2;
    let yaw = p.camYaw;
    yaw = toYaw + Math.atan2(Math.sin(yaw - toYaw), Math.cos(yaw - toYaw));
    s.off = { t: 0, x: p.pos.x, y: p.pos.y, yaw, toYaw, facing: Math.PI / 2 };
    s.auto = 0;
  }

  private ladderStep(dt: number) {
    const s = this.state;
    if (s?.kind !== 'ladder') return;
    const p = this.player;
    if (s.off) {
      s.off.t += dt;
      const k = Math.min(1, s.off.t / STEP_OFF);
      const e = k * k * (3 - 2 * k);
      p.pos.x = THREE.MathUtils.lerp(s.off.x, OFF_X, e);
      p.pos.y = THREE.MathUtils.lerp(s.off.y, 0, e) + Math.sin(Math.PI * k) * 0.12;
      p.pos.z += (LADDER.z - p.pos.z) * Math.min(1, dt * 12);
      p.facing = THREE.MathUtils.lerp(-Math.PI / 2, s.off.facing, e);
      if (p.view === 'first') {
        p.camYaw = THREE.MathUtils.lerp(s.off.yaw, s.off.toYaw, e);
        p.lookPitch += (-0.08 - p.lookPitch) * Math.min(1, dt * 8);
      }
      p.moving = k < 1;
      if (k >= 1) {
        p.pos.y = 0;
        this.release('ladder', true);
      }
      return;
    }
    // Onto the rungs, facing the wall.
    p.pos.x += (LADDER.x - p.pos.x) * Math.min(1, dt * 12);
    p.pos.z += (LADDER.z - p.pos.z) * Math.min(1, dt * 12);
    p.facing = -Math.PI / 2;
    if (!s.auto && !s.waiting && p.pos.y >= 0 && p.holding('Space')) {
      // Jump off, back from the wall.
      p.pos.x = LADDER.x + 0.3;
      this.release('ladder', false);
      p.vy = 3.5;
      return;
    }
    let dir = 0;
    if (s.waiting) dir = 0;
    else if (s.auto) dir = s.auto;
    else dir = (p.holding('KeyW', 'ArrowUp') ? 1 : 0) - (p.holding('KeyS', 'ArrowDown') ? 1 : 0);
    const up = this.hooks.floorThere(1);
    const down = this.hooks.floorThere(-1);
    let y = p.pos.y + dir * CLIMB * dt;
    // At the floor: off, unless you're on your way down through it.
    if (dir < 0 && y <= 0 && p.pos.y >= 0 && (s.auto === -1 || !down)) {
      p.pos.y = 0;
      this.stepOff(s);
      return;
    }
    // Climbing up out of the hatch onto a new floor: step off onto it.
    if (dir > 0 && s.auto === 1 && y >= 0) {
      p.pos.y = 0;
      this.stepOff(s);
      return;
    }
    if (dir > 0 && y > LADDER_TOP) {
      y = LADDER_TOP;
      if (!up) {
        if (!s.bonked) this.hooks.sound('bonk');
        s.bonked = true;
      } else this.go(s, 1, y);
    } else if (dir < 0) s.bonked = false;
    if (dir < 0 && y < LADDER_BOTTOM) {
      y = LADDER_BOTTOM;
      this.go(s, -1, y);
    }
    p.pos.y = y;
    p.moving = dir !== 0 && !s.waiting;
    p.walkPhase += Math.abs(dir) * dt * 7;
    const rung = Math.round(y / 0.3);
    if (rung !== s.rung) {
      s.rung = rung;
      this.hooks.sound('rung');
    }
  }

  private go(s: Extract<State, { kind: 'ladder' }>, way: Way, y: number) {
    if (s.waiting) return;
    s.waiting = true;
    const p = this.player;
    this.hooks.travel(way, 'ladder', { x: p.pos.x, y: y + (way > 0 ? -STOREY : STOREY), z: p.pos.z, rotY: p.facing });
  }

  private poleStep(dt: number) {
    const s = this.state;
    if (s?.kind !== 'pole') return;
    const p = this.player;
    const { spot } = s;
    s.t += dt;
    const place = (r: number) => {
      p.pos.x = spot.x + Math.sin(s.angle) * r;
      p.pos.z = spot.z + Math.cos(s.angle) * r;
    };
    if (s.stage === 'twirl') {
      const k = Math.min(1, s.t / TWIRL);
      s.angle += dt * ((Math.PI * 2) / TWIRL) * Math.sin(Math.PI * k) * 1.57;
      const r = THREE.MathUtils.lerp(Math.hypot(s.from.x - spot.x, s.from.z - spot.z), POLE.grip + 0.1, Math.sin(Math.PI * k));
      place(Math.max(r, POLE.grip));
      p.pos.y = s.from.y + Math.sin(Math.PI * k) * 0.5;
      this.face(s.angle, dt, 0.1);
      p.moving = false;
      if (k >= 1) {
        p.pos.y = s.from.y;
        this.release('pole', false);
      }
      return;
    }
    if (s.stage === 'hop') {
      // A hop onto the pole: in to it, and up a little.
      const k = Math.min(1, s.t / 0.28);
      const r0 = Math.hypot(s.from.x - spot.x, s.from.z - spot.z);
      place(THREE.MathUtils.lerp(r0, POLE.grip, k));
      p.pos.y = s.from.y + Math.sin(Math.PI * k * 0.5) * 0.35;
      this.face(s.angle, dt, 0);
      if (k >= 1) {
        s.stage = 'slide';
        this.hooks.sound('slide');
      }
      return;
    }
    if (s.stage === 'wait') {
      // In the dark under the floor, holding on, while the floor below comes.
      this.face(s.angle, dt, -0.4);
      return;
    }
    if (s.stage === 'off') {
      // Round to the railing's gap, then out through it onto the floor with a little hop.
      const k = Math.min(1, s.t / SWING_OFF);
      const ease = (x: number) => x * x * (3 - 2 * x);
      const turn = ease(Math.min(1, k / 0.6));
      const out = ease(Math.max(0, (k - 0.4) / 0.6));
      const a0 = s.offFrom ?? s.angle;
      s.angle = a0 + Math.atan2(Math.sin(spot.open - a0), Math.cos(spot.open - a0)) * turn;
      place(THREE.MathUtils.lerp(POLE.grip, OFF_POLE, out));
      p.pos.y = Math.sin(Math.PI * k) * 0.25;
      // From facing round the pole to facing out, away from it.
      const along = s.angle + Math.PI / 2;
      p.facing = along + Math.atan2(Math.sin(spot.open - along), Math.cos(spot.open - along)) * out;
      if (p.view === 'first') {
        const yaw = p.facing - Math.PI;
        p.camYaw += Math.atan2(Math.sin(yaw - p.camYaw), Math.cos(yaw - p.camYaw)) * Math.min(1, dt * 10);
        p.lookPitch += (-0.08 - p.lookPitch) * Math.min(1, dt * 8);
      }
      p.moving = out > 0 && k < 1;
      this.rush = Math.max(0, this.rush - dt * 4);
      if (k >= 1) {
        p.pos.y = 0;
        this.hooks.sound('land', s.v);
        this.release('pole', true);
      }
      return;
    }
    // Down you go, faster and faster, spinning round the pole; squeeze to slow down near the bottom.
    const braking = s.through && p.pos.y < 1;
    if (braking) s.v = Math.max(2, s.v - 26 * dt);
    else s.v = Math.min(SLIDE_MAX, s.v + SLIDE_G * dt);
    s.angle += dt * (1.6 + s.v * 0.55);
    place(POLE.grip);
    p.pos.y -= s.v * dt;
    this.rush = Math.min(1, s.v / SLIDE_MAX);
    this.face(s.angle, dt, braking ? -0.12 : -0.4);
    p.moving = false;
    p.walkPhase += dt * 4;
    if (p.pos.y <= POLE_BOTTOM && !s.through) {
      p.pos.y = POLE_BOTTOM;
      s.stage = 'wait';
      this.hooks.travel(-1, 'pole', { x: p.pos.x, y: POLE_BOTTOM + STOREY, z: p.pos.z, rotY: p.facing });
      return;
    }
    if (p.pos.y <= 0 && s.through) {
      p.pos.y = 0;
      if (this.hooks.floorThere(-1)) {
        // No mat here: the pole goes on down through a hole in this floor. Off it, beside the hole.
        s.stage = 'off';
        s.t = 0;
        s.offFrom = s.angle;
        return;
      }
      const speed = s.v;
      // Knees bend as you land.
      p.stepOffset = -0.35;
      this.hooks.sound('land', speed);
      this.release('pole', true);
    }
  }

  /**
   * Swinging round the pole: you face the way you're going, the pole on your left. In first person
   * you look a little toward it (so it's in view, hands on it) and down a little.
   */
  private face(angle: number, dt: number, pitch: number) {
    const p = this.player;
    const facing = angle + Math.PI / 2;
    p.facing = facing;
    if (p.view !== 'first') return;
    const yaw = facing + 1.25 - Math.PI;
    const d = Math.atan2(Math.sin(yaw - p.camYaw), Math.cos(yaw - p.camYaw));
    p.camYaw += d * Math.min(1, dt * 10);
    p.lookPitch += (pitch - p.lookPitch) * Math.min(1, dt * 6);
  }
}

/**
 * Whether someone at `p` is holding on to the ladder or a pole (someone else, going by where they
 * are): up off the floor, right where your hands would be.
 */
export function gripOf(p: { x: number; y: number; z: number }, poles: readonly PoleSpot[], ground: number): Grip | null {
  if (Math.abs(p.y - ground) < 0.05) return null;
  if (Math.abs(p.x - LADDER.x) < 0.12 && Math.abs(p.z - LADDER.z) < 0.15) return 'ladder';
  for (const s of poles) if (Math.abs(Math.hypot(p.x - s.x, p.z - s.z) - POLE.grip) < 0.12) return 'pole';
  return null;
}
