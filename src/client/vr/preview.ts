/**
 * DEV-ONLY debug preview for the world-space VR panels (see vr-preview.html). Renders the
 * menu, a worker terminal and the keyboard to the flat screen with synthetic data — no server,
 * no headset. The mouse is the controller ray: moving hovers, pressing clicks, dragging
 * scrolls, and the wheel emulates the thumbstick. Every action logs to the corner panel (and
 * the console) so ray hit-testing can be verified by eye.
 *
 * Nothing imports this module except vr-preview.html, which production builds exclude.
 */

import * as THREE from 'three';
import type { ChatLine, FloorInfo, GhIssue, GhPull, QueueTask, Run, WorkerInfo } from '../../shared/protocol';
import type { JukeboxState } from '../../shared/jukebox';
import type { ScreenState } from '../world/laptop';
import { attachVrUi, type VrUiDeps } from './attach';

const logEl = document.getElementById('log')!;
const barEl = document.getElementById('bar')!;
function log(...args: unknown[]) {
  const line = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  console.log('[vr-preview]', ...args);
  logEl.textContent = `${line}\n${logEl.textContent}`.slice(0, 4000);
}

// ---- Synthetic office ---------------------------------------------------------------

const now = Date.now();
const workers = new Map<string, WorkerInfo>();
const screens = new Map<string, ScreenState>();
let screenVersion = 1;

function worker(id: string, name: string, color: string, status: WorkerInfo['status'], extra: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    id, kind: 'agent', provider: 'claude', deskId: `desk-${id}`, name, color, status,
    acked: status !== 'needs_input' && status !== 'done', createdBy: 'preview', createdAt: now - 3600_000,
    viewers: [], viewerIds: [], cols: 96, rows: 28, ...extra,
  } as WorkerInfo;
}

workers.set('w1', worker('w1', 'Ada', '#4f86f7', 'working', { waitingSince: now - 1000 }));
workers.set('w2', worker('w2', 'Grace', '#06d6a0', 'needs_input', { waitingSince: now - 600_000, acked: false }));
workers.set('w3', worker('w3', 'Sam', '#ef476f', 'done', { waitingSince: now - 300_000, acked: false, pr: { number: 42, url: 'https://example.invalid/pr/42' } }));

function gridLine(text: string, fg = -1, bg = -1, flags = 0): Run[] {
  return [[text, fg, bg, flags]];
}

function demoScreen(seed: number): ScreenState {
  const cols = 96;
  const rows = 28;
  const lines: Run[][] = [];
  const rainbow = [1, 2, 3, 4, 5, 6];
  lines.push(gridLine('$ agent-office worker --demo', 2, -1, 1));
  lines.push(gridLine(''));
  for (let i = 0; i < 20; i++) {
    const fg = rainbow[(i + seed) % rainbow.length];
    lines.push([[`[${String(i + seed).padStart(3, '0')}] `, 8, -1, 0], [`building module-${i} … `, -1, -1, 0], [i % 4 === 3 ? 'FAIL' : 'ok', i % 4 === 3 ? 1 : 2, -1, 1], [` ${fg}`, fg, -1, 0]]);
  }
  lines.push(gridLine(''));
  lines.push(gridLine('Inv_days… inverse video test', -1, 4, 2));
  lines.push(gridLine('dimmed detail line (dim flag)', -1, -1, 4));
  lines.push([[`truecolor `, -1, -1, 0], ['▓▓▓', 0x1000000 | 0xee6018, -1, 0], [' office orange', -1, -1, 0]]);
  lines.push(gridLine(`$ cursor on row ${rows - 1} — type on the keyboard below`, 2));
  while (lines.length < rows) lines.push(gridLine(''));
  return { cols, rows, lines: lines.slice(0, rows), cursor: [2, rows - 1], version: screenVersion };
}

screens.set('w1', demoScreen(0));
screens.set('w2', demoScreen(40));
screens.set('w3', demoScreen(80));

const issues: GhIssue[] = [
  { number: 101, title: 'Dog walks through the jukebox on floor 2', state: 'OPEN', url: '#', author: 'nik', labels: [{ name: 'bug', color: 'ee6018' }], assignees: [], createdAt: '', updatedAt: '', body: 'Steps to reproduce: hire a worker, wait for the dog. The good boy phases straight through the jukebox cabinet. Expected: collision. Actual: ghost dog.', comments: 4 },
  { number: 102, title: 'Add rooftop bar drink: espresso martini', state: 'OPEN', url: '#', author: 'ada', labels: [{ name: 'feature', color: '06d6a0' }], assignees: ['nik'], createdAt: '', updatedAt: '', body: 'The people demand it. Shaken, not stirred, served at the DJ booth.', comments: 12 },
  { number: 103, title: 'Laptop screens flicker at midnight (sky bug?)', state: 'CLOSED', url: '#', author: 'sam', labels: [], assignees: [], createdAt: '', updatedAt: '', body: '', comments: 0 },
];
const pulls: GhPull[] = [
  { number: 42, title: 'Fix ghost dog collision', state: 'OPEN', isDraft: false, url: '#', author: 'grace', labels: [], reviewDecision: '', headRefName: 'fix/ghost-dog', baseRefName: 'main', createdAt: '', updatedAt: '', additions: 120, deletions: 30, checks: 'pass', body: 'Collider added to the jukebox. The dog now walks around it, disappointed.', closes: [101] },
  { number: 43, title: 'WIP: espresso martini', state: 'OPEN', isDraft: true, url: '#', author: 'ada', labels: [], reviewDecision: '', headRefName: 'feat/espresso-martini', baseRefName: 'main', createdAt: '', updatedAt: '', additions: 5, deletions: 1, checks: 'pending', body: 'Do not merge yet. Glassware pending.', closes: [] },
];
const tasks: QueueTask[] = [
  { id: 't1', title: '#101 ghost dog', prompt: 'fix the dog', addedBy: 'nik', addedAt: now - 5000, status: 'running', issue: 101, workerId: 'w2', workerName: 'Grace', branch: 'fix/ghost-dog' },
  { id: 't2', title: '#102 espresso martini', prompt: 'mix drinks', addedBy: 'ada', addedAt: now - 60000, status: 'queued', issue: 102 },
  { id: 't3', title: 'Refactor confetti physics', prompt: 'confetti', addedBy: 'sam', addedAt: now - 90000, status: 'queued' },
  { id: 't4', title: 'Old task with a PR', prompt: 'old', addedBy: 'nik', addedAt: now - 8000000, status: 'done', finishedAt: now - 7000000, outcome: 'done', workerName: 'Sam', pr: { number: 42, url: '#', title: 'Fix ghost dog collision', state: 'OPEN' } },
];

type Topic = 'screens' | 'workers' | 'issues' | 'pulls' | 'queue' | 'chat' | 'floors' | 'floor' | 'jukebox' | 'meeting' | 'services' | 'peers' | 'dog';
const subs = new Map<Topic, Set<() => void>>();
function emit(t: Topic) {
  subs.get(t)?.forEach((fn) => fn());
}

const chat: ChatLine[] = [
  { from: 'nik', name: 'Nik', color: '#ee6018', text: 'who took my bean bag', at: now - 90000 },
  { from: 'ada', name: 'Ada', color: '#4f86f7', text: 'the dog did. he looked guilty', at: now - 60000 },
];
const floors: FloorInfo[] = [
  { id: 'f1', name: 'agent-office', repo: 'nik/agent-office', dir: '/tmp/f1', palette: 0, addedBy: 'nik', addedAt: now - 8000000, workers: 3, busy: 1, waiting: 1, people: 1 },
  { id: 'f2', name: 'droidproxy', dir: '/tmp/f2', palette: 2, addedBy: 'nik', addedAt: now - 7000000, workers: 1, busy: 0, waiting: 0, people: 0 },
];
const jukebox: JukeboxState = { on: true, track: 'coffee-break', by: 'Ada', startedAt: now - 45000, elapsed: 0 };

let muted = false;
const deps: VrUiDeps = {
  send: (msg) => {
    log('send', msg.t, (msg as { workerId?: string }).workerId ?? '', (msg as { data?: string }).data ? JSON.stringify((msg as { data?: string }).data) : '');
    // Typing echoes into the fake screen so the keyboard visibly works.
    if (msg.t === 'term.input') {
      const s = screens.get(msg.workerId);
      if (s) {
        const row = s.cursor[1];
        const line = s.lines[row] ?? [];
        const text = line.map((r) => r[0]).join('') + msg.data.replace(/[\r\n]/g, '');
        s.lines[row] = [[text.slice(-s.cols), -1, -1, 0]];
        s.cursor = [Math.min(s.cols - 1, text.length), row];
        s.version = ++screenVersion;
        emit('screens');
      }
    }
  },
  subscribe: (topic, fn) => {
    let set = subs.get(topic);
    if (!set) subs.set(topic, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  },
  getScreen: (id) => screens.get(id),
  getWorker: (id) => workers.get(id),
  getWorkers: () => [...workers.values()],
  getIssues: () => ({ items: issues, fetchedAt: now, loading: false }),
  getPulls: () => ({ items: pulls, fetchedAt: now, loading: false }),
  getQueue: () => ({ tasks, maxWorkers: 2 }),
  getFreeDesks: () => [
    { id: 'd4', label: 'Desk 4' },
    { id: 'd5', label: 'Desk 5' },
    { id: 'lounge-beanbag', label: '🫘 Lounge bean bag' },
  ],
  getChat: () => chat,
  getFloors: () => floors,
  currentFloor: () => 'f1',
  getJukebox: () => jukebox,
  getMeeting: () => ({ current: null, past: [] }),
  getServices: () => ({ items: [], port: 4600 }),
  getPeers: () => [],
  getDogName: () => 'Biscuit',
  onRoof: () => false,
  barCutOff: () => false,
  getVrSettings: () => ({ glide: false, turn: 'snap', turnSpeed: 90, fade: true }),
  voice: { isMuted: () => muted, inVoice: () => true, toggleMute: () => { muted = !muted; log('mute →', muted); } },
  actions: {
    hire: (deskId) => log('hire at', deskId, '(would open the VR hire prompt)'),
    nextWaiting: () => log('next waiting (would walk to Grace)'),
    promptWorker: (workerId, n, title) => log('prompt worker', workerId, `#${n}`, title),
    queueIssue: (n, title) => log('queue issue', `#${n}`, title),
    ride: (floorId) => log('ride to', floorId),
    jukebox: (op, track) => log('jukebox', op, track ?? ''),
    orderDrink: (id) => log('order drink', id),
    meetingCall: () => log('call a meeting (would open the VR meeting prompts)'),
    meetingStop: () => log('stop the meeting'),
    meetingClear: () => log('clear the room'),
    copyServiceTunnel: (port) => log('copy tunnel for', `:${port}`),
    addFloor: () => log('add a project (would open the VR repo prompt)'),
    addQueueTask: () => log('add a queue task (would open the VR task prompt)'),
    queueLimit: (n) => log('queue width →', n),
    removeQueueTask: (id) => log('remove queue task', id),
    retryQueueTask: (id) => log('requeue task', id),
    commentOn: (kind, n) => log('comment on', kind, `#${n}`),
    closeItem: (kind, n) => log('close', kind, `#${n}`),
    playStream: () => log('play a stream (would open the VR URL prompt)'),
    renameDog: () => log('rename the dog (would open the VR name prompt)'),
    sendChat: (text) => log('say', text),
    vrSettings: (patch) => log('VR settings', JSON.stringify(patch)),
    exitVr: () => log('exit VR (would end the XR session)'),
  },
  workerActions: {
    resume: (workerId) => log('wake', workerId),
    kill: (workerId) => log('send home', workerId),
    killWarning: (workerId) => `Tap again to send ${workerId} home`,
  },
};

// ---- Scene ----------------------------------------------------------------------------

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#101014');
scene.add(new THREE.AmbientLight('#ffffff', 1.2));
// A floor grid so panel distances read at a glance.
const grid = new THREE.GridHelper(8, 16, 0xee6018, 0x333333);
grid.position.y = 0;
scene.add(grid);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 50);
const camHome = new THREE.Vector3(0, 1.5, 0.4);
camera.position.copy(camHome);
camera.lookAt(0, 1.3, -1.1);

const vrUi = attachVrUi(scene, deps);
vrUi.openTerminal('w1');
vrUi.menu.show();
// Face the dash at the camera.
vrUi.terminal.panel.group.lookAt(camera.position);
vrUi.keyboard.panel.group.lookAt(camera.position);
vrUi.keyboard.panel.group.rotateX(-0.35);

(window as unknown as { vrUi: typeof vrUi }).vrUi = vrUi;
log('preview up: menu + terminal (Ada) + keyboard. Click panels with the mouse.');

/** Synthetic-ray tap: dispatches real pointer events at a panel-local point (0..1, top-left origin). */
(window as unknown as { vrTap: (which: 'menu' | 'terminal' | 'keyboard', lx: number, ly: number) => string }).vrTap = (which, lx, ly) => {
  const ui = which === 'menu' ? vrUi.menu : which === 'terminal' ? vrUi.terminal : vrUi.keyboard;
  const v = new THREE.Vector3((lx - 0.5) * ui.panel.width, (0.5 - ly) * ui.panel.height, 0);
  ui.panel.mesh.localToWorld(v);
  v.project(camera);
  const x = ((v.x + 1) / 2) * window.innerWidth;
  const y = ((1 - v.y) / 2) * window.innerHeight;
  const canvas = renderer.domElement;
  const opts = { clientX: x, clientY: y, bubbles: true };
  canvas.dispatchEvent(new PointerEvent('pointermove', opts));
  canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
  window.dispatchEvent(new PointerEvent('pointerup', opts));
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = ui.panel.raycast(raycaster);
  return `tap ${which} @local(${lx.toFixed(3)},${ly.toFixed(3)}) → screen(${Math.round(x)},${Math.round(y)}) uv=${hit ? `${hit.u.toFixed(3)},${hit.v.toFixed(3)}` : 'miss'}`;
};

/** Synthetic-ray drag: real pointer events from one panel-local point to another (scroll test). */
(window as unknown as { vrDrag: (which: 'menu' | 'terminal' | 'keyboard', lx0: number, ly0: number, lx1: number, ly1: number) => string }).vrDrag = (which, lx0, ly0, lx1, ly1) => {
  const ui = which === 'menu' ? vrUi.menu : which === 'terminal' ? vrUi.terminal : vrUi.keyboard;
  const canvas = renderer.domElement;
  const toScreen = (lx: number, ly: number) => {
    const v = new THREE.Vector3((lx - 0.5) * ui.panel.width, (0.5 - ly) * ui.panel.height, 0);
    ui.panel.mesh.localToWorld(v);
    v.project(camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  };
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const p = toScreen(lx0 + ((lx1 - lx0) * i) / steps, ly0 + ((ly1 - ly0) * i) / steps);
    const opts = { clientX: p.x, clientY: p.y, bubbles: true };
    if (i === 0) {
      canvas.dispatchEvent(new PointerEvent('pointermove', opts));
      canvas.dispatchEvent(new PointerEvent('pointerdown', opts));
    } else {
      canvas.dispatchEvent(new PointerEvent('pointermove', opts));
    }
    if (i === steps) window.dispatchEvent(new PointerEvent('pointerup', opts));
  }
  return `drag ${which} (${lx0},${ly0})→(${lx1},${ly1}) done`;
};

// Toolbar: switch views and workers without needing the in-world buttons.
function button(label: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', fn);
  barEl.append(b);
  return b;
}
button('menu: main', () => vrUi.menu.show('main'));
button('menu: hire', () => vrUi.menu.show('hire'));
button('menu: queue', () => vrUi.menu.show('queue'));
button('menu: board', () => vrUi.menu.show('board'));
button('terminal: Ada', () => vrUi.openTerminal('w1'));
button('terminal: Grace', () => vrUi.openTerminal('w2'));
button('terminal: Sam', () => vrUi.openTerminal('w3'));
button('terminal: close', () => vrUi.closeTerminal());
const menuAnchor = vrUi.menu.panel.group.position.clone();
button('follow: on', (function () {
  let on = true;
  return function (this: HTMLButtonElement) {
    on = !on;
    vrUi.menu.panel.setFollow(on);
    if (!on) {
      vrUi.menu.panel.group.position.copy(menuAnchor);
      vrUi.menu.panel.group.lookAt(camera.position);
    }
    this.textContent = `follow: ${on ? 'on' : 'off'}`;
    this.classList.toggle('on', on);
    log('menu follow →', on);
  };
})());
function focus(pos: [number, number, number], look: [number, number, number]) {
  camera.position.set(pos[0], pos[1], pos[2]);
  camera.lookAt(look[0], look[1], look[2]);
}
button('focus: all', () => focus([0, 1.5, 0.9], [0, 1.3, -1.1]));
button('focus: menu', () => { vrUi.menu.panel.setFollow(false); vrUi.menu.panel.group.position.copy(menuAnchor); vrUi.menu.panel.group.lookAt(camera.position); focus([-0.75, 1.35, 0.1], [-0.75, 1.35, -0.95]); });
button('focus: terminal', () => focus([0, 1.5, -0.25], [0, 1.5, -1.15]));
button('focus: keyboard', () => focus([0, 1.45, -0.25], [0, 1.0, -0.95]));

// The mouse is the controller ray.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pressed = false;

function cast(e: MouseEvent) {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

renderer.domElement.addEventListener('pointermove', (e) => {
  cast(e);
  vrUi.routeRay(0, raycaster, pressed);
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  cast(e);
  pressed = true;
  const hit = vrUi.routeRay(0, raycaster, true);
  log('ray down →', hit ? 'panel hit' : 'miss');
});
window.addEventListener('pointerup', (e) => {
  if (!pressed) return;
  pressed = false;
  cast(e);
  vrUi.routeRay(0, raycaster, false);
});
renderer.domElement.addEventListener('wheel', (e) => {
  vrUi.stickScroll(0, Math.sign(e.deltaY) * 0.8, 1 / 60);
}, { passive: true });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Fake live output: Ada's screen ticks every couple of seconds (scrollback grows).
let tick = 0;
setInterval(() => {
  tick++;
  const s = screens.get('w1');
  if (!s) return;
  s.lines = [...s.lines.slice(1), [[`[${tick}] heartbeat ok`, 8, -1, 0]]];
  s.version = ++screenVersion;
  emit('screens');
}, 2500);

let last = performance.now();
const pv = new THREE.Vector3();
const pd = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const nowMs = performance.now();
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  // The flat preview's camera is a plain world-space camera, so its pose is the head pose.
  camera.getWorldPosition(pv);
  camera.getWorldDirection(pd);
  vrUi.update(dt, { pos: [pv.x, pv.y, pv.z], dir: [pd.x, pd.y, pd.z] });
  renderer.render(scene, camera);
});
