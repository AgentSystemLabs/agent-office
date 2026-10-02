/**
 * Hanging a picture on a wall of this floor (F), moving one, and looking closer at one hung already.
 * The pictures themselves are the gallery's (see gallery.ts).
 */
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { Hanger } from './controller';
import { store } from '../../state';
import { h, toast } from '../../ui/dom';
import type { Gallery } from './world';
import { L } from '../../i18n';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    decor: true;
  }
}

export { installGallery } from './gallery';

export interface HangingDeps {
  /** The pictures on the walls (see installGallery). */
  gallery: Gallery;
  /** Plays the reach on your hands and your character, and shows it to everyone else. */
  reach(): void;
}

export function installHanging(ctx: Ctx, deps: HangingDeps) {
  const hanger = new Hanger(ctx.net, ctx.camera, ctx.canvas, ctx.player, ctx.office, deps.gallery);
  ctx.scene.add(hanger.ghost.group);
  hanger.onChange = () => {
    ctx.hud.refresh();
    ctx.hint.invalidate();
  };
  ctx.activities.add({
    id: 'hanger',
    active: () => hanger.active,
    // Put away for anything but walking over to someone, which you can do holding a picture up.
    stop: (why) => {
      if (why !== 'walk') hanger.cancel();
    },
    key: (e) => {
      if (!hangingKey(e.code)) return false;
      e.preventDefault();
      return true;
    },
    hint: (el) => renderHangHint(el),
  });
  ctx.ticks.add('world', () => hanger.update());
  ctx.interactions.define('decor', {
    reach: 9,
    hint: (it) => {
      const d = store.decor.find((x) => x.id === it.decorId);
      return { k: `${d?.title}|${d?.by}`, parts: [hintTitle(`🖼️ ${d?.title || L.hints.aPicture}`), d ? aside(L.hints.hungBy(d.by)) : '', key('E', L.hints.lookCloser)] };
    },
    use: onE((it) => {
      if (it.decorId) hanger.view(it.decorId);
    }),
  });

  /** Keys while hanging a picture. Walking, chat and voice work as usual. */
  function hangingKey(code: string): boolean {
    switch (code) {
      case 'Escape':
      case 'KeyF':
        hanger.cancel();
        return true;
      case 'KeyE':
      case 'Enter':
        deps.reach();
        hanger.place();
        return true;
      case 'BracketLeft':
      case 'Minus':
        hanger.resize(-1);
        return true;
      case 'BracketRight':
      case 'Equal':
        hanger.resize(1);
        return true;
    }
    return false;
  }

  function renderHangHint(el: HTMLElement) {
    const spot = hanger.spot;
    ctx.hint.draw(el, `hang|${hanger.moving}|${spot ? spot.ok : '-'}`, () => {
      const title = !spot ? L.hints.aimWall : !spot.ok ? L.hints.inTheWay : hanger.moving ? L.hints.movingPicture : L.hints.hangingPicture;
      return [h('span.title', {}, title), key(L.hints.click, L.hints.hang), key(L.hints.scroll, L.hints.size), key('Esc', L.hints.cancel)];
    });
  }

  /** F: hang a picture on a wall of this floor. There are no walls for them up on the roof. */
  function startHanging() {
    if (ctx.upTop()) return toast(L.main.noWalls, 'warn');
    if (!ctx.inOffice()) return toast(L.game.wallsHung(`${ctx.plan().icon} ${ctx.plan().name}`), 'warn');
    hanger.start();
  }

  return { hanger, startHanging };
}
