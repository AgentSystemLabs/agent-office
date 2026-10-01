/**
 * Every part of the office main.ts makes and installs, by name, for the parts that need one another.
 * Each is set as it's made (see the install list in main.ts) and read when something happens (a
 * message, a key, a frame), never while installing: so the order parts are installed in is only the
 * order they register in, and a part can reach one installed after it. Each part names the ones it
 * reaches for (a `Pick` of these). Types only.
 */
import type { Net } from '../net';
import type { DesktopNotifier } from '../notify';
import type { PlayerController } from '../player';
import type { OfficeSound } from '../sound';
import type { Settings } from '../state';
import type { Voice } from '../voice';
import type { Person } from '../world/character';
import type { Confetti } from '../world/confetti';
import type { Hands } from '../world/hands';
import type { Smoke } from '../world/smoke';
import type { installArcade } from '../features/arcade';
import type { installBar } from '../features/bar';
import type { installBarGames } from '../features/bargames';
import type { installBasketball } from '../features/basketball';
import type { installBoards } from '../features/boards';
import type { installBookshelf } from '../features/bookshelf';
import type { installCabinet } from '../features/cabinet';
import type { installCarrying } from '../features/carrying';
import type { installCars } from '../features/cars';
import type { installClimbing } from '../features/climbing';
import type { installCoffee } from '../features/coffee';
import type { installDog } from '../features/dog';
import type { installEmotes } from '../features/emotes';
import type { installGolf } from '../features/golf';
import type { installGallery, installHanging } from '../features/hanging';
import type { installHud } from '../features/hud';
import type { installJukebox } from '../features/jukebox';
import type { installMeeting } from '../features/meeting';
import type { installPeers } from '../features/peers';
import type { installRooftop } from '../features/rooftop';
import type { installSeating } from '../features/seating';
import type { installSmoke } from '../features/smoke';
import type { installTelescope } from '../features/telescope';
import type { installTv } from '../features/tv';
import type { installVoice } from '../features/voice';
import type { installWaiting } from '../features/waiting';
import type { installWalking } from '../features/walking';
import type { installWorkerActions } from '../features/workers/actions';
import type { installWorkerViews } from '../features/workers/views';
import type { installFocus } from '../input/focus';
import type { installPointer } from '../input/pointer';
import type { installArrival } from './arrival';
import type { installHintBar } from './hintbar';
import type { installMaps } from './maps';
import type { installPlace } from './place';
import type { Stage } from './scene';
import type { installTravel } from './travel';
import type { createWorlds } from './worlds';
import type { Puff, installYou } from './you';

type Made<F extends (...args: never[]) => unknown> = ReturnType<F>;

export interface Parts {
  // ---- What the office is made of ------------------------------------------------------------------
  stage: Stage;
  /** The building's map as it's built, and the one it's on (see core/worlds.ts). */
  worlds: Made<typeof createWorlds>;
  net: Net;
  voice: Voice;
  /** Your own character. */
  me: Person;
  settings: Settings;
  player: PlayerController;
  /** Your hands, in first person. */
  hands: Hands;
  /** The system asks for less motion: no shaking the view, no swaying. */
  reduceMotion: MediaQueryList;
  /** Cigarette smoke, from anyone on a smoke break. */
  smoke: Smoke;
  /** A puff of it off someone's cigarette. */
  puff: Puff;
  sound: OfficeSound;
  /** Confetti for merges, landing on whatever it falls on. */
  confetti: Confetti;
  notifier: DesktopNotifier;

  // ---- The office's own parts ----------------------------------------------------------------------
  place: Made<typeof installPlace>;
  you: Made<typeof installYou>;
  travel: Made<typeof installTravel>;
  arrival: Made<typeof installArrival>;
  maps: Made<typeof installMaps>;
  hintbar: Made<typeof installHintBar>;
  focus: Made<typeof installFocus>;
  pointer: Made<typeof installPointer>;

  // ---- Features ------------------------------------------------------------------------------------
  boards: Made<typeof installBoards>;
  gallery: Made<typeof installGallery>;
  tv: Made<typeof installTv>;
  arcade: Made<typeof installArcade>;
  rooftop: Made<typeof installRooftop>;
  telescope: Made<typeof installTelescope>;
  dog: Made<typeof installDog>;
  jukebox: Made<typeof installJukebox>;
  cabinet: Made<typeof installCabinet>;
  golf: Made<typeof installGolf>;
  bargames: Made<typeof installBarGames>;
  hanging: Made<typeof installHanging>;
  climbing: Made<typeof installClimbing>;
  cars: Made<typeof installCars>;
  peers: Made<typeof installPeers>;
  walking: Made<typeof installWalking>;
  views: Made<typeof installWorkerViews>;
  actions: Made<typeof installWorkerActions>;
  waiting: Made<typeof installWaiting>;
  meeting: Made<typeof installMeeting>;
  bookshelf: Made<typeof installBookshelf>;
  bar: Made<typeof installBar>;
  coffee: Made<typeof installCoffee>;
  smoking: Made<typeof installSmoke>;
  hoops: Made<typeof installBasketball>;
  cards: Made<typeof installCarrying>;
  seating: Made<typeof installSeating>;
  emotes: Made<typeof installEmotes>;
  talk: Made<typeof installVoice>;
  hud: Made<typeof installHud>;
}
