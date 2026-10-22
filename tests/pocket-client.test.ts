import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pocketWelcome, pocketUpdates, type PocketSnapshot } from '../src/client/shared/pocket/wire';
import { PocketTransport, verifiedReply, type PocketRequest } from '../src/client/shared/pocket/transport';
import { installPocketBoundary, pocketRuntime } from '../src/client/shared/pocket/runtime';
import type { PeerInfo, ServerMsg, WorkerInfo } from '../src/shared/protocol';
import { initPocketBootstrap, parsePocketBootstrap, readPocketBootstrap, type PocketBootstrap } from '../src/client/shared/pocket/bootstrap';
import { loadProfile, loadSettings, saveSettings, lastSpot, lastFloor, rememberSpot, storageKey } from '../src/client/state/persist';
import { openPocketCustomize } from '../src/client/shared/pocket/native';

const peer: PeerInfo = { id: 'me', name: 'Sam', color: '#ffffff', look: { skin: 0, hair: 0, style: 0 }, x: 0, y: 0, z: 0, rotY: 0, moving: false, voice: false, muted: true, sharing: false };
const worker: WorkerInfo = { id: 'w1', kind: 'agent', provider: 'pi', name: 'Worker', deskId: 'desk-1', color: '#ffffff', status: 'working', acked: true, createdBy: 'Sam', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [] };
const snapshot = (): PocketSnapshot => ({ source: 10, title: 'Project', cwd: '/project', model: 'provider/model', you: 'me', peers: [peer], chat: [], workers: [worker] });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const bootstrapValue = (): PocketBootstrap => ({ person: { id: 'person-1', name: 'Sam', role: 'owner' }, profile: { name: 'Sam', color: '#ffffff', look: { skin: 0, hair: 0, style: 0 } }, snapshot: snapshot() });
const encoded = (b: unknown) => encodeURIComponent(JSON.stringify(b));

function harness(bootstrap: PocketBootstrap = bootstrapValue(), storage = new Map<string, string>()) {
  const saved = ['window', 'document', 'localStorage'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  const requests: PocketRequest[] = [];
  const fetches: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  const parent = { postMessage(message: PocketRequest, origin: string) { assert.equal(origin, 'https://pocket.test'); requests.push(message); } };
  const fake = {
    parent, location: { origin: 'null' }, fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      fetches.push({ input, init });
      return new Response('asset');
    },
    addEventListener(name: string, fn: (e: MessageEvent) => void) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
    removeEventListener(name: string, fn: (e: MessageEvent) => void) { listeners.get(name)?.delete(fn); },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fake });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    baseURI: 'https://pocket.test/s/3',
    querySelector(selector: string) { return { getAttribute() {
      return selector.includes('pocket-runtime') ? '1' : selector.includes('pocket-bootstrap') ? encoded(bootstrap) : 'channel-1';
    } }; },
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key: string) { return storage.get(key) ?? null; },
    setItem(key: string, value: string) { storage.set(key, value); },
  } });
  function reply(request: PocketRequest, result: unknown, error?: string, overrides = {}) {
    const event = { source: parent, origin: 'https://pocket.test', data: { type: 'office-v2:reply', channel: 'channel-1', id: request.id, result, error }, ...overrides } as unknown as MessageEvent;
    for (const fn of listeners.get('message') ?? []) fn(event);
  }
  return { requests, reply, fake, fetches, restore() {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  } };
}

test('welcome supplies one Pocket floor without inventing child model, costs, or detailed status', () => {
  const s = snapshot();
  s.workers = [{ ...worker, status: 'needs_input' }];
  const w = pocketWelcome(s);
  assert.equal(w.floor, 'pocket');
  assert.equal(w.floors.length, 1);
  assert.equal(w.project?.branch, undefined);
  assert.deepEqual(w.project?.agentProviders, ['pi']);
  assert.equal(w.workers[0].model, undefined);
  assert.equal(w.workers[0].status, 'offline');
  assert.equal(w.workers[0].usage, undefined);
  assert.equal(w.usage.total.costKnown, false);
  assert.equal(w.usage.total.incomplete, true);
  assert.equal(w.me.admin, false);
  assert.equal(w.upgrade.available, false);
  assert.equal(w.dog, null);
  assert.equal(w.cars.length > 0, true);
});

test('poll deltas preserve the floor, remove departed workers/peers and do not repeat chat', () => {
  const before = snapshot();
  before.chat = [{ from: 'me', name: 'Sam', color: '#fff', text: 'old', at: 1 }];
  const after = { ...before, peers: [{ ...peer, id: 'other' }], workers: [], chat: [...before.chat, { ...before.chat[0], text: 'new', at: 2 }] };
  const messages = pocketUpdates(before, after);
  assert.deepEqual(messages.map((m) => m.t), ['peer.join', 'peer.leave', 'worker.remove', 'chat']);
  assert.equal(messages.some((m) => m.t === 'welcome' || m.t === 'floor.enter'), false);
  assert.equal(pocketUpdates(before, before).some((m) => m.t === 'worker.update' || m.t === 'chat'), false);
});

test('reply validation requires parent source, exact origin, channel and envelope', () => {
  const parent = {} as Window;
  const event = { source: parent, origin: 'https://pocket.test', data: { type: 'office-v2:reply', channel: 'nonce', id: 'id' } } as MessageEvent;
  assert.equal(verifiedReply(event, parent, event.origin, 'nonce'), true);
  assert.equal(verifiedReply({ ...event, source: {} } as MessageEvent, parent, event.origin, 'nonce'), false);
  assert.equal(verifiedReply(event, parent, 'https://other.test', 'nonce'), false);
  assert.equal(verifiedReply(event, parent, event.origin, 'wrong'), false);
  assert.equal(verifiedReply(event, parent, event.origin, ''), false);
});

test('transport connects, opens native chat, requires hire prompt, refuses shell and admin actions', async () => {
  const h = harness();
  const messages: ServerMsg[] = [];
  const transport = new PocketTransport((m) => messages.push(m), () => {});
  try {
    transport.connect({ name: 'Sam' });
    assert.equal(h.requests[0].op, 'connect');
    assert.deepEqual(h.requests[0].payload, { profile: { name: 'Sam' } });
    h.reply(h.requests[0], snapshot(), undefined, { origin: 'https://evil.test' });
    await tick();
    assert.equal(messages.length, 0);
    h.reply(h.requests[0], snapshot());
    await tick();
    assert.equal(messages[0].t, 'welcome');
    transport.send({ t: 'worker.prompt', workerId: 'w1', prompt: 'Draft only' });
    assert.equal(h.requests[1].op, 'open');
    assert.deepEqual(h.requests[1].payload, { workerId: 'w1', prompt: 'Draft only' });
    h.reply(h.requests[1], {});
    for (const t of ['worker.attach', 'worker.resume'] as const) {
      transport.send({ t, workerId: 'w1' });
      assert.equal(h.requests.at(-1)?.op, 'open');
      h.reply(h.requests.at(-1)!, {});
    }
    const n = h.requests.length;
    transport.send({ t: 'worker.spawn', deskId: 'desk-1' });
    transport.send({ t: 'worker.spawn', deskId: 'desk-1', kind: 'shell', prompt: 'echo unsafe' });
    transport.send({ t: 'upgrade.start' });
    transport.send({ t: 'term.input', workerId: 'w1', data: 'unsafe' });
    assert.equal(h.requests.length, n);
    assert.equal(messages.filter((m) => m.t === 'toast').length, 4);
    transport.send({ t: 'worker.spawn', deskId: 'desk-1', prompt: 'Task', provider: 'claude', model: 'ignored' });
    transport.send({ t: 'worker.spawn', deskId: 'desk-1', prompt: 'Task', worktree: true });
    transport.send({ t: 'worker.spawn', deskId: 'desk-1', prompt: 'Task', repos: ['other'] });
    assert.equal(h.requests.length, n);
    transport.send({ t: 'worker.spawn', deskId: 'desk-1', prompt: 'Task', provider: 'pi' });
    assert.equal(h.requests.at(-1)?.op, 'hire');
    assert.deepEqual(Object.keys(h.requests.at(-1)!.payload).sort(), ['deskId', 'key', 'prompt']);
    h.reply(h.requests.at(-1)!, undefined, 'Access denied');
    await tick();
    assert.ok(messages.some((m) => m.t === 'toast' && m.text === 'Access denied'));
  } finally { transport.dispose(); await tick(); h.restore(); }
});

test('transport coalesces moves for 250 ms and polls without rebuilding welcome', async () => {
  const h = harness();
  const messages: ServerMsg[] = [];
  const transport = new PocketTransport((m) => messages.push(m), () => {});
  try {
    transport.connect({ name: 'Sam' });
    h.reply(h.requests[0], snapshot());
    await tick();
    transport.send({ t: 'move', x: 1, y: 0, z: 0, rotY: 0, moving: true });
    transport.send({ t: 'move', x: 2, y: 0, z: 0, rotY: 0, moving: false });
    assert.equal(h.requests.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.equal(h.requests[1].op, 'move');
    assert.equal(h.requests[1].payload.x, 2);
    h.reply(h.requests[1], {});
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.equal(h.requests[2].op, 'poll');
    h.reply(h.requests[2], snapshot());
    await tick();
    assert.equal(messages.filter((m) => m.t === 'welcome').length, 1);
  } finally { transport.dispose(); await tick(); h.restore(); }
});

test('Pocket fetch boundary blocks APIs and external fetches but permits same-origin assets without redirects', async () => {
  const h = harness();
  try {
    assert.equal(pocketRuntime(), true);
    installPocketBoundary();
    for (const url of ['/api/whoami', '/api/models', '/api/agents/pi/models', '/api/github', '/api/term/drop', 'https://external.test/asset', '//external.test/asset', 'data:text/plain,external']) {
      const response = await h.fake.fetch(url);
      assert.equal(response.status, 501);
      assert.match((await response.json()).error, /unsupported/);
    }
    const request = new Request('https://external.test/request');
    assert.equal((await h.fake.fetch(request)).status, 501);
    assert.equal(h.fetches.length, 0);
    const asset = 'https://pocket.test/x/office/client/assets/model.glb.png';
    assert.equal((await h.fake.fetch(asset)).status, 200);
    assert.deepEqual(h.fetches, [{ input: asset, init: { mode: 'same-origin', redirect: 'error' } }]);
  } finally { h.restore(); }
});

test('Pocket boot is separate from standalone identity, saved profile, character and dog gates', () => {
  const read = (path: string) => readFileSync(new URL(`../src/client/${path}`, import.meta.url), 'utf8');
  const main = read('main.ts');
  assert.ok(main.indexOf('const pocket = initPocketBootstrap(store)') < main.indexOf('parts.stage = createScene'));
  assert.ok(main.indexOf('const pocket = initPocketBootstrap(store)') < main.indexOf('parts.me = makeMe'));
  const branch = main.slice(main.indexOf('if (pocket) {'), main.indexOf('} else void whoami()'));
  assert.match(branch, /pocket.start\(/);
  assert.doesNotMatch(branch, /whoami|loadProfile|openCharacter|firstReady|lastSpot|showElevator/);
  assert.match(main, /!!pocket \|\| chose3d \|\| offerLite/);
  assert.match(read('ui/character.ts'), /if \(openPocketCustomize\(\)\) return;/);
  assert.match(read('ui/elevator.ts'), /if \(pocketRuntime\(\)\)/);
  assert.match(read('ui/terminal.ts'), /if \(net.openPocketSession\(workerId\)\) return;/);
  assert.match(read('ui/provider.ts'), /if \(pocketRuntime\(\)\) return undefined;/);
});

test('fresh Pocket user initializes authenticated profile before scene and needs only welcome plus rendered frame', async () => {
  const h = harness();
  const messages: ServerMsg[] = [];
  const transport = new PocketTransport((m) => { messages.push(m); listeners.forEach((fn) => fn(m)); }, () => {});
  const listeners = new Set<(msg: { t: string }) => void>();
  try {
    const target = { profile: { name: 'Old standalone name', color: '#000000', look: { skin: 1, hair: 1, style: 1 } }, me: { admin: false } };
    const lifecycle = initPocketBootstrap(target)!;
    assert.deepEqual(target.profile, bootstrapValue().profile);
    assert.deepEqual(target.me, { admin: false, account: { name: 'Sam', role: 'member' } });
    assert.equal(readPocketBootstrap(), lifecycle.data); // Parsed once per document.
    const settings = loadSettings();
    assert.equal(settings.hud.workers, true);
    assert.equal(settings.hud.people, true);
    assert.equal(settings.muted, true);
    assert.equal(settings.musicMuted, true);
    assert.equal(settings.notify, false);
    let frameStarted = false;
    let ready = false;
    const steps: string[] = [];
    const readyPromise = lifecycle.start({
      net: { onMessage(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }, connect() { transport.connect(target.profile, lifecycle.data); } },
      loading: { until(items) { steps.push(...items.map((item) => item.say)); } },
      startFrames() { frameStarted = true; },
    }).then(() => { ready = true; });
    assert.equal(frameStarted, true);
    assert.deepEqual(steps, ['Opening Pocket source']);
    assert.equal(messages[0].t, 'welcome'); // No wait for a parent request/reply round trip.
    assert.deepEqual(messages[0].t === 'welcome' && messages[0].me, target.me);
    assert.equal(listeners.size, 0);
    await tick();
    assert.equal(ready, false);
    lifecycle.drew();
    await readyPromise;
    assert.equal(ready, true);
    assert.equal(h.requests[0].op, 'connect'); // Parent still refreshes authorization.
    h.reply(h.requests[0], snapshot());
    await tick();
    assert.equal(messages.filter((m) => m.t === 'welcome').length, 1);
  } finally { transport.dispose(); await tick(); h.restore(); }
});

test('Pocket persistence isolates two users in one browser and never reads standalone profile or position', () => {
  const storage = new Map<string, string>([
    ['agent-office.profile', JSON.stringify({ name: 'Wrong user', color: '#000000' })],
    ['agent-office.settings', JSON.stringify({ notify: true, muted: false, hud: { workers: false } })],
    ['agent-office.spot', JSON.stringify({ floor: 'old', name: 'Old', x: 99, y: 0, z: 99, facing: 0 })],
  ]);
  const h1 = harness(bootstrapValue(), storage);
  try {
    assert.equal(loadProfile()?.name, 'Sam');
    assert.equal(lastSpot(), null);
    assert.equal(lastFloor(), 'pocket');
    rememberSpot({ floor: 'pocket', name: 'Room', x: 2, y: 0, z: 2, facing: 0 });
    const settings = loadSettings();
    assert.equal(settings.notify, false);
    settings.hud.workers = false;
    saveSettings(settings);
    assert.equal(storageKey('agent-office.settings'), 'x.office-v2.person-1.settings');
    assert.equal(storage.has('x.office-v2.person-1.settings'), true);
    assert.equal(storage.has('x.office-v2.person-1.spot'), false);
  } finally { h1.restore(); }
  const other = bootstrapValue();
  other.person = { id: 'person-2', name: 'Alex', role: 'guest' };
  const h2 = harness(other, storage);
  try {
    assert.equal(loadProfile()?.name, 'Alex');
    assert.equal(loadSettings().hud.workers, true);
    assert.equal(storageKey('agent-office.golf'), 'x.office-v2.person-2.golf');
    saveSettings(loadSettings());
    assert.equal(storage.has('x.office-v2.person-2.settings'), true);
    assert.equal(storage.has('agent-office.settings'), true);
  } finally { h2.restore(); }
});

test('malformed bootstrap fails closed instead of falling back to standalone onboarding', () => {
  for (const value of ['', '%invalid', encoded(null), encoded({}), encoded({ ...bootstrapValue(), person: { id: '', name: 'Sam', role: 'owner' } }),
    encoded({ ...bootstrapValue(), profile: { name: 'Sam', color: 'invalid', look: {} } }),
    encoded({ ...bootstrapValue(), snapshot: { ...snapshot(), peers: [] } })]) {
    assert.throws(() => parsePocketBootstrap(value), /Invalid Pocket bootstrap/);
  }
  const h = harness({ ...bootstrapValue(), snapshot: { ...snapshot(), source: -1 } });
  try {
    assert.throws(() => readPocketBootstrap(), /Invalid Pocket bootstrap source/);
    assert.throws(() => readPocketBootstrap(), /Invalid Pocket bootstrap source/);
  } finally { h.restore(); }
});

test('native customization uses the live transport and removes its callback on disposal', async () => {
  const h = harness();
  const transport = new PocketTransport(() => {}, () => {});
  try {
    transport.connect(bootstrapValue().profile, readPocketBootstrap()!);
    h.reply(h.requests[0], snapshot());
    assert.equal(openPocketCustomize(), true);
    assert.equal(h.requests[1].op, 'customize');
    assert.deepEqual(h.requests[1].payload, {});
    h.reply(h.requests[1], { opened: true });
    await tick();
    assert.equal(h.requests.length, 2);
    transport.dispose();
    assert.throws(() => openPocketCustomize(), /not connected/);
  } finally { transport.dispose(); await tick(); h.restore(); }
});
