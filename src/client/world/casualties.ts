import * as THREE from 'three';
import { ELEVATOR, ELEVATOR_FRONT } from '../../shared/layout';
import { nearestWalkable, route, type Pt } from '../../shared/nav';

/**
 * Workers shot with the .44 Magnum. Nothing here goes to the server: the death scene is local to
 * the shooter, and the confirmed kill goes out as an ordinary `worker.kill`.
 *
 * One shot, one scene: the worker tumbles out of its chair onto the floor with a thud, and a blood
 * pool spreads under it while its session keeps running (see shoot). From there either Revive
 * stands it back up in its seat with its session untouched, or confirming the kill calls in two
 * paramedics with a stretcher (see confirm): they walk in from the elevator, load the body (~1.5s,
 * the pool draining as it lifts), carry it back to the elevator and fade, and the laptop shuts and
 * shrinks as on a send-home. Other clients just see the send-home walk-out.
 *
 * No DOM or WebGL at import time, so tests can load this in Node.
 */

/** Seconds tumbling out of the chair onto the floor. */
export const FALL_TIME = 0.75;
/** Seconds for the blood pool to spread to full size under the body. */
export const BLEED_TIME = 6;
/** How wide the blood pool gets, in meters. */
export const POOL_R = 0.9;
/** Seconds lifting the body onto the stretcher, the pool draining as it goes. */
export const LOAD_TIME = 1.5;
/** How fast the medics walk the stretcher in and out, in m/s. */
export const MEDIC_PACE = 3;
/** Seconds fading away at the elevator with the body. */
export const FADE_TIME = 0.7;
/** Seconds for the team's pop-in at the elevator. */
const TEAM_IN = 0.35;
/** Seconds for a shut laptop to shrink away. */
const LAPTOP_GONE = 0.3;
/** A worker's feet are this far above its origin. */
const FEET = 0.07;
/** How high the stretcher's bed is. */
const BED_Y = 0.72;
/** How far out of its seat the shot worker lands. */
const TUMBLE = 0.65;

/** Where the medics come from: out of the elevator, on every floor. */
const MEDIC_FROM: Pt = [ELEVATOR.x, ELEVATOR_FRONT + 0.5];

/** Falling, bled out waiting on the dialog, medics on the way, loading, carrying out, gone. */
export type CasualtyPhase = 'fall' | 'bled' | 'fetch' | 'load' | 'carry' | 'fade';

/** What a casualty needs of a worker's model (see world/character.ts Worker). */
export interface CasualtyModel {
  readonly root: THREE.Group;
  update(dt: number, t: number): void;
  /** Light out, face slack, bubble gone. */
  die(): void;
  /** Back on its feet: light and bubble as its status says. */
  revive(): void;
  dispose(): void;
}

/** What a casualty needs of a medic (see world/character.ts Person). */
export interface Medic {
  readonly root: THREE.Group;
  update(dt: number, t: number, moving: boolean, airborne: boolean): void;
  dispose(): void;
}

/** What a casualty needs of a laptop (see world/laptop.ts Laptop). */
export interface CasualtyLaptop {
  readonly root: THREE.Object3D;
  /** Shuts the lid; true once it's shut. */
  shut(dt: number): boolean;
  dispose(): void;
}

export interface CasualtyHooks {
  /** A paramedic in whites, by name. */
  spawnMedic(name: string): Medic;
  /** The thud as the body lands, and the siren sting as the medics come in. */
  onLand(at: THREE.Vector3): void;
  onSiren(at: THREE.Vector3): void;
}

let poolGeo: THREE.CircleGeometry | null = null;
let poolMat: THREE.MeshBasicMaterial | null = null;

/** The blood pool: a spreading circle with a lobe off to one side, so it isn't a perfect disc. */
function bloodPool(): THREE.Group {
  poolGeo ??= new THREE.CircleGeometry(1, 28);
  poolMat ??= new THREE.MeshBasicMaterial({ color: '#a31621', transparent: true, opacity: 0.88, depthWrite: false });
  const pool = new THREE.Group();
  const main = new THREE.Mesh(poolGeo, poolMat);
  main.rotation.x = -Math.PI / 2;
  pool.add(main);
  const lobe = new THREE.Mesh(poolGeo, poolMat);
  lobe.rotation.x = -Math.PI / 2;
  lobe.position.set(0.55, 0.001, 0.35);
  lobe.scale.setScalar(0.55);
  pool.add(lobe);
  pool.scale.setScalar(0.05);
  return pool;
}

/** A stretcher: an orange canvas with a red cross on it, on poles, carried at BED_Y. */
function stretcher(): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.MeshToonMaterial({ color: '#ced4da' });
  const canvas = new THREE.MeshToonMaterial({ color: '#e36414' });
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.9, 8).rotateX(Math.PI / 2), pole);
    p.position.set(s * 0.32, BED_Y, 0);
    g.add(p);
  }
  const bed = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 1.5), canvas);
  bed.position.y = BED_Y;
  g.add(bed);
  const cross = new THREE.MeshToonMaterial({ color: '#e63946' });
  for (const [w, d] of [
    [0.3, 0.1],
    [0.1, 0.3],
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.045, d), cross);
    bar.position.y = BED_Y;
    g.add(bar);
  }
  return g;
}

interface Team {
  group: THREE.Group;
  medics: Medic[];
  way: Pt[];
  next: number;
  heading: number;
}

interface Casualty {
  model: CasualtyModel;
  /** The seat anchor it fell out of (and goes back to on Revive). */
  seat: THREE.Object3D;
  scale: number;
  phase: CasualtyPhase;
  /** Seconds into the phase. */
  t: number;
  /** 0 → 1 as the pool spreads. */
  bleed: number;
  /** Where it sat, and the way it faced. */
  from: THREE.Vector3;
  yaw: number;
  /** Which way it tips over, and how far. */
  tip: number;
  lean: number;
  /** Where it lands on the floor. */
  floor: THREE.Vector3;
  pool: THREE.Group;
  laptop: CasualtyLaptop | null;
  /** 0 → 1 as the shut laptop shrinks away. */
  lgone: number;
  team: Team | null;
  /** Confirmed: the model and laptop are this class's to dispose. Before that they're the office's. */
  owned: boolean;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const easeOut = (p: number) => 1 - (1 - p) * (1 - p);

export class Casualties {
  private all = new Map<string, Casualty>();

  constructor(
    private parent: THREE.Object3D,
    /** The top of whatever is underfoot at (x, z) for feet at `y`. */
    private ground: (x: number, z: number, y: number) => number,
    private hooks: CasualtyHooks,
  ) {}

  /** Whether `id` is down on the floor waiting on the bleed-out dialog. */
  dying(id: string): boolean {
    const c = this.all.get(id);
    return !!c && (c.phase === 'fall' || c.phase === 'bled');
  }

  /** The phase `id` is in, if it has a scene running. */
  phaseOf(id: string): CasualtyPhase | null {
    return this.all.get(id)?.phase ?? null;
  }

  /**
   * Shoots the worker: it tumbles out of `seat` onto the floor, landing with a thud, and bleeds
   * out under a spreading pool. False when it already has a scene running.
   */
  shoot(id: string, model: CasualtyModel, seat: THREE.Object3D): boolean {
    if (this.all.has(id)) return false;
    // Off the desk first if it was up there dancing: it falls out of its seat.
    model.die();
    const from = model.root.getWorldPosition(new THREE.Vector3());
    const quat = model.root.getWorldQuaternion(new THREE.Quaternion());
    const yaw = new THREE.Euler().setFromQuaternion(quat, 'YXZ').y;
    const scale = model.root.getWorldScale(new THREE.Vector3()).x;
    const local = model.root.scale.x;
    this.parent.add(model.root);
    model.root.position.copy(from);
    model.root.quaternion.copy(quat);
    model.root.scale.setScalar(scale);
    const floor = new THREE.Vector3(from.x + Math.sin(yaw) * TUMBLE, 0, from.z + Math.cos(yaw) * TUMBLE);
    floor.y = this.ground(floor.x, floor.z, from.y) - FEET;
    const pool = bloodPool();
    pool.position.set(floor.x, floor.y + 0.012, floor.z);
    pool.rotation.y = Math.random() * Math.PI * 2;
    this.parent.add(pool);
    this.all.set(id, {
      model,
      seat,
      scale: local,
      phase: 'fall',
      t: 0,
      bleed: 0,
      from,
      yaw,
      tip: (Math.random() < 0.5 ? -1 : 1) * (1.35 + Math.random() * 0.25),
      lean: (Math.random() - 0.5) * 0.5,
      floor,
      pool,
      laptop: null,
      lgone: 0,
      team: null,
      owned: false,
    });
    return true;
  }

  /**
   * Revive stands the worker back up in its seat with its session untouched, blood gone. False
   * when there's nothing (left) to revive.
   */
  revive(id: string): boolean {
    const c = this.all.get(id);
    if (!c || (c.phase !== 'fall' && c.phase !== 'bled')) return false;
    this.reseat(c);
    this.dropPool(c);
    this.all.delete(id);
    return true;
  }

  /**
   * Confirms the kill: two paramedics walk in from the elevator with a stretcher, load the body
   * (~1.5s, the pool draining as it lifts), carry it back to the elevator and fade. The laptop
   * shuts and shrinks as on a send-home. False when there's no body to collect.
   */
  confirm(id: string, laptop: CasualtyLaptop): boolean {
    const c = this.all.get(id);
    if (!c || (c.phase !== 'fall' && c.phase !== 'bled')) return false;
    if (c.phase === 'fall') this.land(c);
    c.owned = true;
    c.laptop = laptop;
    c.phase = 'fetch';
    c.t = 0;
    const group = new THREE.Group();
    const medics = [this.hooks.spawnMedic('🚑 Medic'), this.hooks.spawnMedic('🚑 Medic')];
    medics[0].root.position.set(0, 0, 0.95);
    medics[1].root.position.set(0, 0, -0.95);
    medics[1].root.rotation.y = Math.PI;
    group.add(medics[0].root, medics[1].root, stretcher());
    group.scale.setScalar(0.01);
    this.parent.add(group);
    const body: Pt = [c.floor.x, c.floor.z];
    const way = route(MEDIC_FROM, nearestWalkable(body));
    way.push(body);
    group.position.set(way[0][0], this.ground(way[0][0], way[0][1], c.floor.y) - FEET, way[0][1]);
    c.team = { group, medics, way, next: 1, heading: 0 };
    this.hooks.onSiren(group.position);
    return true;
  }

  /** Off to another floor, or gone: every scene ends, models back in their seats unless collected. */
  clear() {
    for (const c of this.all.values()) {
      if (c.owned) {
        c.model.root.removeFromParent();
        c.model.dispose();
      } else this.reseat(c);
      this.dropTeam(c);
      this.dropPool(c);
      this.dropLaptop(c);
    }
    this.all.clear();
  }

  /** Where the medic teams are, for the doors to open. */
  positions(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const c of this.all.values()) if (c.team) out.push(c.team.group.position);
    return out;
  }

  update(dt: number, t: number) {
    for (const [id, c] of [...this.all]) {
      this.step(c, dt);
      c.model.update(dt, t);
      if (c.team) for (const m of c.team.medics) m.update(dt, t, c.phase === 'fetch' || c.phase === 'carry', false);
      if (c.laptop && !this.closeLaptop(c, dt)) c.laptop = null;
      if (c.phase === 'fade' && c.t >= FADE_TIME) {
        this.dropTeam(c);
        this.dropPool(c);
        this.dropLaptop(c);
        c.model.root.removeFromParent();
        c.model.dispose();
        this.all.delete(id);
      }
    }
  }

  private step(c: Casualty, dt: number) {
    c.t += dt;
    const { root } = c.model;
    switch (c.phase) {
      case 'fall': {
        const p = Math.min(1, c.t / FALL_TIME);
        const e = easeOut(p);
        root.position.set(THREE.MathUtils.lerp(c.from.x, c.floor.x, e), THREE.MathUtils.lerp(c.from.y, c.floor.y, e) + Math.sin(p * Math.PI) * 0.3, THREE.MathUtils.lerp(c.from.z, c.floor.z, e));
        root.rotation.set(c.tip * e, c.yaw + c.lean * e, c.lean * 0.6 * e);
        if (p >= 1) this.land(c);
        return;
      }
      case 'bled':
        c.bleed = Math.min(1, c.bleed + dt / BLEED_TIME);
        c.pool.scale.setScalar(Math.max(0.05, POOL_R * easeOut(c.bleed)));
        return;
      case 'fetch': {
        const team = c.team!;
        team.group.scale.setScalar(Math.max(0.01, Math.min(1, c.t / TEAM_IN)));
        if (this.walk(team, dt)) {
          c.phase = 'load';
          c.t = 0;
        }
        return;
      }
      case 'load': {
        // Up onto the stretcher, turning to lie along it, the pool draining as it lifts.
        const p = Math.min(1, c.t / LOAD_TIME);
        const e = p * p * (3 - 2 * p);
        const team = c.team!;
        const bed = team.group.localToWorld(new THREE.Vector3(0, BED_Y + 0.05, 0));
        root.position.lerpVectors(c.floor, bed, e);
        root.rotation.y = c.yaw + wrap(team.heading - c.yaw) * e;
        c.pool.scale.setScalar(Math.max(0.001, POOL_R * (1 - e)));
        if (p < 1) return;
        team.group.add(root);
        root.position.set(0, BED_Y + 0.05, 0);
        const here: Pt = [team.group.position.x, team.group.position.z];
        team.way = [here, ...route(nearestWalkable(here), MEDIC_FROM)];
        team.next = 1;
        c.phase = 'carry';
        c.t = 0;
        return;
      }
      case 'carry':
        if (this.walk(c.team!, dt)) {
          c.phase = 'fade';
          c.t = 0;
        }
        return;
      case 'fade': {
        const p = Math.min(1, c.t / FADE_TIME);
        c.team!.group.scale.setScalar(Math.max(0.001, 1 - p * p));
        return;
      }
    }
  }

  /** Down: it lands with a thud and starts bleeding out. */
  private land(c: Casualty) {
    c.model.root.position.copy(c.floor);
    c.model.root.rotation.set(c.tip, c.yaw + c.lean, c.lean * 0.6);
    c.phase = 'bled';
    c.t = 0;
    this.hooks.onLand(c.floor);
  }

  /** Walks a team along its way; true once it's there. */
  private walk(team: Team, dt: number): boolean {
    const pos = team.group.position;
    let move = MEDIC_PACE * dt;
    while (move > 0 && team.next < team.way.length) {
      const [x, z] = team.way[team.next];
      const dx = x - pos.x;
      const dz = z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-4) team.heading = Math.atan2(dx, dz);
      if (d <= move) {
        pos.x = x;
        pos.z = z;
        move -= d;
        team.next++;
      } else {
        pos.x += (dx / d) * move;
        pos.z += (dz / d) * move;
        move = 0;
      }
    }
    const g = this.ground(pos.x, pos.z, pos.y + FEET) - FEET;
    pos.y += (g - pos.y) * Math.min(1, dt * 14);
    team.group.rotation.y += wrap(team.heading - team.group.rotation.y) * Math.min(1, dt * 8);
    return team.next >= team.way.length;
  }

  /** Shuts the laptop and shrinks it away; false once it's gone. */
  private closeLaptop(c: Casualty, dt: number): boolean {
    const laptop = c.laptop!;
    if (!laptop.shut(dt)) return true;
    c.lgone = Math.min(1, c.lgone + dt / LAPTOP_GONE);
    laptop.root.scale.setScalar(Math.max(0.001, 1 - c.lgone * c.lgone));
    if (c.lgone < 1) return true;
    this.dropLaptop(c);
    c.laptop = null;
    return false;
  }

  /** Back in its seat at once, as if nothing happened: its session never stopped. */
  private reseat(c: Casualty) {
    c.seat.add(c.model.root);
    c.model.root.position.set(0, 0, 0);
    c.model.root.rotation.set(0, 0, 0);
    c.model.root.scale.setScalar(c.scale);
    c.model.revive();
  }

  private dropTeam(c: Casualty) {
    const team = c.team;
    if (!team) return;
    c.team = null;
    team.group.removeFromParent();
    // Meshes only: a sprite's geometry is three.js's own shared one, and the medics free their own sprites.
    team.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
    });
    for (const m of team.medics) m.dispose();
  }

  private dropPool(c: Casualty) {
    c.pool.removeFromParent();
  }

  private dropLaptop(c: Casualty) {
    if (!c.laptop) return;
    c.laptop.root.removeFromParent();
    c.laptop.dispose();
    c.laptop = null;
  }
}
