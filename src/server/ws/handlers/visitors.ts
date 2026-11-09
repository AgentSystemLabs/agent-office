// Visitors take no messages: they're only looked at. What someone arriving on a floor is sent of them.
import type { VisitorsState } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { Floor } from '../../floor.js';

export const visitorsView = (ctx: Ctx, floor: Floor | undefined): VisitorsState => ctx.visitors.state(floor?.id);
