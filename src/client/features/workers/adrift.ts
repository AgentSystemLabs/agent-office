import * as THREE from 'three';
import { adrift, adriftFrom, wasting, type Drift, type SendHomePlan } from '../../../shared/maps';
import type { JailState, Prisoner } from '../../../shared/protocol';
import { Worker } from '../../world/character';
import type { AirlockView } from '../../world/station/airlock';

/*
 * Whoever's been blown out of a station's airlock (see shared/maps/airlock.ts and the floor's
 * JailState, which keeps them as it keeps a dungeon's prisoners): each one adrift outside, off on a
 * heading of its own and turning over as it goes, further off by the hour, and wasting away as it
 * would in a cell: thinner, then dead, then bones. Only the latest are still to be seen; the ones
 * from before them have drifted out of sight. One on its way to the airlock with Security isn't
 * shown till it's blown out (see hold).
 */

/** How often (s) how far gone they are is worked out again: it changes over hours. */
const REFRESH = 2;
/** A worker's middle is this far above its feet: what it turns about, out there. */
const MIDDLE = 0.45;
/** How big they are: as they were at their seats. */
export const ADRIFT_SCALE = 0.82;
/** What they say, now and then, while there's breath in them and you're near enough to see. */
const MUTTERS = ['🥶 so cold…', '👋 hello? anyone?', '🫁 …air?', '🌍 nice view, though', '😩 I can fix it, I swear', '📡 mayday… mayday…', '🧑‍🚀 should’ve worn a suit', '😵 …', '🎵 ground control to…', '📜 I’ll write the tests!'];
const EARSHOT = 34;

const turn = new THREE.Euler();
const up = new THREE.Vector3();

/** Puts `root` (a worker, `scale` big) where `d` has it: its middle there, turned over the way it has tumbled. */
export function float(root: THREE.Object3D, d: Drift, scale: number, q?: THREE.Quaternion) {
  if (q) root.quaternion.copy(q);
  else root.quaternion.setFromEuler(turn.set(d.rx, d.ry, d.rz));
  root.scale.setScalar(scale);
  up.set(0, MIDDLE * scale, 0).applyQuaternion(root.quaternion);
  root.position.set(d.x - up.x, d.y - up.y, d.z - up.z);
}

interface Drifter {
  prisoner: Prisoner;
  model: Worker;
}

export class Drifters {
  private out = new Map<string, Drifter>();
  /** On their way to the airlock: not out there yet. */
  private held = new Set<string>();
  private lock: AirlockView | undefined;
  private plan: SendHomePlan | undefined;
  private refreshIn = 0;
  private mutterIn = 6;

  constructor(
    /** Who's been kept on the floor you're on. */
    private state: () => JailState,
    /** The office's clock (ms). */
    private now: () => number,
    /** How to dress one: the map's outfit, and how worn out it had got working. */
    private dress: (model: Worker, p: Prisoner) => void,
  ) {}

  /** Shows whoever's been kept adrift outside `lock` (nobody, without one), as far gone as `plan` says they are. */
  sync(lock: AirlockView | undefined, plan: SendHomePlan | undefined) {
    if (lock !== this.lock || plan !== this.plan) {
      this.clear();
      this.lock = lock;
      this.plan = plan;
    }
    if (!lock || !plan) return;
    const { prisoners } = this.state();
    const want = new Map(prisoners.slice(adriftFrom(prisoners.length)).filter((p) => !this.held.has(p.id)).map((p) => [p.id, p]));
    for (const [id, d] of this.out) {
      if (want.get(id)?.at === d.prisoner.at) continue;
      this.drop(d);
      this.out.delete(id);
    }
    for (const [id, p] of want) {
      if (this.out.has(id)) continue;
      const model = new Worker(p.name, p.color);
      this.dress(model, p);
      model.setJailed(wasting(p.at, this.now(), plan));
      float(model.root, adrift(lock.plan, id, this.now() - p.at), ADRIFT_SCALE);
      lock.outside.add(model.root);
      this.out.set(id, { prisoner: p, model });
    }
  }

  /** `id` is on its way to the airlock: not out there till it's blown out (release). */
  hold(id: string) {
    this.held.add(id);
    const d = this.out.get(id);
    if (d) {
      this.drop(d);
      this.out.delete(id);
    }
  }

  /** `id` has been blown out: it's adrift from now on. */
  release(id: string) {
    if (!this.held.delete(id)) return;
    this.sync(this.lock, this.plan);
  }

  /** Where `id` is out there by now (or would be, while it's still on its way to the airlock), if it's one that's kept. */
  where(id: string): Drift | null {
    const p = this.state().prisoners.find((q) => q.id === id);
    return p && this.lock ? adrift(this.lock.plan, id, this.now() - p.at) : null;
  }

  /** How many are out there to be seen, for a look from the page (__office.adrift). */
  get count(): number {
    return this.out.size;
  }

  /** Every frame: where each has got to; every so often, how far gone they are; and, from near enough, what they have to say about it. */
  update(dt: number, t: number, eye: THREE.Vector3) {
    const lock = this.lock;
    if (!lock || !this.plan || !this.out.size) return;
    const now = this.now();
    this.refreshIn -= dt;
    const refresh = this.refreshIn <= 0;
    if (refresh) this.refreshIn = REFRESH;
    for (const [id, d] of this.out) {
      if (refresh) d.model.setJailed(wasting(d.prisoner.at, now, this.plan));
      d.model.update(dt, t);
      float(d.model.root, adrift(lock.plan, id, now - d.prisoner.at), ADRIFT_SCALE);
    }
    this.mutterIn -= dt;
    if (this.mutterIn > 0) return;
    this.mutterIn = 6 + Math.random() * 8;
    const near = [...this.out.values()].filter((d) => d.model.root.position.distanceTo(eye) < EARSHOT && !wasting(d.prisoner.at, now, this.plan!).dead);
    near[Math.floor(Math.random() * near.length)]?.model.mutter(MUTTERS[Math.floor(Math.random() * MUTTERS.length)]);
  }

  /** Nobody's out there (off to another floor, or another map). Whoever was on their way to the airlock is let go too. */
  clear() {
    for (const d of this.out.values()) this.drop(d);
    this.out.clear();
    this.held.clear();
  }

  private drop(d: Drifter) {
    d.model.root.removeFromParent();
    d.model.dispose();
  }
}
