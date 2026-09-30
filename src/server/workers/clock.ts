// How long each worker has spent working (WorkerInfo.workedMs), for its card and the map.
import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';

/** How long a worker has spent working (ms), the stretch it's in now included. */
export function workedMs(info: WorkerInfo, now = Date.now()): number | undefined {
  const ms = (info.workedMs ?? 0) + (info.workingSince === undefined ? 0 : Math.max(0, now - info.workingSince));
  return ms > 0 ? ms : undefined;
}

/** Keeps count of how long a worker has worked (WorkerInfo.workedMs) as it goes from its status into `next`. */
export function clockWork(info: WorkerInfo, next: WorkerStatus, now = Date.now()) {
  if (next === 'working') {
    info.workingSince ??= now;
    return;
  }
  if (info.workingSince === undefined) return;
  info.workedMs = workedMs(info, now);
  info.workingSince = undefined;
}
