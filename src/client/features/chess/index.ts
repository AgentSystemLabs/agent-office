import type { Ctx } from '../../core/context';
import { Chess } from './ui';

/** The chess corner behind the lounge couch: sit on a chair and press E again to play an idle agent (see features/seating). */
export function installChess(ctx: Ctx): Chess {
  return new Chess(ctx);
}
