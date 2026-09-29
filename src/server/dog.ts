import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DESK_BY_ID, FLOOR, KIOSK, type DeskDef } from '../shared/layout.js';
import { cleanDogName, dogAt, dogDefaults, legSeconds, type DogAct, type DogBreed, type DogState } from '../shared/dog.js';
import { deskPoint, nearestWalkable, route, walkable, type Pt } from '../shared/nav.js';
import type { PeerInfo, WorkerInfo } from '../shared/protocol.js';

// ---- Its day ------------------------------------------------------------------------------------

/** Spots on the lounge rug, by the TV. */
const LOUNGE: Pt[] = [
  [16, 1.6],
  [16, -1.5],
  [14.8, 1.9],
  [11.8, 2.4],
  [11.8, -2.6],
  [14.6, -1.3],
];

const TROT = 1.3;
const RUN = 3.4;
/** How long a pat lasts, wag and all. */
const PET_MS = 2600;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const toward = (from: Pt, to: Pt) => Math.atan2(to[0] - from[0], to[1] - from[1]);

/** Needs input and nobody has answered yet. */
export function callsForDog(w: WorkerInfo): boolean {
  return w.status === 'needs_input' && !w.acked && DESK_BY_ID.has(w.deskId);
}

type Mode = 'lounge' | 'nap' | 'wander' | 'follow' | 'bark' | 'pet';

export interface DogEnv {
  workers(): WorkerInfo[];
  /** Everyone on this floor, where they stand now. */
  people(): PeerInfo[];
  /** To everyone on this floor. */
  send(dog: DogState): void;
  /** How many rows the floor's back office is built out, for getting round its desks too (see WING). */
  wing?(): number;
}

type Leg = Omit<DogState, 'name' | 'coat' | 'breed' | 'elapsed'> & { start: number };

/**
 * A floor's dog. It naps under the desks of workers who are busy, trots after people for a while,
 * sniffs around and hangs out on the lounge rug. When a worker needs input it drops everything, runs
 * to that desk and barks (the browsers do the barking; see client/world/dog.ts). Its name is kept
 * in the floor's .agent-office/dog.json; its coat and breed come from the floor's id (see dogDefaults).
 */
export class Dog {
  private name: string;
  private readonly coat: number;
  private readonly breed: DogBreed;
  private readonly fallbackName: string;
  private readonly file: string;
  private leg: Leg;
  private mode: Mode = 'lounge';
  private timer?: NodeJS.Timeout;
  /** Workers waiting on an answer, and since when. It goes to whoever has waited longest. */
  private calling = new Map<string, number>();
  /** Crawled under a desk from here, so it comes out the same way. */
  private exit?: Pt;
  private follow?: { id: string; until: number };
  /** Its nap is ending (its worker stopped working); it gets up once, however many updates follow. */
  private waking = false;
  private lastPet = 0;
  private stopped = false;

  constructor(
    readonly floorId: string,
    dataDir: string,
    private env: DogEnv,
  ) {
    const d = dogDefaults(floorId);
    this.fallbackName = d.name;
    this.coat = d.coat;
    this.breed = d.breed;
    this.file = path.join(dataDir, 'dog.json');
    this.name = this.load() ?? d.name;
    // Lying on the rug when the office opens, and up and about a few seconds later.
    const spot = pick(LOUNGE);
    this.leg = { path: [spot], speed: 0, act: 'lie', face: Math.PI / 2 + rand(-0.6, 0.6), start: Date.now() - 60_000 };
    this.wake(rand(3000, 8000));
  }

  view(): DogState {
    const { start, ...leg } = this.leg;
    return { name: this.name, coat: this.coat, breed: this.breed, ...leg, elapsed: Date.now() - start };
  }

  /** Where it is right now. */
  here(): Pt {
    const p = dogAt(this.leg, (Date.now() - this.leg.start) / 1000);
    return [p.x, p.z];
  }

  get dogName(): string {
    return this.name;
  }

  /** A worker on this floor changed. */
  onWorker(w: WorkerInfo) {
    const calls = callsForDog(w);
    if (calls && !this.calling.has(w.id)) {
      this.calling.set(w.id, Date.now());
      // Drop everything, except finishing a pat.
      if (this.mode !== 'bark' && this.mode !== 'pet') return this.wake(0);
    } else if (!calls && this.calling.delete(w.id) && this.mode === 'bark' && this.leg.workerId === w.id) {
      return this.wake(rand(800, 1600));
    }
    // Its worker stopped working: time to get up.
    if (this.mode === 'nap' && !this.waking && this.leg.workerId === w.id && w.status !== 'working') {
      this.waking = true;
      this.wake(rand(1500, 4000));
    }
  }

  onWorkerGone(workerId: string) {
    this.calling.delete(workerId);
    if ((this.mode === 'bark' || this.mode === 'nap') && this.leg.workerId === workerId) this.wake(rand(800, 1600));
  }

  /** Someone gave it a pat: it stops, turns to them and wags for everyone to see. */
  pet(by: PeerInfo): boolean {
    if (by.floor !== this.floorId || by.y > 1) return false;
    const now = Date.now();
    if (now - this.lastPet < 400) return false;
    const at = this.here();
    if (Math.hypot(by.x - at[0], by.z - at[1]) > 3.5) return false;
    this.lastPet = now;
    const workerId = this.mode === 'bark' || this.mode === 'nap' ? this.leg.workerId : undefined;
    this.mode = 'pet';
    this.go([at], 0, 'wag', { face: toward(at, [by.x, by.z]), petBy: by.name, workerId });
    this.wake(PET_MS, () => {
      // Back to the worker that needs someone; otherwise tag along with whoever petted it for a bit.
      if (this.nextCall()) return this.think();
      const p = this.env.people().find((q) => q.id === by.id);
      if (p && p.y < 0.5 && Math.random() < 0.7) return this.startFollow(p.id, rand(10_000, 20_000));
      this.think();
    });
    return true;
  }

  /** Renames it ('' goes back to its first name). Answers with the name it has now. */
  rename(raw: string): string {
    this.name = cleanDogName(raw) || this.fallbackName;
    try {
      writeFileSync(this.file, JSON.stringify({ name: this.name }, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save the dog's name: ${(err as Error).message}`);
    }
    this.send();
    return this.name;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private load(): string | undefined {
    if (!existsSync(this.file)) return undefined;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as { name?: unknown };
      return typeof saved.name === 'string' ? cleanDogName(saved.name) || undefined : undefined;
    } catch {
      return undefined;
    }
  }

  private send() {
    this.env.send(this.view());
  }

  private wake(ms: number, fn: () => void = () => this.think()) {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(fn, ms);
  }

  /** Starts a leg from where it is now. */
  private go(pathPts: Pt[], speed: number, act: DogAct, extra: Pick<DogState, 'face' | 'workerId' | 'following' | 'petBy'> = {}) {
    this.leg = { path: pathPts, speed, act, ...extra, start: Date.now() };
    this.send();
  }

  /** Walks to `to` (out from under a desk first, if it's under one) and says how long that takes, in ms. */
  private walkTo(to: Pt, speed: number, act: DogAct, extra: Pick<DogState, 'face' | 'workerId' | 'following'> = {}, last?: Pt): number {
    const from = this.here();
    const pts: Pt[] = [from];
    let start = from;
    // Still under the desk (or on its way in), not just somewhere on the way there.
    if (this.exit && !walkable(from[0], from[1], this.wing)) {
      pts.push(this.exit);
      start = this.exit;
    }
    this.exit = undefined;
    pts.push(...route(start, to, this.wing).slice(1));
    if (last) pts.push(last);
    this.go(pts, speed, act, extra);
    return legSeconds(this.leg) * 1000;
  }

  /** The worker that has waited longest for an answer. */
  private nextCall(): WorkerInfo | undefined {
    const byId = new Map(this.env.workers().map((w) => [w.id, w]));
    let best: WorkerInfo | undefined;
    let since = Infinity;
    for (const [id, t] of this.calling) {
      const w = byId.get(id);
      if (!w || !callsForDog(w)) {
        this.calling.delete(id);
        continue;
      }
      if (t < since) {
        since = t;
        best = w;
      }
    }
    return best;
  }

  /** How far the floor's back office is built out. */
  private get wing(): number {
    return this.env.wing?.() ?? 0;
  }

  /** Picks what to do next. */
  private think() {
    if (this.stopped) return;
    this.waking = false;
    const call = this.nextCall();
    if (call) return this.barkAt(call);
    // Only at a desk or a bean bag: a board agent's kiosk has nothing to curl up under.
    const busy = this.env.workers().filter((w) => w.status === 'working' && DESK_BY_ID.has(w.deskId) && !DESK_BY_ID.get(w.deskId)?.station);
    const people = this.env.people().filter((p) => p.y < 0.5);
    const was = this.mode;
    const options: [number, () => void][] = [
      [was === 'lounge' ? 1 : 2.5, () => this.lounge()],
      [1.5, () => this.wander()],
    ];
    if (busy.length) options.push([was === 'nap' ? 1.5 : 3, () => this.nap(pick(busy))]);
    if (people.length) options.push([was === 'follow' ? 0.5 : 2, () => this.startFollow(pick(people).id, rand(15_000, 30_000))]);
    let roll = Math.random() * options.reduce((n, [w]) => n + w, 0);
    for (const [w, fn] of options) {
      roll -= w;
      if (roll <= 0) return fn();
    }
    options[0][1]();
  }

  private lounge() {
    this.mode = 'lounge';
    const at = this.here();
    const spot = pick(LOUNGE.filter((p) => dist(p, at) > 1));
    // Settles down facing the TV, more or less.
    const ms = this.walkTo(spot, TROT, 'lie', { face: Math.PI / 2 + rand(-0.7, 0.7) });
    this.wake(ms + rand(20_000, 45_000));
  }

  private wander() {
    this.mode = 'wander';
    const at = this.here();
    let spot: Pt = at;
    for (let i = 0; i < 30; i++) {
      const p: Pt = [rand(FLOOR.minX + 1, FLOOR.maxX - 1), rand(FLOOR.minZ + 1, FLOOR.maxZ - 1)];
      if (walkable(p[0], p[1], this.wing) && dist(p, at) > 4) {
        spot = p;
        break;
      }
    }
    const ms = this.walkTo(spot, TROT, 'sniff');
    this.wake(ms + rand(4000, 9000));
  }

  /** Curls up under a busy worker's desk, at its feet. */
  private nap(w: WorkerInfo) {
    const desk = DESK_BY_ID.get(w.deskId)!;
    this.mode = 'nap';
    let side = this.sideOf(desk);
    // A bean bag has no desk to get under, so it curls up beside it, on whichever side has room.
    if (desk.beanbag && !walkable(...deskPoint(desk, side * 1.05, 0.1), this.wing)) side = -side;
    const approach = desk.beanbag ? deskPoint(desk, side * 1.3, 1.2) : deskPoint(desk, side * 0.8, 1.3);
    const under = desk.beanbag ? deskPoint(desk, side * 1.05, 0.1) : deskPoint(desk, side * 0.45, 0.15);
    // Head out toward the chair.
    const ms = this.walkTo(approach, TROT, 'nap', { workerId: w.id, face: desk.rotY }, under);
    this.exit = approach;
    this.wake(ms + rand(30_000, 70_000));
  }

  private startFollow(id: string, ms: number) {
    this.mode = 'follow';
    this.follow = { id, until: Date.now() + ms };
    this.followStep();
  }

  /** Every second or so: keep up with them, and sit when they stop. */
  private followStep() {
    const f = this.follow;
    const p = f && this.env.people().find((q) => q.id === f.id);
    // Gone upstairs: it doesn't do stairs.
    if (!f || !p || Date.now() > f.until || p.y > 1.5) {
      this.follow = undefined;
      return this.think();
    }
    const person: Pt = [p.x, p.z];
    const behind = nearestWalkable([p.x - Math.sin(p.rotY) * 1.1, p.z - Math.cos(p.rotY) * 1.1], this.wing);
    const end = this.leg.path[this.leg.path.length - 1];
    const along = this.leg.act === 'sit' && this.leg.following === p.id;
    // Someone standing still who just turns around doesn't need it circling round behind them.
    const settled = along && ((!p.moving && dist(end, person) < 1.8 && dist(end, person) > 0.4) || dist(end, behind) < 0.8);
    if (!settled) {
      const at = this.here();
      if (dist(at, behind) < 0.8) this.go([at], 0, 'sit', { face: toward(at, person), following: p.id });
      else this.walkTo(behind, dist(at, behind) > 4 ? RUN * 0.8 : 1.8, 'sit', { face: toward(behind, person), following: p.id });
    }
    this.wake(900, () => this.followStep());
  }

  /** Runs to the desk of a worker that needs input, and barks at it. */
  private barkAt(w: WorkerInfo) {
    const desk = DESK_BY_ID.get(w.deskId)!;
    const already = this.mode === 'bark' && this.leg.workerId === w.id;
    this.mode = 'bark';
    this.follow = undefined;
    if (!already) {
      const side = this.sideOf(desk);
      // At a board agent, out in front of its kiosk, looking up at the agent behind it.
      const spot = desk.station ? deskPoint(desk, side * 0.6, -1.1) : deskPoint(desk, side * 0.75, 1.45);
      this.walkTo(spot, RUN, 'bark', { workerId: w.id, face: toward(spot, deskPoint(desk, 0, desk.station ? KIOSK.stand : 0.9)) });
    }
    // Checks now and then that it's still the one to bark at.
    this.wake(5000);
  }

  /** Which end of a desk (-1 or +1 along its width) is nearer. */
  private sideOf(desk: DeskDef): number {
    const at = this.here();
    const s = desk.station ? -1.1 : 1.3;
    return dist(at, deskPoint(desk, 1, s)) <= dist(at, deskPoint(desk, -1, s)) ? 1 : -1;
  }
}
