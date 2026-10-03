/**
 * Chess on the rooftop, in the 'Merge Conflict' corner: three tables where teammates play while they
 * think about (or wait out) a merge conflict. Sitting in a chair takes that side; E or a click at the
 * board picks a piece up and puts it down (see controller.ts). Everyone up there sees every game. The
 * corner itself (tables, chairs, sign) is built by the roof (world.ts's buildChessCorner).
 */
import { ROOF } from '../../../shared/rooftop';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { ChessController } from './controller';
import './ui.css';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    chess: true;
  }
  interface Interactable {
    /** Which chess table (from 1), for a chess table. */
    chessTable?: number;
  }
}

export function installChess(ctx: Ctx) {
  const chess = new ChessController(ctx);

  ctx.messages.on('chess.tables', (msg) => msg.tables.forEach((t) => chess.apply(t)));
  ctx.messages.on('chess.table', (msg) => chess.apply(msg.table));
  // Up on the roof (by elevator, or back there after a reload): ask how the games stand.
  for (const t of ['welcome', 'floor.enter'] as const) ctx.messages.on(t, () => store.floor === ROOF && ctx.net.send({ t: 'chess.sync' }));

  ctx.interactions.define('chess', {
    reach: 3.6,
    hint: (it) => {
      const n = it.chessTable ?? 0;
      const { status, playing } = chess.describe(n);
      return { k: `${n}|${status}|${playing}`, parts: [hintTitle(`♟ Chess · table ${n}`), aside(status), playing ? key('E / Click', 'Pick up a piece, put it down') : aside('sit in a chair to play')] };
    },
    // Each table is yours to play at only from a chair; E there is a click on whatever you're looking at.
    use: onE(() => chess.click()),
  });

  ctx.ticks.add('world', ({ t, dt }) => (ctx.upTop() ? chess.tick(t, dt) : chess.hide()));

  return { chess };
}
