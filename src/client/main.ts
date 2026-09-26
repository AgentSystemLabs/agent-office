import './style.css';
import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import { sameLook } from '../shared/avatar';
import { DESK_BY_ID, DESKS, SPAWN } from '../shared/layout';
import type { PeerInfo, WorkerInfo } from '../shared/protocol';
import { Net } from './net';
import { store, loadProfile, loadSettings, saveSettings, type Profile } from './state';
import { EYE_HEIGHT, PlayerController, isTyping } from './player';
import { buildOffice, type InteractKind, type Interactable } from './world/office';
import { Person, Worker } from './world/character';
import { Hands } from './world/hands';
import { Laptop } from './world/laptop';
import { BoardTexture, ServicesBoardTexture } from './world/boards';
import { disposeSprite, textSprite } from './world/toon';
import { Voice } from './voice';
import { $, h, modalOpen, onModalChange, openModal, toast, STATUS_LABEL } from './ui/dom';
import { openTerminal, openTerminalFor, routeTerminalMessage } from './ui/terminal';
import { openPrompt, confirmDialog } from './ui/prompt';
import { openBoard } from './ui/boards';
import { openTeam, routeTeamMessage } from './ui/team';
import { mountServicesButton, openServices } from './ui/services';
import { openUpgrade, restarting, showRestarting, showUpgraded } from './ui/upgrade';
import { openHelp, renderChat, renderPeople, renderWorkers, updateSpeaking } from './ui/hud';
import { openCharacter } from './ui/character';
import { openSettings } from './ui/settings';

// ---- Renderer & scene ---------------------------------------------------------------------------
const canvas = $('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const effect = new OutlineEffect(renderer, { defaultThickness: 0.0032, defaultColor: [0.17, 0.18, 0.26] });

const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfe3ff');
scene.fog = new THREE.Fog('#bfe3ff', 40, 90);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);

scene.add(new THREE.HemisphereLight('#fff5e6', '#c9a27a', 1.5));
scene.add(new THREE.AmbientLight('#ffffff', 0.5));
const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
sun.position.set(-8, 18, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 16, bottom: -16, near: 1, far: 50 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.02;
scene.add(sun);

const office = buildOffice();
scene.add(office.group);

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

// Boards
const issuesTex = new BoardTexture('issues');
const pullsTex = new BoardTexture('pulls');
for (const [meshKey, tex] of [
  ['issues', issuesTex],
  ['pulls', pullsTex],
] as const) {
  const mat = office.boardMeshes[meshKey].material as THREE.MeshBasicMaterial;
  mat.map = tex.texture;
  mat.needsUpdate = true;
}
store.on('issues', () => issuesTex.render(store.issues));
store.on('pulls', () => pullsTex.render(store.pulls));
issuesTex.render(store.issues);
pullsTex.render(store.pulls);
const servicesTex = new ServicesBoardTexture();
const servicesMat = office.boardMeshes.services.material as THREE.MeshBasicMaterial;
servicesMat.map = servicesTex.texture;
servicesMat.needsUpdate = true;
const renderServicesBoard = () => servicesTex.render(store.services.items, store.workers);
store.on('services', renderServicesBoard);
store.on('workers', renderServicesBoard);
renderServicesBoard();

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

// ---- Networking & state -------------------------------------------------------------------------
const net = new Net(() => store.profile);
const voice = new Voice(net);

const me = new Person(store.profile.name, store.profile.color, store.profile.look);
me.showLabel(false);
scene.add(me.root);
noOutline(me.root);
const settings = loadSettings();
const player = new PlayerController(camera, canvas, office.colliders);
player.pos.set(SPAWN.x, 0, SPAWN.z);
player.view = settings.view;
const hands = new Hands(store.profile.color, me.skinColor);

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
let firstWelcome = true;
/** The server version this page was loaded with. */
let bootVersion = '';
let upgradePhase = '';

net.onStatus((up) => $('conn').classList.toggle('hidden', up));
net.onMessage((msg) => {
  if (msg.t === 'welcome') voice.reset();
  store.apply(msg);
  routeTerminalMessage(msg);
  routeTeamMessage(msg);
  switch (msg.t) {
    case 'welcome': {
      const mine = store.peers.get(store.you);
      if (firstWelcome && mine) {
        player.pos.set(mine.x, 0, mine.z);
        firstWelcome = false;
      }
      if (voice.inVoice || voice.sharing) net.send({ t: 'voice', voice: voice.inVoice, muted: voice.muted, sharing: voice.sharing });
      // After a reconnect the server has forgotten which terminal we had open.
      const openId = openTerminalFor();
      if (openId && store.workers.has(openId)) net.send({ t: 'worker.attach', workerId: openId });
      renderProject();
      $('btn-team').classList.toggle('hidden', !store.invites);
      // Back from a restart on another version: this page's code is stale, so load the new one.
      if (!bootVersion) bootVersion = msg.version;
      else if (msg.version !== bootVersion || restarting()) showUpgraded(msg.upgrade);
      upgradePhase = msg.upgrade.phase;
      voice.syncPeers();
      break;
    }
    case 'peer.join':
    case 'peer.leave':
      voice.syncPeers();
      break;
    case 'rtc':
      void voice.handleSignal(msg.from, msg.data as never);
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
    case 'peer.act':
      remotes.get(msg.id)?.person.reach();
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
  if (!p) return;
  $('project-name').textContent = `🏢 ${p.name}`;
  $('project-meta').textContent = [p.branch && `⎇ ${p.branch}`, p.dir, `runs: ${p.agentCmd}`].filter(Boolean).join(' · ');
  document.title = `${p.name} · Agent Office`;
  office.setProjectName(p.name);
}

// ---- Peers --------------------------------------------------------------------------------------
function syncPeers() {
  for (const [id, peer] of store.peers) {
    if (id === store.you) continue;
    let r = remotes.get(id);
    if (!r) {
      const person = new Person(peer.name, peer.color, peer.look);
      person.root.position.set(peer.x, peer.y, peer.z);
      scene.add(person.root);
      noOutline(person.root);
      r = { person, target: new THREE.Vector3(peer.x, peer.y, peer.z), rotY: peer.rotY, moving: false, label: '', look: { ...peer.look } };
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
  }
  for (const [id, r] of remotes) {
    if (!store.peers.has(id)) {
      scene.remove(r.person.root);
      remotes.delete(id);
    }
  }
  renderPeople(voice, editProfile);
  refreshShares();
}
store.on('peers', syncPeers);

function sayBubble(from: string, text: string) {
  const short = text.length > 60 ? `${text.slice(0, 59)}…` : text;
  if (from === store.you) return;
  const r = remotes.get(from);
  if (!r) return;
  if (r.bubble) {
    r.person.root.remove(r.bubble.sprite);
    disposeSprite(r.bubble.sprite);
  }
  const sprite = textSprite(`💬 ${short}`, { bg: '#ffffff', size: 34 });
  sprite.position.y = 2.45;
  r.person.root.add(sprite);
  r.bubble = { sprite, until: performance.now() + 6000 };
}

// ---- Workers ------------------------------------------------------------------------------------
let dingCtx: AudioContext | null = null;
// Browsers only allow audio after a gesture: unlock the ding on the first click or key.
const unlockAudio = () => {
  try {
    dingCtx ??= new AudioContext();
    void dingCtx.resume();
  } catch {
    // no audio
  }
};
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });
function ding(kind: 'done' | 'needs_input') {
  try {
    dingCtx ??= new AudioContext();
    const ctx = dingCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const notes = kind === 'done' ? [660, 880] : [880, 660, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.15, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.3);
    });
  } catch {
    // audio unavailable
  }
}

function shouldBounce(w: WorkerInfo) {
  return w.status === 'needs_input' || (w.status === 'done' && !w.acked);
}

function syncWorkers() {
  for (const w of store.workers.values()) {
    let v = workerViews.get(w.id);
    const desk = office.desks.get(w.deskId);
    if (!desk) continue;
    if (!v) {
      const model = new Worker(w.name, w.color);
      model.root.position.copy(desk.seatAnchor.position);
      model.root.position.y = 0.4;
      model.root.position.z += 0.08;
      model.root.rotation.y = Math.PI;
      model.root.scale.setScalar(0.82);
      desk.group.add(model.root);
      const laptop = new Laptop();
      laptop.root.position.copy(desk.laptopAnchor.position);
      laptop.root.position.z -= 0.08;
      laptop.root.scale.setScalar(1.3);
      desk.group.add(laptop.root);
      noOutline(desk.group);
      desk.vacancy.visible = false;
      desk.chair.rotation.y = 0;
      v = { model, laptop, deskId: w.deskId, status: '', acked: true };
      workerViews.set(w.id, v);
    }
    if (v.status !== w.status || v.acked !== w.acked) {
      const becameHot = shouldBounce(w) && !(v.status === w.status && v.acked === w.acked) && v.status !== '' && (w.status !== v.status);
      if (becameHot && (w.status === 'needs_input' || w.status === 'done')) {
        ding(w.status);
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          new Notification(`${w.name} ${w.status === 'done' ? 'is done' : 'needs input'}`, { body: w.activity ?? w.prompt ?? '', icon: '/favicon.svg' });
        }
      }
      v.status = w.status;
      v.acked = w.acked;
      v.model.setStatus(w.status, shouldBounce(w));
      noOutline(v.model.root);
    }
    const again = w.kind === 'shell' ? 'restart' : 'resume';
    v.laptop.setPlaceholder(w.status === 'offline' ? `💤 ${w.name} is asleep — press R to ${again}` : w.status === 'exited' ? `${w.name} exited` : 'booting…');
  }
  for (const [id, v] of workerViews) {
    if (store.workers.has(id)) continue;
    const desk = office.desks.get(v.deskId);
    desk?.group.remove(v.model.root);
    desk?.group.remove(v.laptop.root);
    v.model.dispose();
    v.laptop.dispose();
    if (desk) desk.vacancy.visible = true;
    workerViews.delete(id);
  }
  renderWorkers((id) => openWorkerTerminal(id));
}
store.on('workers', syncWorkers);

// ---- Actions ------------------------------------------------------------------------------------
function freeDesk(): string | null {
  // Prefer the empty desk nearest to you.
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
  return best;
}

function hire(deskId: string, prompt?: string, worktree = false) {
  net.send({ t: 'worker.spawn', deskId, prompt, worktree });
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
      subtitle: 'A fresh Claude Code worker will sit down and start on this right away.',
      submitLabel: 'Hire & start',
      worktreeOption: !!store.project?.branch,
      onSubmit: (text, o) => hire(deskId, text, o.worktree),
    });
  } else if (w.status === 'exited' || w.status === 'offline') {
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

function killWorker(id: string) {
  const w = store.workers.get(id);
  if (!w) return;
  confirmDialog(`Send ${w.name} home?`, `This stops the Claude Code session at ${DESK_BY_ID.get(w.deskId)?.label ?? 'the desk'} for everyone and frees the desk.`, 'Send home', () =>
    net.send({ t: 'worker.kill', workerId: id }),
  );
}

function resumeWorker(w: WorkerInfo) {
  if (!w.sessionId && w.kind !== 'shell') toast(`${w.name} has no saved Claude session — starting a fresh one`, 'warn');
  net.send({ t: 'worker.resume', workerId: w.id });
}

/** Opening a sleeping worker's terminal wakes it, so there's nothing to press first. */
function openWorkerTerminal(id: string) {
  const w = store.workers.get(id);
  if (!w) return;
  if (w.status === 'exited' || w.status === 'offline') resumeWorker(w);
  openTerminal(net, id);
}

function boardActions() {
  return {
    assign: (prompt: string, title: string) => {
      const desk = freeDesk();
      if (!desk) {
        toast('Every desk is taken — send a worker home first', 'warn');
        return;
      }
      openPrompt({
        title: `🤖 ${title}`,
        subtitle: `A new worker will take ${DESK_BY_ID.get(desk)!.label}.`,
        initial: prompt,
        submitLabel: 'Hire & start',
        worktreeOption: !!store.project?.branch,
        onSubmit: (text, o) => hire(desk, text, o.worktree),
      });
    },
  };
}

function watchShare() {
  const streams = currentShares();
  if (!streams.length) {
    void toggleShare();
    return;
  }
  const video = h('video', { autoplay: true, playsinline: true, muted: true }) as HTMLVideoElement;
  const [who, stream] = streams[0];
  video.srcObject = stream;
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const el = h('div.modal.viewer', { role: 'dialog', 'aria-label': 'Screen share' }, h('header', {}, h('h2', {}, `🖥️ ${who}'s screen`), close), video);
  const modal = openModal(el, { onClose: () => (video.srcObject = null) });
  close.addEventListener('click', () => modal.close());
}

function interact(target: Interactable | null, key: 'E' | 'P' | 'R' | 'X' | 'B') {
  if (!target) return;
  if (target.kind === 'desk' && target.deskId) {
    const w = store.workerAtDesk(target.deskId);
    if (key === 'B' && !w) return openShell(target.deskId);
    if (key === 'P') return promptAtDesk(target.deskId);
    if (key === 'E') return w ? openWorkerTerminal(w.id) : hire(target.deskId);
    if (key === 'R' && w && (w.status === 'exited' || w.status === 'offline')) return resumeWorker(w);
    if (key === 'X' && w) return killWorker(w.id);
    return;
  }
  if (key !== 'E') return;
  if (target.kind === 'issues' || target.kind === 'pulls') openBoard(target.kind, net, boardActions());
  else if (target.kind === 'services') openServices();
  else if (target.kind === 'tv') watchShare();
  else if (target.kind === 'coffee') toast('☕ Mmm, fresh coffee. +10 focus');
}

// ---- Interaction targeting & hint -----------------------------------------------------------------
let target: Interactable | null = null;
let hintKey = '';

function pickTarget(): Interactable | null {
  let best: Interactable | null = null;
  let bestD = Infinity;
  for (const it of office.interactables) {
    const d = Math.hypot(it.x - player.pos.x, it.z - player.pos.z);
    if (d < it.radius && d < bestD) {
      best = it;
      bestD = d;
    }
  }
  return best;
}

function key(k: string, label: string) {
  return h('span', {}, h('span.key', {}, k), label);
}

function renderHint() {
  const el = $('hint');
  if (!target || modalOpen()) {
    if (hintKey) {
      el.classList.add('hidden');
      hintKey = '';
    }
    return;
  }
  let parts: (HTMLElement | string)[] = [];
  let k = target.kind + (target.deskId ?? '');
  if (target.kind === 'desk' && target.deskId) {
    const w = store.workerAtDesk(target.deskId);
    const desk = DESK_BY_ID.get(target.deskId)!;
    if (!w) parts = [h('span.title', {}, `${desk.label} · empty`), key('E', 'Hire a worker'), key('P', 'Hire with a task'), key('B', 'Shell')];
    else {
      k += w.status + w.id;
      const asleep = w.status === 'exited' || w.status === 'offline';
      const doing = w.activity ? (w.activity.length > 48 ? `${w.activity.slice(0, 47)}…` : w.activity) : '';
      k += doing;
      parts = [
        h('span.title', {}, `${w.name} · ${STATUS_LABEL[w.status]}`),
        doing ? h('span', { style: 'opacity:.75;font-weight:600' }, doing) : '',
        key('E', 'Open terminal'),
        asleep ? key('R', w.kind === 'shell' ? 'Restart' : 'Resume') : key('P', w.kind === 'shell' ? 'Run command' : 'Prompt'),
        key('X', 'Send home'),
      ];
    }
  } else if (target.kind === 'issues') parts = [h('span.title', {}, '📌 Issues board'), key('E', 'Open')];
  else if (target.kind === 'pulls') parts = [h('span.title', {}, '🔀 Pull request board'), key('E', 'Open')];
  else if (target.kind === 'services') parts = [h('span.title', {}, '🌐 Services board'), key('E', 'Open')];
  else if (target.kind === 'tv') {
    const any = currentShares().length > 0;
    k += any;
    parts = [h('span.title', {}, '📺 Office TV'), key('E', any ? 'Watch full screen' : 'Share your screen')];
  } else if (target.kind === 'coffee') parts = [h('span.title', {}, '☕ Coffee machine'), key('E', 'Grab a cup')];
  if (k === hintKey) return;
  hintKey = k;
  el.replaceChildren(...parts);
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

function use(it: Interactable | null, key: 'E' | 'P' | 'R' | 'X' | 'B') {
  if (!it) return;
  reach();
  interact(it, key);
}

// ---- Input ----------------------------------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (modalOpen() || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.code) {
    case 'KeyE':
      use(target, 'E');
      break;
    case 'KeyP':
      e.preventDefault();
      use(target, 'P');
      break;
    case 'KeyR':
      use(target, 'R');
      break;
    case 'KeyX':
      use(target, 'X');
      break;
    case 'KeyB':
      use(target, 'B');
      break;
    case 'KeyT':
    case 'Enter':
      e.preventDefault();
      ($('chat-input') as HTMLInputElement).focus();
      break;
    case 'KeyV':
      void toggleVoice();
      break;
    case 'KeyM':
      voice.toggleMute();
      break;
    case 'KeyH':
      openHelp();
      break;
    default:
      return;
  }
  player.clearKeys();
});

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
const REACH: Record<InteractKind, number> = { desk: 4.5, coffee: 3, issues: 9, pulls: 9, services: 9, tv: 10 };
const eye = new THREE.Vector3();

/** What the ray through `ndc` lands on first, and whether it is within reach (plus `slack` meters). */
function aimedAt(ndc: THREE.Vector2, slack = 0): { it: Interactable; near: boolean } | null {
  raycaster.setFromCamera(ndc, camera);
  eye.set(player.pos.x, player.pos.y + EYE_HEIGHT, player.pos.z);
  for (const hit of raycaster.intersectObject(office.group, true)) {
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
  for (const [id, s] of voice.remoteScreens()) out.push([store.peers.get(id)?.name ?? 'Someone', s]);
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
$('btn-voice').addEventListener('click', () => void toggleVoice());
$('btn-mute').addEventListener('click', () => voice.toggleMute());
$('btn-share').addEventListener('click', () => void toggleShare());
$('btn-issues').addEventListener('click', () => openBoard('issues', net, boardActions()));
$('btn-pulls').addEventListener('click', () => openBoard('pulls', net, boardActions()));
mountServicesButton($('btn-services'));
$('btn-team').addEventListener('click', () => openTeam(net));
$('btn-upgrade').addEventListener('click', () => openUpgrade(net));
$('btn-help').addEventListener('click', () => openHelp());
$('btn-settings').addEventListener('click', () =>
  openSettings(
    settings,
    (s) => {
      Object.assign(settings, s);
      saveSettings(settings);
      player.setView(settings.view);
    },
    editProfile,
  ),
);

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

function frame(ts?: number) {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();

  player.update(dt);
  me.root.position.copy(player.pos);
  me.root.rotation.y = player.facing;
  me.update(dt, t, player.moving && player.grounded, !player.grounded);
  me.setVoiceLevel(voice.inVoice ? voice.localLevel : 0);
  const firstPerson = player.view === 'first';
  // In first person you are the camera; in third, hide yourself when it's zoomed in right behind your head.
  me.root.visible = !firstPerson && camera.position.distanceTo(new THREE.Vector3(player.pos.x, player.pos.y + 1.3, player.pos.z)) > 1.5;
  if (firstPerson) hands.update(dt, t, { yaw: player.camYaw, pitch: player.lookPitch, walkPhase: player.walkPhase, walking: player.moving && player.grounded, airborne: !player.grounded });

  const now = performance.now();
  const moved = Math.abs(player.pos.x - lastSent.x) + Math.abs(player.pos.y - lastSent.y) + Math.abs(player.pos.z - lastSent.z) > 0.01 || Math.abs(player.facing - lastSent.rotY) > 0.02;
  if ((moved || player.moving !== lastSent.moving) && now - lastSent.at > 66) {
    lastSent = { x: player.pos.x, y: player.pos.y, z: player.pos.z, rotY: player.facing, moving: player.moving, at: now };
    net.send({ t: 'move', x: player.pos.x, y: player.pos.y, z: player.pos.z, rotY: player.facing, moving: player.moving });
  }

  for (const [id, r] of remotes) {
    const p = store.peers.get(id);
    if (!p) continue;
    r.target.set(p.x, p.y, p.z);
    const pos = r.person.root.position;
    pos.lerp(r.target, Math.min(1, dt * 12));
    let diff = p.rotY - r.person.root.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    r.person.root.rotation.y += diff * Math.min(1, dt * 12);
    r.person.update(dt, t, p.moving && p.y < 0.05 + 0.8, p.y > 0.05 && Math.abs(pos.y - r.target.y) > 0.01);
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
    v.model.update(dt, t);
    const desk = DESK_BY_ID.get(v.deskId)!;
    v.laptop.update(dt, store.screens.get(id), Math.hypot(desk.x - camPos.x, desk.z - camPos.z));
  }
  office.update(t);

  if (modalOpen()) target = null;
  else if (firstPerson) {
    const aim = aimedAt(CROSSHAIR);
    target = aim?.near ? aim.it : null;
  } else target = pickTarget();
  renderHint();
  renderCrosshair();

  if (now - speakTick > 200) {
    speakTick = now;
    updateSpeaking(voice);
  }

  effect.render(scene, camera);
  if (firstPerson) {
    // Hands go on top of everything, so they never clip into a desk you walk up to.
    renderer.clearDepth();
    effect.render(hands.scene, hands.camera);
  }
  requestAnimationFrame(frame);
}

// ---- Boot ------------------------------------------------------------------------------------------
function boot() {
  net.connect();
  requestAnimationFrame(frame);
  if ('Notification' in window && Notification.permission === 'default') {
    window.addEventListener('pointerdown', () => void Notification.requestPermission().catch(() => {}), { once: true });
  }
}

const saved = loadProfile();
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

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__office = { store, player, camera, workerViews, scene, net, renderer, hands, me, remotes, settings };
(window as any).__voice = voice;
