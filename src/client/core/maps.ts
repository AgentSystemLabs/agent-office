/**
 * The building's map changing (the office, or a map of its own like the castle): the old world goes,
 * the new one's put up with everyone in their seats, and you come in where it has you arrive. Also
 * the floor's paint, down off a roof the map doesn't have, and who's waiting on another floor.
 */
import { floorPalette } from '../../shared/floors';
import { store } from '../state';
import { $, toast } from '../ui/dom';
import type { Ctx } from './context';
import type { CoreState } from './ctx';
import { builtFloors } from './floors';
import type { Parts } from './parts';
import { streetOf } from './worlds';

export type MapsParts = Pick<Parts, 'stage' | 'worlds' | 'place' | 'travel' | 'arrival' | 'views' | 'walking' | 'peers' | 'telescope' | 'smoking' | 'hoops' | 'arcade' | 'cabinet' | 'dog' | 'jukebox' | 'boards'>;

/** Registers the floor's paint (store 'floors'), the map (store 'map') and the floors' waiting count (the 'floors' message). */
export function installMaps(ctx: Ctx, core: CoreState, parts: MapsParts) {
  const { player, sound, sky, me, hands } = ctx;
  const { holiday } = parts.stage;
  const { inOffice, plan } = parts.worlds;

  /** Which of the floor palettes the walls are painted in now. */
  let painted = -1;
  function paintFloor() {
    const p = store.currentFloor()?.palette ?? 0;
    if (p === painted) return;
    painted = p;
    ctx.world().setLook(floorPalette(p));
  }
  // A brand-new floor can arrive before the elevator's list says what color it is.
  store.on('floors', paintFloor);

  /**
   * The building changed maps (or you arrived and it's not the office): the old world goes, the new
   * one's put up, every worker sits down in its seat there, and you come in where it has you arrive.
   */
  function applyMap() {
    const { worlds, views, boards, travel } = parts;
    const next = worlds.worldFor(store.plan());
    if (next.world === worlds.world()) return;
    // Everyone gets up from the old map's seats; they sit down in the new one's below.
    for (const [id, v] of views.workerViews) {
      worlds.court()?.release(id);
      v.model.root.removeFromParent();
      v.laptop.root.removeFromParent();
      v.model.dispose();
      v.laptop.dispose();
      sound.removeTypist(id);
    }
    views.workerViews.clear();
    views.departures.clear();
    views.sendoffs.clear();
    views.arrivals.clear();
    parts.telescope.exit();
    ctx.activities.stopAll('map');
    parts.walking.stopWalkingTo();
    parts.smoking.stop();
    // The office's things: the ball goes down (out of everyone's hands, since its sync is the office's), the games stop.
    if (parts.hoops.holding()) parts.hoops.dropBall();
    me.holdBall(false);
    hands.holdBall(false);
    for (const r of parts.peers.remotes.values()) r.person.holdBall(false);
    parts.arcade.stop();
    parts.cabinet.stop();
    worlds.world().group.visible = false;
    worlds.enter(next);
    const world = worlds.world();
    world.group.visible = !core.upTop;
    if (!core.upTop) player.colliders = world.colliders;
    player.room = { ...plan().bounds, ...world.room };
    if (!core.upTop && !inOffice()) player.street = streetOf(world);
    sky.setIndoors(world.room.enclosed);
    // What you hear: the office's fridge, or the hall's own windows and gong.
    sound.setHall(world.acoustics ? { bounds: plan().bounds, ...world.acoustics } : null);
    // The office's own: the holiday decorations round it and the street, the dog, the jukebox.
    holiday.group.visible = inOffice() && !core.upTop;
    parts.dog.root.visible = inOffice() && !!store.dog;
    parts.jukebox.playJukebox();
    boards.dressBoards(world);
    painted = -1;
    paintFloor();
    parts.arrival.renderProject();
    views.dressUp();
    views.syncPlan();
    // They were there already: nobody walks in (and on a welcome, the floor's workers that come next weren't either).
    views.syncWorkersSeated();
    views.syncJail();
    // The boards name seats the way this map does.
    boards.renderPullsBoard();
    boards.renderServicesBoard();
    boards.renderQueueBoard();
    if (store.floor && !core.upTop && !core.trip) {
      parts.place.placeInCar();
      // Back in the office, in its elevator: the doors open onto it.
      travel.lift()?.setOpen(true);
    } else if (core.trip) travel.pending.placeOnArrival = true;
    views.heraldHires.clear();
    offTheRoof();
    ctx.hint.invalidate();
    ctx.hud.refresh();
  }
  store.on('map', applyMap);

  /** Down off the roof, on a map with no roof to be up on (it changed while you were up there). */
  function offTheRoof() {
    if (!core.upTop || inOffice() || core.trip) return;
    const f = builtFloors()[0];
    if (!f) return;
    parts.travel.leaveRoofFor(f.id);
    toast(`The building's ${plan().icon} ${plan().name} now, with no rooftop bar: down you go`);
  }

  ctx.messages.on('floors', () => noticeWaiting());
  /** Workers waiting on someone, per floor, the last time the elevator said so. */
  const waitingOn = new Map<string, number>();
  /** Someone's waiting on another floor: say so, since you can't see or hear it from here. */
  function noticeWaiting() {
    let elsewhere = 0;
    for (const f of store.floors) {
      const before = waitingOn.get(f.id);
      waitingOn.set(f.id, f.waiting);
      if (f.id === store.floor) continue;
      elsewhere += f.waiting;
      if (before !== undefined && f.waiting > before) {
        toast(`🙋 A worker on the ${f.name} floor is waiting on someone — take the elevator up`, 'warn');
        sound.ding('needs_input');
      }
    }
    const badge = $('floors-waiting');
    badge.textContent = elsewhere ? String(elsewhere) : '';
    badge.classList.toggle('hidden', !elsewhere);
    $('project').title = elsewhere ? `${elsewhere} worker${elsewhere === 1 ? '' : 's'} on other floors waiting on someone — click to go there` : 'Floors: go to another project';
  }

  return { paintFloor, applyMap, offTheRoof, noticeWaiting };
}
