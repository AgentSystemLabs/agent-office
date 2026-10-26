import type { WorkerHandle } from './types.js';

/** A launcher waiting for resources is not an agent asking the user for permission. */
export function noteBootTimeout(worker: Pick<WorkerHandle, 'info' | 'bootBlocked' | 'setStatus'>, hint: string, screen: string) {
  const waiting = /Agent Office capacity guard: Waiting for capacity; no model started\./.test(screen.slice(-12_000));
  worker.bootBlocked = !waiting;
  worker.info.activity = waiting ? 'Waiting for available RAM or a company slot; task preserved' : hint;
  worker.setStatus(waiting ? 'starting' : 'needs_input');
}
