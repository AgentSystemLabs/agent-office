import * as THREE from 'three';
import type { HelperState } from '../../shared/helper';
import type { Worker } from './character';

/*
 * The helpers standing at workers' desks, and the walk each one makes to get there (see
 * shared/helper.ts and docs/helper-plan.md).
 *
 * The office works out the way — the same way it does for the dog, from the same nav — and sends it
 * here with a speed and a heading. This flies the model along those points at that speed, so every
 * browser on the floor sees the same walk, and the helper arrives where the office said it would.
 * The worker itself is an ordinary worker and is drawn by the office's own code; all this owns is
 * where it stands while it is on its feet.
 */

/** A worker's feet are this far above its origin (see leaving.ts). */
const FEET = 0.07;

/** How far along its path a helper is, 0–1, for the leg that began at `start`. */
function along(state: HelperState, start: number, now: number): number {
  const total = state.path.slice(1).reduce((n, p, i, a) => (i ? n + Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : Math.hypot(p[0] - state.path[0][0], p[1] - state.path[0][1])), 0);
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, ((now - start) / 1000) * state.speed) / total);
}

interface Walk {
  state: HelperState;
  /** When this batch of paths began, on this page's clock. */
  start: number;
}

export class HelperWalk {
  private readonly walks = new Map<string, Walk>();
  private readonly tmp = new THREE.Vector3();

  constructor(
    private parent: THREE.Object3D,
    /** How high the floor is under (x, z), so a helper stands on it rather than in it. */
    private ground: (x: number, z: number, y: number) => number,
  ) {}

  /** Takes the office's latest word on where every helper is, starting the walks it hasn't seen. */
  sync(helpers: readonly HelperState[], start: number) {
    const seen = new Set(helpers.map((h) => h.workerId));
    for (const id of [...this.walks.keys()]) if (!seen.has(id)) this.walks.delete(id);
    for (const state of helpers) {
      // A path that hasn't changed keeps walking from where it got to; a new one starts over.
      const old = this.walks.get(state.workerId);
      if (!old || old.state.path !== state.path || old.state.phase !== state.phase) {
        this.walks.set(state.workerId, { state, start: state.phase === 'walking' ? start : nowMs() });
      } else {
        old.state = state;
      }
    }
  }

  /** Where the helper at `workerId` has got to, so its model can be put there. */
  place(workerId: string, model: Worker): boolean {
    const w = this.walks.get(workerId);
    if (!w || !w.state.path.length) return false;
    const t = along(w.state, w.start, nowMs());
    const at = pointAt(w.state.path, t);
    const root = model.root;
    // Into the world if it isn't in it yet (a helper has no seat, so it isn't parented anywhere).
    if (root.parent !== this.parent) {
      const pos = root.getWorldPosition(this.tmp).clone();
      this.parent.add(root);
      root.position.copy(pos);
    }
    root.position.set(at[0], this.ground(at[0], at[1], 2) - FEET, at[1]);
    // Facing the way it is going, and once there the way the office said it should face.
    const face = t >= 1 ? w.state.face : headingAt(w.state.path, t);
    root.rotation.set(0, face, 0);
    // On its feet and walking while it is still on its way, standing once it has arrived.
    model.walking = t < 1;
    model.gait = 1;
    return true;
  }

  /** Forgets a helper, however it went. */
  forget(workerId: string) {
    this.walks.delete(workerId);
  }

  /** Every helper on its feet right now, for the doors to open for. */
  positions(models: ReadonlyMap<string, Worker>): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const [id, w] of this.walks) {
      const model = models.get(id);
      if (model) {
        out.push(model.root.position);
        continue;
      }
      // Not modelled yet (a helper hired a moment ago): where its path says it is.
      const at = pointAt(w.state.path, along(w.state, w.start, nowMs()));
      out.push(new THREE.Vector3(at[0], 0, at[1]));
    }
    return out;
  }
}

const nowMs = () => performance.now();

/** The point `t` of the way along a path, 0 the first point and 1 the last. */
function pointAt(path: readonly [number, number][], t: number): [number, number] {
  if (path.length < 2) return path[0] ?? [0, 0];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    lengths.push(total);
  }
  if (total <= 0) return path[path.length - 1];
  let want = t * total;
  for (let i = 0; i < lengths.length; i++) {
    if (want <= lengths[i]) {
      const a = path[i];
      const b = path[i + 1];
      const seg = lengths[i] - (i ? lengths[i - 1] : 0);
      const f = seg > 0 ? (want - (i ? lengths[i - 1] : 0)) / seg : 0;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    want = total;
  }
  return path[path.length - 1];
}

/** Which way a face at `t` is pointing: down the leg it is on. */
function headingAt(path: readonly [number, number][], t: number): number {
  const a = pointAt(path, Math.max(0, t - 0.01));
  const b = pointAt(path, Math.min(1, t + 0.01));
  if (a[0] === b[0] && a[1] === b[1]) return 0;
  return Math.atan2(b[0] - a[0], b[1] - a[1]);
}
