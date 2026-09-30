import * as THREE from 'three';
import { levelRoute, type SendHomePlace, type SendHomeStep, type Spot } from '../../../shared/maps';
import type { Pt } from '../../../shared/nav';
import type { Person, Worker } from '../../world/character';
import type { Jail } from './jail';
import type { Laptop } from './laptop';
import type { DeskView } from '../../world/types';
import type { World } from '../../world/world';

/*
 * Workers sent home on a map with a script for it (MapPlan.sendHome, see shared/maps/dungeon.ts),
 * acting its steps out one after another: the castle's Kingsguard runs up from the dungeon, the
 * worker packs its things, and it's marched off down the stairs with a hand on its shoulder, thrown
 * into its cell, and the door slams behind it. Each step is a `begin` (once) and a `tick` (each
 * frame, until it's done) below; a new kind of step goes in SEND_HOME_STEPS (shared) and here.
 * A map without a script sees its workers out the office's way (leaving.ts).
 */

/** Paces (m/s): the worker's walk (slower the more worn out it is), or at a run; the escort's run to fetch it, and its walk. */
const WALK = 2.3;
const RUN = 3.8;
const GUARD_RUN = 4.8;
const GUARD_WALK = 2.6;
/** Seconds packing up at its seat, hopping down off it, and shrinking away once it's gone. */
const PACK = 0.9;
const HOP = 0.55;
const GONE = 0.6;
const LAPTOP_GONE = 0.3;
/** A worker's feet are this far above its origin (see leaving.ts). */
const FEET = 0.07;
/** How far behind the worker its escort walks, a hand on its shoulder. */
const BEHIND = 0.8;
/** The most escorts out at once: anyone else sent home meanwhile waits for one. */
const GUARDS = 4;
/** Thrown into its cell: the door swinging open, a step up to it, the throw, and the door slamming. */
const JAIL = { open: 0.5, step: 0.35, fly: 0.75, shut: 0.3 } as const;

const FAREWELLS = ['😢 bye, everyone', '🥲 it was fun', '📦 welp', '😞 cleaning out my desk', '🥺 but my PR…'];

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** Someone walking a way: the worker, or its escort. */
interface Walk {
  root: THREE.Object3D;
  way: Pt[];
  next: number;
  heading: number;
  stepIn: number;
}

interface Guard extends Walk {
  person: Person;
  /** The map's own, on watch at its post; the others are called out while it's busy, and put away after. */
  posted: boolean;
  /** Fetching a worker, marching one along, or heading back to its post. */
  mode: 'idle' | 'go' | 'wait' | 'follow' | 'home';
  speed: number;
}

interface Sendoff {
  id: string;
  model: Worker;
  desk: DeskView;
  laptop: { laptop: Laptop; gone: number; closing: boolean } | null;
  steps: SendHomeStep[];
  /** The step it's on, whether it's begun, and seconds into it. */
  i: number;
  begun: boolean;
  t: number;
  /** In its seat, getting down off it, on its feet, walking, being thrown into its cell, or done for. */
  state: 'seated' | 'hop' | 'stand' | 'walk' | 'fly' | 'done';
  walk: Walk;
  speed: number;
  hop: { from: THREE.Vector3; t: number };
  chair: THREE.Object3D | null;
  spin: number;
  scale: number;
  /** Where it's walked, for its escort to follow. */
  trail: Pt[];
  guard: Guard | null;
  /** Its seat in the dungeon, if it's to be locked up. */
  cell: { cell: number; spot: Spot } | null;
  jail: { phase: 'go' | 'open' | 'step' | 'fly' | 'shut'; t: number; from: THREE.Vector3; walked: boolean } | null;
  /** 0 → 1 as it shrinks away. */
  gone: number;
  leaving: boolean;
  /** What it (or its escort) said last, for how long to give it. */
  said: string;
  /** Its script has run to the end. */
  over: boolean;
}

export class Sendoffs {
  private list: Sendoff[] = [];
  private guards: Guard[] = [];
  private guardsOf: World | null = null;

  constructor(
    private parent: THREE.Object3D,
    /** The top of whatever is underfoot at (x, z) for feet at `y`. */
    private ground: (x: number, z: number, y: number) => number,
    private sounds: { step(x: number, y: number, z: number): void; door(at: THREE.Vector3, open: boolean): void; thud(at: THREE.Vector3): void },
    /** It has got up from `deskId`, so the seat is free to see. */
    private onUp: (deskId: string) => void,
    private world: () => World,
    private jail: Jail,
  ) {}

  /**
   * Takes over a worker's model and laptop the moment it's sent home from `desk`, and plays the map's
   * script out on it. `from` is where it stands if it's up out of its seat (in line for the throne).
   */
  add(id: string, model: Worker, laptop: Laptop, desk: DeskView, from?: Pt) {
    const plan = this.world().plan.sendHome;
    if (!plan) return;
    model.stopDancing();
    model.setAction(undefined);
    model.setStatus('idle', false);
    const pos = model.root.getWorldPosition(new THREE.Vector3());
    const scale = model.root.getWorldScale(new THREE.Vector3()).x;
    const facing = from ? model.root.getWorldQuaternion(new THREE.Quaternion()) : null;
    this.parent.add(model.root);
    model.root.position.copy(pos);
    if (facing) model.root.rotation.set(0, new THREE.Euler().setFromQuaternion(facing, 'YXZ').y, 0);
    else model.root.rotation.set(0, desk.def.rotY + Math.PI, 0);
    model.root.scale.setScalar(scale);
    const cell = plan.keeps ? this.jail.seatOf(id) : null;
    if (cell) this.jail.hold(id);
    this.list.push({
      id,
      model,
      desk,
      laptop: { laptop, gone: 0, closing: false },
      steps: plan.steps,
      i: 0,
      begun: false,
      t: 0,
      state: from ? 'stand' : 'seated',
      walk: { root: model.root, way: [], next: 0, heading: model.root.rotation.y, stepIn: 0 },
      speed: WALK,
      hop: { from: pos.clone(), t: 0 },
      chair: from || desk.def.beanbag ? null : desk.chair,
      spin: 0,
      scale,
      trail: [],
      guard: null,
      cell,
      jail: null,
      gone: 0,
      leaving: false,
      said: '',
      over: false,
    });
  }

  /** Whether someone sent home from `deskId` is still sitting there. */
  seated(deskId: string): boolean {
    return this.list.some((s) => s.desk.def.id === deskId && (s.state === 'seated' || s.state === 'hop'));
  }

  /** Someone new sat down at `deskId`: the old laptop goes at once, and whoever's still sitting there gets up. */
  vacate(deskId: string) {
    for (const s of this.list) {
      if (s.desk.def.id !== deskId) continue;
      if (s.laptop) this.dropLaptop(s);
      s.chair = null;
      if (s.state === 'seated') {
        // Up and out of the way, beside the seat, to wait for whatever's next.
        const w = this.world();
        const way = w.nav.wayFrom(s.desk.def, [w.plan.door.x, w.plan.door.z]);
        s.walk.way = [way[0]];
        this.getUp(s);
      }
    }
  }

  /** Off to another floor or map: nobody's left being seen out, and the escorts are back at their posts. */
  clear() {
    for (const s of this.list) this.drop(s);
    this.list = [];
    this.resetGuards();
  }

  /** Where each of them is, and their escorts, for the doors to open. */
  positions(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const s of this.list) if (s.state !== 'done') out.push(s.model.root.position);
    for (const g of this.guards) if (g.mode !== 'idle') out.push(g.root.position);
    return out;
  }

  /** How many are being seen out right now (for a look from the page). */
  get busy(): number {
    return this.list.length;
  }

  update(dt: number, t: number) {
    const w = this.world();
    if (w !== this.guardsOf) this.resetGuards();
    for (const s of this.list) this.step(s, dt, t);
    this.list = this.list.filter((s) => {
      if (!s.over || s.laptop) return true;
      // Done with: the escort takes itself back to its post.
      if (s.guard && s.guard.mode !== 'home' && s.guard.mode !== 'idle') this.sendBack(s.guard);
      return false;
    });
    for (const g of this.guards) this.moveGuard(g, dt, t);
  }

  // ---- The script --------------------------------------------------------------------------------

  private step(s: Sendoff, dt: number, t: number) {
    // Its chair spins on after it, the laptop (or tome) shuts once it's packing or up.
    if (s.chair && s.spin) {
      s.chair.rotation.y += s.spin * dt;
      s.spin *= Math.exp(-dt * 1.4);
      if (Math.abs(s.spin) < 0.05) s.spin = 0;
    }
    if (s.laptop?.closing && s.laptop.laptop.shut(dt)) {
      s.laptop.gone = Math.min(1, s.laptop.gone + dt / LAPTOP_GONE);
      s.laptop.laptop.root.scale.setScalar(Math.max(0.001, 1 - s.laptop.gone ** 2));
      if (s.laptop.gone >= 1) this.dropLaptop(s);
    }
    if (s.state !== 'done') this.move(s, dt);
    // Through the script, as far as it goes this frame. Past its end, whatever's left of the worker goes.
    let left = dt;
    while (!s.over) {
      if (s.i >= s.steps.length) {
        if (s.state === 'done') s.over = true;
        else s.leaving = true;
        break;
      }
      const step = s.steps[s.i];
      if (!s.begun) {
        s.begun = true;
        s.t = 0;
        this.begin(s, step);
      }
      s.t += left;
      left = 0;
      if (!this.tick(s, step)) break;
      s.i++;
      s.begun = false;
    }
    if (s.state !== 'done') s.model.update(dt, t);
  }

  private begin(s: Sendoff, step: SendHomeStep) {
    switch (step.do) {
      case 'pack': {
        // What it says next, if the script has it say something, or a farewell of its own.
        const next = s.steps[s.i + 1];
        s.model.leave(next?.do === 'say' && next.who !== 'escort' ? '📦' : pick(FAREWELLS));
        if (s.laptop) s.laptop.closing = true;
        return;
      }
      case 'say': {
        const text = (s.said = pick(step.text as string[]));
        if (step.who === 'escort') (s.guard?.person ?? this.guards[0]?.person)?.say(text, 3.4);
        else s.model.say(text);
        return;
      }
      case 'walk':
        return this.walkTo(s, step.to, step.run);
      case 'leave':
        s.leaving = true;
        return;
      case 'jail':
        if (s.cell) s.jail = { phase: 'go', t: 0, from: new THREE.Vector3(), walked: false };
        return;
      case 'return':
        if (s.guard) this.sendBack(s.guard);
        return;
    }
  }

  /** Whether `step` is done with. */
  private tick(s: Sendoff, step: SendHomeStep): boolean {
    switch (step.do) {
      case 'pack':
        return s.t >= PACK;
      case 'wait':
        return s.t >= step.seconds;
      case 'say':
        return s.t >= Math.min(2.4, 0.9 + s.said.length * 0.025);
      case 'fetch':
        return this.fetch(s, step.run !== false);
      case 'walk':
        return s.state === 'stand';
      case 'jail':
        // With no seat for it down there (the map changed its mind), it's just gone.
        if (!s.jail) {
          s.leaving = true;
          return true;
        }
        return this.lockUp(s);
      case 'leave':
        return s.state === 'done';
      case 'return':
        return true;
    }
  }

  /** The escort comes for it: true once it's there, beside it. */
  private fetch(s: Sendoff, run: boolean): boolean {
    if (!s.guard) {
      s.guard = this.freeGuard();
      // Every escort's out: it waits its turn.
      if (!s.guard) return false;
      const g = s.guard;
      g.speed = run ? GUARD_RUN : GUARD_WALK;
      // Up beside it, where it'll get down (or in front of it, if it's on its feet already).
      const p = s.model.root.position;
      let to: Pt;
      if (s.state === 'seated') {
        const way = this.plot(s, this.nextPlace(s));
        to = way[1] ?? way[0] ?? [p.x, p.z];
      } else {
        const a = s.walk.heading;
        to = [p.x + Math.sin(a) * 0.9, p.z + Math.cos(a) * 0.9];
      }
      g.way = this.between(this.at(g.root), this.levelOf(g.root.position.y), to, this.levelOf(p.y));
      g.next = 1;
      g.mode = 'go';
    }
    return s.guard.mode === 'wait';
  }

  /** Thrown into its cell, and the door locked behind it: true once it's shut. */
  private lockUp(s: Sendoff): boolean {
    const j = s.jail!;
    const d = this.world().dungeon;
    const c = d?.plan.cells[s.cell!.cell];
    if (!d || !c) {
      s.leaving = true;
      return true;
    }
    const pos = s.model.root.position;
    if (j.phase === 'go') {
      // Not at its cell's door yet (the script didn't take it there): off it goes, then.
      if (s.state === 'walk' || s.state === 'hop') return false;
      if (Math.hypot(pos.x - c.outside[0], pos.z - c.outside[1]) > 0.35 && !j.walked) {
        j.walked = true;
        this.walkTo(s, 'cell');
        return false;
      }
      j.phase = 'open';
      j.t = s.t;
      this.sounds.door(d.lock(s.cell!.cell), true);
    }
    const t = s.t - j.t;
    const face = Math.atan2(c.x - c.outside[0], c.z - c.outside[1]);
    if (j.phase === 'open') {
      d.swing(s.cell!.cell, Math.min(1, t / JAIL.open));
      s.model.root.rotation.y += wrap(face - s.model.root.rotation.y) * 0.2;
      if (t < JAIL.open) return false;
      j.phase = 'step';
      j.t = s.t;
      j.from.copy(pos);
      return false;
    }
    if (j.phase === 'step') {
      const k = Math.min(1, t / JAIL.step);
      pos.x = THREE.MathUtils.lerp(j.from.x, c.threshold[0], k);
      pos.z = THREE.MathUtils.lerp(j.from.z, c.threshold[1], k);
      s.model.walking = k < 1;
      if (k < 1) return false;
      // A shove from behind.
      s.guard?.person.reach();
      j.phase = 'fly';
      j.t = s.t;
      j.from.copy(pos);
      s.state = 'fly';
      return false;
    }
    if (j.phase === 'fly') {
      const k = Math.min(1, t / JAIL.fly);
      const spot = s.cell!.spot;
      pos.set(THREE.MathUtils.lerp(j.from.x, spot.x, k), THREE.MathUtils.lerp(j.from.y, spot.y, k) + Math.sin(k * Math.PI) * 0.9, THREE.MathUtils.lerp(j.from.z, spot.z, k));
      s.model.root.rotation.y += wrap(spot.rotY - s.model.root.rotation.y) * Math.min(1, k * 0.35);
      s.model.root.rotation.x = Math.sin(k * Math.PI) * -0.5;
      s.model.walking = false;
      if (k < 1) return false;
      // In a heap on the straw: from here on it's the jail's, sat where it landed.
      this.sounds.thud(pos.clone());
      this.jail.release(s.id);
      s.model.root.removeFromParent();
      s.model.dispose();
      s.state = 'done';
      j.phase = 'shut';
      j.t = s.t;
      return false;
    }
    // The door slams.
    const k = Math.min(1, t / JAIL.shut);
    d.swing(s.cell!.cell, 1 - k * k);
    if (k < 1) return false;
    this.sounds.door(d.lock(s.cell!.cell), false);
    s.guard?.person.holdOn(false);
    return true;
  }

  // ---- Walking ----------------------------------------------------------------------------------

  /** Where the script walks it next (or out of the door, if it doesn't). */
  private nextPlace(s: Sendoff): SendHomePlace {
    for (let i = s.i; i < s.steps.length; i++) {
      const st = s.steps[i];
      if (st.do === 'walk') return st.to;
      if (st.do === 'jail') return 'cell';
    }
    return 'door';
  }

  /** Where `to` is: a spot, and whether it's down in the dungeon. */
  private placeOf(s: Sendoff, to: SendHomePlace): { at: Pt; below: boolean } | null {
    const w = this.world();
    const d = w.dungeon?.plan;
    if (typeof to === 'object') return { at: [to.x, to.z], below: !!to.below && !!d };
    switch (to) {
      case 'stairs':
        return d ? { at: d.stairs.top, below: false } : null;
      case 'dungeon':
        return d ? { at: d.stairs.foot, below: true } : null;
      case 'cell': {
        const c = s.cell && d?.cells[s.cell.cell];
        return c ? { at: c.outside, below: true } : d ? { at: d.stairs.foot, below: true } : null;
      }
      case 'post': {
        const p = w.escort?.post;
        return p ? { at: [p.x, p.z], below: p.below } : null;
      }
      default:
        return null;
    }
  }

  /** The way from where it is (its seat, or where it stands) to `to`: the first point is where it gets down, if it's seated. */
  private plot(s: Sendoff, to: SendHomePlace): Pt[] {
    const w = this.world();
    const d = w.dungeon;
    const seated = s.state === 'seated';
    const here = this.at(s.model.root);
    const below = this.levelOf(s.model.root.position.y);
    if (to === 'door') {
      if (seated) return w.ways.home(s.desk.def).way;
      if (!below || !d) return w.ways.home(s.desk.def, here).way;
      const up = this.between(here, true, d.plan.stairs.top, false);
      return [...up, ...w.ways.home(s.desk.def, d.plan.stairs.top).way.slice(1)];
    }
    const p = this.placeOf(s, to);
    if (!p) return seated ? w.ways.home(s.desk.def).way : w.ways.home(s.desk.def, here).way;
    if (!seated) return this.between(here, below, p.at, p.below);
    // Off its seat on whichever side's the shorter way, then round the hall, and down the stairs if it's going down.
    const hallTo = p.below && d ? d.plan.stairs.top : p.at;
    const off = w.nav.wayFrom(s.desk.def, hallTo);
    return p.below && d ? [...off, ...this.between(d.plan.stairs.top, false, p.at, true).slice(1)] : off;
  }

  /** The way between two spots, up or down the dungeon stairs if they're on different levels. */
  private between(from: Pt, fromBelow: boolean, to: Pt, toBelow: boolean): Pt[] {
    const w = this.world();
    const d = w.dungeon;
    if (!d) return w.nav.route(from, to);
    return levelRoute(d.plan, w.nav, d.nav, from, fromBelow, to, toBelow);
  }

  private walkTo(s: Sendoff, to: SendHomePlace, run?: boolean) {
    s.speed = (run ? RUN : WALK) * s.model.pace;
    s.walk.way = this.plot(s, to);
    s.walk.next = 1;
    if (s.laptop) s.laptop.closing = true;
    if (s.guard) {
      s.guard.mode = 'follow';
      s.guard.person.holdOn(true);
    }
    if (s.state === 'seated') this.getUp(s);
    else {
      s.state = 'walk';
      s.trail = [this.at(s.model.root)];
    }
  }

  private getUp(s: Sendoff) {
    s.state = 'hop';
    s.hop = { from: s.model.root.position.clone(), t: 0 };
    if (s.chair && !s.spin) s.spin = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 3);
  }

  /** Moves the worker along: down off its seat, along its way, or shrinking away. */
  private move(s: Sendoff, dt: number) {
    const root = s.model.root;
    const pos = root.position;
    if (s.leaving && s.state !== 'hop') {
      s.model.walking = false;
      s.gone = Math.min(1, s.gone + dt / GONE);
      root.scale.setScalar(Math.max(0.001, s.scale * (1 - s.gone * s.gone)));
      if (s.gone >= 1) {
        root.removeFromParent();
        s.model.dispose();
        this.jail.release(s.id);
        s.state = 'done';
      }
      return;
    }
    if (s.state === 'hop') {
      s.hop.t = Math.min(1, s.hop.t + dt / HOP);
      const [x0, z0] = s.walk.way[0] ?? [pos.x, pos.z];
      const floor = this.ground(x0, z0, s.hop.from.y) - FEET;
      const p = s.hop.t;
      pos.set(THREE.MathUtils.lerp(s.hop.from.x, x0, p), THREE.MathUtils.lerp(s.hop.from.y, floor, p) + Math.sin(p * Math.PI) * 0.35, THREE.MathUtils.lerp(s.hop.from.z, z0, p));
      const [x1, z1] = s.walk.way[1] ?? s.walk.way[0] ?? [pos.x, pos.z + 1];
      s.walk.heading = Math.atan2(x1 - x0, z1 - z0);
      root.rotation.y += wrap(s.walk.heading - root.rotation.y) * Math.min(1, dt * 7);
      if (p < 1) return;
      this.onUp(s.desk.def.id);
      s.trail = [[x0, z0]];
      s.state = s.walk.way.length > 1 ? 'walk' : 'stand';
      s.walk.next = 1;
      return;
    }
    if (s.state !== 'walk') return;
    const arrived = this.along(s.walk, s.speed, dt);
    s.model.walking = !arrived;
    // Where it's been, for its escort to follow in its footsteps.
    const last = s.trail[s.trail.length - 1];
    if (!last || Math.hypot(pos.x - last[0], pos.z - last[1]) > 0.08) s.trail.push([pos.x, pos.z]);
    if (s.trail.length > 400) s.trail.splice(0, 200);
    if (arrived) s.state = 'stand';
  }

  /** A step along `m.way` at `speed`, up and down stairs as the ground goes, with footsteps: true once it's at the end. */
  private along(m: Walk, speed: number, dt: number): boolean {
    const pos = m.root.position;
    let move = speed * dt;
    while (move > 0 && m.next < m.way.length) {
      const [x, z] = m.way[m.next];
      const dx = x - pos.x;
      const dz = z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) m.heading = Math.atan2(dx, dz);
      if (d <= move) {
        pos.x = x;
        pos.z = z;
        move -= d;
        m.next++;
      } else {
        pos.x += (dx / d) * move;
        pos.z += (dz / d) * move;
        move = 0;
      }
    }
    const g = this.ground(pos.x, pos.z, pos.y + FEET + 0.35) - FEET;
    pos.y += (g - pos.y) * Math.min(1, dt * 14);
    m.root.rotation.y += wrap(m.heading - m.root.rotation.y) * Math.min(1, dt * 8);
    const walking = m.next < m.way.length;
    if (walking) {
      m.stepIn -= dt;
      if (m.stepIn <= 0) {
        m.stepIn += 0.9 / Math.max(1, speed);
        this.sounds.step(pos.x, pos.y, pos.z);
      }
    }
    return !walking;
  }

  // ---- The escorts ------------------------------------------------------------------------------

  private moveGuard(g: Guard, dt: number, t: number) {
    const pos = g.root.position;
    let moving = false;
    if (g.mode === 'go' || g.mode === 'home') {
      moving = !this.along(g, g.speed, dt);
      if (!moving) {
        if (g.mode === 'home') {
          const post = this.world().escort?.post;
          if (post) g.heading = post.rotY;
          g.mode = 'idle';
          g.person.holdOn(false);
          // One called out to help goes back in; the one on watch stays at its post.
          if (!g.posted) g.root.visible = false;
        } else g.mode = 'wait';
      }
    } else if (g.mode === 'follow' || g.mode === 'wait') {
      const s = this.list.find((x) => x.guard === g);
      if (s && g.mode === 'follow' && s.state !== 'fly' && s.state !== 'done') {
        // A step behind it, where it's just been.
        const [tx, tz] = behind(s.trail, BEHIND) ?? this.at(g.root);
        const dx = tx - pos.x;
        const dz = tz - pos.z;
        const d = Math.hypot(dx, dz);
        const step = Math.min(d, Math.max(s.speed, 1) * 1.6 * dt);
        if (d > 0.02) {
          pos.x += (dx / d) * step;
          pos.z += (dz / d) * step;
          moving = step > 0.004;
        }
        const gr = this.ground(pos.x, pos.z, pos.y + FEET + 0.35) - FEET;
        pos.y += (gr - pos.y) * Math.min(1, dt * 14);
      }
      // Facing whoever it's come for.
      if (s && s.state !== 'done') {
        const p = s.model.root.position;
        if (Math.hypot(p.x - pos.x, p.z - pos.z) > 0.05) g.heading = Math.atan2(p.x - pos.x, p.z - pos.z);
      }
      if (moving) {
        g.stepIn -= dt;
        if (g.stepIn <= 0) {
          g.stepIn += 0.35;
          this.sounds.step(pos.x, pos.y, pos.z);
        }
      }
    }
    g.root.rotation.y += wrap(g.heading - g.root.rotation.y) * Math.min(1, dt * 8);
    if (g.root.visible) g.person.update(dt, t, moving, false, moving ? Math.max(0.8, g.speed / GUARD_WALK) : 1);
  }

  /** An escort who isn't busy: the one on watch, or another called out (up to GUARDS of them). */
  private freeGuard(): Guard | null {
    const w = this.world();
    if (!w.escort) return null;
    if (w !== this.guardsOf) this.resetGuards();
    let g = this.guards.find((x) => x.mode === 'idle' && !this.list.some((s) => s.guard === x));
    if (!g && this.guards.length < GUARDS) {
      const person = w.escort.make();
      w.group.add(person.root);
      g = { person, root: person.root, posted: false, mode: 'idle', speed: GUARD_WALK, way: [], next: 0, heading: w.escort.post.rotY, stepIn: 0 };
      this.guards.push(g);
    }
    if (!g) return null;
    if (!g.posted) {
      // Out of the guardroom, at the post.
      const post = w.escort.post;
      g.root.position.set(post.x, post.y, post.z);
      g.root.rotation.y = g.heading = post.rotY;
      g.root.visible = true;
    }
    return g;
  }

  private sendBack(g: Guard) {
    const post = this.world().escort?.post;
    g.person.holdOn(false);
    if (!post) {
      g.mode = 'idle';
      return;
    }
    g.way = this.between(this.at(g.root), this.levelOf(g.root.position.y), [post.x, post.z], post.below);
    g.next = 1;
    g.speed = GUARD_WALK;
    g.mode = 'home';
  }

  /** The escorts of the world you're in, all back at their post: the one on watch, and nobody else. */
  private resetGuards() {
    for (const g of this.guards) {
      g.person.holdOn(false);
      if (!g.posted) g.root.removeFromParent();
    }
    this.guards = [];
    const w = this.world();
    this.guardsOf = w;
    const e = w.escort;
    if (!e) return;
    const g: Guard = { person: e.guard, root: e.guard.root, posted: true, mode: 'idle', speed: GUARD_WALK, way: [], next: 0, heading: e.post.rotY, stepIn: 0 };
    g.root.position.set(e.post.x, e.post.y, e.post.z);
    g.root.rotation.y = e.post.rotY;
    this.guards.push(g);
  }

  // ---- Bits -----------------------------------------------------------------------------------

  private at(o: THREE.Object3D): Pt {
    return [o.position.x, o.position.z];
  }

  /** Whether feet at `y` are down in the dungeon. */
  private levelOf(y: number): boolean {
    const d = this.world().dungeon?.plan;
    return !!d && y < d.ceiling - 0.5;
  }

  private drop(s: Sendoff) {
    if (s.state === 'seated' || s.state === 'hop') this.onUp(s.desk.def.id);
    if (s.laptop) this.dropLaptop(s);
    if (s.state !== 'done') {
      s.model.root.removeFromParent();
      s.model.dispose();
    }
    this.jail.release(s.id);
    const d = this.world().dungeon;
    if (s.cell && d) d.swing(s.cell.cell, 0);
  }

  private dropLaptop(s: Sendoff) {
    if (!s.laptop) return;
    s.laptop.laptop.root.removeFromParent();
    s.laptop.laptop.dispose();
    s.laptop = null;
  }
}

/** The point `dist` back along `trail` from its end (where it is now), or undefined while it hasn't gone that far. */
function behind(trail: Pt[], dist: number): Pt | undefined {
  let left = dist;
  for (let i = trail.length - 1; i > 0; i--) {
    const [x1, z1] = trail[i];
    const [x0, z0] = trail[i - 1];
    const d = Math.hypot(x1 - x0, z1 - z0);
    if (d >= left) {
      const k = left / d;
      return [x1 + (x0 - x1) * k, z1 + (z0 - z1) * k];
    }
    left -= d;
  }
  return undefined;
}
