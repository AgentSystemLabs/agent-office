/**
 * A worker that needs you is the one thing in the office that can't wait, so it's the hardest to
 * miss: a beacon over its desk you can see from across the room, a banner under the top bar saying
 * who and what for, a flash round the edge of the screen and an alarm when it starts asking, and
 * (if you ask for it) a reminder until someone's at its terminal.
 */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { needingYou } from '../../nextup';
import { store } from '../../state';
import { $ } from '../../ui/dom';
import { bannerText, Fresh, Reminders, waitKey } from './logic';
import { Banner } from './ui';
import { Beacon } from './world';

/** How close (m) the beacon's light is gone altogether, and how far off it's at its brightest. */
const NEAR = 3;
const FAR = 6.5;
/** How far under the floor a worker on its feet is put, so its feet rest on it (as FEET in world/court.ts). */
const FEET = 0.07;

/** Follows the workers for the banner, the flash and the alarm, and registers the beacons' tick ('others', after the workers' own). */
export function installNeedsYou(ctx: Ctx, parts: Pick<Parts, 'views' | 'waiting'>) {
  const { scene, camera, sound, settings, player, reduceMotion } = ctx;
  const fresh = new Fresh();
  const reminders = new Reminders();
  /** The waits the banner was put away on (see waitKey): it comes back for anyone else, or when one of these asks again. */
  const hidden = new Set<string>();
  const beacons = new Map<string, Beacon>();

  const banner = new Banner($('hud'), {
    go: (id) => parts.waiting.goToWorker(id),
    hide: () => {
      for (const w of needingYou(store.workers.values())) hidden.add(waitKey(w));
      paintBanner();
    },
  });

  function paintBanner() {
    const asking = needingYou(store.workers.values());
    for (const key of hidden) if (!asking.some((w) => waitKey(w) === key)) hidden.delete(key);
    banner.show(bannerText(asking.filter((w) => !hidden.has(waitKey(w))), Date.now()));
  }

  function sync() {
    // Not ones that were asking already when the page first saw them (a reload, a floor you've just arrived on).
    if (fresh.take(store.workers).length) {
      banner.flash();
      if (settings.needsYouSound !== 'off') {
        sound.needsYou();
        reminders.rang(performance.now());
      }
    }
    for (const [id, b] of beacons) {
      if (store.workers.get(id)?.status === 'needs_input') continue;
      b.dispose();
      beacons.delete(id);
    }
    for (const w of needingYou(store.workers.values())) {
      if (beacons.has(w.id)) continue;
      const b = new Beacon();
      b.root.visible = false;
      scene.add(b.root);
      beacons.set(w.id, b);
    }
    paintBanner();
  }
  store.on('workers', sync);

  // Another floor's workers: whoever's asking there has a wait of their own before the first reminder.
  store.on('floor', () => reminders.quiet());

  // How long it has waited ticks on, and the reminder comes round, whether or not a frame is drawn.
  setInterval(() => {
    const asking = needingYou(store.workers.values());
    if (asking.length) paintBanner();
    if (reminders.due(asking, performance.now()) && settings.needsYouSound === 'remind') sound.needsYou(true);
  }, 1000);

  const at = new THREE.Vector3();
  const ground = new THREE.Vector3();
  const size = new THREE.Vector3();
  ctx.ticks.add('others', ({ t }) => {
    for (const [id, b] of beacons) {
      const v = parts.views.workerViews.get(id);
      const root = v?.model.root;
      // Not drawn (it's on its way in, or the floor's out of sight from the roof): neither is its beacon.
      b.root.visible = !!root && inView(root, scene);
      if (!root || !b.root.visible) continue;
      root.getWorldPosition(at);
      // In its seat, the floor is the one its desk stands on; up and about (the castle), the one under its feet.
      const desk = ctx.world().desks.get(v.deskId);
      const floor = desk && root.parent === desk.seatAnchor ? desk.group.getWorldPosition(ground).y : at.y + FEET;
      const d = Math.hypot(at.x - player.pos.x, at.z - player.pos.z);
      const near = 1 - Math.min(1, Math.max(0, (d - NEAR) / (FAR - NEAR)));
      // A worker is the size its seat makes it, and its card with it.
      const top = at.y + topOf(root) * root.getWorldScale(size).y;
      b.update(at, floor, top, camera.position.distanceTo(at), t, near, reduceMotion.matches);
    }
  });

  return { beacons };
}

/** How high over a worker's feet the top of what's over its head is: its card or bubble, or its name. */
function topOf(root: THREE.Object3D): number {
  let top = 1.7;
  for (const c of root.children) {
    const s = c as THREE.Sprite;
    if (s.isSprite && s.visible) top = Math.max(top, s.position.y + s.scale.y * (1 - s.center.y));
  }
  return top;
}

/** Whether `o` is in the scene and nothing it's inside is hidden. */
function inView(o: THREE.Object3D, scene: THREE.Scene): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (!p.visible) return false;
    if (p === scene) return true;
  }
  return false;
}
