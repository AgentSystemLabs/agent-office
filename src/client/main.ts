import './style.css';
import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { sameLook } from '../shared/avatar';
import { BALCONY, DESK_BY_ID, DESKS, ELEVATOR, ELEVATOR_CAR, SEATING_BY_ID, SLAB, STATIONS, STATION_AGENT, beanbagsOut, deskSeat, inElevator, nextFreeSeat, seatAt, seatPlace, type SeatDef, type SeatPlace, type StationKind } from '../shared/layout';
import { floorPalette } from '../shared/floors';
import type { AgentProvider, GongWhy, PeerInfo, WorkerInfo } from '../shared/protocol';
import { isAsleep, isBusy } from '../shared/status';
import { Net } from './net';
import { store, loadProfile, loadSettings, saveSettings, workerForPull, type Profile, type Topic } from './state';
import { EYE_HEIGHT, PlayerController, groundAt, isTyping } from './player';
import { Caffeine } from './caffeine';
import { buildOffice, type InteractKind, type Interactable } from './world/office';
import { Person, Worker } from './world/character';
import { Hands } from './world/hands';
import { Smoke } from './world/smoke';
import { Sky, describeSky } from './world/sky';
import { Laptop } from './world/laptop';
import { BoardTexture, QueueBoardTexture, ServicesBoardTexture } from './world/boards';
import { Gallery } from './world/gallery';
import { Dog } from './world/dog';
import { Departures } from './world/leaving';
import { Confetti } from './world/confetti';
import { Hanger } from './hanging';
import { disposeSprite, textSprite } from './world/toon';
import { Voice } from './voice';
import { OfficeSound } from './sound';
import { DesktopNotifier, askNotifyPermission, notifyPermission, waitingOnSomeone } from './notify';
import { $, h, clip, closeAllModals, modalOpen, onModalChange, openModal, toast, STATUS_LABEL } from './ui/dom';
import { openTerminal, openTerminalFor, routeTerminalMessage, type TerminalFind } from './ui/terminal';
import { openSearch } from './ui/search';
import { openChanges, openChangesFor, routeChangesMessage } from './ui/changes';
import { openPrompt, confirmDialog, sendHomeDialog, routeWorktreeMessage } from './ui/prompt';
import { openBoard } from './ui/boards';
import { openPull, routePullMessage } from './ui/pull';
import { openAsk } from './ui/ask';
import { openTeam, routeTeamMessage } from './ui/team';
import { openAccounts, routeAccountsMessage } from './ui/accounts';
import { mountServicesButton, openServices } from './ui/services';
import { mountQueueButton, openQueue } from './ui/queue';
import { openUpgrade, restarting, showRestarting, showUpgraded } from './ui/upgrade';
import { openHelp, renderCaffeine, renderChat, renderPeople, renderWorkers, updateSpeaking } from './ui/hud';
import { openCharacter } from './ui/character';
import { openSettings } from './ui/settings';
import { hiringPaused, renderUsage, usageLabel, usageTitle } from './ui/usage';
import { elevatorPanelOpen, openElevator, routeElevatorMessage } from './ui/elevator';
import { providerLabel, resolvedProvider } from './ui/provider';
import { mirrorWhiteboard, openWhiteboard, routeWhiteboardMessage } from './ui/whiteboard';
import { renderLimits } from './ui/limits';
import { openJukebox } from './ui/jukebox';
import { Arcade } from './ui/arcade';
import { trackTitle } from '../shared/jukebox';

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
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);

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
const issuesTex = new BoardTexture('issues');
mountBoard(office.boardMeshes.issues, issuesTex.texture, () => issuesTex.render(store.issues), ['issues']);
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

// Pictures people hung on the walls
const gallery = new Gallery();
office.group.add(gallery.group);
store.on('decor', () => gallery.sync(store.decor));

// The whiteboard shows what everyone's drawn on it.
mirrorWhiteboard(office.whiteboard.show, office.whiteboard.fit.width, office.whiteboard.fit.height);

// Confetti for merges, landing on whatever it falls on
const confetti = new Confetti((x, z, y) => groundAt(office.colliders, x, z, y));
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
const notifier = new DesktopNotifier(() => settings.notify, (id) => openWorkerTerminal(id));
sky.onThunder = (delay, loud) => sound.thunder(delay, loud);
const hanger = new Hanger(net, camera, canvas, player, office, gallery);
scene.add(hanger.ghost.group);
hanger.onChange = () => {
  const b = $('btn-decor');
  b.classList.toggle('on', hanger.active);
  b.title = hanger.active ? 'Stop hanging the picture (Esc)' : 'Hang a picture on a wall (F)';
  // Not '': that reads as "no hint shown", and the hanging hint would stay up.
  hintKey = 'stale';
};

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
  (deskId) => {
    const desk = office.desks.get(deskId);
    if (desk && !store.workerAtDesk(deskId)) desk.vacancy.visible = true;
    arrangeBeanbags();
  },
);
let firstWelcome = true;
/** The server version this page was loaded with. */
let bootVersion = '';
let upgradePhase = '';

net.onStatus((up) => $('conn').classList.toggle('hidden', up));
net.onMessage((msg) => {
  if (msg.t === 'welcome') voice.reset();
  if (msg.t === 'welcome' || msg.t === 'floor.enter') departures.clear();
  if (msg.t === 'worker.remove') sentHome.add(msg.workerId);
  store.apply(msg);
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
      // After a reconnect the server has forgotten which terminal we had open.
      const openId = openTerminalFor();
      if (openId && store.workers.has(openId)) net.send({ t: 'worker.attach', workerId: openId });
      const watching = openChangesFor();
      if (watching && store.workers.has(watching)) net.send({ t: 'changes.watch', workerId: watching });
      renderProject();
      $('btn-team').classList.toggle('hidden', !store.invites);
      // Back from a restart on another version: this page's code is stale, so load the new one.
      if (!bootVersion) bootVersion = msg.version;
      else if (msg.version !== bootVersion || restarting()) showUpgraded(msg.upgrade);
      upgradePhase = msg.upgrade.phase;
      voice.syncPeers();
      break;
    }
    case 'floor.enter':
      arrive();
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
      if (msg.smoke === undefined) {
        r?.person.reach();
        break;
      }
      const p = store.peers.get(msg.id);
      if (p) p.smoking = msg.smoke;
      r?.person.setSmoking(msg.smoke);
      break;
    }
    case 'gong':
      gongRang(msg.why, msg.pr);
      break;
  }
});

function renderUpgrade() {
  const u = store.upgrade;
  const btn = $('btn-upgrade');
  btn.classList.toggle('hidden', !u.available);
  btn.classList.toggle('primary', !!u.latest && u.phase !== 'building');
  btn.textContent = u.phase === 'building' ? '🛠️ Upgrading…' : u.latest ? '⬆️ Update' : '⬆️';
  btn.title = u.latest ? `New version: ${u.latest.subject}` : 'Upgrade the office';
  const banner = $('upgrade-banner');
  banner.classList.toggle('hidden', u.phase !== 'building');
  banner.textContent = `🛠️ ${u.by ?? 'Someone'} is upgrading the office. It restarts on the new version in a minute or two.`;
}
store.on('upgrade', renderUpgrade);

function renderProject() {
  const p = store.project;
  renderTitle();
  if (!p) {
    $('project-name').textContent = '🏢 Agent Office';
    $('project-meta').textContent = store.floors.length ? '🛗 Take the elevator to a floor' : '🛗 No floors yet — add a project in the elevator';
    office.setProjectName(store.floors.length ? 'Pick a floor' : 'Lobby');
    return;
  }
  const n = store.floors.findIndex((f) => f.id === store.floor);
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

function fade(on: boolean) {
  $('fade').classList.toggle('on', on);
}

/** A ride under way: the doors are shut and the lights are down until the next floor arrives. */
let riding: { floor: string; timer: number } | null = null;

function showElevator() {
  openElevator({ net, ride });
}

/** Rides the elevator to another floor. From outside the car, you step in while the lights are down. */
function ride(floorId: string) {
  if (riding || floorId === store.floor) return;
  closeAllModals();
  if (hanger.active) hanger.cancel();
  const inside = inElevator(player.pos.x, player.pos.z);
  riding = { floor: floorId, timer: window.setTimeout(rideFailed, 10_000) };
  player.enabled = false;
  player.clearKeys();
  office.elevator.setOpen(false);
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

/** The floor never came (it's gone, or the office is unreachable): open up where you are. */
function rideFailed() {
  if (!riding) return;
  riding = null;
  fade(false);
  office.elevator.setOpen(!!store.floor);
  player.enabled = !modalOpen();
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

/** You're on a floor (or in the building without one): paint it, and open the doors. */
function arrive() {
  paintFloor();
  renderProject();
  noticeWaiting();
  if (riding) {
    clearTimeout(riding.timer);
    riding = null;
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
  setTimeout(() => {
    office.elevator.setOpen(true);
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
  $('project').title = elsewhere ? `${elsewhere} worker${elsewhere === 1 ? '' : 's'} on other floors waiting on someone — click to ride the elevator` : 'The elevator: ride to another project';
}

// ---- Peers --------------------------------------------------------------------------------------
function syncPeers() {
  for (const [id, peer] of store.peers) {
    // Only who's on your floor is in the room with you.
    if (id === store.you || !store.onMyFloor(peer)) continue;
    let r = remotes.get(id);
    if (!r) {
      const person = new Person(peer.name, peer.color, peer.look);
      person.onSmoke = puff;
      person.root.position.set(peer.x, peer.y, peer.z);
      scene.add(person.root);
      noOutline(person.root);
      r = { person, target: new THREE.Vector3(peer.x, peer.y, peer.z), rotY: peer.rotY, moving: false, label: '', look: { ...peer.look }, stepT: 0 };
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
    r.person.sit(peer.seat ? (seatAt(peer.seat)?.hips ?? null) : null);
  }
  for (const [id, r] of remotes) {
    const peer = store.peers.get(id);
    if (!peer || !store.onMyFloor(peer)) {
      scene.remove(r.person.root);
      remotes.delete(id);
    }
  }
  renderPeople(voice, editProfile);
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
  sprite.position.y = 2.45;
  r.person.root.add(sprite);
  r.bubble = { sprite, until: performance.now() + 6000 };
}

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
      desk.seatAnchor.add(model.root);
      const laptop = new Laptop();
      desk.laptopAnchor.add(laptop.root);
      noOutline(desk.group);
      desk.vacancy.visible = false;
      desk.chair.rotation.y = 0;
      v = { model, laptop, deskId: w.deskId, status: '', acked: true };
      workerViews.set(w.id, v);
    }
    if (v.status !== w.status || v.acked !== w.acked) {
      // It just finished or started waiting on you (not already so when this page first saw it): ding, and notify if you're away.
      if (waitingOnSomeone(w) && v.status !== '' && w.status !== v.status) {
        sound.ding(w.status);
        notifier.alert(w);
      }
      v.status = w.status;
      v.acked = w.acked;
      v.model.setStatus(w.status, waitingOnSomeone(w));
      noOutline(v.model.root);
    }
    v.model.setTask(w.task && w.kind === 'agent' ? { ...w.task, name: `${providerLabel(w.provider, store.project)} · ${w.task.name}` } : w.task);
    const deskDef = DESK_BY_ID.get(w.deskId);
    if (deskDef) sound.setTyping(w.id, deskDef.x, deskDef.z, w.status === 'working');
    const again = w.kind === 'shell' ? 'restart' : 'resume';
    v.laptop.setPlaceholder(w.status === 'offline' ? `💤 ${w.name} is asleep — press R to ${again}` : w.status === 'exited' ? `${w.name} exited` : 'booting…');
  }
  for (const [id, v] of workerViews) {
    if (store.workers.has(id)) continue;
    const desk = office.desks.get(v.deskId);
    // Sent home: it packs up and walks out, and the seat shows as free once it's up (see departures).
    if (desk && sentHome.has(id)) departures.add(v.model, v.laptop, desk);
    else {
      v.model.root.removeFromParent();
      v.laptop.root.removeFromParent();
      v.model.dispose();
      v.laptop.dispose();
      if (desk) desk.vacancy.visible = true;
    }
    sound.removeTypist(id);
    workerViews.delete(id);
  }
  arrangeBeanbags();
  renderWorkers((id) => openWorkerTerminal(id));
  notifier.sync(store.workers);
  renderTitle();
}

/** Once every desk is taken, bean bags come out for the workers who don't fit. */
function arrangeBeanbags() {
  // One stays out under a worker who's been sent home until it gets up.
  const appeared = office.setBeanbags(beanbagsOut((id) => !!store.workerAtDesk(id) || departures.seated(id)));
  // One came out right where you're standing (on the office floor, not down in the garage): you end up on top of it.
  const p = player.pos;
  for (const c of appeared) if (p.y > -0.1 && p.y < c.top && p.x > c.minX - 0.3 && p.x < c.maxX + 0.3 && p.z > c.minZ - 0.3 && p.z < c.maxZ + 0.3) p.y = c.top;
}
store.on('workers', syncWorkers);
store.on('workers', renderUsage);
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

function hire(deskId: string, prompt?: string, worktree = false, provider?: AgentProvider, model?: string) {
  net.send({ t: 'worker.spawn', deskId, prompt, worktree, provider, model });
  // The moment notifications start to matter: ask once (it has to come from a key press or click).
  if (settings.notify && notifyPermission() === 'default' && !askedToNotify) {
    askedToNotify = true;
    void askNotifyPermission();
  }
}

function openShell(deskId: string) {
  net.send({ t: 'worker.spawn', deskId, kind: 'shell' });
}

function promptAtDesk(deskId: string) {
  const w = store.workerAtDesk(deskId);
  const desk = DESK_BY_ID.get(deskId)!;
  if (!w) {
    openPrompt({
      title: `✨ New task at ${desk.label}`,
      subtitle: 'A fresh worker will sit down and start on this right away. Choose the worker engine below.',
      submitLabel: 'Hire & start',
      providerOption: true,
      worktreeOption: !!store.project?.branch,
      onSubmit: (text, o) => hire(deskId, text, o.worktree, o.provider, o.model),
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
  openPrompt({
    title: `✨ Hire a worker at ${desk.label}`,
    subtitle: 'Choose the worker engine. You can start with an empty prompt and send work later.',
    placeholder: 'Optional first task…',
    submitLabel: 'Hire & start',
    allowEmpty: true,
    providerOption: true,
    worktreeOption: !!store.project?.branch,
    onSubmit: (text, o) => hire(deskId, text || undefined, o.worktree, o.provider, o.model),
  });
}

function killWorker(id: string) {
  const w = store.workers.get(id);
  if (!w) return;
  const where = DESK_BY_ID.get(w.deskId)?.label ?? 'the desk';
  const session = w.kind === 'shell' ? 'shared shell' : `${providerLabel(w.provider, store.project)} session`;
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
  // Behind the worker, looking over their shoulder at the laptop (or in front of a board agent's kiosk).
  const spot = deskSeat(desk, desk.station ? -1.6 : desk.beanbag ? 1.6 : 2.4);
  player.pos.set(spot.x, 0, spot.z);
  player.vy = 0;
  player.facing = Math.atan2(desk.x - spot.x, desk.z - spot.z);
  player.camYaw = player.facing - Math.PI;
  player.lookPitch = -0.2;
  const w = store.workerAtDesk(deskId);
  toast(w ? `You're at ${desk.label}, ${w.name}'s desk` : `You're at ${desk.label}`);
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
    onSubmit: (prompt, to, worktree, provider, model) => {
      if (to) net.send({ t: 'worker.prompt', workerId: to, prompt });
      else if (desk) hire(desk, prompt, worktree, provider, model);
    },
  });
}

function boardActions() {
  return {
    queue: (prompt: string, title: string, issue: number, provider?: AgentProvider, model?: string) => net.send({ t: 'queue.add', prompt, title, issue, provider, model }),
    assign: (prompt: string, title: string) => sendToWorker(`🤖 ${title}`, { initial: prompt }),
    ask: (context: string, title: string) => sendToWorker(`✍️ ${title}`, { context }),
    goToDesk,
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
  const modal = openModal(el, { onClose: () => (video.srcObject = null) });
  close.addEventListener('click', () => modal.close());
}

function interact(target: Interactable | null, key: DeskKey) {
  if (!target) return;
  if (target.kind === 'desk' && target.deskId) {
    const w = store.workerAtDesk(target.deskId);
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
  return (id && office.interactables.find((it) => it.kind === 'seat' && it.seatId === id)) || null;
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

/** Someone hit the gong, a pull request merged (confetti over its desk), or the queue emptied (a party). */
function gongRang(why: GongWhy, pr?: number) {
  office.gong.strike(why === 'hit' ? 0.7 : 1);
  sound.gong(why);
  const top = office.gong.top;
  if (why === 'merged') {
    // Over the desk it came from while its worker is still there, who jumps for joy; otherwise over the gong.
    const it = store.pulls.items.find((p) => p.number === pr);
    const w = pr === undefined ? undefined : workerForPull(store.workers.values(), it ?? { number: pr, headRefName: '' });
    if (w && workerViews.has(w.id)) {
      burstOver(w.deskId, 220);
      if (!isAsleep(w.status)) workerViews.get(w.id)!.model.cheer();
    } else confetti.burst(top.x, top.y, top.z, 220);
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
  for (const list of [office.interactables, gallery.interactables, dog.interactables]) {
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
  if (!target || modalOpen()) {
    if (hintKey) {
      el.classList.add('hidden');
      hintKey = '';
    }
    return;
  }
  const hint = hintFor(target);
  const k = `${target.kind}${target.deskId ?? ''}|${hint.k}`;
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
      return board('📌 Issues board');
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
    case 'jukebox': {
      const j = store.jukebox;
      const what = j.on ? trackTitle(j) : '';
      return { k: `${j.on}|${what}`, parts: [title('🎵 Jukebox'), aside(j.on ? `♪ ${clip(what, 40)}` : 'off'), key('E', j.on ? 'Change the song' : 'Put on a song')] };
    }
    case 'whiteboard': {
      const names = store.drawing.flatMap((id) => (id === store.you ? [] : (store.peers.get(id)?.name ?? []))).join(', ');
      return { k: names, parts: [title('📝 Whiteboard'), aside(names ? `✏️ ${clip(names, 40)} drawing` : 'draw together, live'), key('E', names ? 'Join in' : 'Draw')] };
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
        const use = tv ? 'Watch the TV' : seat.game ? 'Play Minesweeper' : '';
        return { k: `${seat.id}|sitting|${tv}`, parts: [title(seat.label), aside('sitting'), ...(use ? [key('E', use), key('W A S D', 'Get up')] : [key('E', 'Get up')])] };
      }
      const full = !freePlace(seat);
      return { k: `${seat.id}|${full}`, parts: [title(seat.label), seat.game ? aside('💣 Minesweeper on the monitor') : '', full ? aside('no room') : key('E', 'Sit down')] };
    }
    case 'dog': {
      const doing = dog.doing(
        (id) => store.workers.get(id)?.name,
        (id) => (id === store.you ? 'you' : store.peers.get(id)?.name),
      );
      return { k: `${dog.name}|${doing}`, parts: [title(`🐶 ${dog.name}`), doing ? aside(doing) : '', key('E', 'Pet')] };
    }
  }
}

function deskHint(deskId: string): Hint {
  const w = store.workerAtDesk(deskId);
  if (!w) {
    const paused = hiringPaused();
    return {
      k: String(paused),
      parts: [
        h('span.title', {}, `${DESK_BY_ID.get(deskId)!.label} · empty`),
        ...(paused ? [h('span.cost', {}, '💸 Budget spent — hiring resumes tomorrow')] : [key('E', 'Hire a worker'), key('P', 'Hire with a task')]),
        key('B', 'Shell'),
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
  if (!w) return { k: '', parts: [h('span.title', {}, `${info.icon} ${STATION_AGENT[kind].name}`), aside(info.offer.replace(/^Ask me /, '')), key('E', 'Prompt')] };
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
  const show = player.view === 'first' && !modalOpen();
  const free = show && finePointer && player.canLock && !player.locked;
  const k = `${show}|${!!target}|${free}`;
  if (k === crossKey) return;
  crossKey = k;
  const el = $('crosshair');
  el.classList.toggle('hidden', !show);
  el.classList.toggle('on', !!target);
  el.classList.toggle('free', free);
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

/** Keys that use what you're facing: at a desk, each does something else (see interact). */
const DESK_KEYS = { KeyE: 'E', KeyP: 'P', KeyR: 'R', KeyX: 'X', KeyB: 'B', KeyC: 'C', KeyO: 'O' } as const;
type DeskKey = (typeof DESK_KEYS)[keyof typeof DESK_KEYS];

function use(it: Interactable | null, key: DeskKey) {
  if (!it) return;
  reach();
  interact(it, key);
}

// ---- Input ----------------------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (modalOpen() || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (hanger.active && hangingKey(e.code)) {
    e.preventDefault();
    return;
  }
  if (officeKey(e)) player.clearKeys();
});

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
      $('chat-input').focus();
      return true;
    case 'KeyV':
      void toggleVoice();
      return true;
    case 'KeyM':
      voice.toggleMute();
      return true;
    case 'KeyH':
      openHelp();
      return true;
    case 'KeyF':
      hanger.start();
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

/** Whether the mouse was captured when the modals opened, so closing them gives it back. */
let relookAfterModal = false;
onModalChange((open) => {
  player.enabled = !open;
  player.clearKeys();
  if (open) {
    if (player.locked) relookAfterModal = true;
    player.unlock();
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
  // The browser lets a page re-capture the mouse it let go of itself, even from Esc. Otherwise it
  // needs a recent click or key, like the one that closed the window; without one, "Click to look around".
  if (player.canLock && (relookAfterModal || navigator.userActivation?.isActive)) player.lock();
  relookAfterModal = false;
}

// ---- Clicking the world: use what's under the crosshair (first person) or the mouse (third) ----------
const raycaster = new THREE.Raycaster();
const CROSSHAIR = new THREE.Vector2(0, 0);
/** How close (meters from your eyes) you must be to use each kind of thing. */
const REACH: Record<InteractKind, number> = { desk: 4.5, station: 4.5, coffee: 3, issues: 9, pulls: 9, services: 9, queue: 9, tv: 10, decor: 9, smoke: 3, elevator: 4.5, gong: 3.5, dog: 3.2, jukebox: 4, seat: 3, whiteboard: 7 };
const eye = new THREE.Vector3();

/** What the ray through `ndc` lands on first, and whether it is within reach (plus `slack` meters). */
function aimedAt(ndc: THREE.Vector2, slack = 0): { it: Interactable; near: boolean } | null {
  raycaster.setFromCamera(ndc, camera);
  eye.set(player.pos.x, player.pos.y + EYE_HEIGHT, player.pos.z);
  for (const hit of raycaster.intersectObjects([office.group, dog.root], true)) {
    let it: Interactable | undefined;
    let shown = true;
    for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
      if (!o.visible) shown = false;
      it ??= o.userData.interact as Interactable | undefined;
    }
    if (!shown) continue;
    if (!it) return null; // a wall, the floor, a plant… is in the way
    return { it, near: hit.point.distanceTo(eye) <= REACH[it.kind] + slack };
  }
  return null;
}

player.onClick = (ndc) => {
  if (modalOpen()) return;
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
  use(aim.it, 'E');
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
store.on('chat', renderChat);

// ---- Voice & screen share ---------------------------------------------------------------------------
async function toggleVoice() {
  if (voice.inVoice) voice.leaveVoice();
  else {
    const err = await voice.joinVoice();
    if (err) toast(err, 'warn');
  }
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
  const vb = $('btn-voice');
  vb.classList.toggle('on', voice.inVoice);
  vb.querySelector('span')!.textContent = voice.inVoice ? 'Leave voice' : 'Join voice';
  const mb = $('btn-mute');
  mb.classList.toggle('hidden', !voice.inVoice);
  mb.textContent = voice.muted ? '🔇' : '🎙️';
  mb.classList.toggle('danger', voice.muted);
  const sb = $('btn-share');
  sb.classList.toggle('on', voice.sharing);
  sb.querySelector('span')!.textContent = voice.sharing ? 'Stop sharing' : 'Share screen';
  refreshShares();
});

// Buttons must not keep focus, or Space (jump) would click them again.
$('hud').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button');
  if (btn) setTimeout(() => btn.blur(), 0);
});
if (!window.isSecureContext) {
  for (const id of ['btn-voice', 'btn-share']) {
    const b = $(id);
    b.style.opacity = '0.55';
    b.title = 'Voice and screen sharing need HTTPS or localhost — use a TLS proxy, --self-signed, or an SSH tunnel';
  }
}
// The project in the corner is the floor you're on; click it for the others.
$('project').addEventListener('click', () => showElevator());
$('btn-voice').addEventListener('click', () => void toggleVoice());
$('btn-mute').addEventListener('click', () => voice.toggleMute());
$('btn-share').addEventListener('click', () => void toggleShare());
$('btn-issues').addEventListener('click', () => openBoard('issues', net, boardActions()));
$('btn-pulls').addEventListener('click', () => openBoard('pulls', net, boardActions()));
mountServicesButton($('btn-services'));
mountQueueButton($('btn-queue'), showQueue);
$('btn-team').addEventListener('click', () => openTeam(net));
$('btn-accounts').addEventListener('click', () => openAccounts(net));
store.on('me', () => $('btn-accounts').classList.toggle('hidden', !store.me.admin));
$('btn-upgrade').addEventListener('click', () => openUpgrade(net));
$('btn-search').addEventListener('click', () => showSearch());
$('btn-help').addEventListener('click', () => openHelp());
$('btn-whiteboard').addEventListener('click', () => openWhiteboard(net));
$('btn-decor').addEventListener('click', () => (hanger.active ? hanger.cancel() : hanger.start()));
$('btn-settings').addEventListener('click', () => showSettings());
function showSettings() {
  openSettings(
    net,
    settings,
    (s) => {
      Object.assign(settings, s);
      saveSettings(settings);
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

function frame(ts?: number) {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();
  const now = performance.now();

  // Coffee: quicker feet, higher jumps, a mug in hand, and maybe the jitters.
  const secs = now / 1000;
  player.speedBoost = caffeine.speed(secs);
  player.jumpBoost = caffeine.jump(secs);
  player.jitter = reduceMotion.matches ? 0 : caffeine.jitter(secs);
  const mug = caffeine.buzzed(secs);
  me.holdMug(mug);
  hands.holdMug(mug);
  renderCaffeine(caffeine, secs);

  player.update(dt);
  arcade.update(camera, dt);
  me.root.position.copy(player.pos);
  me.root.position.y += player.stepOffset;
  me.root.rotation.y = player.facing;
  me.update(dt, t, player.moving && player.grounded, !player.grounded, player.speedBoost);
  me.setVoiceLevel(voice.inVoice ? voice.localLevel : 0);
  const firstPerson = player.view === 'first';
  // In first person you are the camera; in third, hide yourself when it's zoomed in right behind your head.
  me.root.visible = !firstPerson && camera.position.distanceTo(headPos.set(player.pos.x, player.pos.y + 1.3, player.pos.z)) > 1.5;
  if (firstPerson) hands.update(dt, t, { yaw: player.camYaw, pitch: player.lookPitch, walkPhase: player.walkPhase, walking: player.moving && player.grounded, airborne: !player.grounded, jitter: player.jitter });

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
    const airborne = !sat && p.y > groundAt(office.colliders, p.x, p.z, p.y) + 0.05;
    const walking = !sat && p.moving && !airborne;
    r.person.update(dt, t, walking, airborne && Math.abs(pos.y - r.target.y) > 0.01);
    // Their walk cycle takes a step every π/11 seconds.
    r.stepT = walking ? r.stepT + dt : 0.2;
    if (r.stepT >= Math.PI / 11) {
      r.stepT -= Math.PI / 11;
      sound.stepAt(pos.x, pos.z);
    }
    r.person.setVoiceLevel(p.voice && !p.muted ? voice.levelOf(id) : 0);
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
  dog.update(dt);
  office.update(t, dt, [player.pos, ...[...remotes.values()].map((r) => r.person.root.position), ...departures.positions()]);
  office.jukebox.update(t, dt, sound.beat());
  checkSmokeBreak(now);
  smoke.update(dt, camera);
  confetti.update(dt);
  hanger.update();
  sky.update(dt, t, camera);
  sound.setWeather(sky.rain, 1 - sky.daylight);

  if (modalOpen() || hanger.active) target = null;
  else if (firstPerson) {
    const aim = aimedAt(CROSSHAIR);
    target = aim?.near ? aim.it : mySeat();
  } else target = mySeat() ?? pickTarget();
  renderHint();
  renderCrosshair();

  if (now - speakTick > 200) {
    speakTick = now;
    updateSpeaking(voice);
    // People on other floors can't be heard here (their voice connection stays up for when you meet).
    for (const p of store.peers.values()) if (p.id !== store.you && !store.onMyFloor(p)) voice.setVolume(p.id, 0);
  }

  effect.render(scene, camera);
  // Not while the camera's up at the boss's monitor, where they'd cover the screen.
  if (firstPerson && !arcade.zoomed) {
    // Hands go on top of everything, so they never clip into a desk you walk up to. They have
    // lights of their own, turned down to match wherever you're standing.
    renderer.clearDepth();
    hands.setLight(sky.lightAt(camera.position));
    sky.shading(false);
    effect.render(hands.scene, hands.camera);
    sky.shading(true);
  }
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
(window as any).__office = { store, player, caffeine, camera, arcade, workerViews, departures, scene, net, renderer, hands, me, remotes, settings, gallery, hanger, office, ride, elevatorPanelOpen, confetti, dog, sky };
(window as any).__voice = voice;
(window as any).__sound = sound;
(window as any).__notify = notifier;
