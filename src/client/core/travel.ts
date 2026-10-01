/**
 * Floors and the elevator: the building as tall as its floors, riding the elevator (up to the roof,
 * down to the garage), straight to another floor from the floor list, through the ceiling up the
 * ladder or down a pole; and arriving, up on the roof or on a floor, with the doors opening onto it.
 */
import { inElevator, roofDrop, streetBelow } from '../../shared/layout';
import { ROOF } from '../../shared/rooftop';
import type { Arrival, Grip } from '../features/climbing/controller';
import { lastSpot, store } from '../state';
import { $, clip, closeAllModals, modalOpen, toast } from '../ui/dom';
import { GARAGE, openElevator } from '../ui/elevator';
import type { Ctx, TripKind } from './context';
import type { CoreState } from './ctx';
import { builtFloors, floorWings } from './floors';
import { aside, hintTitle, key, onE } from './hint';
import type { Parts } from './parts';
import { FAR } from './scene';
import { streetOf } from './worlds';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../world/types' {
  interface InteractKinds {
    elevator: true;
  }
}

export type TravelParts = Pick<Parts, 'stage' | 'worlds' | 'place' | 'walking' | 'seating' | 'climbing' | 'cars' | 'rooftop' | 'telescope' | 'bar' | 'bargames' | 'hanging' | 'golf' | 'maps' | 'arrival'>;

/** Registers what follows the building's floors (store 'floors'). */
export function installTravel(ctx: Ctx, core: CoreState, parts: TravelParts) {
  const { player, office, net, sound, sky, camera } = ctx;
  const { holiday } = parts.stage;
  const { inOffice, plan } = parts.worlds;
  const { placeInCar, downstairs, indoors, standingAt, unstick, sitOnThrone, onThrone } = parts.place;

  let wingsShown = '';
  /**
   * The ladder and the poles go where there are floors to go to from this one, and the building is as
   * tall as there are floors, with the street as far down as this one is up.
   */
  function syncStack() {
    const floors = builtFloors();
    const index = floors.findIndex((f) => f.id === store.floor);
    // Up on the roof there's no ladder or pole to take: nothing above, nothing below.
    const up = store.floor === ROOF ? undefined : floors[index + 1]?.name;
    const down = index > 0 ? floors[index - 1]?.name : undefined;
    const count = index < 0 ? 1 : floors.length;
    const wings = floorWings(floors);
    // A map of its own is a hall on the ground: nothing under its floor to fall to, but its dungeon's.
    player.street = inOffice() ? streetBelow(index) : streetOf(ctx.world());
    const s = office.stack.state;
    const same = s.index === Math.max(0, index) && s.count === count && s.up === up && s.down === down;
    if (same && wings.join() === wingsShown) return;
    wingsShown = wings.join();
    if (!same) office.stack.set({ index: Math.max(0, index), count, up, down });
    office.setLevel(Math.max(0, index), count, wings);
  }
  store.on('floors', syncStack);

  /** Not a trip of yours: the office put you on another floor (yours went), in its elevator car. Whatever you were doing stops. */
  function takenAway() {
    closeAllModals();
    ctx.activities.stopAll('taken');
    parts.walking.stopWalkingTo();
    placeInCar();
  }

  // Closing the tab, or reloading: the frame loop saves it every second, and here's the last word.
  window.addEventListener('pagehide', () => {
    parts.place.saveSpot();
    // Mid-drive, the car stops right where you left it, not where the office last heard it was.
    const { driver } = parts.cars;
    const p = driver.driving ? driver.pose : null;
    if (p) net.send({ t: 'car.drive', car: driver.car!, x: p.x, z: p.z, rotY: p.rotY, speed: 0, steer: p.steer });
  });

  function fade(on: boolean, quick = false) {
    $('fade').classList.toggle('quick', quick);
    $('fade').classList.toggle('on', on);
  }

  function showElevator() {
    openElevator({ net, ride, downstairs });
  }

  ctx.interactions.define('elevator', {
    reach: 4.5,
    hint: (it) => {
      const f = store.currentFloor();
      const n = store.floors.length;
      if (it === office.garageLift.interactable) return { k: `garage|${f?.name}|${n}`, parts: [hintTitle('🛗 Elevator'), aside(f ? `Garage · up to ${clip(f.name, 24)}` : 'Garage'), key('E', 'Choose a floor')] };
      return { k: `${f?.name}|${n}`, parts: [hintTitle('🛗 Elevator'), f ? aside(`${f.name} · ${n} floor${n === 1 ? '' : 's'}`) : '', key('E', n > 1 ? 'Choose a floor' : 'Floors & projects')] };
    },
    use: onE(() => showElevator()),
  });

  /** What's still to happen when the next floor comes (see floor.enter in core/arrival.ts). */
  const pending = {
    /** The map changed while you were on your way to a floor: wherever you land, you arrive where the map has you come in. */
    placeOnArrival: false,
    /** Down off the roof, on a map with no roof to be up on (it changed while you were up there). */
    offRoof: false,
  };

  /** The elevator where you are: the office's, its stop down in the garage, or the one up on the roof. None on a map of its own. */
  function lift() {
    if (!inOffice()) return null;
    const roof = parts.rooftop.roof();
    return core.upTop && roof ? roof.elevator : downstairs() ? office.garageLift : office.elevator;
  }

  /**
   * Rides the elevator to another floor, up to the roof or down to the garage (GARAGE). From outside
   * the car, you step in while the lights are down. Between your floor and the garage under it you
   * stay on that floor, just further down the shaft (or back up it); from the roof, the garage is the
   * bottom floor's.
   */
  function ride(to: string, keepWalking = false): void {
    // A map of its own has no elevator: straight there, and no roof or garage to go to.
    if (!inOffice()) {
      if (to === ROOF || to === GARAGE) {
        parts.walking.stopWalkingTo();
        toast(`There's no ${to === ROOF ? 'rooftop bar' : 'garage'} on this map (${plan().icon} ${plan().name})`, 'warn');
        return;
      }
      // Still up on a roof this map doesn't have: straight down to that floor.
      if (core.upTop) return leaveRoofFor(to);
      // Straight there (and on over to whoever you were walking to, if that's why).
      return switchFloor(to, keepWalking);
    }
    const garage = to === GARAGE;
    const floorId = garage ? (core.upTop || !store.floor ? builtFloors()[0]?.id : store.floor) : to;
    if (core.trip || !floorId || (floorId === store.floor && garage === downstairs())) return;
    closeAllModals();
    stopForTrip();
    const inside = inElevator(player.pos.x, player.pos.z);
    const within = floorId === store.floor;
    core.trip = { floor: floorId, how: 'elevator', garage, timer: window.setTimeout(tripFailed, 10_000) };
    player.enabled = false;
    player.clearKeys();
    lift()?.setOpen(false);
    // Wait for the doors to shut on you, then dim the lights and go.
    setTimeout(
      () => {
        fade(true);
        setTimeout(() => {
          placeInCar(inside ? player.pos : undefined, garage && within);
          if (within) setTimeout(rodeWithin, 700);
          // Down to the garage from the roof: the bottom floor, and down its shaft once it's here (see arrive).
          else net.send({ t: 'floor.go', floor: floorId, ...(garage ? { at: { x: player.pos.x, y: streetBelow(0), z: player.pos.z, rotY: 0 } } : {}) });
        }, 320);
      },
      inside ? 650 : 0,
    );
  }

  /**
   * Off to another floor: whatever you were doing stops. The picture, the ladder or a pole and the car
   * go before the club and the darts, the order they always went in (the activities' own order has the
   * car last, for keys and the hint bar).
   */
  function stopForTrip() {
    ctx.activities.stopAll('trip', ['golf', 'thrower']);
    ctx.activities.stopAll('trip');
  }

  /** Down to the garage under your floor, or back up from it: still the same floor, so the lights come up and the doors open. */
  function rodeWithin() {
    if (!core.trip) return;
    clearTimeout(core.trip.timer);
    core.trip = null;
    // The map changed on the ride down (or up): where it has you come in.
    if (pending.placeOnArrival) {
      pending.placeOnArrival = false;
      placeInCar();
    }
    fade(false);
    doorsOpen();
  }

  /** There: the doors open onto it, with a ding. */
  function doorsOpen() {
    setTimeout(() => {
      lift()?.setOpen(true);
      sound.ding('done');
      player.enabled = !modalOpen();
    }, 450);
  }

  /** You were on the throne when you left for another floor: you sit back down on that one's, if it's free. */
  let backToThrone = false;

  /** Straight to another floor from the floor list: a blink, and you're standing in the same spot there. */
  function switchFloor(floorId: string, keepWalking = false): void {
    // The roof isn't laid out like a floor: to and from it, it's the elevator (and on a map with no
    // roof, straight down off it).
    if (core.upTop && !inOffice()) return leaveRoofFor(floorId);
    if (core.upTop || floorId === ROOF) return ride(floorId);
    if (core.trip || floorId === store.floor) return;
    // Outside, the same spot on another floor looks just like this one: the elevator brings you in
    // to that floor instead, into its car.
    if (inOffice() && !indoors()) {
      if (!keepWalking) parts.walking.stopWalkingTo();
      return ride(floorId, keepWalking);
    }
    closeAllModals();
    stopForTrip();
    backToThrone = onThrone();
    if (player.seat) parts.seating.standUp();
    // The floor list isn't a window, so nothing else stops a walk over to someone on this floor.
    if (!keepWalking) parts.walking.stopWalkingTo();
    core.trip = { floor: floorId, how: 'switch', timer: window.setTimeout(tripFailed, 10_000) };
    player.enabled = false;
    player.clearKeys();
    fade(true, true);
    setTimeout(() => net.send({ t: 'floor.go', floor: floorId, at: standingAt(floorId) }), 170);
  }

  /** Through the ceiling up the ladder, or through the floor down one: the lights dip as you pass. */
  function travel(floorId: string, how: Grip, at: Arrival) {
    if (core.trip) return;
    core.trip = { floor: floorId, how, timer: window.setTimeout(tripFailed, 10_000) };
    fade(true, true);
    setTimeout(() => net.send({ t: 'floor.go', floor: floorId, at }), 170);
  }

  /** The floor never came (it's gone, or the office is unreachable): back where you were. */
  function tripFailed() {
    const t = core.trip;
    if (!t) return;
    core.trip = null;
    fade(false);
    if (t.how === 'elevator') lift()?.setOpen(!!store.floor);
    if (t.how === 'ladder' || t.how === 'pole') parts.climbing.climber.abort();
    player.enabled = !modalOpen();
    // The map changed on the way: back where it has you come in (or down off a roof it doesn't have).
    if (pending.placeOnArrival && !core.upTop) {
      pending.placeOnArrival = false;
      placeInCar();
      lift()?.setOpen(true);
    } else if (pending.placeOnArrival) {
      pending.placeOnArrival = false;
      parts.maps.offTheRoof();
    }
    // Down off a roof the map doesn't have: try again.
    if (pending.offRoof) {
      pending.offRoof = false;
      parts.maps.offTheRoof();
    }
  }

  /** Off a roof the map doesn't have, down to `floorId`, arriving where the map has you come in (see floor.enter). */
  function leaveRoofFor(floorId: string) {
    if (core.trip) return;
    pending.offRoof = true;
    core.trip = { floor: floorId, how: 'switch', timer: window.setTimeout(tripFailed, 10_000) };
    player.enabled = false;
    player.clearKeys();
    fade(true, true);
    net.send({ t: 'floor.go', floor: floorId });
  }

  /**
   * Up on the roof, or back down in the office: shows the one you're in, and walks, sounds, lights and
   * looks as it does there.
   */
  function setPlace() {
    parts.telescope.exit();
    const up = store.floor === ROOF;
    if (up === core.upTop) return;
    core.upTop = up;
    const { rooftop } = parts;
    const r = up ? rooftop.theRoof() : rooftop.roof();
    const world = ctx.world();
    world.group.visible = !up;
    // The holiday decorations are dressed round the office and the street below it, not up here.
    holiday.group.visible = !up && inOffice();
    if (r) r.group.visible = up;
    player.colliders = up ? r!.colliders : world.colliders;
    sky.setRoof(up, roofDrop(rooftop.roofFloors()));
    sound.setOutdoors(up);
    sound.setDj(up ? rooftop.djAt : null);
    // You can see the whole city from up there (and its clouds); from the top floors, as far as the haze.
    camera.far = up ? 700 : FAR;
    camera.updateProjectionMatrix();
    // Drinks stay at the bar (what you've had comes down with you).
    if (!up) parts.bar.booze.putDown();
    // Whatever was thrown up there while you were away, you didn't see: the boards start clean.
    if (up) parts.bargames.freshBoards(r!);
    const { hanger } = parts.hanging;
    if (hanger.active) hanger.cancel();
    ctx.hint.invalidate();
  }

  /**
   * You're on a floor (or in the building without one): paint it, and open the doors (or carry on down
   * the pole…). `back` is standing in the spot you left from last time, the doors open already.
   */
  function arrive(how: TripKind | 'back' = core.trip?.how ?? 'elevator') {
    // The balls lying about were this floor's.
    parts.golf.balls.clear();
    setPlace();
    parts.maps.paintFloor();
    parts.arrival.renderProject();
    parts.maps.noticeWaiting();
    syncStack();
    if (core.trip) {
      // Down to the garage: into the car at the bottom of the shaft, now that the street is where this floor has it.
      if (core.trip.garage && store.floor) placeInCar(player.pos, true);
      clearTimeout(core.trip.timer);
      core.trip = null;
    }
    if (!store.floor) {
      // Nowhere to go yet: the doors stay shut until there's a floor, and the panel says how to add one.
      lift()?.setOpen(false);
      fade(false);
      player.enabled = !modalOpen();
      showElevator();
      return;
    }
    fade(false);
    if (how === 'back') {
      // The doors stand open, the way the last one out left them.
      lift()?.setOpen(true);
      player.enabled = !modalOpen();
      if (!core.upTop) unstick();
      // Back on the throne you were on when you left (if nobody's taken it since).
      if (lastSpot()?.throne) sitOnThrone();
      return;
    }
    if (how !== 'elevator') {
      player.enabled = !modalOpen();
      if (how === 'switch') unstick();
      else parts.climbing.climber.arrived();
      if (how === 'switch' && backToThrone) sitOnThrone();
      backToThrone = false;
      return;
    }
    doorsOpen();
  }

  return { syncStack, takenAway, showElevator, lift, ride, switchFloor, travel, leaveRoofFor, setPlace, arrive, pending };
}
