import * as THREE from 'three';
import { prisonSeat, wasting, type DungeonPlan, type SendHomePlan, type Spot } from '../../../shared/maps';
import type { JailState, Prisoner } from '../../../shared/protocol';
import { Worker } from '../../world/character';
import type { DungeonView } from '../../world/dungeon';
import { mesh, toon } from '../../world/toon';

/*
 * Whoever's locked up in the dungeon (see shared/maps/dungeon.ts and the floor's JailState): each one
 * sat in its cell where it was thrown, thinner the longer it's been there, then dead, keeled over and
 * rotting down to its bones. Once every seat in every cell has been taken, the ones from before are a
 * heap of bones in the corner. One on its way down there with the Kingsguard isn't shown till it's
 * thrown in (see hold).
 */

/** How often (s) how far gone they are is worked out again: it changes over hours. */
const REFRESH = 2;
/** What they mutter, now and then, while you're down there with them. */
const MUTTERS = ['🍞 …bread?', '💧 water…', '🙏 let me out', '😩 I can fix it, I swear', '🐀 hello, rat', '🥶 so cold…', '📜 I’ll write the tests!', '😵 …', '🎵 99 bugs in the code…', '🕯️ is it day?', '😢 I miss my desk', '🔑 psst… the key?'];
/** How close (m) you have to be to hear one. */
const EARSHOT = 9;

interface Inmate {
  prisoner: Prisoner;
  model: Worker;
  seat: { cell: number; spot: Spot };
}

const BONE = toon('#e3dac0');
const SOCKET = toon('#241c16');

/** A heap of `n` skulls and bones: the more, the bigger the heap. */
function boneHeap(n: number): THREE.Group {
  const g = new THREE.Group();
  const shown = Math.min(60, n);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const radius = 0.35 + 0.12 * Math.sqrt(shown);
  for (let i = 0; i < shown; i++) {
    // Piled in a cone: the first at the bottom and out to the edge, the later ones on top.
    const k = i / Math.max(1, shown - 1);
    const r = radius * (1 - k) * Math.sqrt(rand());
    const a = rand() * Math.PI * 2;
    const y = 0.1 + k * radius * 0.9;
    const skull = new THREE.Group();
    skull.add(mesh(new THREE.SphereGeometry(0.13, 10, 8), BONE, 0, 0, 0));
    for (const sx of [-1, 1]) skull.add(mesh(new THREE.SphereGeometry(0.035, 6, 5), SOCKET, sx * 0.05, 0.02, 0.11, false));
    skull.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    skull.rotation.set((rand() - 0.5) * 0.8, rand() * Math.PI * 2, (rand() - 0.5) * 0.8);
    g.add(skull);
    if (i % 2 === 0) {
      const bone = mesh(new THREE.CapsuleGeometry(0.03, 0.4, 3, 6), BONE, Math.cos(a + 1) * r * 0.8, y - 0.02, Math.sin(a + 1) * r * 0.8);
      bone.rotation.set(Math.PI / 2 + (rand() - 0.5), rand() * Math.PI, 0);
      g.add(bone);
    }
  }
  return g;
}

export class Jail {
  private inmates = new Map<string, Inmate>();
  /** On their way down with the Kingsguard: not in their cells yet. */
  private held = new Set<string>();
  private dungeon: DungeonView | undefined;
  private plan: SendHomePlan | undefined;
  private heap: { group: THREE.Group; n: number } | null = null;
  private refreshIn = 0;
  private mutterIn = 5;

  constructor(
    /** Who's locked up on the floor you're on. */
    private state: () => JailState,
    /** The office's clock (ms). */
    private now: () => number,
    /** How to dress one: the map's outfit, and how worn out it had got working. */
    private dress: (model: Worker, p: Prisoner) => void,
  ) {}

  /** Shows the floor's prisoners in `dungeon`'s cells (none, without one), as far gone as `plan` says they are. */
  sync(dungeon: DungeonView | undefined, plan: SendHomePlan | undefined) {
    if (dungeon !== this.dungeon || plan !== this.plan) {
      this.clear();
      this.dungeon = dungeon;
      this.plan = plan;
    }
    const state = this.state();
    const d = dungeon?.plan;
    if (!dungeon || !d || !plan) return;
    const total = state.bones + state.prisoners.length;
    const want = new Map<string, { prisoner: Prisoner; seat: { cell: number; spot: Spot } }>();
    let heaped = state.bones;
    state.prisoners.forEach((p, i) => {
      const seat = prisonSeat(d, state.bones + i, total);
      if (!seat) heaped++;
      else if (!this.held.has(p.id)) want.set(p.id, { prisoner: p, seat });
    });
    for (const [id, m] of this.inmates) {
      const w = want.get(id);
      if (w && w.prisoner.at === m.prisoner.at && w.seat === m.seat) continue;
      this.drop(m);
      this.inmates.delete(id);
    }
    for (const [id, w] of want) {
      if (this.inmates.has(id)) continue;
      const model = new Worker(w.prisoner.name, w.prisoner.color);
      this.dress(model, w.prisoner);
      const { spot } = w.seat;
      model.root.position.set(spot.x, spot.y, spot.z);
      model.root.rotation.y = spot.rotY;
      model.setJailed(wasting(w.prisoner.at, this.now(), plan));
      dungeon.inside.add(model.root);
      this.inmates.set(id, { prisoner: w.prisoner, model, seat: w.seat });
    }
    this.pile(d, heaped);
  }

  /** `id` is on its way down (being marched off by the escort): not in its cell till it's thrown in (release). */
  hold(id: string) {
    this.held.add(id);
    const m = this.inmates.get(id);
    if (m) {
      this.drop(m);
      this.inmates.delete(id);
    }
  }

  /** `id` has been thrown in: it's in its cell from now on. */
  release(id: string) {
    if (!this.held.delete(id)) return;
    this.sync(this.dungeon, this.plan);
  }

  /** Where `id` sits, once it's locked up: which cell, and where in it. */
  seatOf(id: string): { cell: number; spot: Spot } | null {
    const d = this.dungeon?.plan;
    const { prisoners, bones } = this.state();
    const i = prisoners.findIndex((p) => p.id === id);
    if (!d || i < 0) return null;
    return prisonSeat(d, bones + i, bones + prisoners.length);
  }

  /** How many are down there, for a look from the page (__office.jail). */
  get count(): number {
    return this.inmates.size;
  }

  /** Every so often, how far gone they are; and, while you're down there, their moaning. `eye` is where you're looking from. */
  update(dt: number, t: number, eye: THREE.Vector3) {
    const dungeon = this.dungeon;
    if (!dungeon || !this.plan || !this.inmates.size) return;
    this.refreshIn -= dt;
    if (this.refreshIn <= 0) {
      this.refreshIn = REFRESH;
      const now = this.now();
      for (const m of this.inmates.values()) m.model.setJailed(wasting(m.prisoner.at, now, this.plan));
    }
    // Nobody down there to see them: they needn't move.
    if (!dungeon.inside.visible) return;
    for (const m of this.inmates.values()) m.model.update(dt, t);
    const below = eye.y < dungeon.plan.ceiling;
    this.mutterIn -= dt;
    if (below && this.mutterIn <= 0) {
      this.mutterIn = 5 + Math.random() * 7;
      const near = [...this.inmates.values()].filter((m) => Math.hypot(m.seat.spot.x - eye.x, m.seat.spot.z - eye.z) < EARSHOT && !wasting(m.prisoner.at, this.now(), this.plan!).dead);
      const who = near[Math.floor(Math.random() * near.length)];
      who?.model.mutter(MUTTERS[Math.floor(Math.random() * MUTTERS.length)]);
    }
  }

  /** Everyone out of the cells (off to another floor, or another map). Whoever was on their way down is let go too. */
  clear() {
    for (const m of this.inmates.values()) this.drop(m);
    this.inmates.clear();
    this.held.clear();
    if (this.heap) {
      this.heap.group.removeFromParent();
      this.heap.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.heap = null;
    }
  }

  /** The heap of bones, `n` of them, where the dungeon has one. */
  private pile(d: DungeonPlan, n: number) {
    const size = n <= 0 ? 0 : Math.min(60, n);
    if ((this.heap?.n ?? 0) === size) return;
    if (this.heap) {
      this.heap.group.removeFromParent();
      this.heap.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.heap = null;
    }
    if (!size || !d.ossuary || !this.dungeon) return;
    const group = boneHeap(size);
    group.position.set(d.ossuary[0], d.floor, d.ossuary[1]);
    this.dungeon.inside.add(group);
    this.heap = { group, n: size };
  }

  private drop(m: Inmate) {
    m.model.root.removeFromParent();
    m.model.dispose();
  }
}
