import './style.css';
import { Net } from './net';
import { DesktopNotifier } from './notify';
import { store, loadProfile, loadSettings } from './state';
import { PlayerController, groundAt } from './player';
import { Hands } from './world/hands';
import { Confetti } from './world/confetti';
import { djFrame } from './dnb';
import { Voice } from './voice';
import { $ } from './ui/dom';
import { openCharacter } from './ui/character';
import { elevatorPanelOpen } from './ui/elevator';
import { onModelsProgress, preloadModels } from './world/models';
import { loadingScreen } from './ui/loading';
import { offerLite, touchOnly } from './ui/litesuggest';
import { createCtx } from './core/ctx';
import type { Parts } from './core/parts';
import { createScene, fitWindow, installSky, makeRenderer, noWebGL } from './core/scene';
import { createWorlds } from './core/worlds';
import { frameLoop, installLoop } from './core/loop';
import { installPlace } from './core/place';
import { installYou, makeMe, makeSmoke, makeSound } from './core/you';
import { installTravel } from './core/travel';
import { installArrival } from './core/arrival';
import { installMaps } from './core/maps';
import { installHintBar } from './core/hintbar';
import { installKeyboard, installKeyGuards } from './input/keyboard';
import { installFocus } from './input/focus';
import { installPointer } from './input/pointer';
import { installArcade } from './features/arcade';
import { installBar } from './features/bar';
import { installBarGames } from './features/bargames';
import { installBasketball } from './features/basketball';
import { installBoards } from './features/boards';
import { installBookshelf } from './features/bookshelf';
import { installCabinet } from './features/cabinet';
import { installCarrying } from './features/carrying';
import { installCars } from './features/cars';
import { installChat } from './features/chat';
import { installClimbing } from './features/climbing';
import { installCoffee } from './features/coffee';
import { installDog } from './features/dog';
import { installEmotes } from './features/emotes';
import { installGolf } from './features/golf';
import { installGong } from './features/gong';
import { installGallery, installHanging } from './features/hanging';
import { installHerald } from './features/herald';
import { installHud } from './features/hud';
import { installJukebox } from './features/jukebox';
import { installMeeting } from './features/meeting';
import { installPalette } from './features/palette';
import { installPeers } from './features/peers';
import { installRooftop } from './features/rooftop';
import { installSeating } from './features/seating';
import { installSmoke } from './features/smoke';
import { installTelescope } from './features/telescope';
import { installTv } from './features/tv';
import { installVoice } from './features/voice';
import { installWaiting } from './features/waiting';
import { installWalking } from './features/walking';
import { installWhiteboard } from './features/whiteboard';
import { installWorkerActions } from './features/workers/actions';
import { installWorkerViews } from './features/workers/views';

// The loading screen stays up until there's an office to see (see boot and whoami at the end).
const loading = loadingScreen(onModelsProgress);
// Came here from the 2D view's 🏢 3D button: it isn't offered straight back.
const chose3d = new URLSearchParams(location.search).has('3d');
if (chose3d) history.replaceState(null, '', location.pathname);
/** Offers the 2D view (/lite) where the 3D is hard going. */
const offer2d = (why: 'touch' | 'slow') => chose3d || offerLite(why);
// A phone can't walk around the office: the 2D view is made for it.
if (touchOnly()) offer2d('touch');
// The models made in Blender, loaded before the world they're in is built (see world/models.ts).
await preloadModels();

// ---- The context every part of the office plugs into (see core/context.ts) ----------------------------
// Built before the parts it hands out, which are there by the time anything asks for them. Every part
// below goes into `parts` as it's made; one reaches another's only when something happens, so the
// order here is the order they register in: messages, keys, ticks, store topics and listeners run in
// that order, and it's kept on purpose.
const parts = {} as Parts;
const { ctx, core } = createCtx(parts);
// The office's own parts of each frame, before anything else's.
installLoop(ctx, core, parts, { offer2d });

// ---- Renderer & scene ---------------------------------------------------------------------------
const canvas = $('scene') as HTMLCanvasElement;
parts.stage = createScene(canvas, makeRenderer(canvas) ?? (await noWebGL()));
parts.worlds = createWorlds(ctx);
installSky(ctx);

// ---- The install list ---------------------------------------------------------------------------
parts.boards = installBoards(ctx, { aimedNote: () => parts.pointer.aimedNote(), pickUp: (it) => parts.cards.pickUp(it), boardActions: () => parts.actions.boardActions(), showQueue: () => parts.waiting.showQueue() });
parts.gallery = installGallery(ctx);
installWhiteboard(ctx);
// Onto whatever you're walking on: the office's floor and furniture, or the roof's.
parts.confetti = new Confetti((x, z, y) => groundAt(ctx.player.colliders, x, z, y, false));
ctx.scene.add(parts.confetti.mesh);
parts.tv = installTv(ctx, { shares: () => parts.talk.currentShares(), watch: () => parts.talk.watchShare() });
parts.arcade = installArcade(ctx);
parts.rooftop = installRooftop(ctx, { ambient: parts.stage.ambient, hemi: parts.stage.hemi });

// You, and how you talk to the office.
parts.net = new Net(() => store.profile, () => parts.arrival.whereNow());
parts.voice = new Voice(parts.net);
parts.me = makeMe(ctx);
parts.settings = loadSettings();
parts.player = new PlayerController(ctx.camera, canvas, ctx.office.colliders);
parts.telescope = installTelescope(ctx, { clearTarget: () => parts.pointer.clearTarget(), backToGame: () => parts.focus.backToGame() });
installKeyGuards(ctx, parts);
parts.place = installPlace(ctx, core, parts);
// Everyone arrives by elevator (the welcome says exactly where).
parts.place.placeInCar();
parts.player.view = parts.settings.view;
parts.hands = new Hands(store.profile.color, parts.me.skinColor);
parts.you = installYou(ctx);
parts.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
({ smoke: parts.smoke, puff: parts.puff } = makeSmoke(ctx));
parts.sound = makeSound(parts.settings);

parts.dog = installDog(ctx);
parts.jukebox = installJukebox(ctx, { showSettings: (pane) => parts.hud.showSettings(pane) });
parts.cabinet = installCabinet(ctx, { openTerminal: (id) => parts.waiting.openWorkerTerminal(id) });
parts.notifier = new DesktopNotifier(() => parts.settings.notify, (id) => parts.waiting.openWorkerTerminal(id));
const standUp = () => parts.seating.standUp();
const stopWalking = () => parts.walking.stopWalkingTo();
const personOf = (id: string) => parts.peers.remotes.get(id)?.person;
const reach = () => parts.you.reach();
parts.golf = installGolf(ctx, { standUp, stopWalking, stopSmoking: () => parts.smoking.stop(), personOf });
parts.bargames = installBarGames(ctx, { roof: parts.rooftop.roof, standUp, stopWalking, personOf });
parts.hanging = installHanging(ctx, { gallery: parts.gallery, reach });
parts.climbing = installClimbing(ctx, { travel: (floorId, how, at) => parts.travel.travel(floorId, how, at), standUp, stopWalking });
parts.cars = installCars(ctx, { standUp, stopWalking });

parts.travel = installTravel(ctx, core, parts);
parts.arrival = installArrival(ctx, core, parts);
parts.maps = installMaps(ctx, core, parts);
parts.peers = installPeers(ctx, core, parts);
parts.walking = installWalking(ctx, core, parts);
parts.views = installWorkerViews(ctx, core, parts);
parts.actions = installWorkerActions(ctx, core, parts);
parts.waiting = installWaiting(ctx, core, parts);
installPalette(ctx, parts);
parts.meeting = installMeeting(ctx, parts);
parts.bookshelf = installBookshelf(ctx);
installHerald(ctx, parts);

parts.bar = installBar(ctx, { roof: parts.rooftop.roof, djAt: parts.rooftop.djAt, reach });
parts.coffee = installCoffee(ctx);
parts.smoking = installSmoke(ctx);
parts.hoops = installBasketball(ctx, { remotes: parts.peers.remotes, reach });
parts.cards = installCarrying(ctx, {
  hold: (card) => void (core.carrying = card),
  boards: parts.boards,
  aimedNote: () => parts.pointer.aimedNote(),
  reach,
  dropBall: parts.hoops.dropBall,
  hire: parts.actions.hire,
  heraldSeat: parts.views.heraldSeat,
  heraldHires: parts.views.heraldHires,
  officeIsFull: parts.actions.officeIsFull,
  showMeeting: parts.meeting.showMeeting,
});
parts.seating = installSeating(ctx, { shares: () => parts.talk.currentShares(), watchShare: () => parts.talk.watchShare(), arcade: parts.arcade, showBar: parts.bar.showBar, usable: () => parts.pointer.usable() });
installGong(ctx, { burstOver: parts.views.burstOver, workerViews: parts.views.workerViews, court: () => parts.worlds.court(), idleAgents: () => parts.worlds.idleAgents() });

parts.hintbar = installHintBar(ctx, core, parts);
parts.emotes = installEmotes(ctx, { personOf });
installKeyboard(ctx, parts);
parts.focus = installFocus(ctx, core, parts);
parts.pointer = installPointer(ctx, core, parts);
installChat(ctx);
parts.talk = installVoice(ctx, { tv: parts.tv });
parts.hud = installHud(ctx, core, parts);

// ---- Main loop ---------------------------------------------------------------------------------------
fitWindow(ctx);
const frame = frameLoop(ctx, loading);

// ---- Boot ------------------------------------------------------------------------------------------
function boot() {
  parts.net.connect();
  requestAnimationFrame(frame);
}

/** Who you're signed in as. With an account of your own, your name is that account's. */
async function whoami() {
  try {
    const res = await fetch('/api/whoami', { cache: 'no-store' });
    if (res.status === 401) location.href = '/login';
    const { me } = (await res.json()) as { me?: typeof store.me };
    if (me) store.me = me;
  } catch {
    // the welcome message says it too
  }
}

void whoami().then(() => {
  const saved = loadProfile();
  if (saved && store.me.account) saved.name = store.me.account.name;
  if (store.me.account) store.profile.name = store.me.account.name;
  store.emit('me');
  if (saved?.look) {
    store.profile = { ...saved, look: saved.look };
    parts.you.showMyProfile(store.profile);
    boot();
    // In as soon as the floor you're on is here with its dog, so the dog doesn't pop in after.
    const welcomed = new Promise<void>((resolve) => {
      const off = store.on('floor', () => {
        off();
        resolve();
      });
    });
    loading.until([
      { say: 'Knocking on the door', done: welcomed },
      { say: 'Fetching the dog', done: parts.dog.firstReady },
    ]);
  } else {
    // Pick a character first (people from before there was a choice keep their name and color).
    if (saved) Object.assign(store.profile, { name: saved.name, color: saved.color });
    // Render the office behind the character select screen.
    requestAnimationFrame(frame);
    openCharacter(true, (p) => {
      parts.you.showMyProfile(p);
      parts.net.connect();
    });
    // No floor comes before you pick, so only the office behind the character select is waited for.
    loading.until([]);
  }
});

// Debug handle for quick checks from the console / headless screenshots.
const { worlds, views, rooftop, bar, coffee, golf, bargames, hanging, climbing, cars, emotes, hoops } = parts;
(window as any).__office = { world: () => worlds.world(), court: () => worlds.court(), sendoffs: views.sendoffs, jail: views.jail, plan: worlds.plan, applyMap: parts.maps.applyMap, roof: rooftop.roof, booze: bar.booze, dj: () => djFrame(rooftop.djAt()), store, player: parts.player, caffeine: coffee.caffeine, camera: ctx.camera, arcade: parts.arcade, cabinet: parts.cabinet, workerViews: views.workerViews, departures: views.departures, arrivals: views.arrivals, scene: ctx.scene, net: parts.net, renderer: ctx.renderer, hands: parts.hands, me: parts.me, remotes: parts.peers.remotes, settings: parts.settings, gallery: parts.gallery, hanger: hanging.hanger, office: ctx.office, ride: parts.travel.ride, switchFloor: parts.travel.switchFloor, climber: climbing.climber, driver: cars.driver, getIn: cars.getIn, getOut: cars.getOut, golf: golf.golf, balls: golf.balls, thrower: bargames.thrower, elevatorPanelOpen, confetti: parts.confetti, dog: parts.dog, sky: ctx.sky, holiday: parts.stage.holiday, carried: () => core.carrying, emoteWheel: emotes.emoteWheel, emote: emotes.emote, ball: hoops.ball };
(window as any).__voice = parts.voice;
(window as any).__sound = parts.sound;
(window as any).__notify = parts.notifier;
