import * as THREE from 'three';
import type { MapPlan } from '../../shared/maps';
import type { NavGrid, Pt } from '../../shared/nav';
import type { Worker } from './character';
import type { DeskView, Interactable } from './types';

/*
 * The castle's workers getting up and walking about the hall (see MapPlan.lineup). One waiting on
 * someone (done, or stuck on a question) gets up from its seat and joins the line in front of the
 * throne, first come first served, shuffling forward as the ones ahead are seen to, and goes back
 * to its seat once it has been. A new one runs in from wherever it was sent out from (the herald by
 * the throne, or the doors) to its seat. While it's up, its seat is empty but still its own, and the
 * spot it stands in is somewhere to walk up to it (`interactables`), as good as its seat.
 */

/** Walking pace (m/s), and running, for a new worker sent out to its seat. */
const WALK = 2.6;
const RUN = 4;
/** Seconds hopping down off its seat, or up onto it. */
const HOP = 0.5;
/** A worker's feet are this far above its origin (see features/workers/leaving.ts). */
const FEET = 0.07;

/** Where it's going: its seat, or a spot in line (its index). */
type Goal = { seat: true } | { spot: number };

interface Courtier {
  id: string;
  model: Worker;
  desk: DeskView;
  goal: Goal;
  /** In its seat; hopping down off it or up onto it; walking; or standing still in line. */
  state: 'seated' | 'down' | 'walk' | 'up' | 'stand';
  way: Pt[];
  next: number;
  /** Seconds into a hop, and where it hopped from. */
  hop: number;
  from: THREE.Vector3;
  heading: number;
  stepIn: number;
  /** m/s, before its age slows it down. */
  pace: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const sameGoal = (a: Goal, b: Goal) => ('seat' in a ? 'seat' in b : 'spot' in b && a.spot === b.spot);

export class Court {
  /** One for each spot in line: walk up to whoever stands there, as at its seat. */
  readonly interactables: Interactable[];
  private people = new Map<string, Courtier>();
  private readonly tmp = new THREE.Vector3();

  constructor(
    private parent: THREE.Object3D,
    private plan: MapPlan,
    private nav: NavGrid,
    /** The top of whatever is underfoot at (x, z) for feet at `y`. */
    private ground: (x: number, z: number, y: number) => number,
    private footstep: (x: number, y: number, z: number) => void,
  ) {
    this.interactables = plan.lineup.map((s) => ({ kind: 'desk', x: s.x, z: s.z, radius: 1.3, off: true }));
  }

  /**
   * A worker sitting at `desk` now. `from` is where it comes in from, running to its seat, or
   * undefined: it's in its seat already.
   */
  add(id: string, model: Worker, desk: DeskView, from?: Pt) {
    const c: Courtier = { id, model, desk, goal: { seat: true }, state: 'seated', way: [], next: 0, hop: 0, from: new THREE.Vector3(), heading: 0, stepIn: 0, pace: WALK };
    this.people.set(id, c);
    if (!from) return;
    // Out into the hall where it comes in, then off to its seat at a run.
    this.detach(c);
    const [x, z] = from;
    c.model.root.position.set(x, this.ground(x, z, 2) - FEET, z);
    c.pace = RUN;
    // On its feet in the hall (not in its seat), so it sets off for it.
    c.state = 'stand';
    this.walkTo(c, { seat: true });
  }

  /** Stops walking `id` about (it's gone, or being sent home), leaving its model wherever it is. Where it stood, if it was up. */
  release(id: string): Pt | undefined {
    const c = this.people.get(id);
    if (!c) return undefined;
    this.people.delete(id);
    c.model.walking = false;
    c.model.gait = 1;
    delete c.model.root.userData.interact;
    this.freeSpots();
    if (c.state === 'seated') return undefined;
    const p = c.model.root.position;
    return [p.x, p.z];
  }

  /** Whether `id` is up out of its seat. */
  away(id: string): boolean {
    const c = this.people.get(id);
    return !!c && c.state !== 'seated';
  }

  /** Where `id` is in line, or on its way to (0 is at the front), or -1. */
  spotOf(id: string): number {
    const c = this.people.get(id);
    return c && c.state !== 'seated' && 'spot' in c.goal ? c.goal.spot : -1;
  }

  /** Who's waiting on someone, the one who's waited longest first: they line up in that order, as many as there are spots. */
  line(waiting: readonly string[]) {
    const spots = this.plan.lineup.length;
    const order = waiting.filter((id) => this.people.has(id)).slice(0, spots);
    for (const c of this.people.values()) {
      const i = order.indexOf(c.id);
      const goal: Goal = i >= 0 ? { spot: i } : { seat: true };
      if (sameGoal(goal, c.goal)) continue;
      c.pace = WALK;
      this.walkTo(c, goal);
    }
  }

  /** Everyone walking about, for the doors to open (the same list each time, to save making one a frame). */
  positions(): THREE.Vector3[] {
    this.walking.length = 0;
    for (const c of this.people.values()) if (c.state !== 'seated') this.walking.push(c.model.root.position);
    return this.walking;
  }
  private readonly walking: THREE.Vector3[] = [];

  update(dt: number) {
    for (const c of this.people.values()) this.step(c, dt);
  }

  /**
   * Each spot in line points at whoever's standing in it, and so does a click on them (the model
   * carries its spot's interactable, as a desk's group does its own). Run whenever someone takes a
   * spot or leaves one.
   */
  private freeSpots() {
    for (const it of this.interactables) {
      it.off = true;
      it.deskId = undefined;
    }
    for (const c of this.people.values()) {
      const it = c.state === 'stand' && 'spot' in c.goal ? this.interactables[c.goal.spot] : undefined;
      if (it) {
        it.off = false;
        it.deskId = c.desk.def.id;
        c.model.root.userData.interact = it;
      } else delete c.model.root.userData.interact;
    }
  }

  /** Out of its seat, into the hall, keeping where it is in the world. */
  private detach(c: Courtier) {
    const root = c.model.root;
    const pos = root.getWorldPosition(this.tmp).clone();
    const scale = root.getWorldScale(new THREE.Vector3()).x;
    const turn = root.getWorldQuaternion(new THREE.Quaternion());
    this.parent.add(root);
    root.position.copy(pos);
    // Upright, facing the way it was (as a heading, so turning from here never flips it round).
    c.heading = new THREE.Euler().setFromQuaternion(turn, 'YXZ').y;
    root.rotation.set(0, c.heading, 0);
    root.scale.setScalar(scale);
  }

  /** Sets off for `goal` from wherever it is: down off its seat first if it's in it. */
  private walkTo(c: Courtier, goal: Goal): void {
    c.goal = goal;
    c.model.stopDancing();
    const target: Pt | null = 'spot' in goal ? [this.plan.lineup[goal.spot].x, this.plan.lineup[goal.spot].z] : null;
    if (c.state === 'seated') {
      if (!target) return;
      this.detach(c);
      c.way = this.nav.wayFrom(c.desk.def, target);
      c.from.copy(c.model.root.position);
      c.state = 'down';
      c.hop = 0;
      c.next = 0;
      return;
    }
    const p = c.model.root.position;
    const here: Pt = [p.x, p.z];
    // Mid-hop onto its seat and wanted back in line: it finishes the hop, and gets straight down again.
    if (c.state === 'up' && target) {
      c.state = 'seated';
      this.seat(c);
      return this.walkTo(c, goal);
    }
    // Still getting down: from where it lands, it heads the new way.
    if (c.state === 'down') {
      const land = c.way[0];
      c.way = [land, ...(target ? this.nav.route(land, target) : this.nav.wayTo(land, c.desk.def)).slice(1)];
      return;
    }
    const left = c.state === 'stand';
    c.way = target ? this.nav.route(here, target) : this.nav.wayTo(here, c.desk.def);
    c.next = 1;
    c.state = 'walk';
    // Out of its spot in line: it's no longer there to walk up to.
    if (left) this.freeSpots();
  }

  private step(c: Courtier, dt: number) {
    const root = c.model.root;
    const pos = root.position;
    if (c.state === 'seated') return;
    if (c.state === 'down') {
      // Down off the seat in a little arc, turning to face the way it's going.
      c.hop = Math.min(1, c.hop + dt / HOP);
      const [x0, z0] = c.way[0];
      const floor = this.ground(x0, z0, c.from.y + 0.5) - FEET;
      pos.set(THREE.MathUtils.lerp(c.from.x, x0, c.hop), THREE.MathUtils.lerp(c.from.y, floor, c.hop) + Math.sin(c.hop * Math.PI) * 0.3, THREE.MathUtils.lerp(c.from.z, z0, c.hop));
      const [x1, z1] = c.way[1] ?? c.way[0];
      c.heading = Math.atan2(x1 - x0, z1 - z0);
      root.rotation.set(0, root.rotation.y + wrap(c.heading - root.rotation.y) * Math.min(1, dt * 8), 0);
      if (c.hop >= 1) {
        c.state = 'walk';
        c.next = 1;
      }
      return;
    }
    if (c.state === 'up') {
      // Up onto the seat in a little arc, turning to face the table.
      c.hop = Math.min(1, c.hop + dt / HOP);
      const seat = c.desk.seatAnchor.getWorldPosition(this.tmp);
      pos.set(THREE.MathUtils.lerp(c.from.x, seat.x, c.hop), THREE.MathUtils.lerp(c.from.y, seat.y, c.hop) + Math.sin(c.hop * Math.PI) * 0.3, THREE.MathUtils.lerp(c.from.z, seat.z, c.hop));
      root.rotation.set(0, root.rotation.y + wrap(c.desk.def.rotY + Math.PI - root.rotation.y) * Math.min(1, dt * 9), 0);
      if (c.hop >= 1) this.seat(c);
      return;
    }
    if (c.state === 'walk') {
      let move = c.pace * c.model.pace * dt;
      while (move > 0 && c.next < c.way.length) {
        const [x, z] = c.way[c.next];
        const dx = x - pos.x;
        const dz = z - pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 1e-4) c.heading = Math.atan2(dx, dz);
        if (d <= move) {
          pos.x = x;
          pos.z = z;
          move -= d;
          c.next++;
        } else {
          pos.x += (dx / d) * move;
          pos.z += (dz / d) * move;
          move = 0;
        }
      }
      c.model.walking = c.next < c.way.length;
      // Its feet go as fast as it does: quicker running, slower shuffling.
      c.model.gait = c.pace / WALK;
      if (c.model.walking) {
        c.stepIn -= dt;
        if (c.stepIn <= 0) {
          c.stepIn += Math.PI / (9 * c.model.pace * c.model.gait);
          this.footstep(pos.x, pos.y, pos.z);
        }
      } else if ('seat' in c.goal) {
        // Beside its seat: up onto it.
        c.state = 'up';
        c.hop = 0;
        c.from.copy(pos);
      } else {
        c.state = 'stand';
        this.freeSpots();
      }
    }
    // Up and down the dais steps as it goes, and facing the way it's walking, or the throne once it's in line.
    const g = this.ground(pos.x, pos.z, pos.y + FEET + 0.35) - FEET;
    pos.y += (g - pos.y) * Math.min(1, dt * 14);
    const face = c.state === 'stand' && 'spot' in c.goal ? this.plan.lineup[c.goal.spot].rotY : c.heading;
    root.rotation.set(0, root.rotation.y + wrap(face - root.rotation.y) * Math.min(1, dt * 8), 0);
  }

  /** Back in its seat: from here on it's where every worker sits. */
  private seat(c: Courtier) {
    const root = c.model.root;
    c.state = 'seated';
    c.model.walking = false;
    c.model.gait = 1;
    c.pace = WALK;
    c.desk.seatAnchor.add(root);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
  }
}
