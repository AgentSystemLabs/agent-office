import * as THREE from 'three';
import { wayHome, type Pt } from '../../shared/nav';
import type { Worker } from './character';
import type { Laptop } from './laptop';
import type { DeskView } from './office';

/** Walking pace on the way out, in m/s: no hurry any more. */
const PACE = 2.3;
/** Seconds sat at the desk while its things go in the box and the laptop shuts. */
const PACK = 0.9;
/** Seconds hopping down off the chair (or the bean bag). */
const HOP = 0.55;
/** A worker's feet are this far above its origin, so standing on something its origin is this far below the top. */
const FEET = 0.07;
/** Seconds to shrink away once it's off down the sidewalk. */
const GONE = 0.6;
/** Seconds for a shut laptop to shrink away. */
const LAPTOP_GONE = 0.3;

const FAREWELLS = ['😢 bye, everyone', '🥲 it was fun', '📦 welp', '😞 cleaning out my desk', '🥺 but my PR…', '😶 security is walking me out'];

interface Leaver {
  model: Worker;
  deskId: string;
  way: Pt[];
  /** The point on `way` it's walking to; 0 until it has hopped down. */
  next: number;
  /** Seconds since it was sent home. */
  t: number;
  /** Where it sat. */
  seat: THREE.Vector3;
  /** The way it's walking (rotation around y; 0 is +z). */
  heading: number;
  /** Seconds until its next footstep. */
  stepIn: number;
  /** The desk chair it got up from, spinning after it (null for a bean bag, or once someone new sits there). */
  chair: THREE.Object3D | null;
  spin: number;
  scale: number;
  /** 0 → 1 as it shrinks away at the end. */
  gone: number;
}

interface Closing {
  laptop: Laptop;
  deskId: string;
  /** 0 → 1 as it shrinks away, once the lid is shut. */
  gone: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/**
 * Workers who've been sent home. Each one packs its things into a cardboard box while its laptop
 * shuts, hops down off its chair, and walks out of the building with the box (see wayHome): out the
 * exit door, down the steps and off along the sidewalk, where it's gone.
 */
export class Departures {
  private leavers: Leaver[] = [];
  private laptops: Closing[] = [];

  constructor(
    private parent: THREE.Object3D,
    /** The top of whatever is underfoot at (x, z) for feet at `y`: the floor, a step, the street. */
    private ground: (x: number, z: number, y: number) => number,
    private footstep: (x: number, y: number, z: number) => void,
    /** It has got up from `deskId`, so the seat is free to see. */
    private onUp: (deskId: string) => void,
  ) {}

  /** Takes over a worker's model and laptop the moment it's sent home from `desk`. */
  add(model: Worker, laptop: Laptop, desk: DeskView) {
    const seat = model.root.getWorldPosition(new THREE.Vector3());
    const scale = model.root.getWorldScale(new THREE.Vector3()).x;
    this.parent.add(model.root);
    model.root.position.copy(seat);
    // On the seat it faces the desk: the seat anchor is turned round from the desk's own rotation.
    model.root.rotation.set(0, desk.def.rotY + Math.PI, 0);
    model.root.scale.setScalar(scale);
    model.leave(pick(FAREWELLS));
    const chair = desk.def.beanbag ? null : desk.chair;
    this.leavers.push({ model, deskId: desk.def.id, way: wayHome(desk.def), next: 0, t: 0, seat, heading: model.root.rotation.y, stepIn: 0, chair, spin: 0, scale, gone: 0 });
    this.laptops.push({ laptop, deskId: desk.def.id, gone: 0 });
  }

  /** Whether someone sent home from `deskId` is still sitting there, packing up. */
  seated(deskId: string): boolean {
    return this.leavers.some((l) => l.deskId === deskId && l.next === 0);
  }

  /** Someone new sat down at `deskId`: the old laptop goes at once, and whoever was packing there gets up. */
  vacate(deskId: string) {
    for (const c of this.laptops) if (c.deskId === deskId) this.dropLaptop(c);
    this.laptops = this.laptops.filter((c) => c.deskId !== deskId);
    for (const l of this.leavers) {
      if (l.deskId !== deskId) continue;
      l.t = Math.max(l.t, PACK + HOP);
      l.chair = null;
    }
  }

  /** Off to another floor: nobody from this one is left walking out. */
  clear() {
    const [laptops, leavers] = [this.laptops, this.leavers];
    this.laptops = [];
    this.leavers = [];
    for (const c of laptops) this.dropLaptop(c);
    for (const l of leavers) this.drop(l);
  }

  /** Where each of them is, for the doors to open. */
  positions(): THREE.Vector3[] {
    return this.leavers.map((l) => l.model.root.position);
  }

  update(dt: number, t: number) {
    this.laptops = this.laptops.filter((c) => {
      if (!c.laptop.shut(dt)) return true;
      c.gone = Math.min(1, c.gone + dt / LAPTOP_GONE);
      c.laptop.root.scale.setScalar(Math.max(0.001, 1 - c.gone * c.gone));
      if (c.gone < 1) return true;
      this.dropLaptop(c);
      return false;
    });
    this.leavers = this.leavers.filter((l) => {
      const here = this.step(l, dt);
      l.model.update(dt, t);
      if (!here) this.drop(l);
      return here;
    });
  }

  /** Moves one along; false once it's gone. */
  private step(l: Leaver, dt: number): boolean {
    l.t += dt;
    const { root } = l.model;
    const pos = root.position;
    l.model.walking = false;
    if (l.chair && l.spin) {
      l.chair.rotation.y += l.spin * dt;
      l.spin *= Math.exp(-dt * 1.4);
      if (Math.abs(l.spin) < 0.05) l.spin = 0;
    }
    if (l.t < PACK) return true;
    const [x0, z0] = l.way[0];
    if (l.next === 0) {
      const floor = this.ground(x0, z0, l.seat.y) - FEET;
      if (l.t < PACK + HOP) {
        // Down off the seat in a little arc, turning round on the way to face where it's going.
        const p = (l.t - PACK) / HOP;
        if (l.chair && !l.spin) l.spin = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 3);
        pos.set(THREE.MathUtils.lerp(l.seat.x, x0, p), THREE.MathUtils.lerp(l.seat.y, floor, p) + Math.sin(p * Math.PI) * 0.35, THREE.MathUtils.lerp(l.seat.z, z0, p));
        const [x1, z1] = l.way[1];
        root.rotation.y += wrap(Math.atan2(x1 - x0, z1 - z0) - root.rotation.y) * Math.min(1, dt * 7);
        return true;
      }
      pos.set(x0, floor, z0);
      l.next = 1;
      this.onUp(l.deskId);
    }
    let move = PACE * dt;
    while (move > 0 && l.next < l.way.length) {
      const [x, z] = l.way[l.next];
      const dx = x - pos.x;
      const dz = z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) l.heading = Math.atan2(dx, dz);
      if (d <= move) {
        pos.x = x;
        pos.z = z;
        move -= d;
        l.next++;
      } else {
        pos.x += (dx / d) * move;
        pos.z += (dz / d) * move;
        move = 0;
      }
    }
    // Down the steps a stair at a time.
    const g = this.ground(pos.x, pos.z, pos.y + FEET) - FEET;
    pos.y += (g - pos.y) * Math.min(1, dt * 14);
    root.rotation.y += wrap(l.heading - root.rotation.y) * Math.min(1, dt * 8);
    if (l.next < l.way.length) {
      l.model.walking = true;
      l.stepIn -= dt;
      if (l.stepIn <= 0) {
        l.stepIn += Math.PI / 9;
        this.footstep(pos.x, pos.y, pos.z);
      }
      return true;
    }
    // Off down the sidewalk: gone.
    l.gone = Math.min(1, l.gone + dt / GONE);
    root.scale.setScalar(Math.max(0.001, l.scale * (1 - l.gone * l.gone)));
    return l.gone < 1;
  }

  private drop(l: Leaver) {
    if (l.next === 0) this.onUp(l.deskId);
    l.model.root.removeFromParent();
    l.model.dispose();
  }

  private dropLaptop(c: Closing) {
    c.laptop.root.removeFromParent();
    c.laptop.dispose();
  }
}
