import './style.css';
import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { sameLook } from '../shared/avatar';
import { BALCONY, DESK_BY_ID, DESKS, ELEVATOR, ELEVATOR_CAR, FLOOR, GOLF_HOLE, LADDER, LOFT, POLE, POLES, SEATING_BY_ID, SLAB, STATIONS, STATION_AGENT, STOREY, WALL_HEIGHT, beanbagsOut, deskSeat, inElevator, nextFreeSeat, roofDrop, seatAt, seatPlace, streetBelow, vacantSeats, type DeskDef, type SeatDef, type SeatPlace, type StationKind } from '../shared/layout';
import { floorPalette } from '../shared/floors';
import type { AgentEffort, AgentProvider, CarriedIssue, FloorInfo, GhIssue, GongWhy, PeerInfo, WorkerInfo, WorkerTask } from '../shared/protocol';
import { MEETING_PATTERNS } from '../shared/meetings';
import { isAsleep, isBusy } from '../shared/status';
import { Net } from './net';
import { store, loadProfile, loadSettings, saveSettings, workerForPull, workerPr, type Profile, type Topic } from './state';
import { EYE_HEIGHT, PlayerController, groundAt, isTyping } from './player';
import { Climber, gripOf, type Arrival, type Grip, type Way } from './climb';
import { Caffeine } from './caffeine';
import { buildOffice, type DeskView, type InteractKind, type Interactable } from './world/office';
import { buildRooftop, type Rooftop } from './world/rooftop';
import { DrunkVision } from './world/drunk';
import { Booze, type Stage as Feeling } from './booze';
import { djFrame, djTime } from './dnb';
import { openBar } from './ui/bar';
import { DRINK_BY_ID, ROOF, ROOF_NAME, type Drink, type DrinkId } from '../shared/rooftop';
import { BACKSWING_TIME, IMPACT, Person, Worker, type Stage } from './world/character';
import { GolfBalls, PIN_DISTANCE, TEE_BALL, fly, lieText, pinText, type Flight, type Hit, type Shot } from './world/golf';
import { Golfer } from './golf';
import { Hands } from './world/hands';
import { Basketball, IN_HANDS } from './world/hoop';
import { HOOP, SWEET, idealSpeed, lookAtRim, meter, shotSpeed, throwPitch, tossSpeed, underCeiling } from '../shared/hoop';
import { Smoke } from './world/smoke';
import { HAZE_MAX, Sky, describeSky } from './world/sky';
import { Laptop } from './world/laptop';
import { BoardTexture, QueueBoardTexture, ServicesBoardTexture } from './world/boards';
import { Gallery } from './world/gallery';
import { Dog } from './world/dog';
import { Holiday } from './world/holiday';
import { Arrivals, Departures } from './world/leaving';
import { Confetti, type Area } from './world/confetti';
import { Hanger } from './hanging';
import { disposeSprite, textSprite } from './world/toon';
import { Voice } from './voice';
import { OfficeSound } from './sound';
import { DesktopNotifier, askNotifyPermission, notifyPermission, waitingOnSomeone } from './notify';
import { NextUp, waitingInOrder, waitingLabel } from './nextup';
import { $, h, clip, closeAllModals, doingNow, modalOpen, onModalChange, openModal, toast, STATUS_LABEL } from './ui/dom';
import { openTerminal, openTerminalFor, routeTerminalMessage, type TerminalFind } from './ui/terminal';
import { openSearch } from './ui/search';
import { openChanges, openChangesFor, routeChangesMessage } from './ui/changes';
import { openPrompt, confirmDialog, sendHomeDialog, routeWorktreeMessage, worktreePref } from './ui/prompt';
import { issuePrompt, openBoard } from './ui/boards';
import { openIssue, openPull, routePullMessage } from './ui/pull';
import { openAsk } from './ui/ask';
import { openTeam, routeTeamMessage } from './ui/team';
import { openAccounts, routeAccountsMessage } from './ui/accounts';
import { openServices } from './ui/services';
import { openQueue } from './ui/queue';
import { openUpgrade, restarting, showRestarting, showUpgraded } from './ui/upgrade';
import { openHelp, renderCaffeine, renderChat, renderPeople, renderWorkers, updateSpeaking } from './ui/hud';
import { Compass, type Bearing } from './ui/compass';
import { openCharacter } from './ui/character';
import { openSettings } from './ui/settings';
import { hiringPaused, renderUsage, usageLabel, usageTitle } from './ui/usage';
import { elevatorPanelOpen, openElevator, routeElevatorMessage } from './ui/elevator';
import { toggleFloorMenu } from './ui/floormenu';
import { providerLabel, officeChoice, resolvedProvider, modelBadge } from './ui/provider';
import { mirrorWhiteboard, openWhiteboard, routeWhiteboardMessage } from './ui/whiteboard';
import { renderLimits } from './ui/limits';
import { MachineTexture, officeFull, pressureNote } from './world/machine';
import { mountHud } from './ui/menu';
import { openJukebox } from './ui/jukebox';
import { Arcade } from './ui/arcade';
import { Cabinet } from './ui/cabinet';
import { trackTitle } from '../shared/jukebox';
import { GAME, scoreText } from '../shared/cabinet';
import { EMOTES, EMOTE_BY_ID, EmoteBucket, type EmoteId } from '../shared/emotes';
import { EmoteWheel } from './ui/emotes';
import { whereabouts } from './ui/whereabouts';
import { wayTo } from './walkto';
import { MeetingBoardTexture, MeetingSignTexture, meetingStage } from './world/meeting';
import { issueMeeting, openMeeting, type MeetingPreset } from './ui/meeting';

// ---- Renderer & scene ---------------------------------------------------------------------------
const canvas = $('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const effect = new OutlineEffect(renderer, { defaultThickness: 0.0032, defaultColor: [0.17, 0.18, 0.26] });

const scene = new THREE.Scene();
// The sky's color and the fog change with the time of day and the weather (world/sky.ts).
scene.background = new THREE.Color('#bfe3ff');
scene.fog = new THREE.Fog('#bfe3ff', 40, 90);
/** How far the camera sees in the office: as far as the haze ever is, from the top floor. */
const FAR = HAZE_MAX + 20;
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, FAR);

const hemi = new THREE.HemisphereLight('#fff5e6', '#c9a27a', 1.5);
const ambient = new THREE.AmbientLight('#ffffff', 0.5);
scene.add(hemi, ambient);
// The sun by day and the moon by night; the sky moves it (world/sky.ts).
const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
sun.position.set(-8, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// Wide enough for the office, the garage under it and the balcony and lot out front, from wherever the sun is.
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 30, bottom: -30, near: 1, far: 100 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.03;
scene.add(sun);

const office = buildOffice();
scene.add(office.group);
const sky = new Sky(scene, { sun, hemi, ambient }, office.night);
store.on('sky', () => store.sky && sky.set(store.sky));
// Halloween or Christmas decorations, up while the building's dressed up for one (see dressUp).
const holiday = new Holiday(office);
scene.add(holiday.group);

const noOutline = (obj: THREE.Object3D) =>
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry;
    const flat = geo instanceof THREE.PlaneGeometry || geo instanceof THREE.CircleGeometry;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) if (flat || mat instanceof THREE.MeshBasicMaterial) mat.userData.outlineParameters = { visible: false };
  });
noOutline(office.group);
noOutline(holiday.group);

// ---- Board agents -------------------------------------------------------------------------------
/** What each board agent is for: its board's icon, what it offers on the card over its head, and an example ask. */
const STATION_INFO: Record<StationKind, { icon: string; offer: string; does: string; example: string }> = {
  issues: { icon: '📌', offer: 'Ask me about issues', does: 'I file, find, triage, label and close them', example: 'File an issue: the dog walks straight through the jukebox' },
  pulls: { icon: '🔀', offer: 'Ask me about PRs', does: 'I sum up, review, comment on and merge them', example: 'Review the newest PR and tell me if it’s ready to merge' },
  queue: { icon: '📋', offer: 'Ask me to queue work', does: 'I turn it into tasks for fresh workers', example: 'Queue every open bug issue, most important first' },
};
/** The board agents waiting by their boards before anyone has asked them anything (see buildKiosk). */
const idleAgents = STATIONS.map((def) => {
  const kind = def.station!;
  const agent = STATION_AGENT[kind];
  const model = new Worker(agent.name, agent.color);
  model.setStatus('idle', false);
  model.setTask({ name: STATION_INFO[kind].offer, summary: STATION_INFO[kind].does });
  const view = office.desks.get(def.id)!;
  view.vacancy.children[0].add(model.root);
  noOutline(model.root);
  return { model, view };
});

// Boards: each draws onto a canvas texture, redrawn whenever what it shows changes.
function mountBoard(mesh: THREE.Mesh, texture: THREE.Texture, render: () => void, topics: Topic[]) {
  const mat = mesh.material as THREE.MeshBasicMaterial;
  mat.map = texture;
  mat.needsUpdate = true;
  for (const topic of topics) store.on(topic, render);
  render();
}
/** The issue card in your hands, taken off this floor's issues board (see Carrying an issue card), or null. */
let carrying: CarriedIssue | null = null;
/** Issues whose cards someone on this floor is carrying around, so they're missing from the board. */
function offBoard(): Set<number> {
  const off = new Set<number>();
  if (carrying) off.add(carrying.issue);
  for (const p of store.peers.values()) if (p.carrying && p.id !== store.you && store.onMyFloor(p)) off.add(p.carrying.issue);
  return off;
}
const issuesTex = new BoardTexture('issues');
const renderIssuesBoard = () => {
  const off = offBoard();
  issuesTex.render(off.size ? { ...store.issues, items: store.issues.items.filter((i) => !off.has(i.number)) } : store.issues);
};
mountBoard(office.boardMeshes.issues, issuesTex.texture, renderIssuesBoard, ['issues']);
let carriedOff = '';
store.on('peers', () => {
  const k = [...offBoard()].join(',');
  if (k === carriedOff) return;
  carriedOff = k;
  renderIssuesBoard();
});
const pullsTex = new BoardTexture('pulls');
const renderPullsBoard = () => pullsTex.render(store.pulls, store.workers);
mountBoard(office.boardMeshes.pulls, pullsTex.texture, renderPullsBoard, ['pulls']);
// PR notes name the desk they came from. Redraw when that changes, not on every worker update.
let deskLinks = '';
store.on('workers', () => {
  const k = JSON.stringify([...store.workers.values()].filter((w) => w.worktree).map((w) => [w.worktree!.branch, w.pr?.number, w.name, w.color, w.deskId]));
  if (k === deskLinks) return;
  deskLinks = k;
  renderPullsBoard();
});
const servicesTex = new ServicesBoardTexture();
mountBoard(office.boardMeshes.services, servicesTex.texture, () => servicesTex.render(store.services.items, store.workers), ['services', 'workers']);
const queueTex = new QueueBoardTexture();
mountBoard(office.boardMeshes.queue, queueTex.texture, () => queueTex.render(store.queue, store.workers), ['queue', 'workers']);
// The machine monitor on the west wall.
const machineTex = new MachineTexture();
mountBoard(office.machineScreen, machineTex.texture, () => machineTex.render(store.machine), ['machine']);
// The meeting room: its output as it's written on the back wall, and how it's going on the door.
const meetingBoardTex = new MeetingBoardTexture();
mountBoard(office.meetingBoard, meetingBoardTex.texture, () => meetingBoardTex.render(store.meeting), ['meeting']);
const meetingSignTex = new MeetingSignTexture();
mountBoard(office.meetingSign, meetingSignTex.texture, () => meetingSignTex.render(store.meeting), ['meeting']);

// Pictures people hung on the walls
const gallery = new Gallery();
office.group.add(gallery.group);
store.on('decor', () => gallery.sync(store.decor));

// The whiteboard shows what everyone's drawn on it.
mirrorWhiteboard(office.whiteboard.show, office.whiteboard.fit.width, office.whiteboard.fit.height);

// Confetti for merges, landing on whatever it falls on
const confetti = new Confetti((x, z, y) => groundAt(office.colliders, x, z, y, false));
scene.add(confetti.mesh);

// TV
const tvVideo = document.createElement('video');
tvVideo.muted = true;
tvVideo.playsInline = true;
tvVideo.autoplay = true;
const tvTexture = new THREE.VideoTexture(tvVideo);
tvTexture.colorSpace = THREE.SRGBColorSpace;
const tvIdle = (() => {
  const c = document.createElement('canvas');
  c.width = 1280;
  c.height = 720;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 1280, 720);
  grad.addColorStop(0, '#3a0ca3');
  grad.addColorStop(1, '#4cc9f0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1280, 720);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = '900 88px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText('📺 Office TV', 640, 330);
  g.font = '700 44px Nunito, ui-rounded, system-ui, sans-serif';
  g.fillText('Click “Share screen” to put something up here', 640, 420);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const tvMat = office.tvScreen.material as THREE.MeshBasicMaterial;
tvMat.color.set('#ffffff');
tvMat.map = tvIdle;
tvMat.toneMapped = false;
// The boss's monitor upstairs: Minesweeper, from the boss's chair.
const arcade = new Arcade(office.bossScreen);

// ---- The rooftop bar ------------------------------------------------------------------------------
/** Up on the roof: built the first time anyone goes up there. */
let roof: Rooftop | null = null;
function theRoof(): Rooftop {
  if (!roof) {
    roof = buildRooftop(office.night, roofFloors());
    roof.group.visible = false;
    scene.add(roof.group);
    noOutline(roof.group);
  }
  return roof;
}
/** How many floors the roof stands on: every one that's built. */
function roofFloors(): number {
  return Math.max(1, builtFloors().length);
}
/** Floors come and go: the roof goes up or down with them, and the street's that much further down from it. */
function syncRoof() {
  if (!roof) return;
  const floors = roofFloors();
  roof.setFloors(floors);
  if (upTop) sky.setRoof(true, roofDrop(floors));
}
store.on('floors', syncRoof);
/** Where you are now: up on the roof (true), or on a floor of the office. */
let upTop = false;
/** How far into the DJ's set it is, on the office's clock, so everyone up there hears the same bar. */
const djAt = () => djTime(store.officeNow());
/** Drinks from the bar, and how they make the world look (see booze.ts, world/drunk.ts). */
const booze = new Booze();
const drunkVision = new DrunkVision(renderer);

// ---- Networking & state -------------------------------------------------------------------------
const net = new Net(() => store.profile);
const voice = new Voice(net);

const me = new Person(store.profile.name, store.profile.color, store.profile.look);
me.showLabel(false);
scene.add(me.root);
noOutline(me.root);
const settings = loadSettings();
const player = new PlayerController(camera, canvas, office.colliders);
// Everyone arrives by elevator (the welcome says exactly where).
placeInCar();
player.view = settings.view;
const hands = new Hands(store.profile.color, me.skinColor);
const caffeine = new Caffeine();
/** No shaking the view for the coffee jitters when the system asks for less motion. */
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// Cigarette smoke, from anyone on a smoke break.
const smoke = new Smoke();
scene.add(smoke.group);
const puff = (kind: 'wisp' | 'exhale', at: THREE.Vector3, dir: THREE.Vector3) => (kind === 'wisp' ? smoke.wisp(at) : smoke.exhale(at, dir));
const camLocal = new THREE.Vector3();
// In first person yours comes off the cigarette in your hand and out in front of the camera.
me.onSmoke = (kind, at, dir) => {
  if (player.view !== 'first') return puff(kind, at, dir);
  if (kind === 'wisp') return smoke.wisp(camera.localToWorld(hands.cigTip(camLocal)));
  smoke.exhale(camera.localToWorld(camLocal.set(0, -0.14, -0.3)), camera.getWorldDirection(camLocal).setY(0.1).normalize());
};
const sound = new OfficeSound();
sound.setVolume(settings.volume, settings.muted);
// The floor's dog. It goes quiet once someone has the terminal of the worker it's barking at open.
const dog = new Dog(sound, (id) => (store.workers.get(id)?.viewers.length ?? 0) > 0);
scene.add(dog.root);
noOutline(dog.root);
store.on('dog', () => dog.sync(store.dog, store.dogStart));
sound.setMusicVolume(settings.music, settings.musicMuted);
sound.onMusicError = (text) => toast(text, 'warn');
// The jukebox on your floor: everyone there hears it from the same bar, and its lights say what's on.
store.on('jukebox', () => {
  const j = store.jukebox;
  sound.setJukebox(j.on ? { track: j.track, url: j.url, startedAt: j.startedAt, since: j.since } : null);
  office.jukebox.show(j.on, trackTitle(j));
});
// The arcade cabinet next to it: BLOCKFALL up close, and on its screen for everyone else on the floor.
const cabinet = new Cabinet(office.cabinet.screen, net, { openTerminal: (id) => openWorkerTerminal(id), sound: (kind, lines) => sound.arcade(kind, lines) });
const notifier = new DesktopNotifier(() => settings.notify, (id) => openWorkerTerminal(id));

// ---- Golf off the balcony --------------------------------------------------------------------------
// Everyone's balls, in the air or lying where they stopped.
const balls = new GolfBalls();
scene.add(balls.group);
/** Your closest shot to the pin so far (meters) and how many you've holed in one, kept in this browser. */
const GOLF_KEY = 'agent-office.golf';
function golfRecord(): { best: number | null; holes: number } {
  try {
    const r = JSON.parse(localStorage.getItem(GOLF_KEY) ?? '{}') as { best?: unknown; holes?: unknown };
    return { best: typeof r.best === 'number' ? r.best : null, holes: typeof r.holes === 'number' ? r.holes : 0 };
  } catch {
    return { best: null, holes: 0 };
  }
}
function saveGolfRecord(r: { best: number | null; holes: number }) {
  try {
    localStorage.setItem(GOLF_KEY, JSON.stringify(r));
  } catch {
    // private window: it's only for this visit then
  }
}
/** Until when (performance.now()) the tee has no ball on it: someone just hit it, and is teeing up the next. */
let teeEmptyUntil = 0;
/** A shot off the tee on this floor, by you or someone else: where it goes is worked out the same way everywhere. */
function shotHere(shot: Shot): Flight {
  return fly(shot, player.street, office.stack.state.index);
}
const golf = new Golfer(player, me, camera, {
  holding: (on) => net.send({ t: 'act', golf: on }),
  hit: (shot) => {
    net.send({ t: 'golf', ...shot });
    balls.launch(shotHere(shot), store.profile.name, true);
    sound.golf('hit');
  },
  ball: () => balls.mine,
  street: () => player.street,
  done: () => {
    // Not '': that reads as "no hint shown", and the golf hint would stay up.
    hintKey = 'stale';
  },
});
balls.onHit = (hit: Hit, mine: boolean) => {
  // Your own ball's heard wherever it lands (the camera's following it); anyone else's from where it is.
  const at = mine ? undefined : hit.at;
  if (hit.kind === 'cup') sound.golf('cup', at);
  else if (hit.kind === 'bounce') sound.golf(hit.lie === 'sand' || hit.lie === 'rough' ? 'thud' : 'bounce', at, hit.speed);
  else sound.golf(hit.kind, at, hit.speed);
};
balls.onRest = (f: Flight, who: string, mine: boolean) => {
  if (f.holed) {
    confetti.burst(GOLF_HOLE.x, player.street + 1.2, GOLF_HOLE.z, 260, 1.4);
    sound.golf('cheer');
  }
  if (!mine) {
    if (f.holed) toast(`🏆 ${who} got a hole in one!`);
    return;
  }
  const rec = golfRecord();
  if (f.holed) {
    rec.holes++;
    toast(rec.holes === 1 ? '🏆 HOLE IN ONE!' : `🏆 HOLE IN ONE! That's ${rec.holes}`);
  } else if (Number.isFinite(f.fromPin) && (rec.best === null || f.fromPin < rec.best)) {
    if (rec.best !== null) toast(`⛳ ${pinText(f.fromPin)} from the pin — your best yet!`);
    rec.best = f.fromPin;
  } else return;
  saveGolfRecord(rec);
};

/** Who's at the tee on this floor already, if anyone. */
function teeTaken(): string | null {
  for (const p of store.peers.values()) if (p.id !== store.you && p.golfing && store.onMyFloor(p)) return p.name;
  return null;
}

/** E at the tee: take a club out and step up to the ball. */
function teeOff() {
  if (golf.active || trip || climber.active) return;
  const other = teeTaken();
  if (other) return toast(`🏌️ ${other} is on the tee — wait your turn`, 'warn');
  if (carrying) return toast(`✋ Your hands are full: put #${carrying.issue} down first (Q)`, 'warn');
  if (player.seat) standUp();
  if (hanger.active) hanger.cancel();
  if (walkingTo) stopWalking();
  if (smokeBreakUntil) setSmoking(false);
  golf.start();
}

/** Someone else on the floor hit one: their swing, then their ball, off the same tee. */
function theirShot(id: string, shot: Shot) {
  const p = store.peers.get(id);
  if (!p || !store.onMyFloor(p) || upTop) return;
  remotes.get(id)?.person.golfSwing(shot.power);
  const floor = store.floor;
  setTimeout(() => {
    if (store.floor !== floor || upTop) return;
    balls.launch(shotHere(shot), p.name, false);
    teeEmptyUntil = performance.now() + 1800;
    sound.golf('hit', TEE_BALL);
  }, (BACKSWING_TIME + IMPACT) * 1000);
}
sky.onThunder = (delay, loud) => sound.thunder(delay, loud);
const hanger = new Hanger(net, camera, canvas, player, office, gallery);
scene.add(hanger.ghost.group);
hanger.onChange = () => {
  hud.refresh();
  // Not '': that reads as "no hint shown", and the hanging hint would stay up.
  hintKey = 'stale';
};

// ---- The ladder and the fire poles ----------------------------------------------------------------
/** The floors of the building from the bottom up (not the ones still being cloned: nobody can go there yet). */
function builtFloors(): FloorInfo[] {
  return store.floors.filter((f) => !f.cloning);
}
/** The floor above yours (1) or below it (-1), if there is one. */
function floorThere(way: Way): FloorInfo | undefined {
  const floors = builtFloors();
  const i = floors.findIndex((f) => f.id === store.floor);
  return i < 0 ? undefined : floors[i + way];
}
const climber = new Climber(player, {
  floorThere: (way) => floorThere(way)?.name,
  travel: (way, how, at) => {
    const f = floorThere(way);
    if (f) travel(f.id, how, at);
    else climber.abort();
  },
  sound: (kind, speed = 0) => {
    if (kind === 'grab') sound.rung(true);
    else if (kind === 'rung') sound.rung();
    else if (kind === 'slide') sound.slide();
    else if (kind === 'twirl') sound.twirl();
    else if (kind === 'bonk') {
      sound.bonk();
      toast(`🔝 ${store.currentFloor()?.name ?? 'This'} is the top floor — the hatch won't budge`);
    } else if (kind === 'land') {
      sound.poleLanding(speed);
      landed(speed);
    }
  },
  done: () => {
    // Not '': that reads as "no hint shown", and the climbing hint would stay up.
    hintKey = 'stale';
  },
});
/** How hard the view shakes from landing off a pole, easing off to 0. */
let thud = 0;
/** Down the pole onto the mat: the view shakes, dust flies, and there's the floor you're on now. */
function landed(speed: number) {
  if (!reduceMotion.matches) thud = Math.min(1, speed / 7);
  const at = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    at.set(player.pos.x + Math.sin(a) * 0.3, player.pos.y + 0.08, player.pos.z + Math.cos(a) * 0.3);
    smoke.exhale(at, dir.set(Math.sin(a), 0.15, Math.cos(a)).normalize());
  }
  const f = store.currentFloor();
  toast(`🚒 Wheee! Down to ${f?.name ?? 'the floor below'}`);
}
office.stack.onHatch = (where, open) => sound.hatch({ x: LADDER.x + 0.3, y: where === 'floor' ? 0 : WALL_HEIGHT, z: LADDER.z }, open);
// Speed lines round the edge of the screen, sliding down a pole.
const whoosh = h('div', { id: 'whoosh' });
$('app').append(whoosh);

/** E at the ladder: onto it, facing the wall. */
function grabLadder() {
  if (trip || climber.active) return;
  if (!floorThere(1) && !floorThere(-1)) return toast('No other floors yet — add a project in the elevator', 'warn');
  if (player.seat) standUp();
  if (hanger.active) hanger.cancel();
  if (walkingTo) stopWalking();
  climber.grabLadder();
}

/** E at a fire pole: down it, if there's a floor below; else (on the bottom floor) a spin round it. */
function usePole(i: number) {
  const spot = POLES[i];
  if (trip || climber.active || !spot) return;
  if (player.seat) standUp();
  if (hanger.active) hanger.cancel();
  if (walkingTo) stopWalking();
  if (office.stack.polesGoDown()) climber.slide(spot);
  else climber.twirl(spot);
}

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
  const s = office.stack.state;
  if (s.index === Math.max(0, index) && s.count === count && s.up === up && s.down === down) return;
  office.stack.set({ index: Math.max(0, index), count, up, down });
  office.setLevel(Math.max(0, index), count);
  player.street = streetBelow(index);
}
store.on('floors', syncStack);

function showMyProfile(p: Profile) {
  me.setColor(p.color);
  me.setLook(p.look);
  hands.setColor(p.color);
  hands.setSkin(me.skinColor);
}

interface RemotePeer {
  person: Person;
  target: THREE.Vector3;
  rotY: number;
  moving: boolean;
  label: string;
  look: PeerInfo['look'];
  bubble?: { sprite: THREE.Sprite; until: number };
  /** Seconds walked since their last footstep. */
  stepT: number;
  /** On the ladder or a pole, going by where they are. */
  grip: Grip | null;
}
const remotes = new Map<string, RemotePeer>();

interface WorkerView {
  model: Worker;
  laptop: Laptop;
  deskId: string;
  status: string;
  acked: boolean;
}
const workerViews = new Map<string, WorkerView>();
/** Workers a `worker.remove` is taking out of the store right now. They walk out of the building; a worker that's gone because you changed floors just vanishes. */
const sentHome = new Set<string>();
// Workers sent home, packing up and walking out with a box of their things.
const departures = new Departures(
  scene,
  (x, z, y) => groundAt(office.colliders, x, z, y),
  (x, y, z) => sound.stepAt(x, z, y),
  () => arrangeSeats(),
  () => office.stack.state.index > 0,
);
// Workers called to a meeting, walking in from the elevator to the meeting table.
const arrivals = new Arrivals(
  scene,
  (x, z, y) => groundAt(office.colliders, x, z, y),
  (x, y, z) => sound.stepAt(x, z, y),
);
/** Set while a floor's workers arrive with it (a welcome, an elevator ride): they're in their seats already. */
let seatedAlready = false;
let firstWelcome = true;
/** The server version this page was loaded with. */
let bootVersion = '';
let upgradePhase = '';

net.onStatus((up) => $('conn').classList.toggle('hidden', up));
net.onMessage((msg) => {
  if (msg.t === 'welcome') voice.reset();
  if (msg.t === 'welcome' || msg.t === 'floor.enter') {
    departures.clear();
    arrivals.clear();
    seatedAlready = true;
  }
  if (msg.t === 'worker.remove') sentHome.add(msg.workerId);
  store.apply(msg);
  seatedAlready = false;
  sentHome.clear();
  routeTerminalMessage(msg);
  routeChangesMessage(msg);
  routeTeamMessage(msg);
  routeAccountsMessage(msg);
  routePullMessage(msg);
  routeElevatorMessage(msg);
  routeWhiteboardMessage(msg, net);
  switch (msg.t) {
    case 'welcome': {
      // A few pings, to line this page's clock up with the office's for the jukebox.
      for (let i = 0; i < 5; i++) setTimeout(() => net.send({ t: 'ping', at: performance.now() }), 200 + i * 500);
      const mine = store.peers.get(store.you);
      if (firstWelcome && mine) {
        placeInCar(mine);
        firstWelcome = false;
        arrive();
      } else if (!store.floor) arrive();
      if (voice.inVoice || voice.sharing) net.send({ t: 'voice', voice: voice.inVoice, muted: voice.muted, sharing: voice.sharing });
      if (player.seat) net.send({ t: 'sit', seat: player.seat.key });
      if (carrying) net.send({ t: 'carry', issue: carrying.issue, title: carrying.title });
      if (shownDrink) net.send({ t: 'act', drink: shownDrink });
      if (golf.active) net.send({ t: 'act', golf: true });
      // The office let go of the ball for you while you were away.
      ballNews(false);
      // After a reconnect the server has forgotten which terminal we had open, and what we're doing.
      sendDoing(true);
      const openId = openTerminalFor();
      if (openId && store.workers.has(openId)) net.send({ t: 'worker.attach', workerId: openId });
      const watching = openChangesFor();
      if (watching && store.workers.has(watching)) net.send({ t: 'changes.watch', workerId: watching });
      renderProject();
      hud.refresh();
      // Back from a restart on another version: this page's code is stale, so load the new one.
      if (!bootVersion) bootVersion = msg.version;
      else if (msg.version !== bootVersion || restarting()) showUpgraded(msg.upgrade);
      upgradePhase = msg.upgrade.phase;
      voice.syncPeers();
      break;
    }
    case 'floor.enter':
      // Not a trip of yours: the floor you were on was taken off the building, and the elevator took you away.
      if (!trip) {
        closeAllModals();
        if (hanger.active) hanger.cancel();
        if (climber.active) climber.abort();
        if (walkingTo) stopWalking();
        placeInCar();
      }
      // The card belongs to the board downstairs (or up): the office already put it back there.
      if (carrying) {
        toast(`📌 #${carrying.issue} stayed behind on the other floor's board`);
        setCarrying(null);
      }
      // So does the ball: it's back under that floor's hoop.
      if (holdingBall()) toast('🏀 The ball stayed behind, back under the other floor’s hoop');
      ballNews(false);
      arrive();
      break;
    case 'ball':
      ballNews(true);
      break;
    case 'floors':
      noticeWaiting();
      break;
    case 'peer.join':
    case 'peer.leave':
      voice.syncPeers();
      break;
    case 'rtc':
      void voice.handleSignal(msg.from, msg.data as never);
      break;
    case 'worker.worktree':
      routeWorktreeMessage(msg);
      break;
    case 'toast':
      toast(msg.text, msg.level);
      break;
    case 'upgrade':
      if (msg.state.phase === 'restarting') showRestarting(msg.state, net);
      if (msg.state.phase === 'failed' && upgradePhase === 'building') toast(`The upgrade failed, so the office stays on ${msg.state.current?.sha ?? 'this version'}`, 'error');
      upgradePhase = msg.state.phase;
      break;
    case 'chat':
      sayBubble(msg.from, msg.text);
      break;
    case 'peer.act': {
      const r = remotes.get(msg.id);
      if (msg.drink !== undefined) {
        // A drink from the rooftop bar in their hand, or put down.
        const p = store.peers.get(msg.id);
        if (p) {
          if (msg.drink) p.drink = msg.drink;
          else delete p.drink;
        }
        if (msg.drink) r?.person.reach();
        r?.person.holdDrink(msg.drink ? (DRINK_BY_ID.get(msg.drink) ?? null) : null);
        break;
      }
      if (msg.golf !== undefined) {
        // A club out at the tee, or back in the bag.
        const p = store.peers.get(msg.id);
        if (p) {
          if (msg.golf) p.golfing = true;
          else delete p.golfing;
        }
        r?.person.setGolf(msg.golf);
        break;
      }
      if (msg.smoke === undefined) {
        r?.person.reach();
        break;
      }
      const p = store.peers.get(msg.id);
      if (p) p.smoking = msg.smoke;
      r?.person.setSmoking(msg.smoke);
      break;
    }
    case 'peer.emote':
      remotes.get(msg.id)?.person.emote(msg.emote);
      break;
    case 'golf':
      theirShot(msg.id, { yaw: msg.yaw, loft: msg.loft, power: msg.power });
      break;
    case 'gong':
      gongRang(msg.why, msg.pr);
      break;
    case 'horn':
      if (!upTop) break;
      sound.horn();
      if (msg.by !== store.profile.name) toast(`📯 ${msg.by} blew the air horn!`);
      break;
  }
});

function renderUpgrade() {
  const u = store.upgrade;
  const banner = $('upgrade-banner');
  banner.classList.toggle('hidden', u.phase !== 'building');
  banner.textContent = `🛠️ ${u.by ?? 'Someone'} is upgrading the office. It restarts on the new version in a minute or two.`;
}
store.on('upgrade', renderUpgrade);

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
    office.setProjectName(store.floors.length ? 'Pick a floor' : 'Lobby');
    return;
  }
  const n = store.floors.findIndex((f) => f.id === store.floor);
  $('project-meta').classList.remove('lobby');
  $('project-name').textContent = `🏢 ${p.name}`;
  $('project-meta').textContent = [n >= 0 && `🛗 floor ${n + 1} of ${store.floors.length}`, p.branch && `⎇ ${p.branch}`, p.dir, `default: ${providerLabel(p.defaultProvider, p)}`].filter(Boolean).join(' · ');
  office.setProjectName(p.name);
}
store.on('floors', renderProject);
store.on('project', renderProject);

/** The tab title counts the workers waiting on someone, on every floor, so you can see them from another tab. */
function renderTitle() {
  const name = store.project?.name;
  const elsewhere = store.floors.reduce((n, f) => n + (f.id === store.floor ? 0 : f.waiting), 0);
  const waiting = [...store.workers.values()].filter(waitingOnSomeone).length + elsewhere;
  document.title = `${waiting ? `(${waiting}) ` : ''}${name ? `${name} · ` : ''}Agent Office`;
}

// ---- Floors & the elevator ----------------------------------------------------------------------
/** In the car, facing out through the doors: where you are when you arrive on a floor. */
function placeInCar(at?: { x: number; z: number }) {
  // You arrive on your feet.
  if (player.seat) standUp();
  const spot = at && inElevator(at.x, at.z) ? at : { x: ELEVATOR.x, z: (ELEVATOR_CAR.minZ + ELEVATOR_CAR.maxZ) / 2 };
  player.pos.set(spot.x, 0, spot.z);
  player.vy = 0;
  player.facing = 0;
  player.camYaw = player.facing - Math.PI;
  player.lookPitch = -0.08;
}

function fade(on: boolean, quick = false) {
  $('fade').classList.toggle('quick', quick);
  $('fade').classList.toggle('on', on);
}

/** How you're going to another floor: by elevator, straight there from the floor list, or by the ladder or a pole. */
type TripKind = 'elevator' | 'switch' | Grip;
/** A trip under way: the lights are down (and by elevator the doors are shut) until the next floor arrives. */
let trip: { floor: string; how: TripKind; timer: number } | null = null;

function showElevator() {
  openElevator({ net, ride });
}

/** The elevator where you are: the office's, or the one up on the roof. */
function lift() {
  return upTop && roof ? roof.elevator : office.elevator;
}

/** Rides the elevator to another floor (or up to the roof). From outside the car, you step in while the lights are down. */
function ride(floorId: string) {
  if (trip || floorId === store.floor) return;
  closeAllModals();
  if (hanger.active) hanger.cancel();
  if (climber.active) climber.abort();
  if (golf.active) golf.stop();
  const inside = inElevator(player.pos.x, player.pos.z);
  trip = { floor: floorId, how: 'elevator', timer: window.setTimeout(tripFailed, 10_000) };
  player.enabled = false;
  player.clearKeys();
  lift().setOpen(false);
  // Wait for the doors to shut on you, then dim the lights and go.
  setTimeout(
    () => {
      fade(true);
      setTimeout(() => {
        placeInCar(inside ? player.pos : undefined);
        net.send({ t: 'floor.go', floor: floorId });
      }, 320);
    },
    inside ? 650 : 0,
  );
}

/** Where you are, to arrive at the same spot on floor `to`. Down on the street (or the steps to it), that's the street there too. */
function standingAt(to: string): Arrival {
  const floors = builtFloors();
  const from = floors.findIndex((f) => f.id === store.floor);
  const there = floors.findIndex((f) => f.id === to);
  const below = player.pos.y < -SLAB - 0.05 && from >= 0 && there >= 0;
  return { x: player.pos.x, y: below ? player.pos.y + (from - there) * STOREY : player.pos.y, z: player.pos.z, rotY: player.facing };
}

/** Straight to another floor from the floor list: a blink, and you're standing in the same spot there. */
function switchFloor(floorId: string) {
  // The roof isn't laid out like a floor: to and from it, it's the elevator.
  if (upTop || floorId === ROOF) return ride(floorId);
  if (trip || floorId === store.floor) return;
  closeAllModals();
  if (hanger.active) hanger.cancel();
  if (climber.active) climber.abort();
  if (golf.active) golf.stop();
  if (player.seat) standUp();
  // The floor list isn't a window, so nothing else stops a walk over to someone on this floor.
  if (walkingTo) stopWalking();
  trip = { floor: floorId, how: 'switch', timer: window.setTimeout(tripFailed, 10_000) };
  player.enabled = false;
  player.clearKeys();
  fade(true, true);
  setTimeout(() => net.send({ t: 'floor.go', floor: floorId, at: standingAt(floorId) }), 170);
}

/** Through the ceiling up the ladder, or through the floor down one: the lights dip as you pass. */
function travel(floorId: string, how: Grip, at: Arrival) {
  if (trip) return;
  trip = { floor: floorId, how, timer: window.setTimeout(tripFailed, 10_000) };
  fade(true, true);
  setTimeout(() => net.send({ t: 'floor.go', floor: floorId, at }), 170);
}

/** The floor never came (it's gone, or the office is unreachable): back where you were. */
function tripFailed() {
  const t = trip;
  if (!t) return;
  trip = null;
  fade(false);
  if (t.how === 'elevator') lift().setOpen(!!store.floor);
  if (t.how === 'ladder' || t.how === 'pole') climber.abort();
  player.enabled = !modalOpen();
}

/** Arrived in a spot that's a pole's hole on this floor: step out of it, the way in. */
function unstick() {
  if (!office.stack.polesGoDown()) return;
  const p = player.pos;
  const spot = office.stack.poles().find((s) => Math.max(Math.abs(p.x - s.x), Math.abs(p.z - s.z)) <= POLE.rail + 0.35);
  if (!spot) return;
  const out = POLE.rail + 0.7;
  p.set(spot.x + Math.sin(spot.open) * out, Math.max(0, p.y), spot.z + Math.cos(spot.open) * out);
}

/** Which of the floor palettes the walls are painted in now. */
let painted = -1;
function paintFloor() {
  const p = store.currentFloor()?.palette ?? 0;
  if (p === painted) return;
  painted = p;
  office.setLook(floorPalette(p));
}
// A brand-new floor can arrive before the elevator's list says what color it is.
store.on('floors', paintFloor);

/**
 * Up on the roof, or back down in the office: shows the one you're in, and walks, sounds, lights and
 * looks as it does there.
 */
function setPlace() {
  const up = store.floor === ROOF;
  if (up === upTop) return;
  upTop = up;
  const r = up ? theRoof() : roof;
  office.group.visible = !up;
  // The holiday decorations are dressed round the office and the street below it, not up here.
  holiday.group.visible = !up;
  if (r) r.group.visible = up;
  player.colliders = up ? r!.colliders : office.colliders;
  sky.setRoof(up, roofDrop(roofFloors()));
  sound.setOutdoors(up);
  sound.setDj(up ? djAt : null);
  // You can see the whole city from up there (and its clouds); from the top floors, as far as the haze.
  camera.far = up ? 700 : FAR;
  camera.updateProjectionMatrix();
  // Drinks stay at the bar (what you've had comes down with you).
  if (!up) booze.putDown();
  if (hanger.active) hanger.cancel();
  hintKey = 'stale';
}

/** What you can use where you are, and what's in the way of looking at it. */
function usable(): Interactable[][] {
  return upTop && roof ? [roof.interactables] : [office.interactables, gallery.interactables, dog.interactables, ball.interactables];
}

/** You're on a floor (or in the building without one): paint it, and open the doors (or carry on down the pole…). */
function arrive() {
  // The balls lying about were this floor's.
  balls.clear();
  setPlace();
  paintFloor();
  renderProject();
  noticeWaiting();
  syncStack();
  const how = trip?.how ?? 'elevator';
  if (trip) {
    clearTimeout(trip.timer);
    trip = null;
  }
  if (!store.floor) {
    // Nowhere to go yet: the doors stay shut until there's a floor, and the panel says how to add one.
    office.elevator.setOpen(false);
    fade(false);
    player.enabled = !modalOpen();
    showElevator();
    return;
  }
  fade(false);
  if (how !== 'elevator') {
    player.enabled = !modalOpen();
    if (how === 'switch') unstick();
    else climber.arrived();
    return;
  }
  setTimeout(() => {
    lift().setOpen(true);
    sound.ding('done');
    player.enabled = !modalOpen();
  }, 450);
}

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

// ---- Peers --------------------------------------------------------------------------------------
function syncPeers() {
  for (const [id, peer] of store.peers) {
    // Only who's on your floor is in the room with you.
    if (id === store.you || !store.onMyFloor(peer)) continue;
    let r = remotes.get(id);
    if (!r) {
      const person = new Person(peer.name, peer.color, peer.look);
      person.setCostume(store.theme.active);
      person.onSmoke = puff;
      person.root.position.set(peer.x, peer.y, peer.z);
      scene.add(person.root);
      noOutline(person.root);
      r = { person, target: new THREE.Vector3(peer.x, peer.y, peer.z), rotY: peer.rotY, moving: false, label: '', look: { ...peer.look }, stepT: 0, grip: null };
      remotes.set(id, r);
    }
    const label = `${peer.name}|${peer.voice ? (peer.muted ? 'm' : 'v') : '-'}|${peer.color}`;
    if (label !== r.label) {
      r.label = label;
      r.person.setLabel(peer.name, peer.voice ? peer.muted : null);
      r.person.setColor(peer.color);
      noOutline(r.person.root);
    }
    if (!sameLook(peer.look, r.look)) {
      r.look = { ...peer.look };
      r.person.setLook(peer.look);
      noOutline(r.person.root);
    }
    r.person.setSmoking(!!peer.smoking);
    r.person.setGolf(!!peer.golfing);
    r.person.holdDrink(peer.drink ? (DRINK_BY_ID.get(peer.drink) ?? null) : null);
    r.person.carry(peer.carrying);
    r.person.sit(peer.seat ? (seatAt(peer.seat)?.hips ?? null) : null);
    r.person.setDoing(whereabouts(peer));
  }
  for (const [id, r] of remotes) {
    const peer = store.peers.get(id);
    if (!peer || !store.onMyFloor(peer)) {
      scene.remove(r.person.root);
      remotes.delete(id);
    }
  }
  renderPeople(voice, editProfile, walkTo);
  refreshShares();
}
store.on('peers', syncPeers);

function sayBubble(from: string, text: string) {
  if (from === store.you) return;
  const r = remotes.get(from);
  if (!r) return;
  if (r.bubble) {
    r.person.root.remove(r.bubble.sprite);
    disposeSprite(r.bubble.sprite);
  }
  const sprite = textSprite(`💬 ${clip(text, 60)}`, { bg: '#ffffff', size: 34 });
  sprite.position.y = r.person.bubbleY;
  r.person.root.add(sprite);
  r.bubble = { sprite, until: performance.now() + 6000 };
}

// ---- Walking over to someone --------------------------------------------------------------------
/** Near enough to talk: where a walk over to someone ends. */
const NEAR_ENOUGH = 1.6;
/** Who you're on your way to (clicked in the sidebar), and when to look again at where they've got to. */
let walkingTo: { id: string; replanAt: number } | null = null;

/** Walks you over to a teammate, riding the elevator first if they're on another floor. A key of yours takes over. */
function walkTo(id: string) {
  const p = store.peers.get(id);
  if (!p || id === store.you) return;
  if (!store.onMyFloor(p) && !p.floor) return;
  if (player.seat) standUp();
  if (golf.active) golf.stop();
  walkingTo = { id, replanAt: 0 };
  if (store.onMyFloor(p)) toast(`🚶 Walking over to ${p.name}`);
  else {
    toast(`🛗 Taking the elevator to ${p.name}, on the ${store.floors.find((f) => f.id === p.floor)?.name ?? 'other'} floor`);
    ride(p.floor!);
  }
}

function stopWalking() {
  walkingTo = null;
  player.stopWalking();
}

/** Where they are, sitting or standing. */
function whereIs(p: PeerInfo): { x: number; y: number; z: number } {
  return (p.seat && seatAt(p.seat)) || p;
}

/** There: stop, and turn to them. */
function arrivedAt(at: { x: number; z: number }) {
  stopWalking();
  const yaw = Math.atan2(at.x - player.pos.x, at.z - player.pos.z);
  player.facing = yaw;
  player.camYaw = yaw - Math.PI;
}

/** Each frame: keep heading for them, looking again every so often in case they've moved on. */
function walkTick(now: number) {
  if (!walkingTo || trip || climber.active || !player.enabled) return;
  // Sitting down on the way is stopping there.
  if (player.seat) return stopWalking();
  const p = store.peers.get(walkingTo.id);
  if (!p || !store.onMyFloor(p)) {
    toast(p ? `${p.name} left the floor before you got there` : 'They left the office', 'warn');
    return stopWalking();
  }
  const at = whereIs(p);
  if (Math.hypot(at.x - player.pos.x, at.z - player.pos.z) < NEAR_ENOUGH && Math.abs(at.y - player.pos.y) < 1) return arrivedAt(at);
  if (now < walkingTo.replanAt) return;
  walkingTo.replanAt = now + 800;
  player.walkPath(wayTo(player.pos, at));
}

player.onPathEnd = (why) => {
  if (!walkingTo) return;
  if (why === 'cancelled') return void (walkingTo = null);
  const p = store.peers.get(walkingTo.id);
  if (!p) return stopWalking();
  const at = whereIs(p);
  // As near as the way goes (they're behind a desk, or on the couch): that'll do.
  if (Math.hypot(at.x - player.pos.x, at.z - player.pos.z) < 3) return arrivedAt(at);
  if (why === 'stuck') {
    toast(`🚧 Couldn't find a way over to ${p.name}`, 'warn');
    stopWalking();
  } else walkingTo.replanAt = 0;
};

// ---- Workers ------------------------------------------------------------------------------------
/** How close (meters) you stop a worker jumping, and how far you go before it starts again. */
const HOLD_NEAR = 4;
const HOLD_LEAVE = 5;

function syncWorkers() {
  for (const w of store.workers.values()) {
    let v = workerViews.get(w.id);
    const desk = office.desks.get(w.deskId);
    if (!desk) continue;
    if (!v) {
      departures.vacate(w.deskId);
      const model = new Worker(w.name, w.color);
      model.setCostume(store.theme.active);
      desk.seatAnchor.add(model.root);
      // Its globe floats beside the laptop (or the kiosk's counter), out from behind the card over
      // its head and the back of its chair, so it shows from across the room.
      const beside = desk.def.station ? new THREE.Vector3(0.62, 0.9, 0) : new THREE.Vector3(0.64, 0.5, -0.1);
      model.setPropSpot(model.root.worldToLocal(desk.laptopAnchor.localToWorld(beside)));
      // Called to a meeting just now: out of the elevator and over to the table, one after another.
      if (desk.def.room && !seatedAlready) arrivals.add(model, desk);
      const laptop = new Laptop();
      desk.laptopAnchor.add(laptop.root);
      noOutline(desk.group);
      desk.chair.rotation.y = 0;
      v = { model, laptop, deskId: w.deskId, status: '', acked: true };
      workerViews.set(w.id, v);
    }
    if (v.status !== w.status || v.acked !== w.acked) {
      // It just finished or started waiting on you (not already so when this page first saw it): ding, and notify if you're away.
      if (waitingOnSomeone(w) && v.status !== '' && w.status !== v.status) {
        sound.ding(w.status);
        notifier.alert(w);
        // Playing at the arcade: one of yours stops the game.
        if (w.status === 'needs_input' && yours(w)) cabinet.needsYou(w);
      }
      // Finished what it was on: a little spin and a puff of confetti.
      if (w.status === 'done' && (v.status === 'working' || v.status === 'needs_input')) {
        v.model.celebrate();
        burstOver(w.deskId, 40);
      }
      v.status = w.status;
      v.acked = w.acked;
      v.model.setStatus(w.status, waitingOnSomeone(w));
      noOutline(v.model.root);
    }
    v.model.setAction(w.action);
    v.model.setPr(workerPr(w, store.pulls.items, store.queue.tasks));
    const engineBadge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort) : undefined;
    v.model.setTask(meetingCard(w) ?? (w.task && w.kind === 'agent' ? { ...w.task, name: `${providerLabel(w.provider, store.project)}${engineBadge ? ` · ${engineBadge}` : ''} · ${w.task.name}` } : w.task));
    const deskDef = DESK_BY_ID.get(w.deskId);
    // Keys clack while it types, not while it reads, watches its tests or browses.
    if (deskDef) sound.setTyping(w.id, deskDef.x, deskDef.z, w.status === 'working' && (!w.action || w.action === 'edit'));
    const again = w.kind === 'shell' ? 'restart' : 'resume';
    v.laptop.setPlaceholder(w.status === 'offline' ? `💤 ${w.name} is asleep — press R to ${again}` : w.status === 'exited' ? `${w.name} exited` : 'booting…');
  }
  for (const [id, v] of workerViews) {
    if (store.workers.has(id)) continue;
    arrivals.forget(v.model);
    const desk = office.desks.get(v.deskId);
    // Sent home: it packs up and walks out, and the seat shows as free once it's up (see departures).
    if (desk && sentHome.has(id)) departures.add(v.model, v.laptop, desk);
    else {
      v.model.root.removeFromParent();
      v.laptop.root.removeFromParent();
      v.model.dispose();
      v.laptop.dispose();
    }
    sound.removeTypist(id);
    workerViews.delete(id);
  }
  arrangeSeats();
  renderWorkers((id) => openWorkerTerminal(id));
  renderWaiting();
  notifier.sync(store.workers);
  renderTitle();
}

/** Hired by you (at a desk, or through the queue), or last given something to do by you. */
function yours(w: WorkerInfo): boolean {
  const name = store.peers.get(store.you)?.name ?? store.profile.name;
  return w.createdBy === name || w.createdBy === `${name} (queue)` || w.lastInput?.by === name;
}

/**
 * The card over a worker at the meeting table: its role, the round, and whether it has the floor
 * (working on its part) or is listening while the others work on theirs.
 */
function meetingCard(w: WorkerInfo): WorkerTask | undefined {
  const m = store.meeting.current;
  if (!w.meeting || !m || m.id !== w.meeting) return undefined;
  const i = m.seats.findIndex((s) => s.workerId === w.id);
  if (i < 0) return undefined;
  const role = m.seats[i].role;
  const p = MEETING_PATTERNS[m.pattern];
  if (m.status !== 'running') return { name: `${role} · ${p.icon} ${p.label}`, summary: m.status === 'done' ? `✅ The meeting wrote ${m.output}` : `⛔ Stopped: ${m.reason ?? 'stopped'}` };
  const t = m.turns.find((x) => x.seat === i);
  if (!t || t.state === 'done') return { name: `👂 ${role} · round ${m.round} of ${m.rounds}`, summary: t ? 'Part written: listening' : 'Listening' };
  return { name: `💬 ${role} · round ${m.round} of ${m.rounds}`, summary: t.state === 'working' ? t.doing : `${t.doing} (up next)` };
}

/**
 * A seat or kiosk shows it's free (its '+', or the board agent waiting there) only while nobody's at
 * it, and once every desk is taken, bean bags come out for the workers who don't fit.
 */
function arrangeSeats() {
  // Someone sent home still counts until they get up, so a bean bag stays out under them.
  const free = vacantSeats(store.workers.values(), (id) => departures.seated(id));
  for (const [id, desk] of office.desks) desk.vacancy.visible = free.has(id);
  const appeared = office.setBeanbags(beanbagsOut((id) => !free.has(id)));
  // One came out right where you're standing (on the office floor, not down in the garage): you end up on top of it.
  const p = player.pos;
  for (const c of appeared) if (p.y > -0.1 && p.y < c.top && p.x > c.minX - 0.3 && p.x < c.maxX + 0.3 && p.z > c.minZ - 0.3 && p.z < c.maxZ + 0.3) p.y = c.top;
}
store.on('workers', syncWorkers);
// A worker at the meeting table shows its role and round over its head (see meetingCard).
store.on('meeting', syncWorkers);
// A worker's bubble shows whether it has a pull request open (green) or merged (purple: send it home).
const paintPrs = () => {
  for (const [id, v] of workerViews) {
    const w = store.workers.get(id);
    if (w) v.model.setPr(workerPr(w, store.pulls.items, store.queue.tasks));
  }
};
store.on('pulls', paintPrs);
store.on('queue', paintPrs);
store.on('workers', renderUsage);

/**
 * Dresses the building up for the holiday it's set to (⚙️ Settings), or takes it all down: the sky and
 * the decorations, the dog, your hands and your character, everyone else, and every worker.
 */
function dressUp() {
  const theme = store.theme.active;
  holiday.set(theme);
  sky.setTheme(theme);
  dog.setCostume(theme);
  hands.setCostume(theme);
  me.setCostume(theme);
  for (const r of remotes.values()) r.person.setCostume(theme);
  for (const v of workerViews.values()) v.model.setCostume(theme);
  for (const a of idleAgents) a.model.setCostume(theme);
}
store.on('theme', dressUp);
store.on('usage', renderUsage);
store.on('limits', renderLimits);
// The reset countdowns tick down between reads.
setInterval(renderLimits, 30_000);
$('limits').addEventListener('click', () => net.send({ t: 'limits.refresh' }));

// ---- Actions ------------------------------------------------------------------------------------
function freeDesk(): string | null {
  // Prefer the empty desk nearest to you; when they're all taken, the bean bag that's out.
  let best: string | null = null;
  let bestD = Infinity;
  for (const d of DESKS) {
    if (store.workerAtDesk(d.id)) continue;
    const dist = Math.hypot(d.x - player.pos.x, d.z - player.pos.z);
    if (dist < bestD) {
      bestD = dist;
      best = d.id;
    }
  }
  return best ?? nextFreeSeat((id) => !!store.workerAtDesk(id))?.id ?? null;
}

let askedToNotify = false;

/** The office is at its worker limit: says so, and says yes (the office would refuse the hire anyway). */
function officeIsFull(): boolean {
  const m = store.machine;
  if (!officeFull(m)) return false;
  toast(`🚫 The office is at its limit of ${m.limit} worker${m.limit === 1 ? '' : 's'} — send one home before hiring another`, 'warn');
  return true;
}

function hire(deskId: string, prompt?: string, worktree = false, provider?: AgentProvider, model?: string, effort?: AgentEffort, issue?: number) {
  net.send({ t: 'worker.spawn', deskId, prompt, worktree, provider, model, effort, issue });
  // The moment notifications start to matter: ask once (it has to come from a key press or click).
  if (settings.notify && notifyPermission() === 'default' && !askedToNotify) {
    askedToNotify = true;
    void askNotifyPermission();
  }
}

function openShell(deskId: string) {
  if (officeIsFull()) return;
  net.send({ t: 'worker.spawn', deskId, kind: 'shell' });
}

function promptAtDesk(deskId: string) {
  const w = store.workerAtDesk(deskId);
  const desk = DESK_BY_ID.get(deskId)!;
  if (!w) {
    if (officeIsFull()) return;
    openPrompt({
      title: `✨ New task at ${desk.label}`,
      subtitle: 'A fresh worker will sit down and start on this right away.',
      warning: pressureNote(store.machine),
      submitLabel: 'Hire & start',
      providerOption: true,
      worktreeOption: !!store.project?.branch,
      onSubmit: (text, o) => hire(deskId, text, o.worktree, o.provider, o.model, o.effort),
    });
  } else if (isAsleep(w.status)) {
    toast(`${w.name} is asleep — press R to resume first`, 'warn');
  } else if (w.kind === 'shell') {
    openPrompt({
      title: `🐚 Run in ${w.name}`,
      placeholder: 'npm run dev',
      submitLabel: 'Run ▶',
      onSubmit: (text) => net.send({ t: 'worker.prompt', workerId: w.id, prompt: text }),
    });
  } else {
    openPrompt({
      title: `💬 Prompt ${w.name}`,
      subtitle: w.status === 'working' ? `${w.name} is busy — your message will be queued in their input box.` : undefined,
      onSubmit: (text) => net.send({ t: 'worker.prompt', workerId: w.id, prompt: text }),
    });
  }
}

/** Direct hire from an empty desk, with an optional first prompt and provider choice. */
function hireAtDesk(deskId: string) {
  const desk = DESK_BY_ID.get(deskId)!;
  if (officeIsFull()) return;
  openPrompt({
    title: `✨ Hire a worker at ${desk.label}`,
    subtitle: 'You can start with an empty prompt and send work later.',
    warning: pressureNote(store.machine),
    placeholder: 'Optional first task…',
    submitLabel: 'Hire & start',
    allowEmpty: true,
    providerOption: true,
    worktreeOption: !!store.project?.branch,
    onSubmit: (text, o) => hire(deskId, text || undefined, o.worktree, o.provider, o.model, o.effort),
  });
}

function killWorker(id: string) {
  const w = store.workers.get(id);
  if (!w) return;
  const where = DESK_BY_ID.get(w.deskId)?.label ?? 'the desk';
  const session = w.kind === 'shell' ? 'shared shell' : `${providerLabel(w.provider, store.project)} session`;
  if (w.meeting) {
    // The meeting's worktree is the whole table's: it's tidied away once they've all gone.
    const m = store.meeting.current;
    const on = m?.id === w.meeting && m.status === 'running';
    confirmDialog(`Send ${w.name} home?`, on ? `${w.name} is in the meeting on “${m.title}”, which stops without it.` : `${w.name} leaves the meeting room.`, 'Send home', () => net.send({ t: 'worker.kill', workerId: id }));
    return;
  }
  if (w.worktree) {
    // A worker with its own worktree: choose what becomes of the worktree and its branch.
    sendHomeDialog({
      workerId: id,
      name: w.name,
      where,
      worktree: w.worktree,
      ask: () => net.send({ t: 'worker.worktree', workerId: id }),
      onConfirm: (cleanup) => net.send({ t: 'worker.kill', workerId: id, cleanup }),
    });
    return;
  }
  const body = DESK_BY_ID.get(w.deskId)?.station
    ? `This stops its ${session} for everyone, and it forgets what it was asked. The next prompt at the ${where} starts a fresh one.`
    : `This stops the ${session} at ${where} for everyone and frees the desk.`;
  confirmDialog(`Send ${w.name} home?`, body, 'Send home', () => net.send({ t: 'worker.kill', workerId: id }));
}

/** E at a board agent: type it a request. It's hired with it when nobody is there yet. */
function askStation(deskId: string) {
  const kind = DESK_BY_ID.get(deskId)?.station;
  if (!kind) return;
  const w = store.workerAtDesk(deskId);
  const name = STATION_AGENT[kind].name;
  const info = STATION_INFO[kind];
  // A prompt typed into a question it's asking would answer it.
  if (w?.status === 'needs_input') {
    toast(`The ${name} is waiting on an answer — here's its terminal`, 'warn');
    return openWorkerTerminal(w.id);
  }
  // Nobody there yet: asking hires the agent.
  if (!w && officeIsFull()) return;
  const subtitle = !w
    ? `${info.does}, in a terminal of my own: press O at the kiosk to watch.`
    : isAsleep(w.status)
      ? `The ${name} is asleep: this wakes it up, and it carries on where it left off.`
      : isBusy(w.status)
        ? `The ${name} is busy. Your prompt waits in its input box until it's done.`
        : undefined;
  openPrompt({
    title: `${info.icon} Ask the ${name}`,
    subtitle,
    placeholder: `e.g. ${info.example}`,
    submitLabel: 'Send ✨',
    warning: w ? undefined : pressureNote(store.machine),
    onSubmit: (text) => net.send({ t: 'station.prompt', deskId, prompt: text }),
  });
}

function resumeWorker(w: WorkerInfo) {
  if (!w.sessionId && w.kind !== 'shell') toast(`${w.name} has no saved Claude session — starting a fresh one`, 'warn');
  net.send({ t: 'worker.resume', workerId: w.id });
}

/** Whether a worker's branch can become a PR: it has its own worktree and isn't mid-turn. */
function prReady(w: WorkerInfo) {
  return !!w.worktree && !isBusy(w.status);
}

/** O at a desk: see the worker's pull request, or push its branch and open one. */
function pullRequestFor(w: WorkerInfo) {
  if (w.pr) {
    const it = store.pulls.items.find((p) => p.number === w.pr!.number);
    if (it) openPull(it, net, boardActions());
    else window.open(w.pr.url, '_blank', 'noopener');
    return;
  }
  if (!w.worktree) return toast(`${w.name} works in the main checkout — only workers with their own worktree can open a PR`, 'warn');
  if (w.prOpening) return;
  if (!prReady(w)) return toast(`${w.name} is still ${STATUS_LABEL[w.status]} — wait until it's done`, 'warn');
  toast(`Pushing ${w.worktree.branch} and opening a pull request…`);
  net.send({ t: 'worker.pr', workerId: w.id });
}

/** Puts you in front of a desk, looking at it: the PR board's "Go to desk". */
function goToDesk(deskId: string) {
  const desk = DESK_BY_ID.get(deskId);
  if (!desk) return;
  closeAllModals();
  standAt(desk);
  const w = store.workerAtDesk(deskId);
  toast(w ? `You're at ${desk.label}, ${w.name}'s desk` : `You're at ${desk.label}`);
}

/** Behind the worker, looking over their shoulder at the laptop (or in front of a board agent's kiosk). */
function standAt(desk: DeskDef) {
  if (player.seat) standUp();
  if (hanger.active) hanger.cancel();
  if (climber.active) climber.abort();
  if (golf.active) golf.stop();
  if (walkingTo) stopWalking();
  const spot = deskSeat(desk, desk.station ? -1.6 : desk.beanbag ? 1.6 : 2.4);
  player.pos.set(spot.x, 0, spot.z);
  player.vy = 0;
  player.facing = Math.atan2(desk.x - spot.x, desk.z - spot.z);
  player.camYaw = player.facing - Math.PI;
  player.lookPitch = -0.2;
}

// ---- Who's waiting on you: N, the count in the Workers panel, and the compass --------------------------
const nextUp = new NextUp();
const compass = new Compass($('compass'));
/** What the last press of N said, which the next press replaces. */
let nextToast: HTMLElement | null = null;

/** N: to the worker that has waited longest on someone, and on each press after, the next. */
function goToNextWaiting() {
  if (trip) return;
  const w = nextUp.next(store.workers.values(), waitingBeside());
  const desk = w && DESK_BY_ID.get(w.deskId);
  nextToast?.remove();
  if (!w || !desk) {
    const other = store.floors.find((f) => f.id !== store.floor && f.waiting > 0);
    nextToast = toast(other ? `🛗 Nobody's waiting on this floor. ${other.waiting} on the ${other.name} floor: take the elevator` : '👍 Nobody is waiting on you');
    return;
  }
  closeAllModals();
  standAt(desk);
  const waiting = waitingInOrder(store.workers.values());
  const of = waiting.length > 1 ? ` (${waiting.findIndex((x) => x.id === w.id) + 1} of ${waiting.length})` : '';
  nextToast = toast(`${w.status === 'needs_input' ? `🙋 ${w.name} needs input` : `✅ ${w.name} is done`}${of}. E opens its terminal`);
}

/** The waiting worker you're standing at, if any: N skips it while anyone else is waiting. */
function waitingBeside(): string | undefined {
  let best: string | undefined;
  let bestD = 2.5;
  for (const w of store.workers.values()) {
    const v = workerViews.get(w.id);
    if (!v || !waitingOnSomeone(w)) continue;
    const d = v.model.root.getWorldPosition(workerPos).distanceTo(player.pos);
    if (d < bestD) {
      bestD = d;
      best = w.id;
    }
  }
  return best;
}

function renderWaiting() {
  const waiting = waitingInOrder(store.workers.values());
  const el = $('waiting');
  el.classList.toggle('hidden', !waiting.length);
  el.classList.toggle('all-done', waiting.every((w) => w.status === 'done'));
  if (waiting.length) el.replaceChildren(h('span', {}, waitingLabel(waiting)), h('span.key', {}, 'N'));
}
$('waiting').addEventListener('click', () => goToNextWaiting());

const bearings: Bearing[] = [];
const heads: THREE.Vector3[] = [];
/** Arrows to the waiting workers you can't see from where you're looking. */
function pointToWaiting(now: number) {
  bearings.length = 0;
  if (!trip && !modalOpen()) {
    for (const w of store.workers.values()) {
      const v = workerViews.get(w.id);
      if (!v || !waitingOnSomeone(w)) continue;
      const at = v.model.root.getWorldPosition((heads[bearings.length] ??= new THREE.Vector3()));
      at.y += 1.2;
      bearings.push({ id: w.id, name: w.name, status: w.status, at });
    }
  }
  compass.update(camera, bearings, now);
}

/** Opening a sleeping worker's terminal wakes it, so there's nothing to press first. */
function openWorkerTerminal(id: string, find?: TerminalFind) {
  const w = store.workers.get(id);
  if (!w) return;
  if (isAsleep(w.status)) resumeWorker(w);
  openTerminal(net, id, () => openWorkerChanges(id), find);
}

/** 🔎 the chat and every terminal; a terminal line opens that terminal right at it. */
function showSearch() {
  openSearch(openWorkerTerminal);
}

/** What the worker changed: changed files, diff, commit / discard / open a PR. */
function openWorkerChanges(id: string) {
  if (!store.workers.has(id)) return;
  openChanges(net, id, () => openWorkerTerminal(id));
}

function showQueue() {
  openQueue(net, { openTerminal: openWorkerTerminal });
}

/** The meeting room's window: how the meeting's going, or the form to call one (prefilled from an issue or a PR). */
function showMeeting(preset?: MeetingPreset) {
  openMeeting(
    net,
    {
      openTerminal: openWorkerTerminal,
      openPr: (id) => {
        const w = store.workers.get(id);
        if (w) pullRequestFor(w);
      },
    },
    preset,
  );
}

function showJukebox() {
  openJukebox(net, showSettings);
}

/** A prompt from the boards goes to a new worker at a free desk, or to one already at a desk. */
function sendToWorker(title: string, text: { context?: string; initial?: string }) {
  const desk = freeDesk();
  const awake = [...store.workers.values()].filter((w) => w.kind === 'agent' && !isAsleep(w.status));
  if (!desk && !awake.length) {
    toast('Every desk and bean bag is taken — send a worker home first', 'warn');
    return;
  }
  openAsk({
    title,
    ...text,
    newDesk: desk ? DESK_BY_ID.get(desk)!.label : undefined,
    workers: awake.map((w) => ({ id: w.id, name: w.name, color: w.color, status: w.status })),
    worktreeOption: !!store.project?.branch,
    providerOption: true,
    onSubmit: (prompt, to, worktree, provider, model, effort) => {
      if (to) net.send({ t: 'worker.prompt', workerId: to, prompt });
      else if (desk) hire(desk, prompt, worktree, provider, model, effort);
    },
  });
}

function boardActions() {
  return {
    queue: (prompt: string, title: string, issue: number, provider?: AgentProvider, model?: string, effort?: AgentEffort) => net.send({ t: 'queue.add', prompt, title, issue, provider, model, effort }),
    assign: (prompt: string, title: string) => sendToWorker(`🤖 ${title}`, { initial: prompt }),
    ask: (context: string, title: string) => sendToWorker(`✍️ ${title}`, { context }),
    meeting: (preset: MeetingPreset) => showMeeting(preset),
    goToDesk,
    pickUp,
  };
}

function watchShare() {
  const streams = currentShares();
  if (!streams.length) {
    void toggleShare();
    return;
  }
  const video = h('video', { autoplay: true, playsinline: true, muted: true }) as HTMLVideoElement;
  // What's on the TV: someone else's screen before your own.
  const [who, stream] = streams.find(([name]) => name !== 'You') ?? streams[0];
  video.srcObject = stream;
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h('div.modal.viewer', { role: 'dialog', 'aria-label': 'Screen share' }, h('header', {}, h('h2', {}, `🖥️ ${who}'s screen`), close), video);
  const modal = openModal(el, { doing: `🖥️ watching ${who}'s screen`, onClose: () => (video.srcObject = null) });
  close.addEventListener('click', () => modal.close());
}

/** `note` is the issue note you're pointing at on the issues board, if any (see aimedNote). */
function interact(target: Interactable | null, key: DeskKey, note = aimedNote) {
  if (!target) return;
  if (target.kind !== 'issues') note = null;
  if (key === 'E' && carrying && dropCard(target, carrying, note)) return;
  if (target.kind === 'desk' && target.deskId) {
    const w = store.workerAtDesk(target.deskId);
    // Nobody is hired at the meeting table: a meeting seats its own workers there.
    if (!w && DESK_BY_ID.get(target.deskId)?.room) return key === 'E' ? showMeeting() : undefined;
    if (key === 'B' && !w) return openShell(target.deskId);
    if (key === 'P') return promptAtDesk(target.deskId);
    if (key === 'E') return w ? openWorkerTerminal(w.id) : hireAtDesk(target.deskId);
    if (key === 'C' && w) return openWorkerChanges(w.id);
    if (key === 'R' && w && isAsleep(w.status)) return resumeWorker(w);
    if (key === 'X' && w) return killWorker(w.id);
    if (key === 'O' && w) return pullRequestFor(w);
    return;
  }
  if (target.kind === 'station' && target.deskId) {
    const w = store.workerAtDesk(target.deskId);
    if (key === 'E' || key === 'P') return askStation(target.deskId);
    if (key === 'O' && w) return openWorkerTerminal(w.id);
    if (key === 'X' && w) return killWorker(w.id);
    return;
  }
  // A note on the issues board: E takes it straight off the cork, O opens it to read first.
  if (note && key === 'E') return pickUp(note);
  if (note && key === 'O') return openIssue(note, net, boardActions());
  if (key !== 'E') return;
  if (target.kind === 'elevator') showElevator();
  else if (target.kind === 'issues' || target.kind === 'pulls') openBoard(target.kind, net, boardActions());
  else if (target.kind === 'services') openServices();
  else if (target.kind === 'queue') showQueue();
  else if (target.kind === 'tv') watchShare();
  else if (target.kind === 'jukebox') showJukebox();
  else if (target.kind === 'decor' && target.decorId) hanger.view(target.decorId);
  else if (target.kind === 'seat' && target.seatId) useSeat(target.seatId);
  else if (target.kind === 'dog') net.send({ t: 'dog.pet' });
  else if (target.kind === 'coffee') drinkCoffee();
  else if (target.kind === 'smoke') {
    if (smokeBreakUntil) {
      setSmoking(false);
      toast('You stub it out in the ashtray');
    } else {
      setSmoking(true);
      toast('🚬 Smoke break');
    }
  } else if (target.kind === 'gong') hitGong();
  else if (target.kind === 'whiteboard') openWhiteboard(net);
  else if (target.kind === 'cabinet') cabinet.play();
  else if (target.kind === 'ladder') grabLadder();
  else if (target.kind === 'pole' && target.pole !== undefined) usePole(target.pole);
  else if (target.kind === 'meeting') showMeeting();
  else if (target.kind === 'bar') showBar();
  else if (target.kind === 'dj') blowHorn();
  else if (target.kind === 'golf') teeOff();
  else if (target.kind === 'ball') takeBall();
}

// ---- The rooftop bar ---------------------------------------------------------------------------------
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
  openBar({ cutOff: booze.cutOff(performance.now() / 1000), order: orderDrink });
}

/** The bartender comes over and pours it (a water, if you've had enough), and slides it across to you. */
function orderDrink(d: Drink) {
  const r = roof;
  if (!r || !upTop) return;
  const cut = d.strength > 0 && booze.cutOff(performance.now() / 1000);
  const drink = cut ? DRINK_BY_ID.get('water')! : d;
  r.serve(player.pos.z);
  sound.pour(r.pourAt);
  if (cut) toast("🙅 The bartender slides you a water instead: you've had enough", 'warn');
  setTimeout(() => {
    if (!upTop) return;
    booze.drink(drink, performance.now() / 1000);
    reach();
    if (player.view === 'first') hands.sip();
    if (!cut) toast(`${drink.emoji} ${drink.name}. ${CHEERS[drink.id] ?? 'Enjoy!'}`);
  }, 1500);
}

let lastHorn = 0;
/** E at the DJ booth: the air horn, for everyone on the roof. */
function blowHorn() {
  const now = performance.now();
  if (now - lastHorn < 1500) return;
  lastHorn = now;
  net.send({ t: 'horn' });
}

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
  player.drunk = reduceMotion.matches ? 0 : Math.min(1.3, amount);
  const glass = booze.holding(secs);
  me.holdDrink(glass);
  hands.holdDrink(glass);
  const id = glass?.id ?? null;
  if (id !== shownDrink) {
    shownDrink = id;
    net.send({ t: 'act', drink: id });
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
      sound.hiccup();
      if (!reduceMotion.matches) thud = Math.max(thud, 0.25);
    }
    nextHiccup = now + 5000 + Math.random() * 12000;
  }
  return amount;
}

/** A cup from the kitchen machine: a minute of quicker feet and higher jumps, and a mug in your hand. */
function drinkCoffee() {
  const jittery = caffeine.drink(performance.now() / 1000);
  sound.coffee();
  if (player.view === 'first') hands.sip();
  if (jittery) toast('☕ One cup too many… you’ve got the jitters!', 'warn');
  else if (caffeine.cups > 1) toast('☕ Another cup: back to a full minute of buzz');
  else toast('☕ Fresh coffee! A minute of quicker feet and higher jumps');
}

// ---- Smoke breaks ------------------------------------------------------------------------------------
/** When your smoke break ends by itself (performance.now()), or 0 when you're not on one. */
let smokeBreakUntil = 0;
const SMOKE_BREAK_MS = 90_000;

function setSmoking(on: boolean) {
  if (on === smokeBreakUntil > 0) return;
  smokeBreakUntil = on ? performance.now() + SMOKE_BREAK_MS : 0;
  me.setSmoking(on);
  hands.setSmoking(on);
  net.send({ t: 'act', smoke: on });
}

/** Out on the balcony (a little slack at the door), where smoking is allowed. */
function onBalcony(): boolean {
  const p = player.pos;
  return p.y > -0.5 && p.y < 2 && p.x > BALCONY.minX - 0.5 && p.x < BALCONY.maxX + 0.5 && p.z > BALCONY.minZ - 0.8 && p.z < BALCONY.maxZ + 0.5;
}

/** Ends the break when the cigarette burns down, or when you take it back inside. */
function checkSmokeBreak(now: number) {
  if (!smokeBreakUntil) return;
  if (!onBalcony()) {
    setSmoking(false);
    toast('🚭 No smoking inside, so you put it out');
  } else if (now > smokeBreakUntil) {
    setSmoking(false);
    toast("That one's done. Back to work!");
  }
}

// ---- The basketball --------------------------------------------------------------------------------
/** The floor's basketball, by the hoop on the west wall (see world/hoop.ts). */
const ball = new Basketball(() => office.colliders);
office.group.add(ball.group);
/**
 * Ball messages of yours the office hasn't answered yet (it answers every one): until it has, what
 * you did stands, so picking it up and shooting quickly doesn't snap it back into your hands.
 */
let ballPending = 0;
/** The office said where the ball is; `answer` when it's answering one of yours (it may be someone else's news). */
function ballNews(answer: boolean) {
  if (!answer) ballPending = 0;
  else if (ballPending > 0 && --ballPending > 0) return;
  ball.set(store.ball, performance.now());
  hintKey = '';
}
const holdingBall = () => ball.holder === store.you;
/** Baskets of yours in a row, and whether your last throw was a shot at the hoop (a miss of a pass or a drop doesn't count). */
let streak = 0;
let shooting = false;
/** When you started winding up a shot (performance.now()), or 0. */
let windFrom = 0;

/** E at the ball: it's yours, if nobody beats you to it. */
function takeBall() {
  if (carrying) return toast('🗂️ Your hands are full: put the card back first (Q)', 'warn');
  if (ball.holder) return;
  reach();
  sound.ball('bounce', ball.at, 1.5);
  ball.takeNow(store.you);
  ballPending++;
  net.send({ t: 'ball.take' });
  hintKey = '';
}

/** How a shot of yours goes from where you are: out of your hands, which way (a heading), how steep, and how hard it takes to sink it (null: you're not shooting at the hoop). */
function shotAim(): { from: THREE.Vector3; heading: number; pitch: number; ideal: number | null } {
  const rim = HOOP.rim;
  const first = player.view === 'first';
  // First person, the ball goes where you look; third, from over your head the way you face.
  const facing = first ? player.camYaw + Math.PI : player.facing;
  const from = first ? camera.position.clone() : new THREE.Vector3(player.pos.x, player.pos.y + 1.95, player.pos.z);
  from.x += Math.sin(facing) * 0.3;
  from.z += Math.cos(facing) * 0.3;
  const toRim = Math.atan2(rim.x - from.x, rim.z - from.z);
  const off = Math.abs(Math.atan2(Math.sin(toRim - facing), Math.cos(toRim - facing)));
  const far = Math.hypot(rim.x - from.x, rim.z - from.z);
  const atHoop = off < (first ? 0.35 : 0.6) && far < 16 && far > 0.4;
  if (first) {
    const look = throwPitch(player.lookPitch);
    const pitch = atHoop ? underCeiling(from, look) : look;
    return { from, heading: facing, pitch, ideal: atHoop ? idealSpeed(from, pitch) : null };
  }
  // Facing about the right way, your character squares up to the hoop.
  if (!atHoop) return { from, heading: facing, pitch: throwPitch(0.15), ideal: null };
  const pitch = underCeiling(from, throwPitch(lookAtRim(from)));
  return { from, heading: toRim, pitch, ideal: idealSpeed(from, pitch) };
}

/** Hold E (or the mouse) with the ball: the meter goes up and down until you let go. */
function windUp() {
  if (!holdingBall() || windFrom) return;
  windFrom = performance.now();
}

/** Let go: it flies as hard as the meter says (right in the green, it drops in). */
function letFly() {
  if (!windFrom) return;
  const power = meter((performance.now() - windFrom) / 1000);
  windFrom = 0;
  if (!holdingBall()) return;
  const a = shotAim();
  shooting = a.ideal !== null;
  release(a.from, a.heading, a.pitch, shooting ? shotSpeed(a.ideal!, power) : tossSpeed(power));
  if (player.view === 'first') hands.shoot();
  else me.shoot();
}

/** Q with the ball: it drops out of your hands in front of you. */
function dropBall() {
  if (!holdingBall()) return;
  windFrom = 0;
  const f = player.view === 'first' ? player.camYaw + Math.PI : player.facing;
  const from = handsOf(store.you, new THREE.Vector3()) ?? camera.localToWorld(new THREE.Vector3(0, -0.25, -0.45));
  shooting = false;
  release(from, f, 0, 0.25);
}

function release(from: THREE.Vector3, heading: number, pitch: number, speed: number) {
  const c = Math.cos(pitch);
  const s = { x: from.x, y: from.y, z: from.z, vx: Math.sin(heading) * c * speed, vy: Math.sin(pitch) * speed, vz: Math.cos(heading) * c * speed };
  ball.throwNow({ ...s, by: store.you }, performance.now());
  ballPending++;
  net.send({ t: 'ball.throw', ...s });
  hintKey = '';
}

/** Where the ball is in `id`'s hands, or null when you can't see it there (your own, in first person, is in your view instead). */
function handsOf(id: string, out: THREE.Vector3): THREE.Vector3 | null {
  const who = id === store.you ? (player.view === 'first' ? null : me) : (remotes.get(id)?.person ?? null);
  if (!who) return null;
  who.root.updateMatrixWorld();
  return who.root.localToWorld(out.copy(IN_HANDS));
}

ball.onHit = (hit, at) => {
  if (hit.kind === 'score') {
    office.hoop.swish();
    sound.ball('score', HOOP.rim, hit.speed);
  } else if (hit.speed > 0.6) sound.ball(hit.kind, at, hit.speed);
};
ball.onThrow = (by) => remotes.get(by)?.person.shoot();
ball.onMiss = (by) => {
  if (by === store.you && shooting) streak = 0;
};
ball.onBasket = (b) => {
  const mine = b.by === store.you;
  const points = b.three ? 3 : 2;
  const peer = store.peers.get(b.by);
  const how = b.swish ? 'SWISH! ' : b.bank ? 'BANK! ' : '';
  popScore(mine ? `${how}+${points}` : `${clip(peer?.name ?? 'Someone', 16)} ${how}+${points}`, mine ? store.profile.color : (peer?.color ?? '#ff6b1a'));
  if (mine) {
    streak++;
    const said = b.swish ? 'Swish!' : b.bank ? 'Off the glass!' : 'In off the rim!';
    toast(`🏀 ${said} +${points} from ${b.distance.toFixed(1)} m${streak > 1 ? ` · 🔥 ${streak} in a row` : ''}`);
  }
  if (b.three || (mine && streak >= 3)) confetti.burst(HOOP.rim.x + 0.3, HOOP.rim.y, HOOP.rim.z, 140, 0.7);
};

/** Points floating up off the hoop, and fading. */
const scorePops: { sprite: THREE.Sprite; t: number }[] = [];
function popScore(text: string, bg: string) {
  const sprite = textSprite(text, { bg, color: '#ffffff', size: 64, border: '#2b2d42' });
  sprite.position.set(HOOP.rim.x + 0.4, HOOP.rim.y + 0.9, HOOP.rim.z);
  office.group.add(sprite);
  scorePops.push({ sprite, t: 0 });
}
function updateScorePops(dt: number) {
  for (let i = scorePops.length - 1; i >= 0; i--) {
    const p = scorePops[i];
    p.t += dt;
    p.sprite.position.y = HOOP.rim.y + 0.9 + p.t * 0.45;
    p.sprite.material.opacity = Math.min(1, (2 - p.t) / 0.5);
    if (p.t < 2) continue;
    office.group.remove(p.sprite);
    disposeSprite(p.sprite);
    scorePops.splice(i, 1);
  }
}

/** Every frame: the ball flies on (or goes wherever whoever has it goes), and your hands and everyone's arms hold it. */
function updateBall(now: number, dt: number) {
  ball.update(now, handsOf);
  const mine = holdingBall();
  if (!mine) windFrom = 0;
  me.holdBall(mine);
  hands.holdBall(mine);
  hands.windUp(windFrom ? meter((now - windFrom) / 1000) : 0);
  for (const [id, r] of remotes) r.person.holdBall(ball.holder === id);
  updateScorePops(dt);
  renderShotMeter(now);
}

/** The wind-up meter over the hint, while you hold E: a green band where the shot drops in, when you're shooting at the hoop. */
let meterKey = '';
function renderShotMeter(now: number) {
  const on = windFrom > 0 && !modalOpen();
  const at = on ? meter((now - windFrom) / 1000) : 0;
  const sweet = on && shotAim().ideal !== null;
  const k = `${on}|${sweet}|${at.toFixed(3)}`;
  if (k === meterKey) return;
  meterKey = k;
  const el = $('shot-meter');
  el.classList.toggle('hidden', !on);
  el.classList.toggle('aimed', sweet);
  el.style.setProperty('--at', String(at));
  el.style.setProperty('--sweet', String(SWEET.at));
  el.style.setProperty('--width', String(SWEET.width));
}

/** With the ball in your hands: how to shoot, and how to put it down. */
function ballHint(): Hint {
  const first = player.view === 'first';
  return {
    k: `${streak}|${first}|${!!windFrom}`,
    parts: [
      h('span.title', {}, '🏀 Ball in hand'),
      streak > 1 ? aside(`🔥 ${streak} in a row`) : '',
      windFrom ? aside('let go in the green!') : key(first ? 'E / Click' : 'E', 'Hold to shoot'),
      key('Q', 'Drop it'),
    ],
  };
}

/** In first person, a ball at your feet is yours to pick up without looking right at it. */
function ballAtFeet(): Interactable | null {
  const it = ball.interactable;
  if (it.off) return null;
  const p = ball.at;
  return Math.hypot(p.x - player.pos.x, p.z - player.pos.z) < 1.1 && p.y - player.pos.y < 1.2 && p.y - player.pos.y > -0.5 ? it : null;
}

// ---- Carrying an issue card ------------------------------------------------------------------------
function setCarrying(card: CarriedIssue | null) {
  if ((card?.issue ?? 0) === (carrying?.issue ?? 0)) return;
  carrying = card;
  me.carry(card);
  hands.carry(card);
  net.send({ t: 'carry', issue: card?.issue, title: card?.title });
  carriedOff = [...offBoard()].join(',');
  renderIssuesBoard();
  hintKey = '';
}

/** ✋ in an issue's window, or E at its note on the board: its card comes off the board and into your hands. */
function pickUp(it: GhIssue) {
  closeAllModals();
  dropBall();
  if (carrying?.issue === it.number) return;
  if (carrying) toast(`📌 #${carrying.issue} went back on the board`);
  setCarrying({ issue: it.number, title: it.title });
  sound.paper();
  toast(`✋ You took #${it.number} off the board: take it to an empty desk, a worker or the 📋 queue and press E`);
}

/** Q, or E at the issues board: the card goes back where it came from. */
function putBack() {
  if (!carrying) return;
  toast(`📌 #${carrying.issue} is back on the board`);
  setCarrying(null);
  sound.paper();
}

/**
 * E with a card in your hands: an empty desk hires a worker for the issue (with the prompt 🤖 Hand
 * to a worker uses), an agent at a desk gets it as its next prompt, the queue board queues it, and
 * the issues board takes it back (or swaps it for the `note` you point at there). False when it's none
 * of those, so E does what it always does there.
 */
function dropCard(it: Interactable, card: CarriedIssue, note: GhIssue | null): boolean {
  if (it.kind === 'issues') {
    if (note) pickUp(note);
    else putBack();
    return true;
  }
  const prompt = issuePrompt({ number: card.issue, title: card.title });
  if (it.kind === 'queue') {
    if (onQueue(card.issue)) toast(`#${card.issue} is already on the queue`, 'warn');
    else {
      const { provider, model, effort } = officeChoice(store.project);
      net.send({ t: 'queue.add', prompt, title: `#${card.issue} ${card.title}`, issue: card.issue, provider, model, effort });
      putDown();
    }
    return true;
  }
  // At the meeting room: a meeting about it, and the card goes back up on the board.
  if (it.kind === 'meeting' || (it.kind === 'desk' && it.deskId && DESK_BY_ID.get(it.deskId)?.room && !store.workerAtDesk(it.deskId))) {
    putBack();
    showMeeting(issueMeeting(card.issue, card.title));
    return true;
  }
  if (it.kind !== 'desk' || !it.deskId) return false;
  const w = store.workerAtDesk(it.deskId);
  const why = w ? cantTakeCard(w) : hiringPaused() ? '💸 Budget spent — hiring resumes tomorrow' : '';
  if (why) toast(why, 'warn');
  else if (w) {
    net.send({ t: 'worker.prompt', workerId: w.id, prompt, issue: card.issue });
    putDown();
  } else if (!officeIsFull()) {
    const { provider, model, effort } = officeChoice(store.project);
    hire(it.deskId, prompt, !!store.project?.branch && worktreePref(), provider, model, effort, card.issue);
    putDown();
  }
  return true;
}

/** The card left your hands for a desk or the queue (the office says who took it). */
function putDown() {
  setCarrying(null);
  sound.paper();
}

function onQueue(issue: number): boolean {
  const t = store.taskForIssue(issue);
  return !!t && t.status !== 'done';
}

/** Why the worker at a desk can't be handed an issue card right now, or '' when it can. */
function cantTakeCard(w: WorkerInfo): string {
  if (w.kind === 'shell') return `${w.name} is a shell, not an agent`;
  if (isAsleep(w.status)) return `${w.name} is asleep — press R to resume first`;
  if (w.status === 'needs_input') return `${w.name} is waiting on an answer — open the terminal first`;
  return '';
}

// ---- Sitting ----------------------------------------------------------------------------------------
/** The free place on a seat nearest you, or null when everyone else on your floor has taken them all. */
function freePlace(seat: SeatDef): SeatPlace | null {
  const taken = new Set<string>();
  for (const p of store.peers.values()) if (p.seat && p.id !== store.you && store.onMyFloor(p)) taken.add(p.seat);
  let best: SeatPlace | null = null;
  let bestD = Infinity;
  for (let i = 0; i < seat.places.length; i++) {
    const place = seatPlace(seat, i);
    const d = Math.hypot(place.x - player.pos.x, place.z - player.pos.z);
    if (!taken.has(place.key) && d < bestD) {
      best = place;
      bestD = d;
    }
  }
  return best;
}

/** Someone else's screen is up on the TV. */
function tvShowing(): boolean {
  return currentShares().some(([who]) => who !== 'You');
}

/** E at a seat: sit down on it. Sitting there already, get up, or on the couch facing the TV, watch it. */
function useSeat(seatId: string) {
  const seat = SEATING_BY_ID.get(seatId);
  if (!seat) return;
  if (player.seat?.seatId === seatId) {
    if (seat.tv && tvShowing()) watchShare();
    else if (seat.game) arcade.play();
    else if (seat.bar) showBar();
    else standUp();
    return;
  }
  const place = freePlace(seat);
  if (!place) {
    toast(`No room on that ${seat.label.replace(/^\S+ /, '').toLowerCase()} right now`, 'warn');
    return;
  }
  player.sit(place);
  me.sit(place.hips);
  net.send({ t: 'sit', seat: place.key });
  // The couch in front of the TV is where you watch whoever's sharing.
  if (seat.tv && tvShowing()) watchShare();
}

function standUp() {
  player.stand();
  gotUp();
}

/** On your feet again, by E or by walking off. */
function gotUp() {
  me.sit(null);
  net.send({ t: 'sit' });
}
player.onStand = gotUp;

/** What you're sitting on, so it's what E is about unless you're looking at something else. */
function mySeat(): Interactable | null {
  const id = player.seat?.seatId;
  return (id && usable()[0].find((it) => it.kind === 'seat' && it.seatId === id)) || null;
}

// ---- The gong -------------------------------------------------------------------------------------
let lastHit = 0;
/** E at the gong. The office rings it for everyone on the floor, you included (see gongRang). */
function hitGong() {
  const now = performance.now();
  if (now - lastHit < 500) return;
  lastHit = now;
  net.send({ t: 'gong' });
}

/** Where confetti comes from over a desk: above the worker's head. */
function burstOver(deskId: string, n: number) {
  const d = DESK_BY_ID.get(deskId);
  if (d) confetti.burst(d.x, 2.3, d.z, n);
}

/** Where a worker at `desk` climbs up to dance, in the frame of whatever it sits or stands in. */
function stageOf(desk: DeskView, model: Worker): Stage {
  const seat = model.root.parent!;
  seat.updateWorldMatrix(true, false);
  desk.stage.updateWorldMatrix(true, false);
  const m = seat.matrixWorld.clone().invert().multiply(desk.stage.matrixWorld);
  const pos = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  m.decompose(pos, turn, new THREE.Vector3());
  const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(turn);
  return { pos, yaw: Math.atan2(ahead.x, ahead.z) };
}

/** A pull request merged: every worker awake on the floor gets up on its desk and dances. */
function danceParty() {
  for (const [id, v] of workerViews) {
    const desk = office.desks.get(v.deskId);
    if (desk && !isAsleep(store.workers.get(id)?.status ?? 'offline')) v.model.dance(stageOf(desk, v.model));
  }
  // The board agents still waiting to be asked, too.
  for (const a of idleAgents) if (a.view.vacancy.visible) a.model.dance(stageOf(a.view, a.model));
}

/** Where confetti rains from downstairs over (x, z): the ceiling, or under the loft, the underside of its floor. */
function ceilingOver(x: number, z: number): number {
  const loft = x > LOFT.minX && x < LOFT.maxX && z > LOFT.minZ && z < LOFT.maxZ;
  return loft ? LOFT.y - 0.35 : WALL_HEIGHT - 0.1;
}
/** Confetti a square meter of floor gets when a pull request merges. */
const CONFETTI_DENSITY = 3.5;
const floorArea = (a: Area) => (a.maxX - a.minX) * (a.maxZ - a.minZ);

/** Someone hit the gong, a pull request merged (a dance party under a confetti rain), or the queue emptied (a party). */
function gongRang(why: GongWhy, pr?: number) {
  office.gong.strike(why === 'hit' ? 0.7 : 1);
  sound.gong(why);
  const top = office.gong.top;
  if (why === 'merged') {
    // Confetti rains down all over the floor, and pops over the desk the PR came from while its worker's still there.
    confetti.rain(FLOOR, floorArea(FLOOR) * CONFETTI_DENSITY, 3, ceilingOver);
    confetti.rain(LOFT, floorArea(LOFT) * CONFETTI_DENSITY, 3, () => LOFT.y + LOFT.height - 0.1);
    const it = store.pulls.items.find((p) => p.number === pr);
    const w = pr === undefined ? undefined : workerForPull(store.workers.values(), it ?? { number: pr, headRefName: '' });
    if (w && workerViews.has(w.id)) burstOver(w.deskId, 220);
    else confetti.burst(top.x, top.y, top.z, 220);
    danceParty();
  } else if (why === 'queue') {
    // Three strokes (sound.gong plays them): a burst at the gong, then every desk, then a cannon.
    confetti.burst(top.x, top.y, top.z, 160);
    setTimeout(() => {
      office.gong.strike(0.85);
      for (const [id, v] of workerViews) {
        burstOver(v.deskId, 120);
        if (!isAsleep(store.workers.get(id)?.status ?? 'offline')) v.model.cheer(4);
      }
    }, 850);
    setTimeout(() => {
      office.gong.strike(1.2);
      confetti.burst(top.x, top.y, top.z, 450, 1.5);
    }, 1700);
  }
}

// ---- Interaction targeting & hint -----------------------------------------------------------------
let target: Interactable | null = null;
let hintKey = '';

function pickTarget(): Interactable | null {
  // Everything you can use is upstairs; down on the street you're under it all.
  if (player.pos.y < -SLAB - 1) return null;
  let best: Interactable | null = null;
  let bestD = Infinity;
  for (const list of usable()) {
    for (const it of list) {
      if (it.off) continue;
      // Up on the loft, or down underneath it.
      if (Math.abs((it.y ?? 0) - player.pos.y) > 1.5) continue;
      const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z);
      if (d < it.radius && d < bestD) {
        best = it;
        bestD = d;
      }
    }
  }
  return best;
}

function key(k: string, label: string) {
  return h('span', {}, h('span.key', {}, k), label);
}

/** Secondary text in the hint bar. */
function aside(text: string) {
  return h('span', { style: 'opacity:.75;font-weight:600' }, text);
}

interface Hint {
  /** Changes whenever the hint needs redrawing. */
  k: string;
  parts: (HTMLElement | string)[];
}

function renderHint() {
  const el = $('hint');
  if (hanger.active && !modalOpen()) return renderHangHint(el);
  if (climber.active && !modalOpen()) return renderClimbHint(el);
  if (golf.active && !modalOpen()) return renderGolfHint(el);
  const withBall = holdingBall();
  if ((!target && !carrying && !withBall) || modalOpen()) {
    if (hintKey) {
      el.classList.add('hidden');
      hintKey = '';
    }
    return;
  }
  const hint = withBall ? ballHint() : carrying ? carryHint(carrying, target) : hintFor(target!);
  const k = `${withBall ? 'ball!' : `${target?.kind}${target?.deskId ?? ''}`}|${carrying?.issue ?? ''}|${hint.k}`;
  if (k === hintKey) return;
  hintKey = k;
  el.replaceChildren(...hint.parts);
  el.classList.remove('hidden');
}

/** What the hint bar says about the thing you're facing. */
function hintFor(it: Interactable): Hint {
  const title = (text: string) => h('span.title', {}, text);
  const board = (name: string): Hint => ({ k: '', parts: [title(name), key('E', 'Open')] });
  switch (it.kind) {
    case 'desk':
      return it.deskId ? deskHint(it.deskId) : { k: '', parts: [] };
    case 'station':
      return it.deskId ? stationHint(it.deskId) : { k: '', parts: [] };
    case 'issues':
      if (aimedNote) return { k: String(aimedNote.number), parts: [title(clip(`📌 #${aimedNote.number} ${aimedNote.title}`, 60)), key('E', 'Take it'), key('O', 'Read it')] };
      return issuesTex.hasNotes ? { k: 'notes', parts: [title('📌 Issues board'), key('E', 'Open'), aside('or point at a note to take it')] } : board('📌 Issues board');
    case 'pulls':
      return board('🔀 Pull request board');
    case 'services':
      return board('🌐 Services board');
    case 'queue': {
      const n = store.queue.tasks.filter((t) => t.status !== 'done').length;
      return { k: String(n), parts: [title(`📋 Task queue${n ? ` · ${n}` : ''}`), key('E', 'Open')] };
    }
    case 'tv': {
      const any = currentShares().length > 0;
      return { k: String(any), parts: [title('📺 Office TV'), key('E', any ? 'Watch full screen' : 'Share your screen')] };
    }
    case 'coffee': {
      const buzzed = caffeine.buzzed(performance.now() / 1000);
      return { k: String(buzzed), parts: [title('☕ Coffee machine'), key('E', buzzed ? 'Another cup' : 'Grab a cup')] };
    }
    case 'smoke':
      return { k: String(smokeBreakUntil > 0), parts: [title('🚬 Ashtray'), key('E', smokeBreakUntil ? 'Stub it out' : 'Take a smoke break')] };
    case 'gong':
      return { k: '', parts: [title('🎉 Merge gong'), aside('rings when a PR merges'), key('E', 'Bang it')] };
    case 'golf': {
      const other = teeTaken();
      if (other) return { k: `taken|${other}`, parts: [title('⛳ Golf tee'), aside(`🏌️ ${clip(other, 24)} is teeing off`)] };
      const { best, holes } = golfRecord();
      const about = [holes ? `🏆 ${holes} hole${holes === 1 ? '' : 's'} in one` : '', best !== null ? `your best ${pinText(best)} from the pin` : `the pin's ${Math.round(PIN_DISTANCE)} m out`].filter(Boolean).join(' · ');
      return { k: about, parts: [title('⛳ Golf tee'), aside(about), key('E', 'Tee off')] };
    }
    case 'jukebox': {
      const j = store.jukebox;
      const what = j.on ? trackTitle(j) : '';
      return { k: `${j.on}|${what}`, parts: [title('🎵 Jukebox'), aside(j.on ? `♪ ${clip(what, 40)}` : 'off'), key('E', j.on ? 'Change the song' : 'Put on a song')] };
    }
    case 'cabinet': {
      const c = store.cabinet;
      const f = store.cabinetFrame;
      if (c.player && c.player.id !== store.you) {
        const who = c.player.name;
        return { k: `${who}|${f?.score}`, parts: [title('🕹️ Arcade'), aside(`▶ ${clip(who, 24)} is playing${f ? ` · ${scoreText(f.score)}` : ''}`), key('E', 'Watch')] };
      }
      const left = cabinet.leftAt;
      const best = c.scores[0];
      const about = left !== null ? `your game's paused at ${scoreText(left)}` : best ? `🏆 ${clip(best.name, 24)} · ${scoreText(best.score)}` : 'no high score yet';
      return { k: `${left}|${best?.name}|${best?.score}`, parts: [title(`🕹️ ${GAME}`), aside(about), key('E', left !== null ? 'Carry on' : 'Play')] };
    }
    case 'whiteboard': {
      const names = store.drawing.flatMap((id) => (id === store.you ? [] : (store.peers.get(id)?.name ?? []))).join(', ');
      return { k: names, parts: [title('📝 Whiteboard'), aside(names ? `✏️ ${clip(names, 40)} drawing` : 'draw together, live'), key('E', names ? 'Join in' : 'Draw')] };
    }
    case 'meeting': {
      const m = store.meeting.current;
      const p = m && MEETING_PATTERNS[m.pattern];
      const what = !m || !p ? 'free' : m.status === 'running' ? `${p.icon} ${p.label} · ${meetingStage(m)}` : `${p.icon} ${p.label} ${m.status === 'done' ? 'done ✅' : 'stopped ⛔'}`;
      return { k: what, parts: [title('🤝 Meeting room'), aside(clip(what, 50)), key('E', m?.status === 'running' ? 'See how it’s going' : m ? 'See it / call a meeting' : 'Call a meeting')] };
    }
    case 'elevator': {
      const f = store.currentFloor();
      const n = store.floors.length;
      return { k: `${f?.name}|${n}`, parts: [title('🛗 Elevator'), f ? aside(`${f.name} · ${n} floor${n === 1 ? '' : 's'}`) : '', key('E', n > 1 ? 'Choose a floor' : 'Floors & projects')] };
    }
    case 'decor': {
      const d = store.decor.find((x) => x.id === it.decorId);
      return { k: `${d?.title}|${d?.by}`, parts: [title(`🖼️ ${d?.title || 'A picture'}`), d ? aside(`hung by ${d.by}`) : '', key('E', 'Look closer')] };
    }
    case 'seat': {
      const seat = SEATING_BY_ID.get(it.seatId ?? '');
      if (!seat) return { k: '', parts: [] };
      if (player.seat?.seatId === seat.id) {
        const tv = !!seat.tv && tvShowing();
        const use = tv ? 'Watch the TV' : seat.game ? 'Play Minesweeper' : seat.bar ? 'Order a drink' : '';
        return { k: `${seat.id}|sitting|${tv}`, parts: [title(seat.label), aside('sitting'), ...(use ? [key('E', use), key('W A S D', 'Get up')] : [key('E', 'Get up')])] };
      }
      const full = !freePlace(seat);
      return { k: `${seat.id}|${full}`, parts: [title(seat.label), seat.game ? aside('💣 Minesweeper on the monitor') : '', full ? aside('no room') : key('E', 'Sit down')] };
    }
    case 'ladder': {
      const up = floorThere(1)?.name;
      const down = floorThere(-1)?.name;
      const where = [up && `⬆ ${up}`, down && `⬇ ${down}`].filter(Boolean).join(' · ');
      return { k: where, parts: [title('🪜 Ladder'), aside(where || 'no other floors yet'), key('E', 'Climb on')] };
    }
    case 'pole': {
      if (office.stack.polesGoDown()) {
        const down = floorThere(-1)?.name ?? 'the floor below';
        return { k: `down|${down}`, parts: [title('🚒 Fire pole'), aside(`down to ${down}`), key('E', 'Slide down!')] };
      }
      const up = floorThere(1)?.name ?? 'upstairs';
      return { k: `landing|${up}`, parts: [title('🚒 Fire pole'), aside(`comes down from ${up}`), key('E', 'Twirl')] };
    }
    case 'bar': {
      const cut = booze.cutOff(performance.now() / 1000);
      return { k: String(cut), parts: [title('🍸 Sky Bar'), aside(cut ? "you've had enough" : 'drinks on the house'), key('E', cut ? 'Ask for water' : 'Order a drink')] };
    }
    case 'dj': {
      const f = djFrame(djAt());
      const what = f.part === 'drop' ? '🔥 the drop' : f.part === 'build' ? 'building up…' : f.part === 'breakdown' ? 'the breakdown' : 'mixing in the next track';
      return { k: what, parts: [title('🎧 DJ Merge Conflict'), aside(`drum & bass · ${what}`), key('E', '📯 Air horn!')] };
    }
    case 'ball':
      return { k: String(ball.still), parts: [title('🏀 Basketball'), ball.still ? aside('shoot some hoops') : '', key('E', ball.still ? 'Pick it up' : 'Catch it!')] };
    case 'dog': {
      const doing = dog.doing(
        (id) => store.workers.get(id)?.name,
        (id) => (id === store.you ? 'you' : store.peers.get(id)?.name),
      );
      return { k: `${dog.name}|${doing}`, parts: [title(`🐶 ${dog.name}`), doing ? aside(doing) : '', key('E', 'Pet')] };
    }
  }
}

/** With an issue card in your hands: what E does with it here, and how to put it back. */
function carryHint(card: CarriedIssue, it: Interactable | null): Hint {
  const parts = (...mid: (HTMLElement | string)[]) => [h('span.title', {}, `🗂️ #${card.issue} in hand`), ...mid, key('Q', 'Put it back')];
  if (it?.kind === 'issues') return aimedNote ? { k: String(aimedNote.number), parts: parts(key('E', `Swap it for #${aimedNote.number}`)) } : { k: '', parts: parts(key('E', 'Pin it back up')) };
  if (it?.kind === 'ball') return { k: 'ball', parts: parts(aside('🏀 hands full')) };
  if (it?.kind === 'queue') {
    const on = onQueue(card.issue);
    return { k: String(on), parts: parts(on ? aside('already on the queue') : key('E', 'Put it on the queue')) };
  }
  if (it?.kind === 'meeting' || (it?.kind === 'desk' && it.deskId && DESK_BY_ID.get(it.deskId)?.room && !store.workerAtDesk(it.deskId))) {
    return { k: 'meeting', parts: parts(key('E', 'Call a meeting about it')) };
  }
  if (it?.kind === 'desk' && it.deskId) {
    const w = store.workerAtDesk(it.deskId);
    if (!w) {
      const paused = hiringPaused();
      return { k: String(paused), parts: parts(paused ? h('span.cost', {}, '💸 Budget spent — hiring resumes tomorrow') : key('E', 'Hire a worker for it')) };
    }
    const why = cantTakeCard(w);
    return { k: w.id + w.status + why, parts: parts(why ? aside(why) : key('E', `Hand it to ${w.name}`)) };
  }
  // Anything else works as usual, card in hand.
  if (it) {
    const rest = hintFor(it);
    return { k: rest.k, parts: parts(...rest.parts) };
  }
  return { k: '', parts: parts(aside('take it to an empty desk, a worker or the 📋 queue')) };
}

function deskHint(deskId: string): Hint {
  const w = store.workerAtDesk(deskId);
  if (!w && DESK_BY_ID.get(deskId)?.room) return { k: 'room', parts: [h('span.title', {}, `🤝 ${DESK_BY_ID.get(deskId)!.label} · free`), key('E', 'Call a meeting')] };
  if (!w) {
    const paused = hiringPaused();
    const m = store.machine;
    const full = officeFull(m);
    return {
      k: `${paused}|${full}|${m.workers}|${m.limit}|${!!m.pressure}`,
      parts: [
        h('span.title', {}, `${DESK_BY_ID.get(deskId)!.label} · empty`),
        ...(full
          ? [h('span.cost', {}, `🚫 Office full · ${m.workers} of ${m.limit} workers`)]
          : [
              m.pressure ? h('span.cost', { title: `This machine is under pressure: ${m.pressure}` }, '⚠️ Machine under pressure') : '',
              ...(paused ? [h('span.cost', {}, '💸 Budget spent — hiring resumes tomorrow')] : [key('E', 'Hire a worker'), key('P', 'Hire with a task')]),
              key('B', 'Shell'),
            ]),
      ],
    };
  }
  const doing = w.activity ? clip(w.activity, 48) : '';
  const workerProvider = w.kind === 'agent' ? resolvedProvider(w.provider, store.project) : undefined;
  const spent = w.kind === 'agent' && w.usage ? usageLabel(w.usage, workerProvider) : '';
  const shell = w.kind === 'shell';
  return {
    k: w.status + w.id + (w.pr?.number ?? '') + (w.prOpening ? '!' : '') + doing + spent,
    parts: [
      h('span.title', {}, `${w.name} · ${STATUS_LABEL[w.status]}`),
      doing ? aside(doing) : '',
      spent ? h('span.cost', { title: usageTitle(w.usage!, workerProvider) }, spent) : '',
      key('E', 'Open terminal'),
      key('C', 'Changes'),
      isAsleep(w.status) ? key('R', shell ? 'Restart' : 'Resume') : key('P', shell ? 'Run command' : 'Prompt'),
      w.pr ? key('O', `PR #${w.pr.number}`) : w.prOpening ? aside('⏳ Opening PR…') : prReady(w) ? key('O', 'Open PR') : '',
      key('X', 'Send home'),
    ],
  };
}

function stationHint(deskId: string): Hint {
  const kind = DESK_BY_ID.get(deskId)?.station;
  if (!kind) return { k: '', parts: [] };
  const w = store.workerAtDesk(deskId);
  const info = STATION_INFO[kind];
  if (!w) {
    const m = store.machine;
    const full = officeFull(m);
    return {
      k: `${full}|${m.workers}|${m.limit}`,
      parts: [
        h('span.title', {}, `${info.icon} ${STATION_AGENT[kind].name}`),
        aside(info.offer.replace(/^Ask me /, '')),
        full ? h('span.cost', {}, `🚫 Office full · ${m.workers} of ${m.limit} workers`) : key('E', 'Prompt'),
      ],
    };
  }
  const doing = w.activity ? clip(w.activity, 48) : '';
  const provider = resolvedProvider(w.provider, store.project);
  const spent = w.usage ? usageLabel(w.usage, provider) : '';
  return {
    k: w.status + w.id + doing + spent,
    parts: [
      h('span.title', {}, `${info.icon} ${w.name} · ${STATUS_LABEL[w.status]}`),
      doing ? aside(doing) : '',
      spent ? h('span.cost', { title: usageTitle(w.usage!, provider) }, spent) : '',
      key('E', isAsleep(w.status) ? 'Wake with a prompt' : 'Prompt'),
      key('O', 'Terminal'),
      key('X', 'Send home'),
    ],
  };
}

/** On the ladder: which way it goes from here, and how to get off. Down a pole: just hold on. */
function renderClimbHint(el: HTMLElement) {
  const title = (text: string) => h('span.title', {}, text);
  const l = climber.ladder;
  let k: string;
  let parts: (HTMLElement | string)[];
  if (l) {
    const up = floorThere(1)?.name;
    const down = floorThere(-1)?.name;
    const atFloor = l.y < 0.4 && l.y > -0.05;
    const busy = l.waiting || l.auto;
    k = `ladder|${up}|${down}|${atFloor}|${busy}`;
    parts = busy
      ? [title('🪜 Climbing…')]
      : [title('🪜 On the ladder'), up ? key('W', `Up to ${up}`) : aside('top floor'), key('S', down ? `Down to ${down}` : atFloor ? 'Step off' : 'Down'), key('E', atFloor ? 'Step off' : 'Let go')];
  } else {
    const how = climber.sliding;
    k = `pole|${how}`;
    parts = [title(how === 'twirl' ? '🚒 Wheee!' : '🚒 Wheeeeeee!')];
  }
  if (k === hintKey) return;
  hintKey = k;
  el.replaceChildren(...parts);
  el.classList.remove('hidden');
}

/** At the golf tee: how to aim and swing, or how to get back to it while the ball's out there. */
function renderGolfHint(el: HTMLElement) {
  const title = (text: string) => h('span.title', {}, text);
  const stage = golf.doing;
  const k = `golf|${stage}`;
  if (k === hintKey) return;
  hintKey = k;
  const parts =
    stage === 'watch'
      ? [title('⛳ Fore!'), key('Space', 'Back to the tee'), key('E', 'Done')]
      : stage === 'charge' || stage === 'swing'
        ? [title('⛳ Let go to hit it'), aside('the fuller the meter, the further it goes')]
        : [key('Space', 'Hold to swing'), key('A D', 'Aim'), key('W S', 'Loft'), key('E', 'Done')];
  el.replaceChildren(...parts);
  el.classList.remove('hidden');
}

function renderHangHint(el: HTMLElement) {
  const spot = hanger.spot;
  const k = `hang|${hanger.moving}|${spot ? spot.ok : '-'}`;
  if (k === hintKey) return;
  hintKey = k;
  const title = !spot ? '🖼️ Aim at a wall' : !spot.ok ? "🚫 Something's in the way" : hanger.moving ? '🖼️ Moving a picture' : '🖼️ Hanging a picture';
  el.replaceChildren(h('span.title', {}, title), key('Click', 'Hang'), key('Scroll', 'Size'), key('Esc', 'Cancel'));
  el.classList.remove('hidden');
}

let crossKey = '';
const finePointer = window.matchMedia('(pointer: fine)').matches;
function renderCrosshair() {
  const show = player.view === 'first' && !modalOpen() && !golf.active;
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

// ---- Reaching out ---------------------------------------------------------------------------------
let lastActSent = 0;
/** Plays the reach on your hands and your character, and shows it to everyone else. */
function reach() {
  if (player.view === 'first') hands.reach();
  me.reach();
  const now = performance.now();
  if (now - lastActSent > 120) {
    lastActSent = now;
    net.send({ t: 'act' });
  }
}

// ---- Emotes ---------------------------------------------------------------------------------------
/** The same limit the server keeps, so an emote you see yourself do is one everyone else sees too. */
const emoteLimit = new EmoteBucket();
let emoteWarnedAt = 0;
/** Plays an emote on your character and your hands, and shows it to everyone else on the floor. */
function emote(id: EmoteId) {
  const now = performance.now();
  if (!emoteLimit.take(now)) {
    if (now - emoteWarnedAt > 3000) {
      emoteWarnedAt = now;
      toast('Easy there, one emote at a time', 'warn');
    }
    return;
  }
  me.emote(id);
  hands.emote(id);
  if (player.view === 'first') popEmoji(id);
  net.send({ t: 'emote', emote: id });
}
const emoteWheel = new EmoteWheel(emote, (open) => (player.mouseLook = !open));
$('hud').append(emoteWheel.el);

/** In first person you can't see the emoji over your head, so it pops up on the screen instead. */
function popEmoji(id: EmoteId) {
  const e = EMOTE_BY_ID.get(id)!;
  document.querySelector('.emote-pop')?.remove();
  const el = h('div.emote-pop', { style: `--secs:${e.seconds}s`, 'aria-hidden': 'true' }, e.emoji);
  el.addEventListener('animationend', () => el.remove());
  $('hud').append(el);
}

/** G opens the emote wheel (hold it and point, or tap it and click); 1–6 play one straight away. */
function emoteKey(e: KeyboardEvent): boolean {
  if (e.code === 'KeyG') {
    if (!e.repeat) emoteWheel.press();
    return true;
  }
  if (e.code === 'Escape' && emoteWheel.isOpen) {
    emoteWheel.close();
    return true;
  }
  const n = /^(?:Digit|Numpad)([1-6])$/.exec(e.code);
  if (!n) return false;
  emoteWheel.close();
  emote(EMOTES[Number(n[1]) - 1].id);
  return true;
}

/** Keys that use what you're facing: at a desk, each does something else (see interact). */
const DESK_KEYS = { KeyE: 'E', KeyP: 'P', KeyR: 'R', KeyX: 'X', KeyB: 'B', KeyC: 'C', KeyO: 'O' } as const;
type DeskKey = (typeof DESK_KEYS)[keyof typeof DESK_KEYS];

function use(it: Interactable | null, key: DeskKey, note = aimedNote) {
  if (!it) return;
  reach();
  interact(it, key, note);
}

// ---- Input ----------------------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (modalOpen() || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (relookOnKey && e.key !== 'Escape' && player.canLock) player.lock();
  if (hanger.active && hangingKey(e.code)) {
    e.preventDefault();
    return;
  }
  // On the ladder, E gets you off it (and nothing else is in reach); W, S and Space climb.
  if (climber.active && (e.code === 'KeyE' || e.code === 'KeyF' || e.code in DESK_KEYS)) {
    if (e.code === 'KeyE') climber.letGo();
    return;
  }
  // At the golf tee, E puts the club back (Space swings, see Golfer); nothing else is in reach, and no emotes mid-swing.
  if (golf.active && (e.code === 'KeyF' || e.code === 'KeyG' || e.code in DESK_KEYS || /^(?:Digit|Numpad)[1-6]$/.test(e.code))) {
    if (e.code === 'KeyE') golf.stop();
    return;
  }
  // With the ball in your hands, E winds up a shot (let go to shoot) and Q drops it.
  if (holdingBall() && (e.code === 'KeyE' || e.code === 'KeyQ')) {
    if (e.repeat) return;
    if (e.code === 'KeyE') windUp();
    else dropBall();
    return;
  }
  if (emoteKey(e)) return;
  if (officeKey(e)) player.clearKeys();
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyG') emoteWheel.release();
  if (e.code === 'KeyE') letFly();
});
window.addEventListener('blur', () => (windFrom = 0));
// First person with the mouse captured, the button winds up a shot like E does (see player.onClick).
window.addEventListener('pointerup', (e) => {
  if (e.button === 0 && windFrom && player.locked) letFly();
});
// Letting go of V mutes you again, wherever the key comes up: a window or a terminal opened meanwhile,
// or another app (the browser never says the key came up there).
window.addEventListener('keyup', (e) => e.code === 'KeyV' && voice.stopTalking(), true);
window.addEventListener('blur', () => voice.stopTalking());

/** The office's own keys; false for any other key, which is left to walking and the browser. */
function officeKey(e: KeyboardEvent): boolean {
  const deskKey = DESK_KEYS[e.code as keyof typeof DESK_KEYS];
  if (deskKey) {
    // P opens a text box, which the key mustn't land in.
    if (deskKey === 'P') e.preventDefault();
    use(target, deskKey);
    return true;
  }
  switch (e.code) {
    case 'KeyT':
    case 'Enter':
      e.preventDefault();
      // With the chat turned off, it shows while you type.
      $('chat').classList.add('peek');
      $('chat-input').focus();
      return true;
    case 'Tab':
      e.preventDefault();
      hud.toggleMenu();
      return true;
    case 'KeyV':
      // Joins voice; in it, it's push to talk (let go and you're muted, above).
      if (e.repeat) return true;
      if (voice.inVoice) voice.startTalking();
      else void joinVoice();
      return true;
    case 'KeyM':
      voice.toggleMute();
      return true;
    case 'KeyH':
      openHelp();
      return true;
    case 'KeyF':
      startHanging();
      return true;
    case 'KeyN':
      goToNextWaiting();
      return true;
    case 'KeyQ':
      if (!carrying) return false;
      reach();
      putBack();
      return true;
  }
  // By the character, so it's / on any keyboard layout. The search box opens without it.
  if (e.key === '/') {
    e.preventDefault();
    showSearch();
    return true;
  }
  return false;
}

/** Keys while hanging a picture. Walking, chat and voice work as usual. */
function hangingKey(code: string): boolean {
  switch (code) {
    case 'Escape':
    case 'KeyF':
      hanger.cancel();
      return true;
    case 'KeyE':
    case 'Enter':
      reach();
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

/** What you last told the office you have open (see PeerInfo.doing). */
let doingSent: string | undefined;
/** Tells everyone what you have open now, for the line under your name tag. A reconnected office has forgotten. */
function sendDoing(reconnected = false) {
  if (reconnected) doingSent = undefined;
  let what = doingNow();
  // The office keeps 60 UTF-16 units of it: cut it short here instead, between whole characters.
  if (what && what.length > 60) {
    let cut = '';
    for (const ch of what) {
      if (cut.length + ch.length >= 60) break;
      cut += ch;
    }
    what = `${cut}…`;
  }
  if (what === doingSent) return;
  doingSent = what;
  net.send({ t: 'doing', what });
}

/**
 * Set when closing the last window may not have given you the mouse back, so the next key you press
 * takes it instead (a key counts for the browser, where the Esc that closed the window doesn't).
 */
let relookOnKey = false;
onModalChange((open) => {
  player.enabled = !open;
  player.clearKeys();
  sendDoing();
  // Opening something on the way over to someone is stopping there.
  if (open && walkingTo && !trip) stopWalking();
  if (open) {
    windFrom = 0;
    emoteWheel.close();
    // A phone has no mouse to take back afterwards.
    if (finePointer) player.yieldMouse();
    else player.unlock();
    $('hint').classList.add('hidden');
  } else {
    // A tick later, so closing one window to open the next (Settings → character) doesn't grab the mouse in between.
    setTimeout(backToGame, 0);
  }
  hintKey = '';
});

/** Once the last window is closed, the game has the keyboard again and, in first person, the mouse. */
function backToGame() {
  if (modalOpen()) return;
  if (!isTyping()) canvas.focus({ preventScroll: true });
  if (!player.canLock || player.hasMouse) return;
  // The browser lets a page re-capture the mouse it let go of itself (see yieldMouse), even on Esc
  // (which it doesn't count as a click or key), and any time after a click, like one on ✕. When it
  // won't (nothing of yours opened the window, or a stricter browser), the next key you press does.
  player.lock();
  relookOnKey = true;
}
document.addEventListener('pointerlockchange', () => {
  if (player.locked) relookOnKey = false;
});

// ---- Clicking the world: use what's under the crosshair (first person) or the mouse (third) ----------
const raycaster = new THREE.Raycaster();
const CROSSHAIR = new THREE.Vector2(0, 0);
/** How close (meters from your eyes) you must be to use each kind of thing. */
const REACH: Record<InteractKind, number> = { desk: 4.5, station: 4.5, coffee: 3, issues: 9, pulls: 9, services: 9, queue: 9, tv: 10, decor: 9, smoke: 3, elevator: 4.5, gong: 3.5, dog: 3.2, jukebox: 4, seat: 3, whiteboard: 7, cabinet: 4, ladder: 3, pole: 4, meeting: 7, bar: 3.5, dj: 6, golf: 3.5, ball: 3.2 };
const eye = new THREE.Vector3();

/** What the ray through `ndc` lands on first, whether it is within reach (plus `slack` meters), and where it hit. */
function aimedAt(ndc: THREE.Vector2, slack = 0): { it: Interactable; near: boolean; hit: THREE.Intersection } | null {
  raycaster.setFromCamera(ndc, camera);
  eye.set(player.pos.x, player.pos.y + EYE_HEIGHT, player.pos.z);
  for (const hit of raycaster.intersectObjects(upTop && roof ? roof.pickables : [office.group, dog.root], true)) {
    let it: Interactable | undefined;
    let shown = true;
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
      if (!o.visible) shown = false;
      it ??= o.userData.interact as Interactable | undefined;
    }
    if (!shown) continue;
    if (!it) return null; // a wall, the floor, a plant… is in the way
    return { it, near: hit.point.distanceTo(eye) <= REACH[it.kind] + slack, hit };
  }
  return null;
}

/** The issue whose note on the issues board an aim lands on, or null (bare cork, the frame, anything else). */
function noteUnder(aim: { it: Interactable; hit: THREE.Intersection } | null): GhIssue | null {
  if (aim?.it.kind !== 'issues' || aim.hit.object !== office.boardMeshes.issues || !aim.hit.uv) return null;
  const n = issuesTex.noteAt(aim.hit.uv);
  return n === undefined ? null : (store.issues.items.find((i) => i.number === n) ?? null);
}

/** The note on the issues board under the crosshair (or, in third person, the mouse), which E takes. */
let aimedNote: GhIssue | null = null;
/** Where the mouse is over the scene, for pointing at notes in third person; null when it's off it. */
let pointer: THREE.Vector2 | null = null;
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect();
  (pointer ??= new THREE.Vector2()).set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
});
canvas.addEventListener('pointerleave', () => (pointer = null));

player.onClick = (ndc) => {
  // At the tee, a click is you steadying the mouse to aim: nothing else is in reach.
  if (modalOpen() || golf.active) return;
  if (emoteWheel.isOpen) return emoteWheel.click();
  // The ball in your hands: press to wind up, let go (or click again, with no mouse captured) to shoot.
  if (holdingBall()) {
    if (windFrom && !player.locked) letFly();
    else windUp();
    return;
  }
  if (hanger.active) {
    reach();
    hanger.place(ndc);
    return;
  }
  if (player.view === 'first') {
    // Reach out even at nothing, like poking the air.
    reach();
    if (target) interact(target, 'E');
    return;
  }
  const aim = aimedAt(ndc, 2.5);
  if (!aim) return;
  if (!aim.near) {
    toast('Walk closer to that first');
    return;
  }
  use(aim.it, 'E', noteUnder(aim));
};

// Chat
const chatInput = $('chat-input') as HTMLInputElement;
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    if (text) net.send({ t: 'chat', text });
    chatInput.value = '';
    chatInput.blur();
    e.preventDefault();
  } else if (e.key === 'Escape') chatInput.blur();
  e.stopPropagation();
});
chatInput.addEventListener('blur', () => $('chat').classList.remove('peek'));
store.on('chat', renderChat);

// ---- Voice & screen share ---------------------------------------------------------------------------
async function toggleVoice() {
  if (voice.inVoice) voice.leaveVoice();
  else await joinVoice();
}

async function joinVoice() {
  const err = await voice.joinVoice(settings.pushToTalk);
  if (err) toast(err, 'warn');
  else if (settings.pushToTalk && voice.inVoice) toast('🎙️ In voice, muted: hold V to talk');
}

async function toggleShare() {
  if (voice.sharing) voice.stopShare();
  else {
    const err = await voice.startShare();
    if (err) toast(err, 'warn');
  }
}

function currentShares(): [string, MediaStream][] {
  const out: [string, MediaStream][] = [];
  const local = voice.localScreen;
  if (local) out.push(['You', local]);
  for (const [id, s] of voice.remoteScreens()) {
    const peer = store.peers.get(id);
    // A screen shared on another floor is on that floor's TV.
    if (peer && !store.onMyFloor(peer)) continue;
    out.push([peer?.name ?? 'Someone', s]);
  }
  return out;
}

let tvStream: MediaStream | null = null;
function refreshShares() {
  const shares = currentShares();
  // Remote shares win the TV; your own share is what others see anyway.
  const pick = shares.find(([who]) => who !== 'You') ?? shares[0];
  const stream = pick?.[1] ?? null;
  if (stream !== tvStream) {
    tvStream = stream;
    tvVideo.srcObject = stream;
    if (stream) void tvVideo.play().catch(() => {});
    tvMat.map = stream ? tvTexture : tvIdle;
    tvMat.needsUpdate = true;
  }
  const box = $('shares');
  box.replaceChildren(
    ...shares
      .filter(([who]) => who !== 'You')
      .map(([who, s]) => {
        const v = h('video', { autoplay: true, playsinline: true, muted: true }) as HTMLVideoElement;
        v.srcObject = s;
        return h('div.share-thumb', { onclick: () => watchShare(), title: 'Watch full screen' }, v, h('span.who', {}, `🖥️ ${who}`));
      }),
  );
  hintKey = '';
}

voice.onChange(() => {
  hud.refresh();
  refreshShares();
});

// Buttons must not keep focus, or Space (jump) would click them again.
$('hud').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (btn) setTimeout(() => btn.blur(), 0);
});
// The project in the corner is the floor you're on; click it for the list of floors to go to.
$('project').addEventListener('click', () => {
  if (!store.floor) return showElevator();
  toggleFloorMenu($('project'), { go: switchFloor, elevator: showElevator, roof: () => ride(ROOF) });
});

// ---- The HUD: a few buttons on the top bar, everything else in the ☰ menu ----------------------------
const waitingNow = () => waitingInOrder(store.workers.values());
const noMedia = () => (window.isSecureContext ? undefined : 'Voice and screen sharing need HTTPS or localhost — use a TLS proxy, --self-signed, or an SSH tunnel');
const hud = mountHud(
  [
    { id: 'issues', icon: '📌', label: 'Issues', section: 'Open', count: () => store.issues.items.filter((i) => i.state === 'OPEN').length, run: () => openBoard('issues', net, boardActions()) },
    { id: 'pulls', icon: '🔀', label: 'Pull requests', section: 'Open', count: () => store.pulls.items.filter((p) => p.state === 'OPEN').length, run: () => openBoard('pulls', net, boardActions()) },
    { id: 'queue', icon: '📋', label: 'Task queue', section: 'Open', count: () => store.queue.tasks.filter((t) => t.status !== 'done').length, title: () => 'Issues and tasks waiting for a worker', run: showQueue },
    { id: 'services', icon: '🌐', label: 'Services', section: 'Open', count: () => store.services.items.length, title: () => 'Web servers the workers are running', run: () => openServices() },
    { id: 'whiteboard', icon: '📝', label: 'Whiteboard', section: 'Open', title: () => 'Draw together, live', run: () => openWhiteboard(net) },
    // Up on the top bar while a meeting is on: what's being worked through in the meeting room.
    {
      id: 'meeting',
      icon: '🤝',
      label: 'Meeting room',
      section: 'Open',
      status: () => store.meeting.current?.status === 'running',
      chip: () => 'In a meeting',
      title: () => 'Call a meeting: workers work through a question or a task together',
      run: () => showMeeting(),
    },
    { id: 'search', icon: '🔎', label: 'Search', section: 'Open', key: '/', title: () => 'Search the chat and every terminal', run: showSearch },
    { id: 'elevator', icon: '🛗', label: 'Elevator', section: 'Open', count: () => store.floors.reduce((n, f) => n + (f.id === store.floor ? 0 : f.waiting), 0), title: () => 'Ride to another project', run: showElevator },
    { id: 'roof', icon: '🍸', label: 'Rooftop bar', section: 'Open', shown: () => !upTop && builtFloors().length > 0, title: () => 'Ride the elevator up to the roof: a DJ, drinks and the city', run: () => ride(ROOF) },
    // In voice, V is push to talk, so leaving is only from here.
    { id: 'voice', icon: '🎙️', label: () => (voice.inVoice ? 'Leave voice' : 'Join voice'), section: 'Together', key: () => (voice.inVoice ? undefined : 'V'), on: () => voice.inVoice, blocked: noMedia, run: () => void toggleVoice() },
    // While you're in voice, the top bar keeps the mute button handy. Muted is the usual with push to talk, so it doesn't stand out then.
    {
      id: 'mute',
      icon: () => (voice.muted ? '🔇' : '🎙️'),
      label: () => (voice.muted ? 'Unmute' : 'Mute'),
      section: 'Together',
      key: 'M',
      shown: () => voice.inVoice,
      status: () => voice.inVoice,
      on: () => voice.inVoice,
      tone: () => (voice.muted && !settings.pushToTalk ? 'danger' : undefined),
      title: () => (voice.muted ? 'Muted: hold V to talk, or M to unmute' : 'Mute (M) · hold V to talk'),
      run: () => voice.toggleMute(),
    },
    { id: 'share', icon: '🖥️', label: () => (voice.sharing ? 'Stop sharing' : 'Share screen'), section: 'Together', on: () => voice.sharing, status: () => voice.sharing, chip: () => 'Sharing', blocked: noMedia, run: () => void toggleShare() },
    { id: 'decor', icon: '🖼️', label: () => (hanger.active ? 'Stop hanging the picture' : 'Hang a picture'), section: 'Together', key: 'F', on: () => hanger.active, status: () => hanger.active, run: () => (hanger.active ? hanger.cancel() : startHanging()) },
    { id: 'team', icon: '👥', label: 'Invite teammates', section: 'Together', shown: () => store.invites, run: () => openTeam(net) },
    { id: 'accounts', icon: '🔑', label: 'Accounts', section: 'Together', shown: () => store.me.admin, title: () => 'Invite people, see who has an account, revoke them', run: () => openAccounts(net) },
    { id: 'settings', icon: '⚙️', label: 'Settings', section: 'Office', run: showSettings },
    { id: 'help', icon: '❓', label: 'Controls', section: 'Office', key: 'H', run: openHelp },
    {
      id: 'upgrade',
      icon: '⬆️',
      label: () => (store.upgrade.phase === 'building' ? 'Upgrading…' : store.upgrade.latest ? 'Update the office' : 'Upgrade the office'),
      section: 'Office',
      shown: () => store.upgrade.available,
      // A new version, or one being built, gets a place on the top bar until it's in.
      status: () => !!store.upgrade.latest || store.upgrade.phase === 'building',
      chip: () => (store.upgrade.phase === 'building' ? 'Upgrading…' : 'Update'),
      tone: () => (store.upgrade.latest && store.upgrade.phase !== 'building' ? 'primary' : undefined),
      title: () => (store.upgrade.latest ? `New version: ${store.upgrade.latest.subject}` : 'Upgrade the office'),
      run: () => openUpgrade(net),
    },
    // Up on the top bar while workers wait on someone (N does the same), next to the Workers button.
    {
      id: 'waiting',
      icon: () => (waitingNow().some((w) => w.status === 'needs_input') ? '🙋' : '✅'),
      label: 'Next worker that needs you',
      section: 'Open',
      key: 'N',
      shown: () => waitingNow().length > 0,
      status: () => waitingNow().length > 0,
      chip: () => waitingLabel(waitingNow()).replace(/^(🙋|✅) /, ''),
      on: () => waitingNow().every((w) => w.status === 'done'),
      tone: () => (waitingNow().some((w) => w.status === 'needs_input') ? 'danger' : undefined),
      title: () => 'Go to the worker that has waited longest on someone (N)',
      run: goToNextWaiting,
    },
  ],
  settings,
  () => saveSettings(settings),
);
/** F: hang a picture on a wall of this floor. There are no walls for them up on the roof. */
function startHanging() {
  if (upTop) return toast('No walls to hang pictures on up here — take the elevator down to a floor', 'warn');
  hanger.start();
}
function showSettings() {
  openSettings(
    net,
    settings,
    (s) => {
      // Switching to push to talk mutes you now; back to an open mic turns it on.
      const talkChanged = s.pushToTalk !== settings.pushToTalk;
      Object.assign(settings, s);
      saveSettings(settings);
      if (talkChanged) {
        voice.setMuted(settings.pushToTalk);
        hud.refresh();
      }
      player.setView(settings.view);
      sound.setVolume(settings.volume, settings.muted);
      sound.setMusicVolume(settings.music, settings.musicMuted);
    },
    editProfile,
    () => sound.ding('done'),
    notifier,
    signOut,
    store.sky ? { now: describeSky(store.sky), live: !!store.sky.city } : undefined,
  );
}

async function signOut() {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
}

function editProfile() {
  openCharacter(false, (p) => {
    showMyProfile(p);
    net.send({ t: 'profile', name: p.name, color: p.color, look: p.look });
  });
}

// ---- Main loop ---------------------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth;
  const hgt = window.innerHeight;
  renderer.setSize(w, hgt, false);
  camera.aspect = w / hgt;
  camera.updateProjectionMatrix();
  hands.setAspect(w / hgt);
}
window.addEventListener('resize', resize);
resize();

const timer = new THREE.Timer();
let lastSent = { x: 0, y: 0, z: 0, rotY: 0, moving: false, at: 0 };
let speakTick = 0;
/** Which half-stride your walk is on, so each one plays a footstep. */
let stride = 0;
/** How fast you were falling, so landing a jump thumps but stepping down a stair doesn't. */
let fallV = 0;
const lookDir = new THREE.Vector3();
const workerPos = new THREE.Vector3();
const headPos = new THREE.Vector3();
/** Last frame went through the drunk vision. */
let drunkVisionOn = false;

function frame(ts?: number) {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();
  const now = performance.now();

  // Coffee: quicker feet, higher jumps, a mug in hand, and maybe the jitters.
  const secs = now / 1000;
  player.speedBoost = caffeine.speed(secs);
  player.jumpBoost = caffeine.jump(secs);
  thud = Math.max(0, thud - dt * 2.5);
  player.jitter = reduceMotion.matches ? 0 : Math.max(caffeine.jitter(secs), thud);
  const mug = caffeine.buzzed(secs);
  // Both hands are on the club at the tee.
  me.holdMug(mug && !golf.active);
  hands.holdMug(mug);
  renderCaffeine(caffeine, secs);
  // Drinks from the rooftop bar: a glass in hand, and the world swaying.
  const drunk = drinking(now);

  walkTick(now);
  player.update(dt);
  // Walked into a pole's hole: you grab the pole on your way down it.
  const hole = office.stack.polesGoDown() ? office.stack.poles().find((s) => Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < POLE.hole - 0.15) : undefined;
  if (hole && !climber.active && !trip && !player.seat && player.enabled && player.pos.y > -1.35 && player.pos.y < 0.6) climber.slide(hole);
  arcade.update(camera, dt);
  cabinet.update(camera, dt);
  // Pulled away from the tee (sat down, off up the ladder, into the elevator): the club goes back.
  if (golf.active && (trip || hanger.active || climber.active || player.seat || upTop)) golf.stop();
  golf.update(dt);
  balls.update(dt);
  office.tee.ball.visible = golf.doing !== 'watch' && now > teeEmptyUntil;
  me.root.position.copy(player.pos);
  me.root.position.y += player.stepOffset;
  me.root.rotation.y = player.facing;
  const grip = climber.grip;
  me.setGrip(grip);
  me.update(dt, t, (player.moving && player.grounded) || (grip === 'ladder' && player.moving), !player.grounded && !grip && !golf.active, player.speedBoost);
  me.setVoiceLevel(voice.inVoice ? voice.localLevel : 0);
  const firstPerson = player.view === 'first';
  // In first person you are the camera; in third, hide yourself when it's zoomed in right behind your head.
  // At the tee the camera's behind the ball, and you're the one holding the club.
  me.root.visible = golf.active || (!firstPerson && camera.position.distanceTo(headPos.set(player.pos.x, player.pos.y + 1.3, player.pos.z)) > 1.5);
  if (firstPerson && !golf.active) hands.update(dt, t, { yaw: player.camYaw, pitch: player.lookPitch, walkPhase: player.walkPhase, walking: player.moving && player.grounded, airborne: !player.grounded, jitter: player.jitter, grip });
  // Down a pole: the view widens and the edges streak past.
  const rush = reduceMotion.matches ? 0 : climber.rush;
  const fov = 55 + rush * 16;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 8);
    camera.updateProjectionMatrix();
  }
  whoosh.style.opacity = rush > 0.02 ? String(rush * 0.85) : '0';

  // Your ears are in your head, facing wherever the camera looks.
  camera.getWorldDirection(lookDir);
  sound.update({ x: player.pos.x, y: player.pos.y + EYE_HEIGHT, z: player.pos.z, fx: lookDir.x, fz: lookDir.z });
  const s = Math.floor(player.walkPhase / Math.PI);
  if (s !== stride) {
    stride = s;
    if (player.moving && player.grounded) sound.step();
  }
  if (!player.grounded) fallV = Math.min(fallV, player.vy);
  else {
    if (fallV < -4) sound.step('land');
    fallV = 0;
  }

  const moved = Math.abs(player.pos.x - lastSent.x) + Math.abs(player.pos.y - lastSent.y) + Math.abs(player.pos.z - lastSent.z) > 0.01 || Math.abs(player.facing - lastSent.rotY) > 0.02;
  if ((moved || player.moving !== lastSent.moving) && now - lastSent.at > 66) {
    lastSent = { x: player.pos.x, y: player.pos.y, z: player.pos.z, rotY: player.facing, moving: player.moving, at: now };
    net.send({ t: 'move', x: player.pos.x, y: player.pos.y, z: player.pos.z, rotY: player.facing, moving: player.moving });
  }

  for (const [id, r] of remotes) {
    const p = store.peers.get(id);
    if (!p) continue;
    // Sitting, they're wherever their seat puts them.
    const sat = p.seat ? seatAt(p.seat) : undefined;
    const at = sat ?? p;
    r.target.set(at.x, at.y, at.z);
    const pos = r.person.root.position;
    pos.lerp(r.target, Math.min(1, dt * 12));
    let diff = at.rotY - r.person.root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    r.person.root.rotation.y += diff * Math.min(1, dt * 12);
    // On their feet if they're standing on something: the floor, a desk, a stair, the loft.
    const ground = groundAt(player.colliders, p.x, p.z, p.y);
    const airborne = !sat && p.y > ground + 0.05;
    // Or holding on to the ladder or a pole; off a pole onto the mat, the firehouse bell rings.
    const holding = sat || upTop ? null : gripOf(p, office.stack.poles(), ground);
    if (r.grip === 'pole' && !holding && Math.abs(p.y) < 0.2) sound.poleLanding(6, { x: pos.x, y: 0.5, z: pos.z });
    r.grip = holding;
    r.person.setGrip(holding);
    const walking = !sat && p.moving && !airborne;
    r.person.update(dt, t, walking || (holding === 'ladder' && p.moving), airborne && !holding && Math.abs(pos.y - r.target.y) > 0.01);
    // Their walk cycle takes a step every π/11 seconds.
    r.stepT = walking ? r.stepT + dt : 0.2;
    if (r.stepT >= Math.PI / 11) {
      r.stepT -= Math.PI / 11;
      sound.stepAt(pos.x, pos.z);
    }
    r.person.setVoiceLevel(p.voice && !p.muted ? voice.levelOf(id) : 0);
    r.person.emojiLift = r.bubble ? 0.45 : 0;
    if (r.bubble && now > r.bubble.until) {
      r.person.root.remove(r.bubble.sprite);
      disposeSprite(r.bubble.sprite);
      r.bubble = undefined;
    }
    const d = Math.hypot(pos.x - player.pos.x, pos.z - player.pos.z);
    voice.setVolume(id, d < 4 ? 1 : Math.max(0.2, 1 - (d - 4) / 16));
  }

  const camPos = camera.position;
  for (const [id, v] of workerViews) {
    const desk = DESK_BY_ID.get(v.deskId)!;
    // A jumping worker holds still while you're near enough to read its card, and jumps again once you walk away.
    const d = v.model.root.getWorldPosition(workerPos).distanceTo(player.pos);
    v.model.held = d < (v.model.held ? HOLD_LEAVE : HOLD_NEAR);
    v.model.update(dt, t);
    // A board agent's kiosk has no laptop to paint (see buildKiosk).
    if (!desk.station) v.laptop.update(dt, store.screens.get(id), Math.hypot(desk.x - camPos.x, desk.z - camPos.z));
  }
  for (const a of idleAgents) if (a.view.vacancy.visible) a.model.update(dt, t);
  departures.update(dt, t);
  arrivals.update(dt);
  dog.update(dt);
  if (!upTop) updateBall(now, dt);
  if (!upTop) {
    office.update(t, dt, [player.pos, ...[...remotes.values()].map((r) => r.person.root.position), ...departures.positions(), ...arrivals.positions()]);
    office.stack.update(dt, [{ x: player.pos.x, y: player.pos.y, z: player.pos.z, grip }, ...[...remotes.values()].map((r) => ({ x: r.person.root.position.x, y: r.person.root.position.y, z: r.person.root.position.z, grip: r.grip }))], camera.position);
    office.jukebox.update(t, dt, sound.beat());
  }
  checkSmokeBreak(now);
  smoke.update(dt, camera);
  confetti.update(dt);
  hanger.update();
  sky.update(dt, t, camera);
  if (!upTop) holiday.update(t, sky.lampsOn, camera);
  sound.setWeather(sky.rain, 1 - sky.daylight);
  if (upTop && roof) {
    // Everything up there moves to the DJ's set; strobes flash the whole roof as a drop lands.
    const strobe = roof.update(t, dt, djFrame(djAt()), { dark: sky.lampsOn, motion: !reduceMotion.matches });
    ambient.intensity += strobe * 1.5;
    hemi.intensity += strobe * 0.8;
  }

  aimedNote = null;
  if (modalOpen() || hanger.active || climber.active || golf.active) target = null;
  else if (firstPerson) {
    const aim = aimedAt(CROSSHAIR);
    target = aim?.near ? aim.it : (mySeat() ?? ballAtFeet());
    if (aim?.near) aimedNote = noteUnder(aim);
  } else {
    target = mySeat() ?? pickTarget();
    // By the issues board, the mouse points at the note you'd take.
    if (target?.kind === 'issues' && pointer) {
      const aim = aimedAt(pointer, 2.5);
      if (aim?.near) aimedNote = noteUnder(aim);
    }
  }
  issuesTex.lift(aimedNote?.number ?? null);
  renderHint();
  renderCrosshair();

  if (now - speakTick > 200) {
    speakTick = now;
    // What people are up to changes as they walk about, not only when they open something.
    for (const [id, r] of remotes) {
      const p = store.peers.get(id);
      if (p) r.person.setDoing(whereabouts(p));
    }
    renderPeople(voice, editProfile, walkTo, false);
    updateSpeaking(voice);
    // People on other floors can't be heard here (their voice connection stays up for when you meet).
    for (const p of store.peers.values()) if (p.id !== store.you && !store.onMyFloor(p)) voice.setVolume(p.id, 0);
  }

  // A few drinks in, the frame goes to the screen through the drunk vision (see world/drunk.ts).
  const blurry = drunk > 0.01;
  if (blurry) drunkVision.begin();
  else if (drunkVisionOn) drunkVision.release();
  drunkVisionOn = blurry;
  effect.render(scene, camera);
  pointToWaiting(now);
  // Not while the camera's up at the boss's monitor or the arcade, where they'd cover the screen.
  if (firstPerson && !arcade.zoomed && !cabinet.zoomed && !golf.active) {
    // Hands go on top of everything, so they never clip into a desk you walk up to. They have
    // lights of their own, turned down to match wherever you're standing.
    renderer.clearDepth();
    hands.setLight(sky.lightAt(camera.position));
    sky.shading(false);
    effect.render(hands.scene, hands.camera);
    sky.shading(true);
  }
  if (blurry) drunkVision.end(drunk, t, !reduceMotion.matches);
  requestAnimationFrame(frame);
}

// ---- Boot ------------------------------------------------------------------------------------------
function boot() {
  net.connect();
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
    showMyProfile(store.profile);
    boot();
  } else {
    // Pick a character first (people from before there was a choice keep their name and color).
    if (saved) Object.assign(store.profile, { name: saved.name, color: saved.color });
    // Render the office behind the character select screen.
    requestAnimationFrame(frame);
    openCharacter(true, (p) => {
      showMyProfile(p);
      net.connect();
    });
  }
});

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__office = { roof: () => roof, booze, dj: () => djFrame(djAt()), store, player, caffeine, camera, arcade, cabinet, workerViews, departures, arrivals, scene, net, renderer, hands, me, remotes, settings, gallery, hanger, office, ride, switchFloor, climber, golf, balls, elevatorPanelOpen, confetti, dog, sky, holiday, carried: () => carrying, emoteWheel, emote, ball };
(window as any).__voice = voice;
(window as any).__sound = sound;
(window as any).__notify = notifier;
