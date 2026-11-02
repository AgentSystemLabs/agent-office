import type { CustomBoardState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Custom boards registered on the floor. */
    customBoards: Map<string, CustomBoardState>;
  }
  interface Topics {
    boards: true;
  }
}

export const boards: Slice = {
  init(s) {
    s.customBoards = new Map();
  },
  on: {
    'board.state'(s, m) {
      s.customBoards.set(m.boardId, m.state);
      return ['boards'];
    },
  },
  enter(s, v) {
    s.customBoards.clear();
    if (v.boards) {
      for (const [id, st] of Object.entries(v.boards)) {
        s.customBoards.set(id, st);
      }
    }
    return ['boards'];
  },
};
