// The task queue: adding, moving and retrying tasks, and how many workers it keeps busy. Each works on
// the queue of the floor you're on, or on another floor's when the message names one.
import { isAgentEffort, isAgentProvider, type QueueClientMsg } from '../../../shared/protocol.js';
import { OPEN_CODE_MODEL_MAX } from '../../../shared/providers.js';
import type { Floor } from '../../floor.js';
import type { Client } from '../../office/client.js';
import type { Ctx } from '../../office/context.js';
import { num, str } from '../../office/input.js';
import { watchQueues } from '../../queue-watch.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const queueView: ViewPieces['queue'] = (_ctx, floor) => floor?.queue.state() ?? { tasks: [], maxWorkers: 0 };

/** The floor a queue message is for: the one it names, else the one `c` is on. */
const queueFloor = (ctx: Ctx, c: Client, id: unknown): Floor | undefined => {
  if (id === undefined) return here(ctx, c);
  const floor = ctx.floors.get(str(id, 200));
  if (!floor) ctx.warn(c, 'That project is no longer in the building');
  return floor;
};

export const queueHandlers = {
  'queue.add'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = queueFloor(ctx, c, msg.floor);
    if (!floor) return;
    if (msg.provider !== undefined && (!isAgentProvider(msg.provider) || !floor.project.agentProviders.includes(msg.provider))) {
      ctx.warn(c, 'Unknown agent provider');
      return;
    }
    const issue = Number.isInteger(msg.issue) && (msg.issue as number) > 0 ? (msg.issue as number) : undefined;
    const model = msg.model === undefined ? undefined : str(msg.model, OPEN_CODE_MODEL_MAX + 1);
    const effort = isAgentEffort(msg.effort) ? msg.effort : undefined;
    // Its worker runs on the sign-ins of whoever queued it, whenever it gets a desk.
    ctx.withSignIn(c, ctx.claudeFor(msg.provider ?? floor.workers.officeDefault.provider), () => {
      const err = floor.queue.add(str(msg.prompt, 20000), who, str(msg.title, 200), issue, msg.provider, model, effort, c.accountId);
      if (err) return ctx.warn(c, err);
      const what = issue !== undefined ? `issue #${issue}` : 'a task';
      ctx.toastFloor(floor, `📋 ${who} queued ${what}`);
      // Handed to another floor: whoever queued it isn't there to see that toast.
      if (ctx.floorOf(c) !== floor) ctx.sendTo(c, { t: 'toast', text: `📋 Queued ${what} on ${floor.def.name}`, level: 'info' });
    });
  },
  'queue.remove'(ctx, c, msg) {
    const floor = queueFloor(ctx, c, msg.floor);
    if (floor) ctx.warn(c, floor.queue.remove(str(msg.taskId, 32)));
  },
  'queue.move'(ctx, c, msg) {
    const floor = msg.floor === undefined ? ctx.floorOf(c) : queueFloor(ctx, c, msg.floor);
    floor?.queue.move(str(msg.taskId, 32), num(msg.delta) < 0 ? -1 : 1);
  },
  'queue.retry'(ctx, c, msg) {
    const floor = queueFloor(ctx, c, msg.floor);
    if (floor) ctx.warn(c, floor.queue.retry(str(msg.taskId, 32)));
  },
  'queue.clear'(ctx, c, msg) {
    const floor = msg.floor === undefined ? ctx.floorOf(c) : queueFloor(ctx, c, msg.floor);
    floor?.queue.clear();
  },
  'queue.limit'(ctx, c, msg) {
    const floor = msg.floor === undefined ? ctx.floorOf(c) : queueFloor(ctx, c, msg.floor);
    floor?.queue.setLimit(num(msg.maxWorkers));
  },
  'queue.watch'(ctx, c, msg) {
    watchQueues(ctx, c, msg.on === true);
  },
} satisfies HandlerMap<QueueClientMsg>;
