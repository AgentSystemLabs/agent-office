// Pictures on a floor's walls.
import type { Floor } from '../../floor.js';
import type { DecorClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { str } from '../../office/input.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const decorView: ViewPieces['decor'] = (_ctx, floor) => floor?.decor.list() ?? [];
export const decorChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'decor', items: floor.decor.list() });

export const decorHandlers = {
  'decor.add'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const d = floor.decor.add(msg.decor, who);
    if (typeof d === 'string') return ctx.warn(c, d);
    decorChanged(ctx, floor);
    ctx.toastFloor(floor, `🖼️ ${who} hung ${d.title ? `“${d.title}”` : 'a picture'}`);
  },
  'decor.update'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    const d = floor.decor.update(str(msg.id, 32), msg.decor);
    if (typeof d === 'string') return ctx.warn(c, d);
    decorChanged(ctx, floor);
  },
  'decor.remove'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const d = floor.decor.remove(str(msg.id, 32));
    if (!d) return;
    decorChanged(ctx, floor);
    ctx.toastFloor(floor, `${who} took down ${d.title ? `“${d.title}”` : 'a picture'}`);
  },
} satisfies HandlerMap<DecorClientMsg>;
