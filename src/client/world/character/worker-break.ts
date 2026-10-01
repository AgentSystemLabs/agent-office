import type * as THREE from 'three';
import { EXHALE_AT, SMOKE_CYCLE, dragCurve } from './curves';
import { golfClub } from './person-golf';
import { cigarette, coffeeMug, undress } from './props';

// What a worker on a break has in its hand (see features/breaks): a mug of coffee it sips, a
// cigarette it takes a drag on now and then (the same as yours, see props.ts and curves.ts), or a golf
// club it swings.

export type Held = 'mug' | 'cigarette' | 'club';

/** Where the hand is, down the arm from the shoulder (see the arms in worker.ts). */
const HAND = -0.25;
/** A worker's a little smaller than a person: what it holds is too. */
const SIZE = { mug: 1, cigarette: 0.7, club: 0.6 };
/** A sip every this many seconds. */
const SIP_CYCLE = 4.5;

/** A break's prop in a worker's right hand, and how its arms move with it. */
export class BreakHands {
  private held: Held | null = null;
  private prop: THREE.Object3D | null = null;
  private tip: THREE.Object3D | null = null;
  private t = 0;
  /** A drag just taken: the smoke comes out of it once (see exhaled). */
  private puffed = false;

  constructor(
    private armL: THREE.Object3D,
    private armR: THREE.Object3D,
  ) {}

  /** Puts something in its hand, or nothing (null). */
  hold(what: Held | null) {
    if (what === this.held) return;
    if (this.prop) undress([this.prop]);
    this.held = what;
    this.prop = this.tip = null;
    this.t = Math.random() * 3;
    if (!what) return;
    if (what === 'cigarette') {
      const c = cigarette();
      this.prop = c.group;
      // Its lit end: the piece in the ember's material.
      this.tip = c.group.children.find((o) => (o as THREE.Mesh).material === c.ember) ?? null;
    } else this.prop = what === 'mug' ? coffeeMug() : golfClub();
    this.prop.scale.setScalar(SIZE[what]);
    this.prop.position.set(0, HAND - (what === 'mug' ? 0.05 : 0), what === 'club' ? 0 : 0.04);
    this.armR.add(this.prop);
  }

  /** After the rest of its pose: the arms hold the prop up, and now and then it sips, drags or swings. */
  pose(dt: number) {
    if (!this.held || !this.prop) return;
    this.t += dt;
    if (this.held === 'club') return this.swing();
    // A sip every few seconds, a drag a bit less often: up to its face and back down.
    const every = this.held === 'mug' ? SIP_CYCLE : SMOKE_CYCLE;
    const prev = (this.t - dt) % every;
    const k = this.t % every;
    const e = dragCurve(k);
    const low = this.held === 'mug' ? -1.1 : -0.35;
    const rx = low + (-2.3 - low) * e;
    this.armR.rotation.set(rx, 0, -0.35 * e);
    // The mug stays upright; the cigarette points out ahead.
    this.prop.rotation.set(this.held === 'mug' ? -rx : -rx - Math.PI / 2, 0, 0);
    if (this.held === 'cigarette' && prev < EXHALE_AT && k >= EXHALE_AT) this.puffed = true;
  }

  /** A golf swing every few seconds: both hands on the club, back over its shoulder and through. */
  private swing() {
    const k = this.t % 5;
    // Address, take it back, hold at the top, whip through, finish high.
    const a = k < 1.5 ? 0 : k < 2.5 ? (k - 1.5) / 1 : k < 2.8 ? 1 : k < 3.1 ? 1 - ((k - 2.8) / 0.3) * 2 : -1;
    const rx = -0.35 - 0.35 * Math.abs(a);
    const rz = 1.2 * a;
    for (const arm of [this.armL, this.armR]) arm.rotation.set(rx, 0, rz);
    this.prop!.rotation.set(-0.3, 0, 0);
  }

  /** Where the cigarette's lit end is in the world, or false. */
  tipAt(out: THREE.Vector3): boolean {
    if (!this.tip) return false;
    this.tip.getWorldPosition(out);
    return true;
  }

  /** It just took a drag: once true, it breathes the smoke out now. */
  exhaled(): boolean {
    const p = this.puffed;
    this.puffed = false;
    return p;
  }

  /** For a worker model (see Worker's arms): undefined if it has none. */
  static of(root: THREE.Object3D): BreakHands | undefined {
    const l = root.getObjectByName('armL');
    const r = root.getObjectByName('armR');
    return l && r ? new BreakHands(l, r) : undefined;
  }
}
