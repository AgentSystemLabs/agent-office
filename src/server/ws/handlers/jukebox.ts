// The lounge jukebox on every floor.
import type { Floor } from '../../floor.js';
import { JUKEBOX_TUNES, STREAM } from '../../../shared/jukebox.js';
import type { JukeboxClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';
import { L } from '../../i18n.js';

export const jukeboxView: ViewPieces['jukebox'] = (_ctx, floor) => floor?.jukebox.state() ?? { on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now(), elapsed: 0 };
export const jukeboxChanged = (ctx: Ctx, floor: Floor) => ctx.toFloor(floor, { t: 'jukebox', state: floor.jukebox.state() });

export const jukeboxHandlers = {
  'jukebox.play'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    const r = floor.jukebox.play({ track: msg.track, url: msg.url }, who);
    if ('error' in r) return ctx.warn(c, r.error);
    if (!r.changed) return;
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, floor.jukebox.state().track === STREAM ? L.srv.tuned(who, floor.jukebox.title()) : L.srv.putOn(who, floor.jukebox.title()));
  },
  'jukebox.skip'(ctx, c) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor) return;
    floor.jukebox.skip(who);
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, L.srv.skipped(who, floor.jukebox.title()));
  },
  'jukebox.stop'(ctx, c) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    if (!floor || !floor.jukebox.stop(who)) return;
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, L.srv.jukeboxOff(who));
  },
} satisfies HandlerMap<JukeboxClientMsg>;
