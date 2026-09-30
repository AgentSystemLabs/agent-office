/** The bookshelf: the project's docs to read, with a book in your hands (and a swish as its pages turn). */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { saveSettings, store } from '../../state';
import { openBookshelf } from './ui';
import { clip, toast } from '../../ui/dom';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    bookshelf: true;
  }
}

/** The project on GitHub, from the floor's origin remote, when that's where it is. */
function githubUrl(remote?: string): string | undefined {
  const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/.exec(remote ?? '');
  return m ? `https://github.com/${m[1]}` : undefined;
}

export function installBookshelf(ctx: Ctx) {
  const { settings } = ctx;

  function showBookshelf() {
    if (!store.floor) return toast('Take the elevator to a floor first');
    openBookshelf({
      floor: store.floor,
      project: store.project?.name,
      repoUrl: githubUrl(store.project?.remote),
      onTurn: turnPage,
      pageSound: settings.pageTurns,
      onPageSound: (on) => {
        settings.pageTurns = on;
        saveSettings(settings);
      },
    });
  }

  ctx.interactions.define('bookshelf', {
    reach: 4,
    hint: () => {
      const names = [...store.peers.values()].filter((p) => p.reading && p.id !== store.you && store.onMyFloor(p)).map((p) => p.name).join(', ');
      return { k: names, parts: [hintTitle('📚 Bookshelf'), aside(names ? `📖 ${clip(names, 40)} reading` : "the project's docs"), key('E', 'Read the docs')] };
    },
    use: onE(() => showBookshelf()),
  });

  /** When a page last turned, so flicking through a doc is one swish rather than a swish a screenful. */
  let turnedAt = 0;
  /** You turned a page on the bookshelf: so does the book in your hands, for everyone watching it too. */
  function turnPage() {
    ctx.me.turnPage();
    ctx.hands.turnPage();
    const now = performance.now();
    if (settings.pageTurns && now - turnedAt > 1000) ctx.sound.pageTurn();
    turnedAt = now;
  }

  return { showBookshelf };
}
