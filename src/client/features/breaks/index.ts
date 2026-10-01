/**
 * Workers on a break (WorkerInfo.resting, Z at a finished worker's desk): instead of sitting at its
 * desk it wanders the office from stop to stop, half a minute or so at each: a coffee at the machine,
 * a sit on the couch or the balcony bench, the jukebox, the arcade, the bookshelf, a few swings on the
 * golf tee, and for the ones who smoke, a cigarette at the ashtray. Each worker's round is its own
 * (worked out from its id and when its break started), so every browser sees the same. Called back to
 * work, or given something to do, it walks back to its desk.
 */
import * as THREE from 'three';
import { ASHTRAY, BALCONY, BALCONY_DOOR, BOOKSHELF, CABINET, FLOOR, GOLF_TEE, JUKEBOX, SEATING_BY_ID } from '../../../shared/layout';
import type { Pt } from '../../../shared/nav';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import type { Court, Stop } from '../../world/court';
import { BreakHands, type Held } from '../../world/character/worker-break';

/** Somewhere to go on a break, what it has in its hand there, and whether only a smoker goes. */
interface Spot {
  stop: Stop;
  held?: Held;
  smokers?: true;
}

/** How long it stays at each stop, give or take (seconds). */
const STAY = 32;
/** Out through the balcony door: just inside it, then just outside it. */
const DOOR: Pt[] = [
  [BALCONY_DOOR.u, FLOOR.maxZ - 0.45],
  [BALCONY_DOOR.u, BALCONY.minZ + 0.4],
];

function spots(): Spot[] {
  const couch = SEATING_BY_ID.get('couch')!;
  const bench = SEATING_BY_ID.get('bench')!;
  const out: Spot[] = [
    { stop: { x: -14.6, z: 10.9, rotY: -Math.PI / 2 }, held: 'mug' },
    { stop: { x: JUKEBOX.x - 1, z: JUKEBOX.z, rotY: Math.PI / 2 } },
    { stop: { x: CABINET.x - 0.95, z: CABINET.z, rotY: Math.PI / 2 } },
    { stop: { x: BOOKSHELF.x, z: BOOKSHELF.z - 0.95, rotY: 0 } },
    {
      stop: {
        x: GOLF_TEE.x + 0.35,
        z: GOLF_TEE.z,
        rotY: -Math.PI / 2,
        through: [...DOOR, [GOLF_TEE.x + 0.6, GOLF_TEE.z - 0.3]],
      },
      held: 'club',
    },
    {
      stop: {
        x: ASHTRAY.x + 0.45,
        z: ASHTRAY.z - 0.6,
        rotY: 0,
        through: [...DOOR, [ASHTRAY.x + 1.2, ASHTRAY.z - 1.2]],
      },
      held: 'cigarette',
      smokers: true,
    },
  ];
  // Sitting down: on the couch facing the TV, and on the bench looking out over the street.
  for (const p of couch.places)
    out.push({
      stop: {
        x: couch.x,
        z: couch.z - p,
        rotY: couch.rotY,
        sit: 0.36,
        through: [[couch.x + 1.1, couch.z - p]],
      },
      held: 'mug',
    });
  for (const p of bench.places)
    out.push({
      stop: {
        x: bench.x + p,
        z: bench.z + 0.05,
        rotY: bench.rotY,
        sit: 0.33,
        through: [...DOOR, [bench.x + p, bench.z + 0.9]],
      },
    });
  return out;
}

/** A number from a string that's the same in every browser. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function installBreaks(ctx: Ctx, parts: Pick<Parts, 'worlds' | 'views'>) {
  const all = spots();
  /** Each worker's own copies of the stops, nudged a little so two at the same one don't stand inside each other. */
  const mine = new Map<string, Stop[]>();
  const tip = new THREE.Vector3();
  const blow = new THREE.Vector3();
  let wispIn = 0;
  /** What each worker on a break has in its hand, for the model it has now. */
  const hands = new Map<string, { root: THREE.Object3D; kit: BreakHands }>();
  /** Models looked at already: one new on a break that's been going a while (the page just opened) starts where it is for everyone else. */
  const seen = new WeakSet<THREE.Object3D>();
  function kitOf(id: string, root: THREE.Object3D): BreakHands | undefined {
    let h = hands.get(id);
    if (!h || h.root !== root) {
      h?.kit.hold(null);
      const kit = BreakHands.of(root);
      if (!kit) return undefined;
      hands.set(id, (h = { root, kit }));
    }
    return h.kit;
  }

  /**
   * A page just opened on `id`'s break: it starts where it was when it set off for `stop` (the stop
   * before, or its desk), and walks on as far as it has got for everyone else.
   */
  function catchUp(court: Court, id: string, resting: number, stop: Stop) {
    const ms = Math.max(0, Date.now() - resting);
    const n = Math.floor(ms / (STAY * 1000));
    if (n > 0) court.placeAt(id, stopsOf(id)[spotAt(id, resting, ms - STAY * 1000, new Set())]);
    court.visit(id, stop);
    court.advance(id, (ms - n * STAY * 1000) / 1000);
  }

  function stopsOf(id: string): Stop[] {
    let s = mine.get(id);
    if (!s) {
      const h = hash(id);
      const jx = ((h % 7) - 3) * 0.08;
      const jz = (((h >> 3) % 7) - 3) * 0.08;
      s = all.map(({ stop: st }) => (st.sit ? st : { ...st, x: st.x + jx, z: st.z + jz }));
      mine.set(id, s);
    }
    return s;
  }

  /** Where `id`'s break has got to `ms` after it started, as an index into the stops. */
  function spotAt(id: string, resting: number, ms: number, taken: Set<number>): number {
    const smoker = hash(id) % 3 === 0;
    const can = all.map((s, i) => (s.smokers && !smoker ? -1 : i)).filter((i) => i >= 0);
    const n = Math.floor(ms / (STAY * 1000));
    // A shuffled round, a new one each time it's been everywhere.
    const round = Math.floor(n / can.length);
    const order = [...can].sort((a, b) => hash(`${id}:${resting}:${round}:${a}`) - hash(`${id}:${resting}:${round}:${b}`));
    // Somewhere someone else is already (one at the tee, one in each seat): on to the next stop in its round.
    for (let k = 0; k < order.length; k++) {
      const i = order[(n + k) % order.length];
      if (!taken.has(i)) return i;
    }
    return order[n % order.length];
  }

  // After the workers' own update (features/workers), so the arms holding something win.
  ctx.ticks.add('others', ({ dt }) => {
    const court = parts.worlds.court();
    if (!court || parts.worlds.plan().style !== 'office') return;
    wispIn -= dt;
    const wisp = wispIn <= 0;
    if (wisp) wispIn = 0.35;
    /** Stops taken this frame, so two don't stand in one another. */
    const taken = new Set<number>();
    for (const w of store.workers.values()) {
      const v = parts.views.workerViews.get(w.id);
      if (!v) continue;
      const fresh = !seen.has(v.model.root);
      seen.add(v.model.root);
      if (!w.resting) {
        if (court.stopOf(w.id)) court.visit(w.id, null);
        hands.get(w.id)?.kit.hold(null);
        continue;
      }
      const kit = kitOf(w.id, v.model.root);
      const i = spotAt(w.id, w.resting, Math.max(0, Date.now() - w.resting), taken);
      taken.add(i);
      const stop = stopsOf(w.id)[i];
      if (fresh) catchUp(court, w.id, w.resting, stop);
      else court.visit(w.id, stop);
      const there = court.arrived(w.id) && court.stopOf(w.id) === stop;
      if (!kit) continue;
      kit.hold(there ? (all[i].held ?? null) : null);
      kit.pose(dt);
      if (!there || all[i].held !== 'cigarette') continue;
      if (wisp && kit.tipAt(tip)) ctx.smoke.wisp(tip);
      if (kit.exhaled() && kit.tipAt(tip)) {
        const a = v.model.root.rotation.y;
        ctx.smoke.exhale(tip.setY(tip.y + 0.12), blow.set(Math.sin(a), 0.15, Math.cos(a)).normalize());
      }
    }
    for (const id of hands.keys()) if (!parts.views.workerViews.has(id)) hands.delete(id);
  });
}
