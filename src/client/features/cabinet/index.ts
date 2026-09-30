import { GAME, scoreText } from '../../../shared/cabinet';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { Cabinet } from './ui';
import { clip } from '../../ui/dom';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    cabinet: true;
  }
}

export interface CabinetDeps {
  /** A worker's terminal: one of yours needing you stops the game, with a button to it. */
  openTerminal(id: string): void;
}

/** The arcade cabinet by the jukebox: BLOCKFALL up close, and on its screen for everyone else on the floor. */
export function installCabinet(ctx: Ctx, deps: CabinetDeps): Cabinet {
  // The arcade cabinet next to it: BLOCKFALL up close, and on its screen for everyone else on the floor.
  const cabinet = new Cabinet(ctx.office.cabinet.screen, ctx.net, { openTerminal: (id) => deps.openTerminal(id), sound: (kind, lines) => ctx.sound.arcade(kind, lines) });
  ctx.ticks.add('play', ({ dt }) => cabinet.update(ctx.camera, dt));
  ctx.interactions.define('cabinet', {
    reach: 4,
    hint: () => {
      const c = store.cabinet;
      const f = store.cabinetFrame;
      if (c.player && c.player.id !== store.you) {
        const who = c.player.name;
        return { k: `${who}|${f?.score}`, parts: [hintTitle('🕹️ Arcade'), aside(`▶ ${clip(who, 24)} is playing${f ? ` · ${scoreText(f.score)}` : ''}`), key('E', 'Watch')] };
      }
      const left = cabinet.leftAt;
      const best = c.scores[0];
      const about = left !== null ? `your game's paused at ${scoreText(left)}` : best ? `🏆 ${clip(best.name, 24)} · ${scoreText(best.score)}` : 'no high score yet';
      return { k: `${left}|${best?.name}|${best?.score}`, parts: [hintTitle(`🕹️ ${GAME}`), aside(about), key('E', left !== null ? 'Carry on' : 'Play')] };
    },
    use: onE(() => cabinet.play()),
  });
  // With the camera up at its screen, the game has the screen: no hands drawn over it.
  ctx.view.add({ covers: () => cabinet.zoomed });
  return cabinet;
}
