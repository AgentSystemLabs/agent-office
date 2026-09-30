/**
 * The herald (the castle's Hand of the King): E at him, or K from the throne, sends out a new worker,
 * hired at the first free seat at the tables and running off there from beside him.
 */
import { officeFull, pressureNote } from '../../../shared/machine';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import type { Parts } from '../../core/parts';
import { repoChoices } from '../../shared/hiring';
import { store } from '../../state';
import { h, toast } from '../../ui/dom';
import { openPrompt } from '../../ui/prompt';
import { hiringPaused } from '../../ui/usage';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    herald: true;
  }
}

/** Registers K (the herald, from the throne). */
export function installHerald(ctx: Ctx, parts: Pick<Parts, 'place' | 'you' | 'actions' | 'views'>) {
  const { plan } = ctx;

  // On the throne: the herald beside you, whoever's in line.
  ctx.keys.bind({
    code: 'KeyK',
    when: () => parts.place.onThrone() && !!ctx.world().herald,
    run: () => {
      parts.you.reach();
      hireFromHerald();
    },
  });
  /**
   * E at the herald (the castle's Hand of the King): what should a new worker do? It's hired at the
   * first free seat at the tables, and runs off there from beside him (see cameFrom).
   */
  function hireFromHerald() {
    const { actions, views } = parts;
    const h = plan().herald;
    if (!h || actions.officeIsFull()) return;
    if (!actions.firstFreeSeat()) return toast(`${h.name}: every seat at the tables is taken — send someone home first`, 'warn');
    openPrompt({
      title: `${plan().icon} ${h.name}: send out a worker`,
      subtitle: `Say what it’s to do. A new worker runs off to a free seat and gets started${plan().lineup.length ? `, and comes back to line up${plan().throne ? ' before your throne' : ''} once it’s done or needs you` : ''}.`,
      warning: pressureNote(store.machine),
      placeholder: h.ask,
      submitLabel: h.button,
      allowEmpty: true,
      providerOption: true,
      worktreeOption: !!store.project?.branch,
      repoOptions: repoChoices(),
      onSubmit: (text, o) => {
        // Whichever seat is free now (someone may have sat down while you were thinking).
        const deskId = views.heraldSeat();
        if (!deskId) return toast('Every seat at the tables is taken now', 'warn');
        views.heraldHires.set(deskId, { floor: store.floor, at: performance.now() });
        actions.hire(deskId, text || undefined, o.worktree, o.provider, o.model, o.effort, undefined, o.repos, 'herald');
      },
    });
  }

  ctx.interactions.define('herald', {
    reach: 5,
    hint: () => {
      const hd = plan().herald;
      const full = !parts.actions.firstFreeSeat();
      const m = store.machine;
      const why = full ? 'every seat is taken' : officeFull(m) ? `🚫 Office full · ${m.workers} of ${m.limit} workers` : hiringPaused() ? '💸 Budget spent — hiring resumes tomorrow' : '';
      return { k: `${hd?.name}|${why}`, parts: [hintTitle(`${plan().icon} ${hd?.name ?? 'Herald'}`), why ? h('span.cost', {}, why) : aside(hd?.says ?? ''), why ? '' : key('E', 'Send out a new worker')] };
    },
    use: onE(() => hireFromHerald()),
  });
}
