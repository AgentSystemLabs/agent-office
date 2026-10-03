/**
 * The rooftop café: order a drink or a bite from the barista, who makes it and slides it over, and
 * you hold it for a while (a cup, a glass or a plate in your hand, shown to everyone else too).
 */
import type { ItemId, MenuItem } from '../../../shared/rooftop';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { openMenu } from './ui';
import { toast } from '../../ui/dom';
import type { Rooftop } from '../rooftop/world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    bar: true;
  }
}

export interface BarDeps {
  /** The roof, once it's built (see features/rooftop). */
  roof(): Rooftop | null;
  /** Plays the reach on your hands and your character, and shows it to everyone else. */
  reach(): void;
}

/** You hold what you ordered for this long, sipping or nibbling, and then it's gone. */
const HOLD_SECONDS = 60;

export function installBar(ctx: Ctx, deps: BarDeps) {
  /** What's in your hand, and when you've finished it. */
  let held: MenuItem | null = null;
  let heldUntil = 0;
  /** What everyone else was last told is in your hand. */
  let shownItem: ItemId | null = null;
  let nextSip = 0;

  /** What the barista says as they slide it over. */
  const SAYS: Partial<Record<ItemId, string>> = {
    espresso: 'Short and strong',
    cappuccino: 'Extra foam',
    flatwhite: 'One flat white',
    mintTea: 'Fresh and minty',
    blackTea: 'Mind, it’s hot',
    orangeJuice: 'Freshly squeezed',
    lemonade: 'Nice and tart',
    sparkling: 'With a slice of lime',
    hotChocolate: 'Careful, it’s hot',
    croissant: 'Still warm',
    almondCroissant: 'Still warm',
    painAuChocolat: 'Still warm',
    toastie: 'Hot from the press',
    avocadoToast: 'With chilli flakes',
    fruitCup: 'Fresh this morning',
    bagel: 'Toasted, with cream cheese',
    falafelWrap: 'Hummus and crunchy salad',
  };

  /** E at the counter: the menu. */
  function showBar() {
    openMenu({ order });
  }

  /** The barista makes it, and slides it across to you. */
  function order(item: MenuItem) {
    const r = deps.roof();
    if (!r || !ctx.upTop()) return;
    r.serve(ctx.player.pos.z);
    ctx.sound.serve(r.pourAt, item.kind === 'drink');
    setTimeout(() => {
      if (!ctx.upTop()) return;
      held = item;
      heldUntil = performance.now() / 1000 + HOLD_SECONDS;
      deps.reach();
      if (ctx.player.view === 'first') ctx.hands.sip();
      toast(`${item.emoji} ${item.name}. ${SAYS[item.id] ?? 'Enjoy!'}`);
    }, 1500);
  }

  ctx.interactions.define('bar', {
    reach: 3.5,
    hint: () => ({ k: 'cafe', parts: [hintTitle('☕ Rooftop café'), aside('on the house'), key('E', 'See the menu')] }),
    use: onE(() => showBar()),
  });

  /** Every frame: what's in your hand, told to everyone else, and the odd sip. */
  ctx.ticks.add('pre', ({ now }) => {
    if (held && now / 1000 > heldUntil) held = null;
    ctx.me.holdDrink(held);
    ctx.hands.holdDrink(held);
    const id = held?.id ?? null;
    if (id !== shownItem) {
      shownItem = id;
      ctx.net.send({ t: 'act', drink: id });
    }
    if (held && ctx.player.view === 'first' && now > nextSip) {
      if (nextSip) ctx.hands.sip();
      nextSip = now + 9000 + Math.random() * 9000;
    }
  });

  return {
    showBar,
    /** Puts what's in your hand down (leaving the roof: it stays at the café). */
    putDown() {
      held = null;
    },
    /** What's in your hand, as everyone else was last told (see the tick above). */
    shownItem: () => shownItem,
  };
}
