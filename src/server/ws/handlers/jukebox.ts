import { socialFloor, type SocialFloor } from '../../lobby.js';
// The lounge jukebox on every floor.
import { JUKEBOX_TUNES, STREAM } from '../../../shared/jukebox.js';
import type { JukeboxClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const jukeboxView: ViewPieces['jukebox'] = (_ctx, floor) => floor?.jukebox.state() ?? { on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now(), elapsed: 0 };
export const jukeboxChanged = (ctx: Ctx, floor: SocialFloor) => ctx.toFloor(floor, { t: 'jukebox', state: floor.jukebox.state() });

export const jukeboxHandlers = {
  'jukebox.play'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = socialFloor(ctx, c);
    if (!floor) return;
    const r = floor.jukebox.play({ track: msg.track, url: msg.url }, who);
    if ('error' in r) return ctx.warn(c, r.error);
    if (!r.changed) return;
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, floor.jukebox.state().track === STREAM ? `📻 ${who} tuned the jukebox to ${floor.jukebox.title()}` : `🎵 ${who} put on “${floor.jukebox.title()}”`);
  },
  'jukebox.skip'(ctx, c) {
    const who = c.peer.name;
    const floor = socialFloor(ctx, c);
    if (!floor) return;
    floor.jukebox.skip(who);
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, `⏭️ ${who} skipped to “${floor.jukebox.title()}”`);
  },
  'jukebox.stop'(ctx, c) {
    const who = c.peer.name;
    const floor = socialFloor(ctx, c);
    if (!floor || !floor.jukebox.stop(who)) return;
    jukeboxChanged(ctx, floor);
    ctx.toastFloor(floor, `🔇 ${who} turned the jukebox off`);
  },
} satisfies HandlerMap<JukeboxClientMsg>;
