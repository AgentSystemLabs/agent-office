import { Caffeine } from '../../caffeine';
import type { Ctx } from '../../core/context';
import { hintTitle, key, onE } from '../../core/hint';
import { toast } from '../../ui/dom';

/**
 * The kitchen's coffee machine: a cup is a minute of quicker feet and higher jumps (and one too many,
 * the jitters). What the caffeine does to you each frame is feelTheCoffee's, in main.ts.
 */
export function installCoffee(ctx: Ctx) {
  const caffeine = new Caffeine();

  /** A cup from the kitchen machine: a minute of quicker feet and higher jumps, and a mug in your hand. */
  function drinkCoffee() {
    const jittery = caffeine.drink(performance.now() / 1000);
    ctx.sound.coffee();
    if (ctx.player.view === 'first') ctx.hands.sip();
    if (jittery) toast('☕ One cup too many… you’ve got the jitters!', 'warn');
    else if (caffeine.cups > 1) toast('☕ Another cup: back to a full minute of buzz');
    else toast('☕ Fresh coffee! A minute of quicker feet and higher jumps');
  }

  ctx.interactions.define('coffee', {
    reach: 3,
    hint: (it) => {
      const buzzed = caffeine.buzzed(performance.now() / 1000);
      return { k: String(buzzed), parts: [hintTitle(it.label ?? '☕ Coffee machine'), key('E', buzzed ? 'Another cup' : 'Grab a cup')] };
    },
    use: onE(() => drinkCoffee()),
  });

  return { caffeine };
}
