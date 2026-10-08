// The floor's coordinator board: the plan its `plans/` folder holds, for whoever arrives on the
// floor, and a way to look at the files again right away.
import { EMPTY_COORDINATOR } from '../../../shared/coordinator.js';
import type { CoordinatorClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const coordinatorView: ViewPieces['coordinator'] = (_ctx, floor) => floor?.coordinator.state() ?? EMPTY_COORDINATOR;

export const coordinatorHandlers = {
  'coordinator.refresh'(ctx, c) {
    ctx.floorOf(c)?.coordinator.refresh();
  },
} satisfies HandlerMap<CoordinatorClientMsg>;
