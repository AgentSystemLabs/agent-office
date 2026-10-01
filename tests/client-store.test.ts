import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EMPTY_PLAN } from '../src/shared/floorplan.js';
import { parked } from '../src/shared/garage.js';
import { JUKEBOX_TUNES } from '../src/shared/jukebox.js';
import type { ServerMsg } from '../src/shared/protocol.js';

// The store keeps the floor you're on in localStorage and times things by performance.now(): stand both
// in, before the store's module makes the store.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, String(v)), removeItem: (k: string) => void storage.delete(k) },
});
let clock = 1000;
Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => (clock += 10) });

const state = await import('../src/client/state/index.js');
const { store } = state;

const msg = (m: object) => m as ServerMsg;
const peer = (id: string, extra: object = {}) => ({ id, name: id, color: '#fff', look: {}, x: 0, y: 0, z: 0, rotY: 0, moving: false, floor: 'f1', ...extra });
const worker = (id: string, deskId: string, extra: object = {}) => ({ id, deskId, name: id, color: '#fff', kind: 'agent', status: 'working', createdAt: 1, ...extra });
const el = (id: string, version: number) => ({ id, version, versionNonce: 1 });

/** Everything on a floor, as `welcome` and `floor.enter` bring it. */
function floorView(floor: string) {
  return {
    floor,
    project: { name: floor, dir: `/p/${floor}`, agentCmd: 'claude', defaultProvider: 'claude', agentProviders: ['claude'] },
    workers: [worker(`${floor}-w1`, 'desk-1')],
    issues: { items: [], fetchedAt: 1, loading: false },
    pulls: { items: [], fetchedAt: 1, loading: false },
    queue: { tasks: [], maxWorkers: 2 },
    decor: [],
    furnishings: { plants: 'ficus', rugs: 'ocean', lamps: 'globe', sofa: 'red' },
    plan: { labels: {}, wing: 1 },
    services: { items: [], port: 4600 },
    dog: { name: 'Rex', coat: 0, breed: 'lab', path: [[0, 0]], speed: 1, elapsed: 100 },
    jukebox: { on: true, track: 'lofi', startedAt: 5000, elapsed: 300 },
    cabinet: { player: null, scores: [], frame: null },
    whiteboard: { elements: [el('e1', 1)], people: [] },
    meeting: { current: null, past: [] },
    ball: {},
    cars: [{ x: 0, z: 0, rotY: 0, speed: 0, steer: 0, driver: 'p-b' }],
    jail: { prisoners: [], bones: 0 },
  };
}

const welcome = () =>
  msg({
    t: 'welcome',
    you: 'p-a',
    peers: [peer('p-a', { seat: 's1' }), peer('p-b', { seat: 's2' })],
    floors: [{ id: 'f1', name: 'f1' }, { id: 'f2', name: 'f2' }],
    projectsDir: { dir: '~/p', custom: false },
    ice: [],
    chat: [],
    invites: false,
    upgrade: { available: false, phase: 'idle' },
    usage: { total: {}, today: {}, day: 'd', pauseHiring: false },
    limits: { windows: [], at: 1 },
    me: { admin: true },
    notify: {},
    machine: { cpu: 0, cores: 1, memUsed: 0, memTotal: 1, history: [], workers: 1 },
    sky: { hour: 1 },
    theme: { pick: 'auto', active: null },
    map: { pick: 'office', custom: [] },
    prompts: { custom: {} },
    leaveOnMerge: { on: false },
    ...floorView('f1'),
  });

/** What a floor you arrive on fires, in order. */
const FLOOR_TOPICS = ['floor', 'project', 'workers', 'issues', 'pulls', 'queue', 'meeting', 'decor', 'floorPlan', 'services', 'dog', 'jukebox', 'whiteboard', 'drawing', 'cabinet', 'cabinetFrame', 'ball', 'cars', 'jail', 'furnishings'];

/** Every topic, to listen for them all. */
const TOPICS = ['peers', 'workers', 'issues', 'pulls', 'chat', 'project', 'screens', 'team', 'upgrade', 'services', 'decor', 'floorPlan', 'usage', 'limits', 'queue', 'me', 'accounts', 'signins', 'notify', 'machine', 'floors', 'floor', 'projectsDir', 'repos', 'dog', 'jukebox', 'sky', 'theme', 'map', 'leaveOnMerge', 'whiteboard', 'drawing', 'cabinet', 'cabinetFrame', 'meeting', 'prompts', 'ball', 'cars', 'jail', 'furnishings'] as const;

/** Every message the store takes in (and one it doesn't), and the topics it fires, in the order it has always fired them. */
const RUN: [ServerMsg, string[]][] = [
  [welcome(), ['map', ...FLOOR_TOPICS, 'peers', 'chat', 'upgrade', 'usage', 'limits', 'me', 'notify', 'machine', 'floors', 'projectsDir', 'sky', 'theme', 'prompts', 'leaveOnMerge']],
  [msg({ t: 'pong', at: 0, now: 1_000_000 }), ['jukebox']],
  [msg({ t: 'pong', at: -1e6, now: 1_000_000 }), []],
  [msg({ t: 'floors', floors: [{ id: 'f1', name: 'f1' }] }), ['floors']],
  [msg({ t: 'projectsDir', state: { dir: '~/q', custom: true } }), ['projectsDir']],
  [msg({ t: 'floor.repos', repos: [] }), ['repos']],
  [msg({ t: 'peer.join', peer: peer('p-c') }), ['peers']],
  [msg({ t: 'peer.update', peer: peer('p-c', { name: 'C' }) }), ['peers']],
  [msg({ t: 'peer.move', id: 'p-c', x: 1, y: 0, z: 1, rotY: 0, moving: true }), []],
  [msg({ t: 'peer.leave', id: 'p-c' }), ['peers']],
  [msg({ t: 'worker.update', worker: worker('w-2', 'desk-2') }), ['workers']],
  [msg({ t: 'screen', workerId: 'w-2', cols: 80, rows: 24, lines: { 0: [['hi', 1, -1, 0]] }, full: true, cursor: [0, 0] }), ['screens']],
  [msg({ t: 'worker.remove', workerId: 'w-2' }), ['workers']],
  [msg({ t: 'worker.remove', workerId: 'f1-w1', jail: { prisoners: [{ id: 'f1-w1' }], bones: 0 } }), ['workers', 'jail']],
  [msg({ t: 'gh.issues', state: { items: [], fetchedAt: 2, loading: false } }), ['issues']],
  [msg({ t: 'gh.pulls', state: { items: [], fetchedAt: 2, loading: false } }), ['pulls']],
  [msg({ t: 'team', state: {} }), ['team']],
  [msg({ t: 'me', me: { admin: false } }), ['me']],
  [msg({ t: 'accounts', state: {} }), ['accounts']],
  [msg({ t: 'signins', state: {} }), ['signins']],
  [msg({ t: 'upgrade', state: { available: true, phase: 'idle' } }), ['upgrade']],
  [msg({ t: 'services', state: { items: [], port: 1 } }), ['services']],
  [msg({ t: 'decor', items: [] }), ['decor']],
  [msg({ t: 'plan', plan: { labels: {}, wing: 2 } }), ['floorPlan']],
  [msg({ t: 'jukebox', state: { on: false, track: 'lofi', startedAt: 0, elapsed: 0 } }), ['jukebox']],
  [msg({ t: 'cabinet', state: { player: { id: 'p-b' }, scores: [] } }), ['cabinet']],
  [msg({ t: 'furnishings', furnishings: { plants: 'mixed', rugs: 'none', lamps: 'disco', sofa: 'grey' } }), ['furnishings']],
  [msg({ t: 'cabinet.frame', frame: { board: [] } }), ['cabinetFrame']],
  [msg({ t: 'wb.update', elements: [el('e2', 1)] }), ['whiteboard']],
  [msg({ t: 'wb.update', elements: [el('e2', 0)] }), []],
  [msg({ t: 'wb.people', people: ['p-a'] }), ['drawing']],
  [msg({ t: 'usage', state: {} }), ['usage']],
  [msg({ t: 'limits', state: {} }), ['limits']],
  [msg({ t: 'queue', state: { tasks: [], maxWorkers: 1 } }), ['queue']],
  [msg({ t: 'meeting', state: { current: null, past: [] } }), ['meeting']],
  [msg({ t: 'notify', state: {} }), ['notify']],
  [msg({ t: 'machine', state: {} }), ['machine']],
  [msg({ t: 'dog', dog: null }), ['dog']],
  [msg({ t: 'ball', ball: {} }), ['ball']],
  [msg({ t: 'cars', cars: [{ x: 0, z: 0, rotY: 0, speed: 0, steer: 0 }] }), ['cars']],
  [msg({ t: 'car.move', car: 0, x: 1, z: 1, rotY: 0, speed: 1, steer: 0 }), []],
  [msg({ t: 'sky', state: { hour: 2 } }), ['sky']],
  [msg({ t: 'theme', state: { pick: 'none', active: null } }), ['theme']],
  [msg({ t: 'map', state: { pick: 'office', custom: [] } }), ['map']],
  [msg({ t: 'map', state: { pick: 'castle', custom: [] } }), ['map', 'peers']],
  [msg({ t: 'prompts', state: { custom: {} } }), ['prompts']],
  [msg({ t: 'leaveOnMerge', state: { on: true } }), ['leaveOnMerge']],
  [msg({ t: 'chat', name: 'A', color: '#fff', text: 'hi', at: 1 }), ['chat']],
  [msg({ t: 'toast', text: 'hi', level: 'info' }), []],
  [msg({ t: 'floor.enter', peers: [peer('p-a', { floor: 'f2' })], ...floorView('f2') }), [...FLOOR_TOPICS, 'peers']],
];

test('every message fires the topics it always has, in the same order', () => {
  let fired: string[] = [];
  const offs = TOPICS.map((t) => store.on(t, () => fired.push(t)));
  for (const [m, topics] of RUN) {
    fired = [];
    store.apply(m);
    assert.deepEqual(fired, topics, m.t);
  }
  for (const off of offs) off();
});

test('each message leaves the fields it always has', () => {
  store.apply(welcome());
  assert.equal(store.you, 'p-a');
  assert.equal(store.floor, 'f1');
  assert.deepEqual([...store.workers.keys()], ['f1-w1']);
  assert.equal(store.carOf('p-b')?.seat, 'driver');
  assert.equal(storage.get('agent-office.floor'), 'f1');
  // A screen that changes size starts over.
  store.apply(msg({ t: 'screen', workerId: 'f1-w1', cols: 80, rows: 24, lines: { 1: [['a', 1, -1, 0]] }, full: true, cursor: [1, 1] }));
  store.apply(msg({ t: 'screen', workerId: 'f1-w1', cols: 80, rows: 24, lines: { 2: [['b', 1, -1, 0]] }, full: false, cursor: [2, 2] }));
  assert.deepEqual({ ...store.screens.get('f1-w1'), lines: store.screens.get('f1-w1')!.lines.length }, { cols: 80, rows: 24, cursor: [2, 2], version: 3, lines: 3 });
  store.apply(msg({ t: 'screen', workerId: 'f1-w1', cols: 90, rows: 24, lines: {}, full: false, cursor: [0, 0] }));
  assert.equal(store.screens.get('f1-w1')!.version, 5);
  assert.equal(store.screens.get('f1-w1')!.lines.length, 0);
  // Somebody else at the cabinet: the last game's screen goes.
  store.apply(msg({ t: 'cabinet', state: { player: { id: 'p-a' }, scores: [] } }));
  store.apply(msg({ t: 'cabinet.frame', frame: { board: [1] } }));
  store.apply(msg({ t: 'cabinet', state: { player: { id: 'p-a' }, scores: [1] } }));
  assert.deepEqual(store.cabinetFrame, { board: [1] });
  store.apply(msg({ t: 'cabinet', state: { player: { id: 'p-b' }, scores: [] } }));
  assert.equal(store.cabinetFrame, null);
  // Onto another map: nobody's sitting any more.
  assert.equal(store.peers.get('p-a')!.seat, 's1');
  store.apply(msg({ t: 'map', state: { pick: 'castle', custom: [] } }));
  assert.equal(store.peers.get('p-a')!.seat, undefined);
  assert.equal(store.plan().id, 'castle');
  // The chat keeps the last 200 lines.
  for (let i = 0; i < 205; i++) store.apply(msg({ t: 'chat', name: 'A', color: '#fff', text: `${i}`, at: i }));
  assert.equal(store.chat.length, 200);
  assert.equal(store.chat[0].text, '5');
  // The quickest pong sets the office's clock.
  store.apply(msg({ t: 'pong', at: clock, now: 5_000_000 }));
  const now = store.officeNow();
  assert.ok(now > 5_000_000 && now < 5_001_000, String(now));
  // A car that isn't there doesn't move.
  store.apply(msg({ t: 'car.move', car: 5, x: 1, z: 1, rotY: 0, speed: 1, steer: 0 }));
  assert.equal(store.cars.length, 1);
});

test('a listener sees the store as it was when its topic fired', () => {
  store.apply(welcome());
  const seen: Record<string, unknown> = {};
  const offs = [
    // The map fires before the floor is taken in, the jukebox's clock already forgotten.
    store.on('map', () => (seen.map = { floor: store.floor, workers: [...store.workers.keys()], clock: store.clock })),
    // The floor's topics fire once all of it is in, and the people's once the floor's have.
    store.on('floor', () => (seen.floor = { peers: [...store.peers.keys()], jail: store.jail.bones, cars: store.cars.length })),
    store.on('workers', () => (seen.workers = store.jail.bones)),
  ];
  store.apply(msg({ t: 'floor.enter', peers: [peer('p-z', { floor: 'f2' })], ...floorView('f2'), jail: { prisoners: [], bones: 3 } }));
  assert.deepEqual(seen.floor, { peers: ['p-z'], jail: 3, cars: 1 });
  store.apply(msg({ t: 'pong', at: clock, now: 9_000_000 }));
  store.apply({ ...welcome(), floor: 'f1', workers: [worker('w-9', 'desk-9')] } as ServerMsg);
  assert.deepEqual(seen.map, { floor: 'f2', workers: ['f2-w1'], clock: undefined });
  // Sent home to the dungeon: the workers' listeners already see the jail.
  store.apply(msg({ t: 'worker.remove', workerId: 'w-9', jail: { prisoners: [{ id: 'w-9' }], bones: 7 } }));
  assert.equal(seen.workers, 7);
  for (const off of offs) off();
});

test('what the browser remembers keeps its keys and shapes', () => {
  state.saveProfile({ name: 'Ann', color: '#fff' });
  assert.deepEqual(JSON.parse(storage.get('agent-office.profile')!), { name: 'Ann', color: '#fff' });
  assert.deepEqual(state.loadProfile(), { name: 'Ann', color: '#fff', look: undefined });
  state.rememberSpot({ floor: 'f1', name: 'F', x: 1, y: 2, z: 3, facing: 4 });
  assert.deepEqual(state.lastSpot(), { floor: 'f1', name: 'F', x: 1, y: 2, z: 3, facing: 4 });
  assert.ok(storage.has('agent-office.spot'));
  const settings = state.loadSettings();
  assert.deepEqual(settings, { view: 'first', volume: 0.7, muted: false, music: 0.5, musicMuted: false, pageTurns: true, pushToTalk: false, notify: true, hud: state.HUD_DEFAULTS, pins: [] });
  state.saveSettings({ ...settings, volume: 2, view: 'third' });
  assert.equal(state.loadSettings().volume, 1);
  assert.equal(state.loadSettings().view, 'third');
  store.apply(welcome());
  assert.equal(state.lastFloor(), 'f1');
});

test("the store's keys are its state, as window.__office shows them", () => {
  // As the office had them before its store was split into slices: methods and the slices aren't among them.
  assert.deepEqual(Object.keys(store).sort(), ['accounts', 'ball', 'cabinet', 'cabinetFrame', 'cars', 'carsAt', 'chat', 'clock', 'decor', 'dog', 'dogStart', 'drawing', 'floor', 'floorPlan', 'floors', 'furnishings', 'ice', 'invites', 'issues', 'jail', 'jukebox', 'leaveOnMerge', 'limits', 'machine', 'map', 'me', 'meeting', 'notify', 'peers', 'profile', 'project', 'projectsDir', 'prompts', 'pulls', 'queue', 'repos', 'screens', 'services', 'signins', 'sky', 'subs', 'team', 'theme', 'upgrade', 'usage', 'whiteboard', 'workers', 'you']);
});

test('a new store starts every field where it always has', async () => {
  const { Store } = await import('../src/client/state/store.js');
  const { SLICES } = await import('../src/client/state/slices/index.js');
  const s = new Store(SLICES);
  const { profile, subs, ...rest } = Object.fromEntries(Object.entries(s));
  void subs;
  assert.deepEqual({ name: profile.name, color: profile.color }, { name: 'Guest', color: '#4f86f7' });
  assert.deepEqual(
    JSON.parse(JSON.stringify(rest, (_k, v) => (v instanceof Map ? [...v] : v === undefined ? '<undefined>' : v))),
    {
      you: '', peers: [], workers: [], screens: [], project: null, floors: [], floor: null, projectsDir: { dir: '', custom: false },
      repos: { list: [], loading: false, at: 0 }, issues: { items: [], fetchedAt: 0, loading: true }, pulls: { items: [], fetchedAt: 0, loading: true },
      ice: [], chat: [], invites: false, queue: { tasks: [], maxWorkers: 0 }, me: { admin: false },
      upgrade: { available: false, phase: 'idle' },
      usage: { total: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 }, today: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, calls: 0 }, day: '', pauseHiring: false },
      limits: { windows: [], at: 0 }, notify: {}, machine: { cpu: 0, cores: 0, memUsed: 0, memTotal: 0, history: [], workers: 0 },
      sky: null, theme: { pick: 'auto', active: null }, prompts: { custom: {} }, leaveOnMerge: { on: false }, map: { pick: 'office', custom: [] },
      meeting: { current: null, past: [] }, decor: [], floorPlan: EMPTY_PLAN, services: { items: [], port: 4600 },
      dog: null, dogStart: 0, jukebox: { on: false, track: JUKEBOX_TUNES[0].id, startedAt: 0, elapsed: 0, since: 0 }, clock: '<undefined>',
      whiteboard: [], drawing: [], cabinet: { player: null, scores: [] }, cabinetFrame: null, ball: {},
      cars: parked(), carsAt: [], jail: { prisoners: [], bones: 0 },
      team: null, accounts: null, signins: null, furnishings: { plants: 'mixed', rugs: 'pastel', lamps: 'cone', sofa: 'blue' },
    },
  );
});

test('every slice in state/slices is registered, once', async () => {
  const { SLICES } = await import('../src/client/state/slices/index.js');
  const core = await import('../src/client/state/core.js');
  assert.equal(new Set(SLICES).size, SLICES.length);
  const dir = path.join(import.meta.dirname, '../src/client/state/slices');
  const slices = [...Object.values(core)];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'index.ts')) {
    const exported = Object.values(await import(pathToFileURL(path.join(dir, f)).href));
    assert.ok(exported.length, `${f} exports its slice`);
    slices.push(...exported);
  }
  for (const s of slices) assert.equal(SLICES.filter((x) => x === s).length, 1, `a slice of ${Object.keys(s as object).join('/')} is registered once`);
  assert.equal(SLICES.length, slices.length);
});

test("a slice's topics fire in its place in the list; a floor's after the message's own, bar the ones the floor hangs on", async () => {
  const { Store } = await import('../src/client/state/store.js');
  const fired: string[] = [];
  const s = new Store([
    { on: { welcome: () => ['a'] }, enter: () => ['a floor'] },
    { beforeFloor: true, on: { welcome: () => ['b'], 'floor.enter': () => ['b'] } },
    { on: { welcome: () => ['c'], toast: () => ['c'] }, enter: () => ['c floor'], methods: { hello: () => 'hi' } },
  ] as never);
  for (const t of ['a', 'a floor', 'b', 'c', 'c floor']) s.on(t as never, () => fired.push(t));
  s.apply(welcome());
  assert.deepEqual(fired, ['b', 'a floor', 'c floor', 'a', 'c']);
  fired.length = 0;
  s.apply(msg({ t: 'floor.enter', peers: [], ...floorView('f2') }));
  assert.deepEqual(fired, ['b', 'a floor', 'c floor']);
  fired.length = 0;
  s.apply(msg({ t: 'toast', text: '', level: 'info' }));
  assert.deepEqual(fired, ['c']);
  assert.equal((s as unknown as { hello(): string }).hello(), 'hi');
  assert.ok(!Object.keys(s).includes('hello'));
});
