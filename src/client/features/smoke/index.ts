import { BALCONY } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import { hintTitle, key, onE } from '../../core/hint';
import { toast } from '../../ui/dom';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    smoke: true;
  }
}

/** Smoke breaks out on the balcony, at the ashtray: the cigarette burns down by itself, and goes out if you take it inside. */
export function installSmoke(ctx: Ctx) {
  /** When your smoke break ends by itself (performance.now()), or 0 when you're not on one. */
  let smokeBreakUntil = 0;
  const SMOKE_BREAK_MS = 90_000;

  function setSmoking(on: boolean) {
    if (on === smokeBreakUntil > 0) return;
    smokeBreakUntil = on ? performance.now() + SMOKE_BREAK_MS : 0;
    ctx.me.setSmoking(on);
    ctx.hands.setSmoking(on);
    ctx.net.send({ t: 'act', smoke: on });
  }

  /** Out on the balcony (a little slack at the door), where smoking is allowed. */
  function onBalcony(): boolean {
    const p = ctx.player.pos;
    return ctx.inOffice() && p.y > -0.5 && p.y < 2 && p.x > BALCONY.minX - 0.5 && p.x < BALCONY.maxX + 0.5 && p.z > BALCONY.minZ - 0.8 && p.z < BALCONY.maxZ + 0.5;
  }

  /** Ends the break when the cigarette burns down, or when you take it back inside. */
  function checkSmokeBreak(now: number) {
    if (!smokeBreakUntil) return;
    if (!onBalcony()) {
      setSmoking(false);
      toast('🚭 No smoking inside, so you put it out');
    } else if (now > smokeBreakUntil) {
      setSmoking(false);
      toast("That one's done. Back to work!");
    }
  }
  ctx.ticks.add('world', ({ now }) => checkSmokeBreak(now));
  ctx.interactions.define('smoke', {
    reach: 3,
    hint: () => ({ k: String(smokeBreakUntil > 0), parts: [hintTitle('🚬 Ashtray'), key('E', smokeBreakUntil ? 'Stub it out' : 'Take a smoke break')] }),
    use: onE(() => {
      if (smokeBreakUntil) {
        setSmoking(false);
        toast('You stub it out in the ashtray');
      } else {
        setSmoking(true);
        toast('🚬 Smoke break');
      }
    }),
  });

  /** Puts it out, if you're on a smoke break: something else is taking you away (the golf tee, another map). */
  function stop() {
    if (smokeBreakUntil) setSmoking(false);
  }

  return { stop };
}
