/**
 * A worker's subagents (WorkerInfo.subagents, from its Claude Code hooks, see server/subagents.ts):
 * each one stands behind its worker's chair while it runs, with its kind, what it was asked to do and
 * its latest tool call on a card over its head, and goes when it's done. Past SHOWN of them, a sign
 * says how many more there are.
 */
import * as THREE from 'three';
import { liveSubagents, type WorkerStatus } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import type { DeskView } from '../../world/types';
import { SubagentCrowd } from '../../world/character';

/** A worker whose process is running: one asleep or gone has nobody working for it. */
const RUNNING = new Set<WorkerStatus>(['starting', 'idle', 'working', 'needs_input', 'done']);
/** How many stand round a desk; the rest are a count. */
const SHOWN = 6;
/** How big they are next to a worker. */
const SIZE = 0.6;

/**
 * Where the i-th stands, in the seat's own frame (the worker faces +z, its desk): behind the chair,
 * the first two at its shoulders and the rest in a row further back, each turned to its worker.
 */
const SPOTS: readonly (readonly [number, number])[] = [
  [-0.62, -0.7],
  [0.62, -0.7],
  [-1.15, -1.2],
  [0, -1.3],
  [1.15, -1.2],
  [-0.6, -1.85],
  [0.6, -1.85],
];
const spot = (i: number) => {
  const [x, z] = SPOTS[Math.min(i, SPOTS.length - 1)];
  return [x, z, Math.atan2(-x, -z)] as const;
};

interface Standing {
  desk: DeskView;
  holder: THREE.Object3D;
  crowd: SubagentCrowd;
}

/** Follows the workers, and keeps each one's subagents round its desk (its tick: 'others'). */
export function installSubagents(ctx: Ctx) {
  const standing = new Map<string, Standing>();

  function drop(id: string) {
    const s = standing.get(id);
    if (!s) return;
    s.crowd.dispose();
    s.holder.removeFromParent();
    standing.delete(id);
  }

  function sync() {
    const world = ctx.world();
    const now = store.officeNow();
    for (const w of store.workers.values()) {
      const list = RUNNING.has(w.status) ? liveSubagents(w.subagents, now) : [];
      const desk = world.desks.get(w.deskId);
      let s = standing.get(w.id);
      if (s && (s.desk !== desk || !list.length)) {
        drop(w.id);
        s = undefined;
      }
      if (!desk || !list.length) continue;
      if (!s) {
        // On the floor under the seat, turned the way its worker faces.
        const holder = new THREE.Object3D();
        holder.position.set(desk.seatAnchor.position.x, 0, desk.seatAnchor.position.z);
        holder.rotation.y = desk.seatAnchor.rotation.y;
        desk.group.add(holder);
        s = { desk, holder, crowd: new SubagentCrowd(holder, spot, SIZE) };
        standing.set(w.id, s);
      }
      s.crowd.sync(list.slice(0, SHOWN), list.length - SHOWN);
    }
    for (const id of standing.keys()) if (!store.workers.has(id)) drop(id);
  }

  store.on('workers', sync);
  /** When (performance.now()) the subagents were last looked over for any gone quiet without a word. */
  let checkedAt = 0;
  ctx.ticks.add('others', ({ dt, t, now }) => {
    if (now - checkedAt > 30_000) {
      checkedAt = now;
      if (standing.size) sync();
    }
    for (const s of standing.values()) s.crowd.update(dt, t);
  });
}
