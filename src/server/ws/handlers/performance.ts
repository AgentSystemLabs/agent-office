import type { PerformanceClientMsg } from '../../../shared/protocol.js';
import { screensOf } from '../../office/screens.js';
import type { HandlerMap } from './types.js';

export const performanceHandlers = {
  'performance.set'(ctx, c, msg) {
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change office performance settings');
    ctx.warn(c, ctx.performance.set(msg.settings, c.peer.name));
  },
  'screen.watch'(ctx, c, msg) {
    if (typeof msg.on !== 'boolean') return;
    const on = msg.on && !c.peer.lite;
    if (c.screens === on) return;
    c.screens = on;
    if (on) screensOf(ctx, c, ctx.floorOf(c));
  },
} satisfies HandlerMap<PerformanceClientMsg>;
