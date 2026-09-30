import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteFloor } from '../src/server/remote-floor.js';
import type { HostRegistry, HostSocket } from '../src/server/floor-hosts.js';

/** A machine that answers whatever it is told to, so the proxy can be driven without a real host. */
function fakeHost() {
  const sent: Record<string, unknown>[] = [];
  const socket = {
    send: (msg: Record<string, unknown>) => sent.push(msg),
  } as unknown as HostSocket;
  let reachable = true;
  const registry = {
    serves: () => (reachable ? socket : undefined),
    isReachable: () => reachable,
    // The registry holds the paired machines, so the name is read from it rather than remembered: a
    // floor is registered from the building before its machine has necessarily paired.
    nameOf: () => (named ? 'Alice’s laptop' : undefined),
  } as unknown as HostRegistry;
  let named = true;
  return {
    sent,
    registry,
    setReachable(v: boolean) {
      reachable = v;
    },
    setNameKnown(v: boolean) {
      named = v;
    },
  };
}

const make = (host = fakeHost()) =>
  new RemoteFloor('f1', 'a machine', 'h1', host.registry, { id: 'f1', name: 'API', dir: '/on/the/host', palette: 0, addedBy: 'alice', addedAt: 1 }, 'main', ['claude']);

test('a floor whose machine has not paired yet has a placeholder name, not an empty one', () => {
  // The building knows a floor's host id before the machine has ever connected, so the proxy is built
  // with a fallback. The panel says something honest rather than nothing.
  const host = fakeHost();
  host.setNameKnown(false);
  const floor = make(host);
  assert.equal(floor.info().host?.name, 'a machine');
});

test('a floor on another machine says so, and never hands out its checkout', () => {
  // The whole point of the proxy: the office holds the host's path only to identify the floor, and
  // must never read it. Empty dir is the enforcement of that, not a missing value.
  const floor = make();
  const info = floor.info();
  assert.equal(info.host?.name, 'Alice’s laptop');
  assert.equal(info.host?.reachable, true);
  assert.equal(info.dir, '', 'the office must not hold a path it could be tempted to read');
  assert.equal(info.name, 'API');
});

test('a call to an asleep machine is a refusal naming it, never a throw', () => {
  // A laptop in a bag is not an error. Every caller in the office already handles a refusal string,
  // and the queue is told to keep the task rather than fail it (finding 10).
  const host = fakeHost();
  host.setReachable(false);
  const floor = make(host);
  return floor.workers.spawn('desk-1', 'bob', 'do a thing').then((r) => {
    assert.equal(r, 'Alice’s laptop is asleep');
    assert.equal(host.sent.length, 0, 'nothing was sent to a machine that is not there');
    assert.equal(floor.info().host?.reachable, false, 'and the elevator says so');
  });
});

test('a write ships a frame and resolves with the host answer', async () => {
  const host = fakeHost();
  const floor = make(host);
  const pending = floor.workers.spawn('desk-1', 'bob', 'do a thing');
  assert.equal(host.sent.length, 1, 'one frame went out');
  const frame = host.sent[0];
  assert.equal(frame.t, 'worker.spawn');
  assert.equal(frame.floorId, 'f1', 'every frame names its floor, because one socket carries many');
  assert.equal(typeof frame.seq, 'number');

  // The host turns the hire down, naming the call it answers so the caller is not left waiting.
  floor.deliver({ t: 'refused', floorId: 'f1', workerId: 'w1', reason: 'seats', seq: frame.seq as number });
  const r = await pending;
  assert.equal(r, 'seats', 'the reason comes through unchanged, so the office shows what the floor said');
});

test('reads are answered from the mirror, so they cost no round trip', () => {
  // What the host streams upward is what the office serves. This is why list() and state() are
  // synchronous on the surface while a hire is not.
  const host = fakeHost();
  const floor = make(host);
  assert.deepEqual(floor.workers.list(), [], 'nothing known yet');
  assert.deepEqual(floor.queue.state(), { tasks: [], maxWorkers: 0 });

  // The host announces a floor with workers on it.
  floor.deliver({ t: 'ready', floor: { floorId: 'f1', name: 'API', seats: 4, accepting: false, workers: [{ id: 'w1', status: 'working', deskId: 'desk-1' }, { id: 'w2', status: 'idle', deskId: 'desk-2' }], forge: 'github' } });
  assert.equal(host.sent.length, 0, 'and none of that crossed the wire to ask');
  assert.equal(floor.info().workers, 2, 'the roster says how many are on the floor');
  assert.deepEqual(floor.workers.list(), [], 'but a roster of ids is not a roster of workers');

  // The host describes them as they change, which is what makes the reads answerable.
  const w1 = { id: 'w1', deskId: 'desk-1', kind: 'agent', provider: 'claude', name: 'Sable', color: '#fff', status: 'working', acked: true, createdBy: 'alice', createdAt: 1, cols: 80, rows: 24, viewers: [], viewerIds: [] };
  floor.deliver({ t: 'event', floorId: 'f1', seq: 1, msg: { t: 'worker.update', worker: w1 } });
  assert.equal(floor.workers.list().length, 1, 'now it can be listed, with no round trip');
  assert.equal(floor.workers.get('w1')?.name, 'Sable');
  assert.equal(floor.workers.deskOccupied('desk-1'), true);
  assert.equal(host.sent.length, 0, 'still nothing asked across the wire');
});

test('a merge or a queue add that the office branches on is awaited', async () => {
  const host = fakeHost();
  const floor = make(host);
  const added = floor.queue.add('do a thing', 'bob');
  assert.equal(host.sent[0].t, 'queue.add');
  floor.deliver({ t: 'refused', floorId: 'f1', reason: 'not-accepting', seq: host.sent[0].seq as number });
  assert.equal(await added, 'not-accepting', 'the refusal reaches the person who asked');
});

test('a write nobody reads the answer to still ships', () => {
  const host = fakeHost();
  const floor = make(host);
  floor.workers.write('w1', 'ls\n', 'bob');
  assert.equal(host.sent[0].t, 'term.input');
  floor.workers.resize('w1', 80, 24);
  assert.equal(host.sent[1].t, 'term.resize');
  floor.jukebox.skip('bob');
  assert.equal(host.sent[2].t, 'jukebox.skip');
});

test('the three host-local features refuse by name rather than silently', () => {
  // The whiteboard, the dog and the docs are files in the floor's own data directory. Serving them
  // would mean the office reading a checkout it must never touch, so they refuse and say where the
  // thing actually is. A gap that names itself beats a button that does nothing.
  const floor = make();
  for (const feature of ['the whiteboard', 'the dog', 'the docs'] as const) {
    assert.equal(floor.refuse(feature), `${feature} is on Alice’s laptop, which hosts this floor`);
  }
});

test('presence stays office-side: a hosted floor does not own the room', () => {
  // Arriving, the gong and leave-on-merge are about the building, not the machine. The proxy does not
  // ship them, so they keep working the way they always have.
  const host = fakeHost();
  const floor = make(host);
  floor.arrived();
  floor.sendLandedHome();
  assert.equal(host.sent.length, 0, 'none of that crossed the wire');
  assert.equal(floor.landed({ id: 'w1' } as never), undefined, 'and the office does not guess at a landing');
});

test('an empty refusal is not a refusal: it is the host saying the call worked', () => {
  // The office settles every call with one frame, and a call whose result nobody branches on reports
  // itself with no reason. Reading that as "refused" would turn every successful keystroke into a
  // warning.
  const host = fakeHost();
  const floor = make(host);
  const added = floor.queue.add('do a thing', 'bob');
  const seq = host.sent[0].seq as number;
  floor.deliver({ t: 'refused', floorId: 'f1', reason: '', seq });
  return added.then((r) => assert.ok(!r, `a call that worked must not read as refused, got "${r}"`));
});

test('a read answers with the payload, not the frame around it', () => {
  // A `queue` event carries `{ t: 'queue', state }`. Mirroring the frame would hand the office a
  // wrapper, and every `state().tasks` would be undefined — which is exactly what happened first.
  const host = fakeHost();
  const floor = make(host);
  const state = { tasks: [{ id: 't1', prompt: 'write the migration' }], maxWorkers: 3 };
  floor.deliver({ t: 'event', floorId: 'f1', seq: 1, msg: { t: 'queue', state } });
  assert.deepEqual(floor.queue.state(), state);
  assert.equal((floor.queue.state() as { tasks: unknown[] }).tasks.length, 1);
});
