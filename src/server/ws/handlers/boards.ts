import type { BoardsClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const boardsView: ViewPieces['boards'] = (_ctx, floor) => floor?.boardsState() ?? {};

export const boardsHandlers: HandlerMap<BoardsClientMsg> = {
  'board.refresh'(ctx, c, msg) {
    const floor = ctx.floorOf(c);
    if (floor && typeof msg.boardId === 'string') {
      void floor.refreshBoard(msg.boardId);
    }
  },
};
