import type { QueueClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap } from './types.js';

export const queueStaffingHandlers = {
  'queue.staffing'(ctx, c, msg) {
    if (typeof msg.existingOnly === 'boolean') ctx.floorOf(c)?.queue.setExistingOnly(msg.existingOnly);
  },
} satisfies HandlerMap<Extract<QueueClientMsg, { t: 'queue.staffing' }>>;
