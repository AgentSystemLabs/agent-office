import type { QueueClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import type { HandlerMap } from './types.js';

export const queueCompletionHandlers = {
  'queue.continue'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    if (floor) ctx.warn(c, floor.queue.continue(str(msg.taskId, 32), c.peer.name));
  },
  'queue.confirm'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    if (floor) ctx.warn(c, floor.queue.confirm(str(msg.taskId, 32), c.peer.name));
  },
} satisfies HandlerMap<Extract<QueueClientMsg, { t: 'queue.continue' | 'queue.confirm' }>>;
