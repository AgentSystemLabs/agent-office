/**
 * The thinking spot on the roof: E there opens a small window to pick the sound to think to (ocean
 * waves, rain or a forest, all made with Web Audio: see engine.ts). It plays across the whole roof and
 * stops when you go back inside.
 */
import { THINK_SPOT } from '../../../shared/garden';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import type { Interactable } from '../../world/types';
import { Ambience } from './engine';
import { nowPlaying, openAmbience } from './ui';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    ambience: true;
  }
}

/** The seat to put in the roof's interactables (see features/rooftop): E there opens the sound picker. */
export function thinkSpotInteractable(): Interactable {
  return { kind: 'ambience', x: THINK_SPOT.x, y: 0, z: THINK_SPOT.z, radius: 2.2 };
}

export function installAmbience(ctx: Ctx) {
  const amb = new Ambience(() => ctx.sound.audioBus());

  ctx.interactions.define('ambience', {
    reach: 3.5,
    hint: () => {
      const cur = amb.current();
      return { k: String(cur), parts: [hintTitle('🎧 Thinking spot'), aside(cur ? nowPlaying(cur) : 'pick a sound'), key('E', 'Choose sounds')] };
    },
    use: onE(() => openAmbience(amb)),
  });

  // Plays everywhere on the roof; leaving it fades the sound out and stops it.
  ctx.ticks.add('env', () => amb.setHere(ctx.upTop()));

  return { amb };
}
