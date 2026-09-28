import * as THREE from 'three';
import type { CarriedObject, CarryPose, GhIssue } from '../../shared/protocol';
import type { Interactable } from '../world/office';
import { HeldObjectView } from '../world/held-object';

/** Physical reach from the grip/pinch, not the much longer interaction ray. */
export const GRAB_REACH = 0.3;
export const GRAB_HOLD_MS = 180;
const POSE_INTERVAL_MS = 50;

export interface GrabAim {
  it: Interactable;
  note: GhIssue | null;
}

/** Opt-in objects supply their domain actions, not a second implementation of dispatch. */
export interface Grabbable {
  point: THREE.Vector3;
  item: CarriedObject;
  take: () => void;
  use: (aim: GrabAim | null) => void;
  release: (aim: GrabAim | null) => void;
  valid: () => boolean;
  /** Coffee rests on the nearest supporting surface; cards return to their board. */
  place?: boolean;
  /** A mug can be used by bringing it to the mouth while the pinch stays held. */
  mouthUse?: boolean;
}

export interface GrabHooks {
  pick: (point: THREE.Vector3) => Grabbable | null;
  changed: (item: CarriedObject | null) => void;
  ground: (point: THREE.Vector3) => number;
}

/** One carry slot, matching peer.carrying. Either hand can own it, never both. */
export class VRGrab {
  private view: HeldObjectView;
  private target: Grabbable | null = null;
  private owner: number | null = null;
  private hand: CarryPose['hand'] = 'right';
  private sentAt = -Infinity;
  private mouthSince: number | null = null;
  private point = new THREE.Vector3();
  private rotation = new THREE.Quaternion();

  constructor(
    private scene: THREE.Scene,
    private hooks: GrabHooks,
    view = new HeldObjectView(),
  ) {
    this.view = view;
  }

  owns(ray: number): boolean {
    return this.owner === ray;
  }

  get held(): boolean {
    return this.owner !== null;
  }

  private candidate(point: THREE.Vector3): Grabbable | null {
    if (this.held) return null;
    if (this.target?.place) {
      this.view.root.getWorldPosition(this.target.point);
      if (this.target.point.distanceTo(point) <= GRAB_REACH) return this.target;
    }
    const target = this.hooks.pick(point);
    return target && target.point.distanceTo(point) <= GRAB_REACH ? target : null;
  }

  canGrab(point: THREE.Vector3): boolean {
    return !!this.candidate(point);
  }

  begin(ray: number, hand: CarryPose['hand'], anchor: THREE.Object3D): boolean {
    const target = this.candidate(anchor.getWorldPosition(new THREE.Vector3()));
    if (!target) return false;
    if (this.target && this.target !== target) this.clear();
    this.target = target;
    this.owner = ray;
    this.hand = hand;
    this.mouthSince = null;
    target.take();
    this.view.set(target.item);
    anchor.add(this.view.root);
    this.view.root.position.set(0, 0, 0);
    this.view.root.quaternion.identity();
    this.publish(true);
    return true;
  }

  use(ray: number, aim: GrabAim | null): boolean {
    if (!this.owns(ray) || !this.target) return false;
    this.target.use(aim);
    this.reconcile();
    if (this.target) {
      this.view.set(this.target.item);
      this.publish(true);
    }
    return true;
  }

  release(ray: number, aim: GrabAim | null): void {
    if (!this.owns(ray) || !this.target) return;
    if (!this.target.place) {
      this.target.release(aim);
      this.clear(false);
      return;
    }
    this.scene.attach(this.view.root);
    this.owner = null;
    const p = this.view.root.position;
    p.y = this.hooks.ground(p) + 0.04;
    this.view.root.quaternion.identity();
    this.publish(true);
  }

  /** Domain actions (queue/pin/menu) may end a carry independently of the physical gesture. */
  private reconcile(): void {
    if (this.target && !this.target.valid()) this.clear(false);
  }

  update(head: THREE.Vector3, now: number): void {
    this.reconcile();
    if (!this.target || !this.held) return;
    if (this.target.mouthUse && this.target.item.kind === 'coffee' && !this.target.item.empty) {
      this.view.root.getWorldPosition(this.point);
      if (this.point.distanceTo(head) < 0.22) {
        this.mouthSince ??= now;
        if (now - this.mouthSince >= 350) this.use(this.owner!, null);
      } else this.mouthSince = null;
    }
    if (now - this.sentAt >= POSE_INTERVAL_MS) this.publish(false, now);
  }

  private publish(force: boolean, now = performance.now()): void {
    if (!this.target || (!force && now - this.sentAt < POSE_INTERVAL_MS)) return;
    this.sentAt = now;
    this.view.root.getWorldPosition(this.point);
    this.view.root.getWorldQuaternion(this.rotation);
    this.hooks.changed({
      ...this.target.item,
      pose: {
        hand: this.hand,
        position: this.point.toArray(),
        quaternion: this.rotation.toArray(),
        ...(this.owner === null ? { placed: true } : {}),
      },
    });
  }

  /** Session end, source loss, floor change and socket loss all take this path. */
  clear(release = true): void {
    const target = this.target;
    this.target = null;
    this.owner = null;
    this.mouthSince = null;
    this.view.set(null);
    this.view.root.removeFromParent();
    if (target) {
      if (release) target.release(null);
      this.hooks.changed(null);
    }
  }
}
