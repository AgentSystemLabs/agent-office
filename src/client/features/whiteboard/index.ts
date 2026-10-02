/** The whiteboard: it shows what everyone's drawn on it, and E draws on it with them. */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { clip } from '../../ui/dom';
import { mirrorWhiteboard, openWhiteboard } from './ui';
import { L } from '../../i18n';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    whiteboard: true;
  }
}

export function installWhiteboard(ctx: Ctx) {
  const { office } = ctx;
  // The whiteboard shows what everyone's drawn on it.
  mirrorWhiteboard(office.whiteboard.show, office.whiteboard.fit.width, office.whiteboard.fit.height);
  ctx.interactions.define('whiteboard', {
    reach: 7,
    hint: () => {
      const names = store.drawing.flatMap((id) => (id === store.you ? [] : (store.peers.get(id)?.name ?? []))).join(', ');
      return { k: names, parts: [hintTitle(L.hints.whiteboard), aside(names ? L.hints.drawing(clip(names, 40)) : L.hints.drawTogether), key('E', names ? L.hints.joinIn : L.hints.draw)] };
    },
    use: onE(() => openWhiteboard(ctx.net)),
  });
}
