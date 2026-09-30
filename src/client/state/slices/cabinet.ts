import type { CabinetFrame, CabinetState } from '../../../shared/cabinet';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Who's at the arcade cabinet on your floor, and the building's high scores. */
    cabinet: CabinetState;
    /** The game on the cabinet as its player last sent it; null while nobody plays. */
    cabinetFrame: CabinetFrame | null;
  }
  interface Topics {
    cabinet: true;
    cabinetFrame: true;
  }
}

export const cabinet: Slice = {
  init(s) {
    s.cabinet = { player: null, scores: [] };
    s.cabinetFrame = null;
  },
  on: {
    cabinet(s, m) {
      // Nobody at it any more: the last game's screen goes with them.
      if (!m.state.player || m.state.player.id !== s.cabinet.player?.id) s.cabinetFrame = null;
      s.cabinet = m.state;
      return ['cabinet'];
    },
    'cabinet.frame'(s, m) {
      s.cabinetFrame = m.frame;
      return ['cabinetFrame'];
    },
  },
  enter(s, v) {
    s.cabinet = { player: v.cabinet.player, scores: v.cabinet.scores };
    s.cabinetFrame = v.cabinet.frame;
    return ['cabinet', 'cabinetFrame'];
  },
};
