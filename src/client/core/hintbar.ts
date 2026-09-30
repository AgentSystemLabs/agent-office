/**
 * The hint bar (what you're facing and what its keys do, or what you're in the middle of) and the
 * crosshair, drawn each frame by the aim tick (see input/pointer.ts), only when they change.
 */
import { $, modalOpen } from '../ui/dom';
import type { Ctx } from './context';
import type { CoreState } from './ctx';
import { key } from './hint';
import type { Parts } from './parts';

export function installHintBar(ctx: Ctx, core: CoreState, parts: Pick<Parts, 'pointer' | 'focus' | 'place' | 'hoops' | 'cards'>) {
  const { player } = ctx;

  function renderHint() {
    const el = $('hint');
    // Whatever you're in the middle of has the hint bar to itself: the picture you're hanging, the ladder, the tee…
    const doing = modalOpen() ? undefined : ctx.activities.current((a) => !!a.hint);
    if (doing) return doing.hint!(el);
    const target = parts.pointer.target();
    const carrying = core.carrying;
    const { hoops } = parts;
    const withBall = hoops.holding();
    if ((!target && !carrying && !withBall) || modalOpen()) {
      // Still up after a redraw was asked for (hintKey cleared) just as you walked away from it, too.
      if (core.hintKey || !el.classList.contains('hidden')) {
        el.classList.add('hidden');
        core.hintKey = '';
      }
      return;
    }
    const hint = withBall ? hoops.ballHint() : carrying ? parts.cards.carryHint(carrying, target) : ctx.interactions.hint(target!);
    // On the throne, whoever's in line: the herald's a key away, and how to get up.
    const throne = parts.place.onThrone() && !carrying && !withBall;
    if (throne) {
      if (ctx.world().herald && target?.kind !== 'herald') hint.parts.push(key('K', ctx.plan().herald!.name));
      if (target?.kind !== 'seat') hint.parts.push(key('W A S D', 'Get up'));
    }
    const k = `${withBall ? 'ball!' : `${target?.kind}${target?.deskId ?? ''}`}|${carrying?.issue ?? ''}|${throne}|${hint.k}`;
    if (k === core.hintKey) return;
    core.hintKey = k;
    el.replaceChildren(...hint.parts);
    el.classList.remove('hidden');
  }

  let crossKey = '';
  function renderCrosshair() {
    const target = parts.pointer.target();
    const { finePointer } = parts.focus;
    const relookOnKey = parts.focus.relookOnKey();
    const show = player.view === 'first' && !modalOpen() && !ctx.activities.any('takesCamera');
    const free = show && finePointer && player.canLock && !player.locked;
    const k = `${show}|${!!target}|${free}|${relookOnKey}`;
    if (k === crossKey) return;
    crossKey = k;
    const el = $('crosshair');
    el.classList.toggle('hidden', !show);
    el.classList.toggle('on', !!target);
    el.classList.toggle('free', free);
    el.querySelector('.look-hint')!.textContent = relookOnKey ? 'Press a key or click to look around' : 'Click to look around';
  }

  return { renderHint, renderCrosshair };
}
