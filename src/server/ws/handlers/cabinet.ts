// The arcade cabinet on every floor: who's playing it, the game on its screen, and the high scores.
import type { Floor } from '../../floor.js';
import type { CabinetState } from '../../../shared/cabinet.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';

/** Who's playing the arcade cabinet on a floor. */
export const cabinetPlayer = (ctx: Ctx, floor: Floor): Client | undefined => [...ctx.clients.values()].find((c) => c.playing && c.peer.floor === floor.id);
export const cabinetState = (ctx: Ctx, floor: Floor | undefined): CabinetState => {
  const p = floor && cabinetPlayer(ctx, floor);
  return { player: p ? { id: p.id, name: p.peer.name, game: p.game ?? '' } : null, scores: ctx.highScores.top() };
};
export const cabinetChanged = (ctx: Ctx, floor: Floor | undefined) => {
  if (floor) ctx.toFloor(floor, { t: 'cabinet', state: cabinetState(ctx, floor) });
};
/** `c` stepped away from the cabinet (or left the floor, or the office): their game waits, with its score so far on the table. */
export const stopPlaying = (ctx: Ctx, c: Client, floor = ctx.floorOf(c)) => {
  if (!c.playing) return;
  if (floor) ctx.arcade.leave(c.game, floor.id);
  c.playing = false;
  c.game = undefined;
  c.frame = undefined;
  cabinetChanged(ctx, floor);
};
