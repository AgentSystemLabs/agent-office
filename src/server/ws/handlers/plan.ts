// A floor's plan: the signs over its desks, and how far its back office is built out.
import type { Floor } from '../../floor.js';
import { DESK_BY_ID } from '../../../shared/layout.js';
import { EMPTY_PLAN } from '../../../shared/floorplan.js';
import type { PlanClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const planView: ViewPieces['plan'] = (_ctx, floor) => floor?.plan.state() ?? EMPTY_PLAN;

/** The floor's signs or back office changed: its people see it, and everyone sees the building's outside change. */
const planChanged = (ctx: Ctx, floor: Floor) => {
  ctx.toFloor(floor, { t: 'plan', plan: floor.plan.state() });
  ctx.floorsChanged();
};

export const planHandlers = {
  'desk.label'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const deskId = str(msg.deskId, 32);
    const r = floor.plan.label(deskId, msg.text, msg.color, who);
    if (typeof r === 'string') return ctx.warn(c, r);
    if (!r.label && !r.old) return;
    planChanged(ctx, floor);
    const desk = DESK_BY_ID.get(deskId)?.label ?? 'a desk';
    if (r.label && r.label.text !== r.old?.text) ctx.toastFloor(floor, `🪧 ${who} hung a sign over ${desk}: “${r.label.text}”`);
    else if (!r.label) ctx.toastFloor(floor, `🪧 ${who} took the “${r.old!.text}” sign down from ${desk}`);
  },
  'floor.expand'(ctx, c) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const r = floor.plan.expand();
    if (typeof r === 'string') return ctx.warn(c, r);
    planChanged(ctx, floor);
    ctx.toastFloor(floor, `🔨 ${who} knocked out the back wall: ${r.map((id) => DESK_BY_ID.get(id)?.label).join(' and ')} are ready for workers`);
  },
  'floor.shrink'(ctx, c) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const r = floor.plan.shrink((id) => floor.workers.deskOccupied(id));
    if (typeof r === 'string') return ctx.warn(c, r);
    planChanged(ctx, floor);
    ctx.toastFloor(floor, `🧱 ${who} walled the back office back up, and ${r.map((id) => DESK_BY_ID.get(id)?.label).join(' and ')} went with it`);
  },
} satisfies HandlerMap<PlanClientMsg>;
