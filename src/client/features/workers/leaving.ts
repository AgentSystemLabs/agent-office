import * as THREE from 'three';
import { BALCONY, PARACHUTE } from '../../../shared/layout';
import { walkOff, type Pt } from '../../../shared/nav';
import type { Worker } from '../../world/character';
import type { Laptop } from './laptop';
import type { DeskView } from '../../world/types';
import type { Ways } from '../../world/world';
import { mesh, toonUnique } from '../../world/toon';

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

// Leaving a floor with no exit door, by parachute off the balcony.
/** Seconds climbing up onto the railing, then teetering on it. */
const CLIMB = 0.6;
const TEETER = 0.8;
/** Seconds falling before the chute opens, and how hard it jumped out (m/s, out and up). */
const FREEFALL = 0.7;
const LEAP = { out: 2.6, up: 2.4 };
const GRAVITY = 9.8;
/** How fast it sinks under the chute (m/s): quicker while it's a long way up, gently at the end. */
const SINK = { min: 2.2, max: 9, per: 4 };
/** How fast it circles down onto the spot it lands on (rad/s). */
const TURN = 1.2;
/** Seconds for the chute to pop open, and to crumple on the ground once it's down. */
const POP = 0.45;
const CRUMPLE = 1.3;
const JUMPS = ['🪂 geronimo!', '🪂 see ya!', '🪂 wheee!', '🪂 bye bye!', '🪂 I quit!'];
const CANOPIES = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#8338ec', '#ff8a5b'];

/** Seen from below too, so both sides of the fabric. */
const fabric = new Map<string, THREE.MeshToonMaterial>();
function cloth(color: string): THREE.MeshToonMaterial {
  let m = fabric.get(color);
  if (!m) {
    m = toonUnique(color);
    m.side = THREE.DoubleSide;
    fabric.set(color, m);
  }
  return m;
}
const CORD = new THREE.LineBasicMaterial({ color: '#2b2d42' });

/**
 * A parachute, to hang from a worker's shoulders: striped gores in a dome over its head, and the
 * cords down to it. Its origin is where it's strapped on, so it pops open (and crumples) from there.
 */
function parachute(color: string): { group: THREE.Group; dome: THREE.Group } {
  const group = new THREE.Group();
  group.position.y = 0.88;
  const dome = new THREE.Group();
  const R = 1.35;
  const rim = 1.15;
  const gores = 10;
  for (let i = 0; i < gores; i++) {
    const geo = new THREE.SphereGeometry(R, 3, 5, (i / gores) * Math.PI * 2, (Math.PI * 2) / gores, 0, rim);
    dome.add(mesh(geo, cloth(i % 2 ? '#fffaf3' : color), 0, 0, 0, false));
  }
  dome.scale.y = 0.62;
  dome.position.y = 1.25;
  group.add(dome);
  // A cord from each seam at the rim down to a shoulder.
  const ends: number[] = [];
  const rimY = 1.25 + R * Math.cos(rim) * 0.62;
  for (let i = 0; i < gores; i++) {
    const a = (i / gores) * Math.PI * 2;
    const x = Math.sin(a) * R * Math.sin(rim);
    const z = Math.cos(a) * R * Math.sin(rim);
    ends.push(x, rimY, z, x < 0 ? -0.24 : 0.24, 0, 0.02);
  }
  const cords = new THREE.BufferGeometry();
  cords.setAttribute('position', new THREE.Float32BufferAttribute(ends, 3));
  group.add(new THREE.LineSegments(cords, CORD));
  return { group, dome };
}

/** How it gets down from a floor with no exit door, and how far along it is. */
interface Chute {
  /** Walking out to the railing, up on it, over it, under the open chute, down on the ground, then off. */
  phase: 'walk' | 'climb' | 'teeter' | 'fall' | 'glide' | 'down' | 'off';
  /** Seconds into the phase. */
  t: number;
  color: string;
  /** Once it's open. */
  canopy: { group: THREE.Group; dome: THREE.Group } | null;
  from: THREE.Vector3;
  vel: THREE.Vector3;
  /** Where it lands (its origin's height there), the way round to it now, how wide it circles, and from how high. */
  land: THREE.Vector3;
  angle: number;
  radius: number;
  height: number;
}

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
  /** Off a floor with no exit door: out over the balcony railing by parachute. */
  chute: Chute | null;
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
 * exit door, down the steps and off along the sidewalk, where it's gone. Only the bottom floor has
 * an exit door, so from the floors above it goes out onto the balcony instead, climbs up on the
 * railing and jumps, and its parachute brings it down onto the lot out front, box and all.
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
    /** The way out of the building, on the map you're on (see Ways.home). */
    private ways: () => Ways,
  ) {}

  /**
   * Takes over a worker's model and laptop the moment it's sent home from `desk`. `from` is where it
   * stands if it's up out of its seat (in line for the throne, say): it sets off from there.
   */
  add(model: Worker, laptop: Laptop, desk: DeskView, from?: Pt) {
    // Off the desk first if it was up there dancing: it packs up in its seat.
    model.stopDancing();
    const seat = model.root.getWorldPosition(new THREE.Vector3());
    const scale = model.root.getWorldScale(new THREE.Vector3()).x;
    const facing = from ? model.root.getWorldQuaternion(new THREE.Quaternion()) : null;
    this.parent.add(model.root);
    model.root.position.copy(seat);
    // On the seat it faces the desk: the seat anchor is turned round from the desk's own rotation.
    // Upright, as a heading, so turning from there never flips it round.
    if (facing) model.root.rotation.set(0, new THREE.Euler().setFromQuaternion(facing, 'YXZ').y, 0);
    else model.root.rotation.set(0, desk.def.rotY + Math.PI, 0);
    model.root.scale.setScalar(scale);
    model.leave(pick(FAREWELLS));
    const chair = desk.def.beanbag || from ? null : desk.chair;
    const { way, chute: up } = this.ways().home(desk.def, from);
    const chute: Chute | null = up ? { phase: 'walk', t: 0, color: pick(CANOPIES), canopy: null, from: new THREE.Vector3(), vel: new THREE.Vector3(), land: new THREE.Vector3(), angle: 0, radius: 0, height: 1 } : null;
    this.leavers.push({ model, deskId: desk.def.id, way, next: 0, t: from ? PACK + HOP : 0, seat, heading: model.root.rotation.y, stepIn: 0, chair, spin: 0, scale, gone: 0, chute });
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
    const c = l.chute;
    if (c && c.phase !== 'walk' && c.phase !== 'off') return this.jump(l, c, dt);
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
    if (c?.phase === 'walk') {
      // At the railing: up and over it.
      c.phase = 'climb';
      c.t = 0;
      c.from.copy(pos);
      return true;
    }
    // Off down the sidewalk: gone.
    l.gone = Math.min(1, l.gone + dt / GONE);
    root.scale.setScalar(Math.max(0.001, l.scale * (1 - l.gone * l.gone)));
    return l.gone < 1;
  }

  /** Over the balcony railing and down by parachute, then onto its feet on the lot out front. */
  private jump(l: Leaver, c: Chute, dt: number): boolean {
    c.t += dt;
    const { root } = l.model;
    const pos = root.position;
    const turn = (to: number, rate: number) => (root.rotation.y += wrap(to - root.rotation.y) * Math.min(1, dt * rate));
    if (c.phase === 'climb') {
      // Up onto the top rail in a little hop, turning to face out over the street.
      const p = Math.min(1, c.t / CLIMB);
      const e = p * p * (3 - 2 * p);
      pos.set(c.from.x, THREE.MathUtils.lerp(c.from.y, PARACHUTE.railTop - FEET, e) + Math.sin(p * Math.PI) * 0.35, THREE.MathUtils.lerp(c.from.z, BALCONY.maxZ - 0.06, e));
      turn(0, 8);
      if (p < 1) return true;
      c.phase = 'teeter';
      c.t = 0;
      l.model.say(pick(JUMPS));
      return true;
    }
    if (c.phase === 'teeter') {
      // A wobble up there, then the leap.
      root.rotation.z = Math.sin(c.t * 11) * 0.1 * (1 - c.t / TEETER);
      turn(0, 8);
      if (c.t < TEETER) return true;
      root.rotation.z = 0;
      c.phase = 'fall';
      c.t = 0;
      c.vel.set(0, LEAP.up, LEAP.out);
      return true;
    }
    if (c.phase === 'fall') {
      c.vel.y -= GRAVITY * dt;
      pos.addScaledVector(c.vel, dt);
      // Tumbling forward a little on the way down.
      root.rotation.x = Math.min(0.6, c.t * 0.9);
      if (c.t < FREEFALL) return true;
      // The chute pops open, and it'll circle down onto a spot out on the lot.
      const chute = parachute(c.color);
      chute.group.scale.setScalar(0.05);
      root.add(chute.group);
      c.canopy = chute;
      const [e0, e1] = PARACHUTE.east;
      const x = pos.x + e0 + Math.random() * (e1 - e0);
      const z = pos.z + PARACHUTE.out;
      c.land.set(x, this.ground(x, z, pos.y) - FEET, z);
      c.radius = Math.hypot(pos.x - x, pos.z - z);
      c.angle = Math.atan2(pos.x - x, pos.z - z);
      c.height = Math.max(0.1, pos.y - c.land.y);
      c.phase = 'glide';
      c.t = 0;
      return true;
    }
    const canopy = c.canopy!;
    if (c.phase === 'glide') {
      // Open with a pop that overshoots a little, then swaying under it on the way down.
      const p = Math.min(1, c.t / POP);
      const u = p - 1;
      canopy.group.scale.setScalar(Math.max(0.05, 1 + 2.7 * u * u * u + 1.7 * u * u));
      canopy.group.rotation.z = Math.sin(c.t * 1.9) * 0.08;
      root.rotation.x *= Math.exp(-dt * 4);
      const h = pos.y - c.land.y;
      const sink = THREE.MathUtils.clamp(h / SINK.per, SINK.min, SINK.max);
      c.vel.y += (-sink - c.vel.y) * Math.min(1, dt * 4);
      pos.y += c.vel.y * dt;
      // Round and round, closing in on the spot as it gets lower.
      c.angle += TURN * dt;
      const r = c.radius * THREE.MathUtils.clamp(h / c.height, 0, 1);
      const x = c.land.x + Math.sin(c.angle) * r;
      const z = c.land.z + Math.cos(c.angle) * r;
      const k = Math.min(1, dt * 3);
      const dx = (x - pos.x) * k;
      const dz = (z - pos.z) * k;
      pos.x += dx;
      pos.z += dz;
      if (Math.hypot(dx, dz) > 1e-4) l.heading = Math.atan2(dx, dz);
      turn(l.heading, 3);
      if (pos.y > c.land.y) return true;
      // Down, with a thump.
      pos.y = c.land.y;
      root.rotation.x = 0;
      this.footstep(pos.x, pos.y, pos.z);
      c.phase = 'down';
      c.t = 0;
      return true;
    }
    // On the ground: the chute sags down behind it and is bundled away, and off it goes.
    const p = Math.min(1, c.t / CRUMPLE);
    canopy.group.rotation.set(-1.35 * Math.min(1, p * 1.6), 0, 0);
    canopy.dome.scale.y = 0.62 * (1 - 0.65 * p);
    canopy.group.scale.setScalar(Math.max(0.001, 1 - Math.max(0, (p - 0.55) / 0.45) ** 2));
    if (p < 1) return true;
    this.dropChute(c);
    c.phase = 'off';
    l.way = walkOff([pos.x, pos.z]);
    l.next = 1;
    return true;
  }

  private dropChute(c: Chute) {
    if (!c.canopy) return;
    c.canopy.group.removeFromParent();
    c.canopy.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    c.canopy = null;
  }

  private drop(l: Leaver) {
    if (l.next === 0) this.onUp(l.deskId);
    if (l.chute) this.dropChute(l.chute);
    l.model.root.removeFromParent();
    l.model.dispose();
  }

  private dropLaptop(c: Closing) {
    c.laptop.root.removeFromParent();
    c.laptop.dispose();
  }
}

interface Arriver {
  model: Worker;
  desk: DeskView;
  way: Pt[];
  /** The point on `way` it's walking to. */
  next: number;
  /** Seconds before it steps out of the elevator (they come out one after another), then seconds walking. */
  t: number;
  heading: number;
  stepIn: number;
  /** Where the hop up onto its chair starts, once it's beside it. */
  from?: THREE.Vector3;
  hop: number;
}

/** Walking pace on the way in to a meeting: a little brisker than on the way out. */
const IN_PACE = 2.8;
/** Seconds between one and the next stepping out of the elevator. */
const IN_SPACING = 0.9;

/**
 * Workers called to a meeting. Each steps out of the elevator, walks round the furniture to its chair
 * at the meeting table (see wayIn), hops up onto it and sits down, and from then on it's an ordinary
 * worker at its seat.
 */
export class Arrivals {
  private walkers: Arriver[] = [];
  /** When (performance.now(), in seconds) the next one to arrive may step out: they come one at a time. */
  private nextAt = 0;

  constructor(
    private parent: THREE.Object3D,
    /** The top of whatever is underfoot at (x, z) for feet at `y`. */
    private ground: (x: number, z: number, y: number) => number,
    private footstep: (x: number, y: number, z: number) => void,
    /** The way in, on the map you're on (see Ways.in). */
    private ways: () => Ways,
  ) {}

  /** Walks `model` in to its seat at `desk`, a moment after whoever stepped out of the elevator last. */
  add(model: Worker, desk: DeskView) {
    const now = performance.now() / 1000;
    const delay = Math.max(0, this.nextAt - now);
    this.nextAt = now + delay + IN_SPACING;
    const way = this.ways().in(desk.def);
    const [x, z] = way[0];
    this.parent.add(model.root);
    model.root.position.set(x, this.ground(x, z, 0) - FEET, z);
    model.root.rotation.set(0, 0, 0);
    model.root.scale.setScalar(desk.seatAnchor.getWorldScale(new THREE.Vector3()).x);
    model.root.visible = delay <= 0;
    this.walkers.push({ model, desk, way, next: 1, t: -delay, heading: 0, stepIn: 0, hop: 0 });
  }

  /** Stops walking `model` in: it was sent home before it sat down, or it's gone. */
  forget(model: Worker) {
    const w = this.walkers.find((x) => x.model === model);
    if (!w) return;
    model.walking = false;
    model.root.visible = true;
    this.walkers = this.walkers.filter((x) => x !== w);
  }

  /** Off to another floor: whoever is still on the way goes with the rest of that floor's workers. */
  clear() {
    for (const w of this.walkers) w.model.walking = false;
    this.walkers = [];
  }

  /** Where each of them is, for the doors to open. */
  positions(): THREE.Vector3[] {
    return this.walkers.filter((w) => w.t >= 0).map((w) => w.model.root.position);
  }

  update(dt: number) {
    this.walkers = this.walkers.filter((w) => {
      const walking = this.step(w, dt);
      if (!walking) this.sit(w);
      return walking;
    });
  }

  /** Moves one along; false once it's in its seat. */
  private step(w: Arriver, dt: number): boolean {
    w.t += dt;
    const { root } = w.model;
    if (w.t < 0) return true;
    root.visible = true;
    const pos = root.position;
    if (w.from) {
      // Up onto the chair in a little arc, turning to face the table.
      w.hop = Math.min(1, w.hop + dt / HOP);
      const seat = w.desk.seatAnchor.getWorldPosition(new THREE.Vector3());
      pos.set(THREE.MathUtils.lerp(w.from.x, seat.x, w.hop), THREE.MathUtils.lerp(w.from.y, seat.y, w.hop) + Math.sin(w.hop * Math.PI) * 0.35, THREE.MathUtils.lerp(w.from.z, seat.z, w.hop));
      root.rotation.y += wrap(w.desk.def.rotY + Math.PI - root.rotation.y) * Math.min(1, dt * 9);
      return w.hop < 1;
    }
    let move = IN_PACE * dt;
    while (move > 0 && w.next < w.way.length) {
      const [x, z] = w.way[w.next];
      const dx = x - pos.x;
      const dz = z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) w.heading = Math.atan2(dx, dz);
      if (d <= move) {
        pos.x = x;
        pos.z = z;
        move -= d;
        w.next++;
      } else {
        pos.x += (dx / d) * move;
        pos.z += (dz / d) * move;
        move = 0;
      }
    }
    const g = this.ground(pos.x, pos.z, pos.y + FEET) - FEET;
    pos.y += (g - pos.y) * Math.min(1, dt * 14);
    root.rotation.y += wrap(w.heading - root.rotation.y) * Math.min(1, dt * 8);
    w.model.walking = w.next < w.way.length;
    if (w.model.walking) {
      w.stepIn -= dt;
      if (w.stepIn <= 0) {
        w.stepIn += Math.PI / 9;
        this.footstep(pos.x, pos.y, pos.z);
      }
    } else w.from = pos.clone();
    return true;
  }

  /** In its seat: from here on it's where every worker sits. */
  private sit(w: Arriver) {
    const { root } = w.model;
    w.model.walking = false;
    w.desk.seatAnchor.add(root);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
  }
}
