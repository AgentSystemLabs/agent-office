/**
 * The rooftop bar: drinks from the bartender, how they go to your head (a glass in hand, hiccups, the
 * world swaying and the frame drawn through the drunk vision), and the DJ's air horn.
 */
import { DRINK_BY_ID, type Drink, type DrinkId } from '../../../shared/rooftop';
import { Booze, type Stage as Feeling } from './booze';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { djFrame } from '../../dnb';
import { store } from '../../state';
import { openBar } from './ui';
import { toast } from '../../ui/dom';
import { DrunkVision } from './drunk';
import type { Rooftop } from '../rooftop/world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    bar: true;
    dj: true;
  }
}

export interface BarDeps {
  /** The roof, once it's built (see features/rooftop). */
  roof(): Rooftop | null;
  /** How far into the DJ's set it is (see features/rooftop). */
  djAt(): number;
  /** Plays the reach on your hands and your character, and shows it to everyone else. */
  reach(): void;
}

export function installBar(ctx: Ctx, deps: BarDeps) {
  /** Drinks from the bar, and how they make the world look (see booze.ts, drunk.ts). */
  const booze = new Booze();
  /** What they do to you (see player/effects.ts): how drunk you are, as drinking has it each frame. */
  const tipsy = ctx.player.effects.add();
  const drunkVision = new DrunkVision(ctx.renderer);
  let warmDrunkVisionQueued = false;
  const queueDrunkVisionWarmup = () => {
    if (warmDrunkVisionQueued) return;
    warmDrunkVisionQueued = true;
    const warm = () => {
      warmDrunkVisionQueued = false;
      drunkVision.prepare();
    };
    if ('requestIdleCallback' in window) window.requestIdleCallback(warm, { timeout: 700 });
    else setTimeout(warm, 0);
  };
  // The first drunk frame should not also pay for a render target allocation and shader compile.
  requestAnimationFrame(() => queueDrunkVisionWarmup());

  /** What the bartender says as they slide it over. */
  const CHEERS: Record<string, string> = {
    beer: 'Cheers! 🍻',
    wine: 'Salud!',
    martini: 'Shaken, not stirred',
    maitai: 'Aloha!',
    shot: 'Salt, shot, lime… whoa',
    mojito: 'Fresh and minty',
    water: 'Good call. Stay hydrated',
  };

  /** E at the bar: the menu. */
  function showBar() {
    queueDrunkVisionWarmup();
    openBar({ cutOff: booze.cutOff(performance.now() / 1000), order: orderDrink });
  }

  /** The bartender comes over and pours it (a water, if you've had enough), and slides it across to you. */
  function orderDrink(d: Drink) {
    const r = deps.roof();
    if (!r || !ctx.upTop()) return;
    const cut = d.strength > 0 && booze.cutOff(performance.now() / 1000);
    const drink = cut ? DRINK_BY_ID.get('water')! : d;
    r.serve(ctx.player.pos.z);
    ctx.sound.pour(r.pourAt);
    queueDrunkVisionWarmup();
    if (cut) toast("🙅 The bartender slides you a water instead: you've had enough", 'warn');
    setTimeout(() => {
      if (!ctx.upTop()) return;
      drunkVision.prepare();
      booze.drink(drink, performance.now() / 1000);
      deps.reach();
      if (ctx.player.view === 'first') ctx.hands.sip();
      if (!cut) toast(`${drink.emoji} ${drink.name}. ${CHEERS[drink.id] ?? 'Enjoy!'}`);
    }, 1500);
  }

  ctx.messages.on('horn', (msg) => {
    if (!ctx.upTop()) return;
    ctx.sound.horn();
    if (msg.by !== store.profile.name) toast(`📯 ${msg.by} blew the air horn!`);
  });
  let lastHorn = 0;
  /** E at the DJ booth: the air horn, for everyone on the roof. */
  function blowHorn() {
    const now = performance.now();
    if (now - lastHorn < 1500) return;
    lastHorn = now;
    ctx.net.send({ t: 'horn' });
  }

  ctx.interactions.define('bar', {
    reach: 3.5,
    hint: () => {
      const cut = booze.cutOff(performance.now() / 1000);
      return { k: String(cut), parts: [hintTitle('🍸 Sky Bar'), aside(cut ? "you've had enough" : 'drinks on the house'), key('E', cut ? 'Ask for water' : 'Order a drink')] };
    },
    use: onE(() => showBar()),
  });
  ctx.interactions.define('dj', {
    reach: 6,
    hint: () => {
      const f = djFrame(deps.djAt());
      const what = f.part === 'drop' ? '🔥 the drop' : f.part === 'build' ? 'building up…' : f.part === 'breakdown' ? 'the breakdown' : 'mixing in the next track';
      return { k: what, parts: [hintTitle('🎧 DJ Merge Conflict'), aside(`drum & bass · ${what}`), key('E', '📯 Air horn!')] };
    },
    use: onE(() => blowHorn()),
  });

  /** How it's going to your head, the last time it changed, and when the next hiccup comes. */
  let feeling: Feeling = 0;
  let nextHiccup = 0;
  let nextSip = 0;
  /** The drink in your hand everyone else was last told about. */
  let shownDrink: DrinkId | null = null;
  const FEELINGS = ['😌 You feel sober again', '🥴 You’re feeling a little tipsy', '🌀 Whoa… is the city spinning?', '🤪 You’re wasted. Maybe have some water'];

  /** Every frame: how drunk you are, the glass in your hand, hiccups and the odd sip. */
  function drinking(now: number) {
    const secs = now / 1000;
    const amount = booze.amount(secs);
    const player = ctx.player;
    const hands = ctx.hands;
    tipsy.sway = ctx.reduceMotion.matches ? 0 : Math.min(1.3, amount);
    const glass = booze.holding(secs);
    ctx.me.holdDrink(glass);
    hands.holdDrink(glass);
    const id = glass?.id ?? null;
    if (id !== shownDrink) {
      shownDrink = id;
      ctx.net.send({ t: 'act', drink: id });
    }
    if (glass && player.view === 'first' && now > nextSip) {
      if (nextSip) hands.sip();
      nextSip = now + 9000 + Math.random() * 9000;
    }
    const stage = booze.stage(secs);
    if (stage !== feeling) {
      if (stage > feeling || stage === 0) toast(FEELINGS[stage], stage >= 3 ? 'warn' : 'info');
      feeling = stage;
    }
    if (amount > 0.5 && now > nextHiccup) {
      if (nextHiccup) {
        ctx.sound.hiccup();
        ctx.shake(0.25);
      }
      nextHiccup = now + 5000 + Math.random() * 12000;
    }
    return amount;
  }
  /** How drunk you are this frame (see drinking), for the drunk vision the frame's drawn through. */
  let drunkNow = 0;
  ctx.ticks.add('pre', ({ now }) => {
    // Drinks from the rooftop bar: a glass in hand, and the world swaying.
    drunkNow = drinking(now);
  });

  /** Last frame went through the drunk vision. */
  let drunkVisionOn = false;
  ctx.view.add({
    filter: {
      // A few drinks in, the frame goes to the screen through the drunk vision (see drunk.ts).
      begin: () => {
        const blurry = drunkNow > 0.01;
        if (blurry) drunkVision.begin();
        else if (drunkVisionOn) drunkVision.release();
        drunkVisionOn = blurry;
        return blurry;
      },
      end: ({ t }) => drunkVision.end(drunkNow, t, !ctx.reduceMotion.matches),
    },
  });

  return {
    booze,
    showBar,
    /** The drink in your hand, as everyone else was last told (see drinking). */
    shownDrink: () => shownDrink,
  };
}
