import { DESK_BY_ID } from '../../shared/layout.js';
import { canRest } from '../../shared/status.js';
import type { WorkerInfo } from '../../shared/protocol.js';

// A worker's break round the office (WorkerInfo.resting, see the client's features/breaks): Z at a
// finished worker's desk sends it off, Z again calls it back, and work for it ends the break too.

/** Sends `info` (the manager's own, live) off on a break, or back to its desk. Why not, if it can't go. */
export function takeBreak(info: WorkerInfo, on: boolean): string | undefined {
  if (on && !canRest(info, !!DESK_BY_ID.get(info.deskId)?.station)) return `${info.name} can only take a break when it's done, at a desk of its own`;
  info.resting = on ? (info.resting ?? Date.now()) : undefined;
  return undefined;
}

/** Busy again, waiting on someone or asleep: the break is over, on the update going out and the worker itself. */
export function breakOver(worker: WorkerInfo, live: WorkerInfo | undefined) {
  if (!worker.resting || worker.status === 'idle' || worker.status === 'done') return;
  delete worker.resting;
  if (live) delete live.resting;
}
