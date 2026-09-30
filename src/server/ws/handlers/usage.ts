// The Claude plan limits under the workers.
import type { UsageClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap } from './types.js';

export const usageHandlers = {
  'limits.refresh'(ctx, c) {
    ctx.limitsOf(c).refresh();
  },
} satisfies HandlerMap<UsageClientMsg>;
