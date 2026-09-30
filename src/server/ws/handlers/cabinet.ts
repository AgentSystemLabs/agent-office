// The arcade cabinet on every floor: who's playing it, the game on its screen, and the high scores.
import type { Floor } from '../../floor.js';
import { checkFrame, type CabinetFrame, type CabinetState } from '../../../shared/cabinet.js';
import type { CabinetClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { throttle, type Client } from '../../office/client.js';
import { here } from './common.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

/** At the arcade cabinet on their floor, playing `game` (see Arcade); `frame` is it as it looks now. */
interface Player {
  playing: boolean;
  game?: string;
  frame?: CabinetFrame;
}
const players = new WeakMap<Client, Player>();
const player = (c: Client): Player => {
  let p = players.get(c);
  if (!p) players.set(c, (p = { playing: false }));
  return p;
};

/** Who's playing the arcade cabinet on a floor. */
export const cabinetPlayer = (ctx: Ctx, floor: Floor): Client | undefined => [...ctx.clients.values()].find((c) => player(c).playing && c.peer.floor === floor.id);
export const cabinetState = (ctx: Ctx, floor: Floor | undefined): CabinetState => {
  const p = floor && cabinetPlayer(ctx, floor);
  return { player: p ? { id: p.id, name: p.peer.name, game: player(p).game ?? '' } : null, scores: ctx.highScores.top() };
};
/** Who's at the cabinet, its high scores, and the game on its screen as its player last sent it. */
export const cabinetView: ViewPieces['cabinet'] = (ctx, floor) => {
  const state = cabinetState(ctx, floor);
  const p = floor && cabinetPlayer(ctx, floor);
  return { ...state, frame: (p && player(p).frame) ?? null };
};
export const cabinetChanged = (ctx: Ctx, floor: Floor | undefined) => {
  if (floor) ctx.toFloor(floor, { t: 'cabinet', state: cabinetState(ctx, floor) });
};
/** `c` stepped away from the cabinet (or left the floor, or the office): their game waits, with its score so far on the table. */
export const stopPlaying = (ctx: Ctx, c: Client, floor = ctx.floorOf(c)) => {
  const p = player(c);
  if (!p.playing) return;
  if (floor) ctx.arcade.leave(p.game, floor.id);
  p.playing = false;
  p.game = undefined;
  p.frame = undefined;
  cabinetChanged(ctx, floor);
};

export const cabinetHandlers = {
  'cabinet.play'(ctx, c, msg) {
    const who = c.peer.name;
    const floor = here(ctx, c);
    const p = player(c);
    if (!floor || (p.playing && msg.game === p.game)) return;
    const at = cabinetPlayer(ctx, floor);
    if (at && at !== c) {
      ctx.warn(c, `${at.peer.name} is on the arcade — press E there to watch`);
      ctx.sendTo(c, { t: 'cabinet', state: cabinetState(ctx, floor) });
      return;
    }
    // Already at it: that game's over, and this is the next one.
    if (p.playing) ctx.arcade.leave(p.game, floor.id);
    p.game = ctx.arcade.start({ owner: c.accountId ? `account:${c.accountId}` : `name:${who}`, name: who, color: c.peer.color, connection: c.id }, msg.game);
    if (p.game !== msg.game && !ctx.arcade.counts(p.game)) ctx.warn(c, "🕹️ That's a lot of new games in a row, so this one won't go on the high-score table");
    p.playing = true;
    p.frame = undefined;
    cabinetChanged(ctx, floor);
  },
  'cabinet.leave'(ctx, c) {
    stopPlaying(ctx, c);
  },
  'cabinet.frame'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    const frame = checkFrame(msg.frame);
    const p = player(c);
    if (!p.playing || !floor || !frame) return;
    // Every frame counts towards the score, even one that comes too soon after the last to pass on.
    if (ctx.arcade.frame(p.game, frame, floor.id) === 'void') ctx.warn(c, "🕹️ The office couldn't follow this game, so its score won't go on the high-score table");
    p.frame = frame;
    if (!throttle(c, 'cabinet.frame', 40)) return;
    ctx.toNeighbors(c, { t: 'cabinet.frame', frame }, true);
  },
} satisfies HandlerMap<CabinetClientMsg>;

export const cabinetHooks: FeatureHooks = {
  // The arcade downstairs stays downstairs.
  leaving: (ctx, c, was) => stopPlaying(ctx, c, was),
  closed: (ctx, c) => stopPlaying(ctx, c),
};
