/**
 * The cars in the garage: getting in (behind the wheel, or beside whoever's driving), driving, the
 * horn, laps of the scenic loop, and a car shoving you out of its way. Placing you anywhere gets you
 * out first: see the driver's activity, and placeAt in core/place.ts.
 */
import { CARS, SEAT_HIPS, type CarSeat } from '../../../shared/garage';
import { PLACES, placeAt as loopPlace } from '../../../shared/scenic';
import type { Ctx, Hint } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { Driver } from './controller';
import { DESK_KEYS } from '../../interaction';
import { LapTimer, lapTime } from './laps';
import { store } from '../../state';
import { clip, h, toast } from '../../ui/dom';
import { L, carName } from '../../i18n';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    car: true;
  }
}

export interface CarsDeps {
  /** Up off whatever you're sitting on (see features/seating). */
  standUp(): void;
  /** Stops a walk over to someone, if you're on one. */
  stopWalking(): void;
}

/** Registers the office's first message router (a floor's cars snap to where they are): install it before any other `onAny`. */
export function installCars(ctx: Ctx, deps: CarsDeps) {
  const { office } = ctx;
  // Behind the wheel of one of the garage's cars.
  const driver = new Driver(ctx.player, office.cars, {
    moved: (car, p) => ctx.net.send({ t: 'car.drive', car, x: p.x, z: p.z, rotY: p.rotY, speed: p.speed, steer: p.steer }),
    bump: (at, speed) => {
      ctx.sound.crash({ x: at.x, y: ctx.player.street + 0.5, z: at.z }, speed);
      ctx.shake(Math.min(0.8, speed / 15));
    },
  });
  /** car.enter and car.leave of yours the office hasn't answered yet: until it has, you're where you say you are. */
  let carPending = 0;

  /** Where car `i` is, at about the height of its horn. */
  function carAt(i: number): { x: number; y: number; z: number } {
    const p = office.cars.cars[i]?.pose ?? CARS[i];
    return { x: p.x, y: ctx.player.street + 0.6, z: p.z };
  }

  /** E at a car: behind the wheel if nobody's driving it, else beside whoever is. */
  function getIn(i: number) {
    const c = store.cars[i];
    const def = CARS[i];
    if (ctx.trip() || ctx.activities.running('climber') || driver.active || !c || !def) return;
    if (ctx.carrying()) return toast(L.main.cardInHand, 'warn');
    if (ctx.holdingBall()) return toast(L.game.ballDown, 'warn');
    const seat: CarSeat | null = !c.driver ? 'driver' : !c.passenger ? 'passenger' : null;
    if (!seat) return toast(L.game.carFull(carName(def)), 'warn');
    if (ctx.player.seat) deps.standUp();
    ctx.activities.stopAll('start');
    deps.stopWalking();
    driver.enter(i, seat);
    ctx.me.sit(SEAT_HIPS);
    carPending++;
    ctx.net.send({ t: 'car.enter', car: i, seat });
    ctx.sound.carDoor(carAt(i));
    ctx.hint.invalidate();
  }

  ctx.interactions.define('car', {
    reach: 4,
    hint: (it) => {
      const c = store.cars[it.car ?? -1];
      const def = CARS[it.car ?? -1];
      if (!c || !def) return { k: '', parts: [] };
      const name = (id?: string) => (id ? clip(store.peers.get(id)?.name ?? L.main.someone, 20) : '');
      const [at, beside] = [name(c.driver), name(c.passenger)];
      const k = `${it.car}|${at}|${beside}`;
      if (!at) return { k, parts: [hintTitle(`🏎️ ${carName(def)}`), aside(beside ? L.game.waitingIn(beside) : L.game.keysIn), key('E', L.game.driveIt)] };
      if (!beside) return { k, parts: [hintTitle(`🏎️ ${carName(def)}`), aside(L.game.isDriving(at)), key('E', L.game.hopIn)] };
      return { k, parts: [hintTitle(`🏎️ ${carName(def)}`), aside(L.game.carFullWith(at, beside))] };
    },
    use: onE((it) => {
      if (it.car !== undefined) getIn(it.car);
    }),
  });

  /** E in a car: out onto your feet beside it; `anyway`, even with no room there. False if you couldn't. */
  function getOut(anyway = false): boolean {
    const i = driver.car;
    if (i === null) return true;
    if (!driver.leave(anyway)) {
      toast(L.game.noRoomDoor, 'warn');
      return false;
    }
    leftCar(i);
    return true;
  }

  /** Out of the car wherever you are: something else is moving you (to another floor, a desk). */
  function dropCar() {
    const i = driver.car;
    if (i === null) return;
    driver.drop();
    leftCar(i);
  }

  function leftCar(i: number) {
    ctx.me.sit(null);
    carPending++;
    ctx.net.send({ t: 'car.leave' });
    ctx.sound.carDoor(carAt(i));
    ctx.hint.invalidate();
  }

  ctx.activities.add({
    id: 'driver',
    active: () => driver.active,
    // Out onto your feet for a trip to another floor, or let go of where you are for a desk. Walking over
    // to someone gets you out first itself (it can't, with no room at the door), and nothing else does.
    stop: (why) => {
      if (why === 'trip') getOut(true);
      else if (why === 'desk') dropCar();
    },
    // In a car, E gets you out and H honks (W A S D and Space drive, see Driver); nothing else is in reach.
    key: (e) => {
      if (e.code !== 'KeyE' && e.code !== 'KeyH' && e.code !== 'KeyF' && !(e.code in DESK_KEYS)) return false;
      if (e.repeat) return true;
      if (e.code === 'KeyE') getOut();
      else if (e.code === 'KeyH') honk();
      return true;
    },
    hint: (el) => renderDriveHint(el),
    hidesHands: true,
  });

  /** H in a car: its horn, for everyone on the floor. */
  let honkedAt = 0;
  function honk() {
    const i = driver.car;
    const now = performance.now();
    if (i === null || now - honkedAt < 300) return;
    honkedAt = now;
    ctx.sound.honk(carAt(i), CARS[i].kind === 'lambo');
    ctx.net.send({ t: 'car.honk' });
  }

  /** Laps of the scenic loop you've driven (see LapTimer), and your fastest, kept in this browser. */
  const LAP_KEY = 'agent-office.bestLap';
  const laps = new LapTimer(
    (() => {
      try {
        const best = Number(localStorage.getItem(LAP_KEY));
        return best > 0 ? best : null;
      } catch {
        return null;
      }
    })(),
  );
  function lapDone(time: number) {
    const done = laps.done;
    if (done?.best) {
      try {
        localStorage.setItem(LAP_KEY, String(time));
      } catch {
        // private window: it's only for this visit then
      }
    }
    if (done?.best) ctx.sound.golf('cheer');
    else ctx.sound.arcade('clear');
    toast(done?.best ? L.game.lapBest(lapTime(time)) : L.game.lap(lapTime(time), lapTime(laps.best ?? time)), 'info');
  }

  ctx.ticks.add('vehicles', ({ dt, now }) => {
    // The cars first, so whoever's riding in one sits in it where it's got to.
    office.cars.update(dt, store.cars, store.carsAt, now, driver.active ? { car: driver.car!, driving: driver.driving } : null, ctx.camera.position);
  });
  /** When a car last shoved you out of its way. */
  let shovedAt = 0;
  ctx.ticks.add('moved', ({ now }) => {
    // Timing a lap of the scenic loop, behind the wheel.
    if (driver.driving && driver.pose) {
      const lap = laps.update(driver.pose.x, driver.pose.z, now / 1000);
      if (lap !== null) lapDone(lap);
    } else laps.reset();
    // A car coming at you where you stand: out of its way, with a thump if it was going.
    const player = ctx.player;
    if (ctx.inOffice() && !driver.active && !ctx.upTop() && !ctx.trip()) {
      const hit = office.cars.shove(player.pos, null);
      if (hit > 1.5 && now - shovedAt > 600) {
        shovedAt = now;
        ctx.sound.crash({ x: player.pos.x, y: player.pos.y + 0.8, z: player.pos.z }, hit / 2);
        ctx.shake(Math.min(0.7, hit / 12));
      }
    }
  });
  ctx.ticks.add('others', () => {
    // The engines of the cars being driven on this floor, yours (by how hard you're on the gas) and theirs.
    const engines: Parameters<typeof ctx.sound.setEngines>[0] = [];
    if (!ctx.upTop() && ctx.inOffice()) {
      for (const [i, c] of store.cars.entries()) {
        const mine = driver.car === i && driver.driving;
        if (!c.driver && !mine) continue;
        const pose = office.cars.cars[i]?.pose ?? c;
        engines.push({ car: i, at: { x: pose.x, y: ctx.player.street + 0.5, z: pose.z }, speed: pose.speed, gas: mine ? driver.gas : Math.min(1, Math.abs(pose.speed) / 10) });
      }
    }
    ctx.sound.setEngines(engines);
  });

  /**
   * The office said who's in which car (`answer`: answering a car.enter or car.leave of yours). Once
   * it has answered them all, where it has you is where you are: out, if someone got in first.
   */
  function carNews(answer: boolean) {
    if (answer) carPending = Math.max(0, carPending - 1);
    if (carPending > 0) return;
    const mine = store.carOf(store.you);
    if (driver.active) {
      if (mine?.car === driver.car && mine.seat === driver.seat) return;
      const who = store.cars[driver.car!]?.[driver.seat!];
      getOut(true);
      toast(`🏎️ ${L.game.gotThereFirst((who && store.peers.get(who)?.name) || L.main.someone)}`, 'warn');
    } else if (mine) {
      // You got out while it was answering something else of yours.
      carPending++;
      ctx.net.send({ t: 'car.leave' });
    }
  }

  ctx.messages.on('cars', (msg) => carNews(!!msg.answer));
  ctx.messages.on('car.honk', (msg) => {
    if (msg.car >= 0 && msg.car < CARS.length) ctx.sound.honk(carAt(msg.car), CARS[msg.car].kind === 'lambo');
  });
  // A floor's cars where they are before anything asks if there's room to stand beside one (see welcome):
  // right after the store has them, before any other message handler.
  ctx.messages.onAny((msg) => {
    if (msg.t === 'welcome' || msg.t === 'floor.enter') office.cars.snap(store.cars);
  });

  /** Back after a reconnect, which let go of your seat for you: back into it if it's still free. */
  function carAgain() {
    carPending = 0;
    const i = driver.car;
    const seat = driver.seat;
    if (i === null || seat === null) return;
    const c = store.cars[i];
    if (!c || c[seat]) {
      getOut(true);
      return;
    }
    carPending++;
    ctx.net.send({ t: 'car.enter', car: i, seat });
    const p = driver.driving ? driver.pose : null;
    if (p) ctx.net.send({ t: 'car.drive', car: i, x: p.x, z: p.z, rotY: p.rotY, speed: p.speed, steer: p.steer });
  }

  /** Where someone on your floor is sitting in a car, if they're in one. */
  function rideOf(id: string): { x: number; y: number; z: number; rotY: number } | undefined {
    const at = store.carOf(id);
    return at && office.cars.seatAt(at.car, at.seat);
  }

  /** In a car: how fast, who with, and the keys. */
  function renderDriveHint(el: HTMLElement) {
    const i = driver.car!;
    const c = store.cars[i];
    const name = (id?: string) => (id && id !== store.you ? (store.peers.get(id)?.name ?? '') : '');
    let hint: Hint;
    // Where you are on the scenic loop, and how the lap's going.
    const pose = office.cars.cars[i]?.pose;
    const place = pose ? loopPlace(pose.x, pose.z) : null;
    const where = place ? ` · ${PLACES[place].icon} ${L.world.places[place] ?? PLACES[place].name}` : '';
    if (driver.driving) {
      const kmh = Math.round(Math.abs(driver.pose?.speed ?? 0) * 3.6);
      const other = name(c?.passenger);
      const now = performance.now() / 1000;
      const done = laps.done && now - laps.done.at < 6 ? laps.done : null;
      const running = laps.running(now);
      const lap = done ? ` · 🏁 ${lapTime(done.time)}${done.best ? ` ${L.game.best}` : ''}` : running !== null ? ` · ⏱ ${lapTime(running)}` : '';
      hint = {
        k: `drive|${kmh}|${other}|${where}|${lap}`,
        parts: [h('span.title', {}, `🏎️ ${carName(CARS[i])}`), aside(`${kmh} km/h${where}${lap}${other ? ` · ${L.game.with(clip(other, 20))}` : ''}`), key('W A S D', L.game.drive), key(L.hints.space, L.game.brake), key('H', L.game.honk), key('E', L.game.getOut)],
      };
    } else {
      const at = name(c?.driver);
      hint = { k: `ride|${at}|${where}`, parts: [h('span.title', {}, `🏎️ ${carName(CARS[i])}`), aside(`${at ? L.game.isDriving(clip(at, 24)) : L.game.nobodyDriving}${where}`), key('H', L.game.honk), key('E', L.game.getOut)] };
    }
    ctx.hint.draw(el, `car|${hint.k}`, () => hint.parts);
  }

  return { driver, getIn, getOut, carAgain, rideOf };
}
