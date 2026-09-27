// What a worker's status means, for the checks the server and the browser both make.

import type { WorkerInfo, WorkerStatus } from './protocol.js';

/** Its process isn't running: it exited, or came back asleep after a restart. R wakes it. */
export function isAsleep(status: WorkerStatus): boolean {
  return status === 'exited' || status === 'offline';
}

/** In the middle of a turn: booting, working, or waiting on an answer. */
export function isBusy(status: WorkerStatus): boolean {
  return status === 'starting' || status === 'working' || status === 'needs_input';
}

/**
 * One line for a notification about a worker: what it's asking for when it needs input, or what it
 * was on when it's done (its last activity may be a permission prompt it has long got past).
 */
export function alertDetail(w: WorkerInfo): string | undefined {
  return w.status === 'needs_input' ? (w.activity ?? w.task?.summary) : (w.task?.summary ?? w.prompt);
}
