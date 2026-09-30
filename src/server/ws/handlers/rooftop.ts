// The balcony and the roof: the golf tee, the dart board and the axe lane, the gong and the DJ's air horn.
import type { RooftopClientMsg } from '../../../shared/protocol.js';
import { ROOF } from '../../../shared/rooftop.js';
import { tossOk, type BarGame } from '../../../shared/bargames.js';
import { throttle } from '../../office/client.js';
import { num } from '../../office/input.js';
import type { HandlerMap } from './types.js';

/** The quickest anyone throws one dart after another, or one axe (ms): a page's own wait is longer. */
const TOSS_EVERY: Record<BarGame, number> = { darts: 250, axe: 700 };

export const rooftopHandlers = {
  golf(ctx, c, msg) {
    const [yaw, loft, power] = [num(msg.yaw), num(msg.loft), num(msg.power)];
    if (!c.peer.golfing || Math.abs(yaw) > 2 || loft < 0 || loft > 1.6 || power < 0 || power > 1 || !throttle(c, 'golf', 800)) return;
    ctx.toNeighbors(c, { t: 'golf', id: c.id, yaw, loft, power });
  },
  toss(ctx, c, msg) {
    // Only at the line they stepped up to, and no quicker than anyone throws.
    const toss: { game: unknown; u: unknown; v: unknown; n: unknown } = { game: msg.game, u: msg.u, v: msg.v, n: msg.n };
    if (!tossOk(toss) || c.peer.throwing !== toss.game || !throttle(c, 'toss', TOSS_EVERY[toss.game])) return;
    ctx.toNeighbors(c, { t: 'toss', id: c.id, game: toss.game, u: toss.u, v: toss.v, n: toss.n, stick: msg.stick === true });
  },
  gong(ctx, c) {
    const who = c.peer.name;
    const floor = ctx.floorOf(c);
    if (!floor || !throttle(c, 'gong', 500)) return;
    ctx.toFloor(floor, { t: 'gong', why: 'hit', by: who });
  },
  horn(ctx, c) {
    const who = c.peer.name;
    if (c.peer.floor !== ROOF || !throttle(c, 'horn', 1500)) return;
    for (const o of ctx.clients.values()) if (o.peer.floor === ROOF) ctx.sendTo(o, { t: 'horn', by: who });
  },
} satisfies HandlerMap<RooftopClientMsg>;
