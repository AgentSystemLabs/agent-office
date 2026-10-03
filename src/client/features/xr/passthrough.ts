/**
 * Passthrough (immersive-ar): the office in your room. Everything but the floor you're on is cut
 * away (the street, the city, the sky, the floors above and below, its ceiling), the haze is pushed
 * back, and the office is either life-size around you or a model on a table in front of you.
 * The headset clears what's left to your room itself (three.js does, in 'alpha-blend' sessions).
 */
import * as THREE from 'three';
import { BALCONY, FLOOR, LOFT, SLAB, WALL_HEIGHT, WALL_T } from '../../../shared/layout';

const EDGE = WALL_T + 0.15;
const CEILING = WALL_HEIGHT - 0.05;
/** On the table, the walls stop just under the loft, so you look down into the office like a dollhouse. */
const DOLLHOUSE = LOFT.y - 0.1;

/** The floor you're on, its walls and its balcony; nothing above its ceiling or under its slab. */
const OFFICE_BOX = [
  new THREE.Plane(new THREE.Vector3(1, 0, 0), -(FLOOR.minX - EDGE)),
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), FLOOR.maxX + EDGE),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), -(FLOOR.minZ - EDGE)),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), BALCONY.maxZ + 0.15),
  new THREE.Plane(new THREE.Vector3(0, 1, 0), SLAB + 0.05),
  new THREE.Plane(new THREE.Vector3(0, -1, 0), CEILING),
];
const TOP = OFFICE_BOX[OFFICE_BOX.length - 1]!;

/** Cuts the office out of the world while a passthrough session is on. */
export class Passthrough {
  on = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  enter() {
    this.on = true;
  }

  leave() {
    this.on = false;
    this.renderer.clippingPlanes = [];
  }

  /**
   * Each frame, once the sky has set the fog: cut the office out when you're in it (the castle and
   * the roof are drawn whole), and push the haze out past anything you'd see. `dollhouse` lowers
   * the walls for the table (unless `y`, where you're standing, is up on the loft).
   */
  update(scene: THREE.Scene, inOffice: boolean, dollhouse: boolean, y: number) {
    if (!this.on) return;
    TOP.constant = dollhouse && y < LOFT.y - 1 ? DOLLHOUSE : CEILING;
    this.renderer.clippingPlanes = inOffice ? OFFICE_BOX : [];
    const fog = scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = 1e4;
      fog.far = 2e4;
    }
  }
}

/** World units per real meter at the start: the office's 37 meters about a meter and a quarter across. */
const START_SCALE = 30;
const MIN_SCALE = 6;
const MAX_SCALE = 90;
/** How quickly the table re-centers on you as you walk (per second). */
const FOLLOW = 2.5;

/**
 * The office as a model on the table: the rig the headset sits on is scaled up (`scale` world units
 * to a real meter), so the office looks that much smaller, and placed so the spot under you in the
 * office (`pivot`) sits at `anchor` in the room. Snap-turns spin the model about it; zoom grows it.
 */
export class Tabletop {
  scale = START_SCALE;
  /** The point in the office the table is centered on (world units). */
  private readonly pivot = new THREE.Vector3();
  /** Where that point is in the room (rig space: real meters from where the session started). */
  private readonly anchor = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  /** Puts the model a meter in front of where the headset is now, at about table height. */
  place(rig: THREE.Group, camera: THREE.Camera, at: THREE.Vector3) {
    // The camera's pose in the rig is the headset's in the room, in meters, however the rig is scaled.
    this.fwd.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);
    if (this.fwd.lengthSq() < 1e-4) this.fwd.set(0, 0, -1);
    this.fwd.normalize();
    this.anchor.copy(camera.position).addScaledVector(this.fwd, 1);
    this.anchor.y = Math.max(0.45, camera.position.y - 0.65);
    this.pivot.set(at.x, 0, at.z);
    this.apply(rig);
  }

  /** Keeps the table centered on you as you walk about it. */
  follow(rig: THREE.Group, at: THREE.Vector3, dt: number) {
    const k = Math.min(1, dt * FOLLOW);
    this.pivot.x += (at.x - this.pivot.x) * k;
    this.pivot.z += (at.z - this.pivot.z) * k;
    this.apply(rig);
  }

  /** Grows (`amount` > 0) or shrinks the model about its middle. */
  zoom(rig: THREE.Group, amount: number, dt: number) {
    this.scale = THREE.MathUtils.clamp(this.scale * Math.exp(-amount * dt * 1.5), MIN_SCALE, MAX_SCALE);
    this.apply(rig);
  }

  /** pivot = rig.position + R(rig) · scale · anchor, solved for the rig's position. */
  private apply(rig: THREE.Group) {
    rig.scale.setScalar(this.scale);
    this.tmp.copy(this.anchor).multiplyScalar(this.scale).applyAxisAngle(THREE.Object3D.DEFAULT_UP, rig.rotation.y);
    rig.position.copy(this.pivot).sub(this.tmp);
  }
}
