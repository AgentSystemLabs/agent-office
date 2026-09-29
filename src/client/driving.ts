import { CAR, SEATS, carFits, carPoint, drive, onPavement, type Box, type CarPose, type CarSeat, type Pedals } from '../shared/garage';
import type { PlayerController } from './player';
import type { Fleet } from './world/cars';

// Driving the cars in the garage: E at one gets you in (behind the wheel, or beside whoever's
// there), and it takes hold of you (PlayerController.rig) until you get out. The driver's page runs
// the car (shared/garage.ts) and tells the office where it's got to; everyone else's follows it.

export interface DriveHooks {
  /** The car you're driving has got to `pose`: tell the office, for everyone else on the floor. */
  moved(car: number, pose: CarPose): void;
  /** You ran into something at `speed` m/s, at (x, z). */
  bump(at: { x: number; z: number }, speed: number): void;
}

/** How often the office hears where your car is, at most (ms). */
const SEND_EVERY = 66;
/** The longest step a car takes in one go (m), so it never jumps a lamp post between two frames. */
const STEP = 0.25;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Driver {
  /** The car you're in (its place in CARS), and your seat; null on your feet. */
  car: number | null = null;
  seat: CarSeat | null = null;
  /** How hard you're on the gas (-1 in reverse), for the engine. */
  gas = 0;
  private sent = { at: 0, x: 0, z: 0, rotY: 0, speed: 0, steer: 0 };
  private bumpedAt = 0;
  /** The way the car pointed last frame, to turn a first-person view along with it. */
  private yaw = 0;
  /** How the third-person camera was before you got in: it pulls back to see the car. */
  private camWas: { dist: number; pitch: number } | null = null;

  constructor(
    private player: PlayerController,
    private fleet: Fleet,
    private hooks: DriveHooks,
  ) {}

  get active(): boolean {
    return this.car !== null;
  }

  /** Behind the wheel, rather than beside it. */
  get driving(): boolean {
    return this.seat === 'driver';
  }

  /** The car you're in, as it's drawn. */
  get pose(): CarPose | null {
    return this.car === null ? null : this.fleet.cars[this.car].pose;
  }

  /** Gets into `seat` of car `car`, looking out over its hood. */
  enter(car: number, seat: CarSeat) {
    const v = this.fleet.cars[car];
    if (this.active || !v) return;
    this.car = car;
    this.seat = seat;
    this.gas = 0;
    const p = this.player;
    p.stopWalking();
    p.moving = false;
    p.vy = 0;
    this.yaw = v.pose.rotY;
    if (p.view === 'first') {
      p.camYaw = v.pose.rotY + Math.PI;
      p.lookPitch = -0.12;
    } else {
      this.camWas = { dist: p.camDist, pitch: p.camPitch };
      p.camDist = Math.max(p.camDist, 9);
      p.camPitch = Math.min(p.camPitch, 0.32);
      p.camYaw = v.pose.rotY + Math.PI;
    }
    p.rig = (dt) => this.step(dt);
    p.riding = true;
    this.sit(0);
  }

  /**
   * Where you'd be getting out: by your own door, else the other one, else behind the car or in
   * front of it. Null if there's no room anywhere (or you're not in a car).
   */
  wayOut(): { x: number; y: number; z: number } | null {
    const car = this.car;
    const seat = this.seat;
    if (car === null || seat === null) return null;
    const pose = this.fleet.cars[car].pose;
    const y = this.fleet.seatAt(car, seat)!.y;
    const s = SEATS[seat];
    const out = CAR.width / 2 + 0.55;
    const side = Math.sign(s.x);
    for (const [lx, lz] of [
      [side * out, s.z],
      [side * out, 0.9],
      [-side * out, s.z],
      [0, -CAR.length / 2 - 0.6],
      [0, CAR.length / 2 + 0.6],
    ]) {
      const q = carPoint(pose, lx, lz);
      if (this.player.fits(q.x, q.z, y)) return { x: q.x, y, z: q.z };
    }
    return null;
  }

  /** Out onto your feet beside the car (see wayOut). False if there's no room, unless `anyway` (you stand up where you sat). */
  leave(anyway = false): boolean {
    const pose = this.pose;
    if (!pose) return true;
    const at = this.wayOut();
    if (!at && !anyway) return false;
    this.drop();
    const p = this.player;
    if (at) p.pos.set(at.x, at.y, at.z);
    p.facing = pose.rotY;
    p.camYaw = pose.rotY + Math.PI;
    p.lookPitch = -0.08;
    return true;
  }

  /** Lets go of the car where you are (something else is moving you: another floor, a desk): driving, it stops there. */
  drop() {
    const car = this.car;
    if (car === null) return;
    if (this.driving) {
      const pose = { ...this.fleet.cars[car].pose, speed: 0 };
      this.fleet.place(car, pose);
      this.hooks.moved(car, pose);
    }
    const p = this.player;
    p.rig = null;
    p.riding = false;
    if (this.camWas) {
      p.camDist = this.camWas.dist;
      p.camPitch = this.camWas.pitch;
      this.camWas = null;
    }
    this.car = null;
    this.seat = null;
    this.gas = 0;
  }

  /** Each frame in the car: drive it (behind the wheel), and sit in your seat wherever it's got to. */
  private step(dt: number) {
    const car = this.car!;
    if (this.driving) {
      const p = this.player;
      const pedals: Pedals = {
        gas: (p.holding('KeyW', 'ArrowUp') ? 1 : 0) - (p.holding('KeyS', 'ArrowDown') ? 1 : 0),
        turn: (p.holding('KeyA', 'ArrowLeft') ? 1 : 0) - (p.holding('KeyD', 'ArrowRight') ? 1 : 0),
        brake: p.holding('Space'),
      };
      this.gas = pedals.gas;
      const pose = this.move(this.fleet.cars[car].pose, pedals, dt, this.fleet.solids(car));
      this.fleet.place(car, pose);
      this.send(car, pose);
    }
    this.sit(dt);
  }

  /**
   * The car `dt` on from `from`: in short steps, stopping at whatever's in the way. At an angle to
   * it, the car slides along it; head on, it bounces back off.
   */
  private move(from: CarPose, pedals: Pedals, dt: number, solids: Box[]): CarPose {
    const n = Math.max(1, Math.ceil((Math.abs(from.speed) * dt) / STEP));
    const h = dt / n;
    // Already in something (someone parked on top of you): drive out of it any way you like.
    const stuck = !carFits(from, solids);
    let pose = from;
    for (let i = 0; i < n; i++) {
      const next = drive(pose, pedals, h);
      if (stuck ? onPavement(next) : carFits(next, solids)) {
        pose = next;
        continue;
      }
      // Sliding keeps only the part of the move along what's in the way, and only that much of the speed.
      const want = Math.hypot(next.x - pose.x, next.z - pose.z) || 1;
      const slides = [
        { to: { ...next, z: pose.z }, keep: Math.abs(next.x - pose.x) / want },
        { to: { ...next, x: pose.x }, keep: Math.abs(next.z - pose.z) / want },
      ].filter((q) => q.keep > 0.25 && carFits(q.to, solids));
      const along = slides.sort((a, b) => b.keep - a.keep)[0];
      if (along) {
        this.bumped(pose, Math.abs(next.speed) * (1 - along.keep));
        pose = { ...along.to, speed: next.speed * along.keep };
        continue;
      }
      this.bumped(pose, Math.abs(pose.speed));
      pose = { ...pose, steer: next.steer, speed: -pose.speed * 0.3 };
      break;
    }
    return pose;
  }

  /** Ran into something, losing `speed` m/s of the car's: a crunch, if it's enough to hear. */
  private bumped(pose: CarPose, speed: number) {
    const now = performance.now();
    if (speed < 2 || now - this.bumpedAt < 350) return;
    this.bumpedAt = now;
    this.hooks.bump(carPoint(pose, 0, (Math.sign(pose.speed) * CAR.length) / 2), speed);
  }

  /** Tells the office where the car is, every so often while it's going (and once more when it stops). */
  private send(car: number, pose: CarPose) {
    const s = this.sent;
    const now = performance.now();
    const changed = Math.abs(pose.x - s.x) + Math.abs(pose.z - s.z) > 0.01 || Math.abs(wrap(pose.rotY - s.rotY)) > 0.004 || pose.speed !== s.speed || Math.abs(pose.steer - s.steer) > 0.02;
    if (!changed || now - s.at < SEND_EVERY) return;
    this.sent = { at: now, x: pose.x, z: pose.z, rotY: pose.rotY, speed: pose.speed, steer: pose.steer };
    this.hooks.moved(car, pose);
  }

  /**
   * You in your seat, wherever the car's got to. In first person you look round from it, turning as
   * it turns; in third, the camera swings round behind it as it goes.
   */
  private sit(dt: number) {
    const p = this.player;
    const at = this.fleet.seatAt(this.car!, this.seat!)!;
    p.pos.set(at.x, at.y, at.z);
    p.facing = at.rotY;
    p.moving = false;
    const turned = wrap(at.rotY - this.yaw);
    this.yaw = at.rotY;
    if (p.view === 'first') p.camYaw += turned;
    else {
      const speed = Math.abs(this.fleet.cars[this.car!].pose.speed);
      const k = Math.min(1, dt * 2.5 * Math.min(1, speed / 4));
      p.camYaw += wrap(at.rotY + Math.PI - p.camYaw) * k;
    }
  }
}
