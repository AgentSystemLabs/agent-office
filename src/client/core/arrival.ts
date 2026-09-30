/**
 * Arriving: everything the office says goes through ctx.messages from here (each type's `before`
 * handlers, the store, the routers, then its `after` handlers), and arriving (a welcome, a
 * floor.enter) is handled here; the rest are registered with what they're about. Also what the page
 * says about where you are: the project in the corner and the tab's title, the upgrade banner, and the
 * sign-ins a newcomer is greeted with.
 */
import { OFFICE_PLAN } from '../../shared/maps';
import { SLAB, inElevator } from '../../shared/layout';
import { ROOF, ROOF_NAME } from '../../shared/rooftop';
import { renderTitle } from '../shared/title';
import { lastFloor, lastSpot, store, type Spot } from '../state';
import { routeAccountsMessage } from '../ui/accounts';
import { openChangesFor, routeChangesMessage } from '../ui/changes';
import { $, toast } from '../ui/dom';
import { routeElevatorMessage } from '../ui/elevator';
import { providerLabel } from '../ui/provider';
import { routePullMessage } from '../ui/pull';
import { needsSigningIn, openSignIns } from '../ui/signins';
import { routeTeamMessage } from '../ui/team';
import { openTerminalFor, routeTerminalMessage } from '../ui/terminal';
import { restarting, showRestarting, showUpgraded } from '../ui/upgrade';
import { routeWhiteboardMessage } from '../features/whiteboard/ui';
import type { Ctx } from './context';
import type { CoreState } from './ctx';
import { builtFloors, pastTheWing } from './floors';
import type { Parts } from './parts';

export type ArrivalParts = Pick<Parts, 'worlds' | 'place' | 'travel' | 'maps' | 'views' | 'cards' | 'hoops' | 'bar' | 'golf' | 'bargames' | 'cars' | 'focus'>;

/**
 * Registers arriving's messages and the routers (see the order below), and what follows the upgrade,
 * the floors and the project. Install it after core/travel.ts and before anything else hears a welcome.
 */
export function installArrival(ctx: Ctx, core: CoreState, parts: ArrivalParts) {
  const { net, voice, player } = ctx;
  const { inOffice, plan } = parts.worlds;
  const { placeAt, placeInCar } = parts.place;

  /** Whether the next welcome is this page's first (it puts you back where you were last time). */
  let firstWelcome = true;
  /** The server version this page was loaded with. */
  let bootVersion = '';
  let upgradePhase = '';

  net.onStatus((up) => $('conn').classList.toggle('hidden', up));
  /** Whether this page has shown someone their sign-ins yet (it greets a newcomer once). */
  let signInsGreeted = false;
  net.onMessage((msg) => ctx.messages.dispatch(msg));
  /** The floor you asked to come back to (see Net.connect), to tell if the office put you somewhere else. */
  let wasOn: string | null = null;
  ctx.messages.on(
    'welcome',
    () => {
      wasOn = store.floor ?? lastFloor();
      voice.reset();
      parts.views.seatedOnArrival();
    },
    'before',
  );
  ctx.messages.on('floor.enter', () => parts.views.seatedOnArrival(), 'before');
  ctx.messages.on('worker.remove', (msg) => parts.views.sendingHome(msg.workerId), 'before');
  // Once the store has it (the cars have their own, registered with them, first).
  ctx.messages.onAny(() => parts.views.settled());
  ctx.messages.onAny(routeTerminalMessage);
  ctx.messages.onAny(routeChangesMessage);
  ctx.messages.onAny(routeTeamMessage);
  ctx.messages.onAny(routeAccountsMessage);
  ctx.messages.onAny(routePullMessage);
  ctx.messages.onAny(routeElevatorMessage);
  ctx.messages.onAny((msg) => routeWhiteboardMessage(msg, net));
  ctx.messages.on('welcome', (msg) => {
    const { travel, maps } = parts;
    // A few pings, to line this page's clock up with the office's for the jukebox.
    for (let i = 0; i < 5; i++) setTimeout(() => net.send({ t: 'ping', at: performance.now() }), 200 + i * 500);
    const mine = store.peers.get(store.you);
    if (firstWelcome && mine) {
      firstWelcome = false;
      // Where the office put you: back in the spot you left (if there's still room there), or in the elevator car.
      travel.setPlace();
      travel.syncStack();
      // Back to where you were, if that was on this map (and not in the elevator: that's arriving).
      const saved = lastSpot();
      const sameMap = !!saved && (saved.map ?? OFFICE_PLAN.id) === plan().id;
      // A hall of its own has nothing outside it to come back to (and its walls may have moved since).
      const b = plan().bounds;
      const inRoom = inOffice() || (mine.x > b.minX + 0.3 && mine.x < b.maxX - 0.3 && mine.z > b.minZ + 0.3 && mine.z < b.maxZ - 0.3);
      if (sameMap && inRoom && !(inOffice() && (inElevator(mine.x, mine.z) || pastTheWing(mine, parts.worlds.officeWing()))) && player.fits(mine.x, mine.z, mine.y)) {
        placeAt(mine);
        travel.arrive('back');
      } else {
        // The car you were in (or nearest): the garage's, if you were down there.
        placeInCar(mine, !core.upTop && mine.y < -SLAB - 1);
        travel.arrive();
      }
      floorWentWhileAway(wasOn);
    } else if (store.floor && store.floor !== wasOn) {
      // Back after the office restarted, but not on your floor: it went while the office was down.
      travel.takenAway();
      if (core.carrying) parts.cards.setCarrying(null);
      travel.arrive();
      floorWentWhileAway(wasOn);
    } else if (!store.floor) travel.arrive();
    maps.offTheRoof();
    if (voice.inVoice || voice.sharing) net.send({ t: 'voice', voice: voice.inVoice, muted: voice.muted, sharing: voice.sharing });
    if (player.seat) net.send({ t: 'sit', seat: player.seat.key });
    const carrying = core.carrying;
    if (carrying) net.send({ t: 'carry', issue: carrying.issue, title: carrying.title });
    const shownDrink = parts.bar.shownDrink();
    if (shownDrink) net.send({ t: 'act', drink: shownDrink });
    if (parts.golf.golf.active) net.send({ t: 'act', golf: true });
    const { thrower } = parts.bargames;
    if (thrower.playing) net.send({ t: 'act', throwing: thrower.playing });
    // The office let go of the ball for you while you were away, and of your seat in a car.
    parts.hoops.ballNews(false);
    parts.cars.carAgain();
    // After a reconnect the server has forgotten which terminal we had open, and what we're doing.
    parts.focus.sendDoing(true);
    const openId = openTerminalFor();
    if (openId && store.workers.has(openId)) net.send({ t: 'worker.attach', workerId: openId });
    const watching = openChangesFor();
    if (watching && store.workers.has(watching.workerId)) net.send({ t: 'changes.watch', ...watching });
    renderProject();
    ctx.hud.refresh();
    // Back from a restart on another version: this page's code is stale, so load the new one.
    if (!bootVersion) bootVersion = msg.version;
    else if (msg.version !== bootVersion || restarting()) showUpgraded(msg.upgrade);
    upgradePhase = msg.upgrade.phase;
    voice.syncPeers();
  });
  ctx.messages.on('floor.enter', () => {
    const { travel } = parts;
    // Not a trip of yours: the floor you were on was taken off the building, and the elevator took you away.
    if (!core.trip) travel.takenAway();
    // The card belongs to the board downstairs (or up): the office already put it back there.
    const carrying = core.carrying;
    if (carrying) {
      toast(`📌 #${carrying.issue} stayed behind on the other floor's board`);
      parts.cards.setCarrying(null);
    }
    // So does the ball: it's back under that floor's hoop.
    if (parts.hoops.holding()) toast('🏀 The ball stayed behind, back under the other floor’s hoop');
    parts.hoops.ballNews(false);
    travel.arrive();
    // Down off a roof that isn't there any more, or the map changed on the way: where you come in on this map.
    const { pending } = travel;
    if (pending.offRoof || pending.placeOnArrival) {
      pending.offRoof = false;
      pending.placeOnArrival = false;
      placeInCar();
      travel.lift()?.setOpen(true);
    }
    parts.maps.offTheRoof();
  });
  ctx.messages.on('signins', () => {
    // Someone who just joined starts here: their workers need their own Claude sign-in first.
    if (!signInsGreeted) {
      signInsGreeted = true;
      if (needsSigningIn()) openSignIns(net, 'Welcome! Sign in to Claude so the workers you hire run on your own plan, and to GitHub so what you do on the boards is yours.');
    }
  });
  ctx.messages.on('signins.needed', (msg) => openSignIns(net, msg.why));
  ctx.messages.on('toast', (msg) => toast(msg.text, msg.level));

  function renderUpgrade() {
    const u = store.upgrade;
    const banner = $('upgrade-banner');
    banner.classList.toggle('hidden', u.phase !== 'building');
    banner.textContent = `🛠️ ${u.by ?? 'Someone'} is upgrading the office. It restarts on the new version in a minute or two.`;
  }
  store.on('upgrade', renderUpgrade);
  ctx.messages.on('upgrade', (msg) => {
    if (msg.state.phase === 'restarting') showRestarting(msg.state, net);
    if (msg.state.phase === 'failed' && upgradePhase === 'building') toast(`The upgrade failed, so the office stays on ${msg.state.current?.sha ?? 'this version'}`, 'error');
    upgradePhase = msg.state.phase;
  });

  function renderProject() {
    const p = store.project;
    renderTitle();
    if (store.floor === ROOF) {
      const n = builtFloors().length;
      $('project-meta').classList.remove('lobby');
      $('project-name').textContent = `🍸 ${ROOF_NAME}`;
      $('project-meta').textContent = `🛗 on top of ${n} floor${n === 1 ? '' : 's'} · 🎧 drum & bass`;
      return;
    }
    if (!p) {
      $('project-name').textContent = '🏢 Agent Office';
      $('project-meta').textContent = store.floors.length ? '🛗 Take the elevator to a floor' : '🛗 No floors yet — add a project in the elevator';
      // Where to go next, so it shows even with the floor details turned off.
      $('project-meta').classList.add('lobby');
      ctx.world().setProjectName(store.floors.length ? 'Pick a floor' : 'Lobby');
      return;
    }
    const n = store.floors.findIndex((f) => f.id === store.floor);
    $('project-meta').classList.remove('lobby');
    $('project-name').textContent = `🏢 ${p.name}`;
    $('project-meta').textContent = [n >= 0 && `🛗 floor ${n + 1} of ${store.floors.length}`, p.branch && `⎇ ${p.branch}`, p.dir, `default: ${providerLabel(p.defaultProvider, p)}`].filter(Boolean).join(' · ');
    ctx.world().setProjectName(p.name);
  }
  store.on('floors', renderProject);
  store.on('project', renderProject);

  /** Where to put you back when the office lets you in: where you are now, or before this page was loaded, where you were last time. */
  function whereNow(): Spot | null {
    return firstWelcome ? lastSpot() : parts.place.spotHere();
  }

  /** You asked to come back to floor `was`, and it's gone (taken off the building, or its checkout deleted): the office sent you up to the roof. */
  function floorWentWhileAway(was: string | null) {
    if (!was || was === ROOF || store.floor !== ROOF || store.floors.some((f) => f.id === was)) return;
    const saved = lastSpot();
    const name = saved?.floor === was && saved.name ? saved.name : 'Your floor';
    toast(`🛗 ${name} isn't in the building any more, so the elevator brought you up to the roof`, 'warn');
  }

  return { renderProject, whereNow };
}
