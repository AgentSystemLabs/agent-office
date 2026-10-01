// Who follows every floor's queue at once: the 📋 queue's 🏢 All floors view, where tasks are handed
// to any project in the building. Everyone else only hears about the queue of the floor they're on.
import type { FloorQueue, QueueState } from '../shared/protocol.js';
import type { Floor } from './floor.js';
import type { Client } from './office/client.js';
import type { Ctx } from './office/context.js';

/** A client drops out of this by itself once it's gone, so leaving the office needs no hook. */
const watchers = new WeakSet<Client>();

/** Every open floor's queue, in the building's order. */
export function floorQueues(ctx: Ctx): FloorQueue[] {
  return [...ctx.floors.values()].map((f) => ({ floor: f.id, state: f.queue.state() }));
}

/** `c` starts (and gets every floor's queue) or stops following every floor's queue. */
export function watchQueues(ctx: Ctx, c: Client, on: boolean) {
  if (!on) {
    watchers.delete(c);
    return;
  }
  watchers.add(c);
  ctx.sendTo(c, { t: 'queues', floors: floorQueues(ctx) });
}

/** A floor's queue changed: tell everyone following them all. */
export function queueChanged(ctx: Ctx, floor: Floor, state: QueueState) {
  for (const c of ctx.clients.values()) if (watchers.has(c)) ctx.sendTo(c, { t: 'queue.floor', floor: floor.id, state });
}
