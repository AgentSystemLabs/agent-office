import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DESK_BY_ID, DESK_SIZE, DESKS, ELEVATOR, ELEVATOR_FRONT, FLOOR, LOFT, STAIRS, type DeskDef } from '../shared/layout.js';
import { cleanDogName, dogAt, dogDefaults, legSeconds, type DogAct, type DogState } from '../shared/dog.js';
import type { PeerInfo, WorkerInfo } from '../shared/protocol.js';

// ---- Getting around -------------------------------------------------------------------------------
// The dog keeps to the office floor downstairs (no stairs, no loft, no elevator) and walks around the
// furniture on a coarse grid.

type Pt = [number, number];

const CELL = 0.5;
/** Its half-width, plus a little room: how far it keeps from things. */
const R = 0.3;
const COLS = Math.ceil((FLOOR.maxX - FLOOR.minX) / CELL);
const ROWS = Math.ceil((FLOOR.maxZ - FLOOR.minZ) / CELL);

type Rect = [number, number, number, number]; // minX, maxX, minZ, maxZ
type Circle = [number, number, number]; // x, z, radius

/** The desk's own frame: `t` along its width, `s` out toward the side the worker sits on. */
function deskPoint(d: DeskDef, t: number, s: number): Pt {
  return [d.x + Math.cos(d.rotY) * t + Math.sin(d.rotY) * s, d.z - Math.sin(d.rotY) * t + Math.cos(d.rotY) * s];
}

/** What's in the way on the floor. The lounge, kitchen and plants are where office.ts puts them. */
function obstacles(): { rects: Rect[]; circles: Circle[] } {
  const rects: Rect[] = [];
  const circles: Circle[] = [];
  const hw = DESK_SIZE.width / 2;
  const hd = DESK_SIZE.depth / 2;
  for (const d of DESKS) {
    // Desks face ±z, so their tops are axis-aligned.
    rects.push([d.x - hw, d.x + hw, d.z - hd, d.z + hd]);
    const [cx, cz] = deskPoint(d, 0, 0.9);
    circles.push([cx, cz, 0.35]); // the chair
  }
  rects.push([10, 11, -2.2, 2.2]); // couch
  rects.push([12.2, 13.8, -0.8, 0.8]); // coffee table
  circles.push([12.5, 3.5, 0.5], [14.5, -3.4, 0.5]); // beanbags
  rects.push([-17, -10.75, 11.7, 12.7]); // kitchen counter and fridge
  for (const [x, z, s] of [
    [-17.2, -12.2, 1.4],
    [17.2, -12.2, 1.5],
    [17.2, 12.2, 1.3],
    [-17.2, 8.5, 1.2],
    [5.5, -12.2, 1.1],
    [-6, 0, 1],
    [3.5, 0, 0.9],
    [8.5, 5, 1.1],
  ])
    circles.push([x, z, 0.3 * s]);
  // The loft's posts, the stairs up to it, and the elevator shaft.
  for (const x of [LOFT.minX + 0.15, (LOFT.minX + LOFT.maxX) / 2]) circles.push([x, LOFT.minZ + 0.15, 0.14]);
  rects.push([STAIRS.fromX, STAIRS.toX, STAIRS.minZ - 0.1, STAIRS.maxZ]);
  rects.push([ELEVATOR.x - ELEVATOR.width / 2, ELEVATOR.x + ELEVATOR.width / 2, FLOOR.minZ, ELEVATOR_FRONT]);
  return { rects, circles };
}

function isBlocked(x: number, z: number, o: ReturnType<typeof obstacles>): boolean {
  if (x < FLOOR.minX + R || x > FLOOR.maxX - R || z < FLOOR.minZ + R || z > FLOOR.maxZ - R) return true;
  for (const [x0, x1, z0, z1] of o.rects) if (x > x0 - R && x < x1 + R && z > z0 - R && z < z1 + R) return true;
  for (const [cx, cz, r] of o.circles) if (Math.hypot(x - cx, z - cz) < r + R) return true;
  return false;
}

const GRID = (() => {
  const o = obstacles();
  const g = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) g[r * COLS + c] = isBlocked(FLOOR.minX + (c + 0.5) * CELL, FLOOR.minZ + (r + 0.5) * CELL, o) ? 1 : 0;
  return g;
})();

const colOf = (x: number) => Math.max(0, Math.min(COLS - 1, Math.floor((x - FLOOR.minX) / CELL)));
const rowOf = (z: number) => Math.max(0, Math.min(ROWS - 1, Math.floor((z - FLOOR.minZ) / CELL)));
const centerOf = (i: number): Pt => [FLOOR.minX + ((i % COLS) + 0.5) * CELL, FLOOR.minZ + (Math.floor(i / COLS) + 0.5) * CELL];

export function walkable(x: number, z: number): boolean {
  return x > FLOOR.minX && x < FLOOR.maxX && z > FLOOR.minZ && z < FLOOR.maxZ && !GRID[rowOf(z) * COLS + colOf(x)];
}

/** Whether it can trot straight from a to b: every cell the line crosses is clear. */
function clearLine(a: Pt, b: Pt): boolean {
  let c = colOf(a[0]);
  let r = rowOf(a[1]);
  const c1 = colOf(b[0]);
  const r1 = rowOf(b[1]);
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const sc = Math.sign(dx);
  const sr = Math.sign(dz);
  const stepC = sc ? CELL / Math.abs(dx) : Infinity;
  const stepR = sr ? CELL / Math.abs(dz) : Infinity;
  let nextC = sc ? (FLOOR.minX + (c + (sc > 0 ? 1 : 0)) * CELL - a[0]) / dx : Infinity;
  let nextR = sr ? (FLOOR.minZ + (r + (sr > 0 ? 1 : 0)) * CELL - a[1]) / dz : Infinity;
  for (let n = 0; n <= COLS + ROWS; n++) {
    if (GRID[r * COLS + c]) return false;
    if (c === c1 && r === r1) return true;
    if (Math.abs(nextC - nextR) < 1e-9) {
      // Right through a corner: both cells beside it count.
      if (GRID[r * COLS + c + sc] || GRID[(r + sr) * COLS + c]) return false;
      c += sc;
      r += sr;
      nextC += stepC;
      nextR += stepR;
    } else if (nextC < nextR) {
      c += sc;
      nextC += stepC;
    } else {
      r += sr;
      nextR += stepR;
    }
  }
  return false;
}

/** The middle of the nearest cell it can stand in. */
export function nearestWalkable(p: Pt): Pt {
  if (walkable(p[0], p[1])) return p;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < GRID.length; i++) {
    if (GRID[i]) continue;
    const [x, z] = centerOf(i);
    const d = (x - p[0]) ** 2 + (z - p[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best < 0 ? p : centerOf(best);
}

/** A* over the grid, then pulled tight: the corners of a route from `from` to `to`, both included. */
export function route(from: Pt, to: Pt): Pt[] {
  const goal = nearestWalkable(to);
  const start = nearestWalkable(from);
  const lead: Pt[] = start === from ? [from] : [from, start];
  if (clearLine(start, goal)) return [...lead, goal];
  const s = rowOf(start[1]) * COLS + colOf(start[0]);
  const g = rowOf(goal[1]) * COLS + colOf(goal[0]);
  const cost = new Float64Array(GRID.length).fill(Infinity);
  const came = new Int32Array(GRID.length).fill(-1);
  const closed = new Uint8Array(GRID.length);
  const heap = new Heap();
  const gc = g % COLS;
  const gr = Math.floor(g / COLS);
  const h = (i: number) => {
    const dx = Math.abs((i % COLS) - gc);
    const dz = Math.abs(Math.floor(i / COLS) - gr);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  };
  cost[s] = 0;
  heap.push(s, h(s));
  while (heap.size) {
    const i = heap.pop();
    if (i === g) break;
    if (closed[i]) continue;
    closed[i] = 1;
    const c = i % COLS;
    const r = Math.floor(i / COLS);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nc = c + dx;
        const nr = r + dz;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const n = nr * COLS + nc;
        if (GRID[n] || closed[n]) continue;
        // No cutting corners past something in the way.
        if (dx && dz && (GRID[r * COLS + nc] || GRID[nr * COLS + c])) continue;
        const next = cost[i] + (dx && dz ? Math.SQRT2 : 1);
        if (next >= cost[n]) continue;
        cost[n] = next;
        came[n] = i;
        heap.push(n, next + h(n));
      }
    }
  }
  if (came[g] < 0) return [...lead, goal]; // nowhere to go round; shouldn't happen in one room
  const cells: Pt[] = [];
  for (let i = came[g]; i !== s && i >= 0; i = came[i]) cells.push(centerOf(i));
  const pts: Pt[] = [start, ...cells.reverse(), goal];
  // Keep only the corners: from each point, straight on to the farthest one it can see.
  const out: Pt[] = [...lead];
  for (let i = 0; i < pts.length - 1; ) {
    let j = pts.length - 1;
    while (j > i + 1 && !clearLine(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

class Heap {
  private items: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.items.length;
  }
  push(item: number, key: number) {
    const { items, keys } = this;
    let i = items.length;
    items.push(item);
    keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      items[i] = items[p];
      keys[i] = keys[p];
      i = p;
    }
    items[i] = item;
    keys[i] = key;
  }
  pop(): number {
    const { items, keys } = this;
    const top = items[0];
    const item = items.pop()!;
    const key = keys.pop()!;
    if (items.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= items.length) break;
        const m = l + 1 < items.length && keys[l + 1] < keys[l] ? l + 1 : l;
        if (keys[m] >= key) break;
        items[i] = items[m];
        keys[i] = keys[m];
        i = m;
      }
      items[i] = item;
      keys[i] = key;
    }
    return top;
  }
}

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
}

type Leg = Omit<DogState, 'name' | 'coat' | 'elapsed'> & { start: number };

/**
 * A floor's dog. It naps under the desks of workers who are busy, trots after people for a while,
 * sniffs around and hangs out on the lounge rug. When a worker needs input it drops everything, runs
 * to that desk and barks (the browsers do the barking; see client/world/dog.ts). Its name is kept
 * in the floor's .agent-office/dog.json.
 */
export class Dog {
  private name: string;
  private readonly coat: number;
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
    this.file = path.join(dataDir, 'dog.json');
    this.name = this.load() ?? d.name;
    // Lying on the rug when the office opens, and up and about a few seconds later.
    const spot = pick(LOUNGE);
    this.leg = { path: [spot], speed: 0, act: 'lie', face: Math.PI / 2 + rand(-0.6, 0.6), start: Date.now() - 60_000 };
    this.wake(rand(3000, 8000));
  }

  view(): DogState {
    const { start, ...leg } = this.leg;
    return { name: this.name, coat: this.coat, ...leg, elapsed: Date.now() - start };
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
    if (this.exit && !walkable(from[0], from[1])) {
      pts.push(this.exit);
      start = this.exit;
    }
    this.exit = undefined;
    pts.push(...route(start, to).slice(1));
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

  /** Picks what to do next. */
  private think() {
    if (this.stopped) return;
    this.waking = false;
    const call = this.nextCall();
    if (call) return this.barkAt(call);
    const busy = this.env.workers().filter((w) => w.status === 'working' && DESK_BY_ID.has(w.deskId));
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
      if (walkable(p[0], p[1]) && dist(p, at) > 4) {
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
    const side = this.sideOf(desk);
    const approach = deskPoint(desk, side * 0.8, 1.3);
    const under = deskPoint(desk, side * 0.45, 0.15);
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
    const behind = nearestWalkable([p.x - Math.sin(p.rotY) * 1.1, p.z - Math.cos(p.rotY) * 1.1]);
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
      const spot = deskPoint(desk, side * 0.75, 1.45);
      this.walkTo(spot, RUN, 'bark', { workerId: w.id, face: toward(spot, deskPoint(desk, 0, 0.9)) });
    }
    // Checks now and then that it's still the one to bark at.
    this.wake(5000);
  }

  /** Which end of a desk (-1 or +1 along its width) is nearer. */
  private sideOf(desk: DeskDef): number {
    const at = this.here();
    return dist(at, deskPoint(desk, 1, 1.3)) <= dist(at, deskPoint(desk, -1, 1.3)) ? 1 : -1;
  }
}
