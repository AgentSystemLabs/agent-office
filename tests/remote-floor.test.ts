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
  new RemoteFloor('f1', 'a machine', 'h1', host.registry, { id: 'f1', name: 'API', dir: '/on/the/host', palette: 0, addedBy: 'alice', addedAt: 1 });

test('a hosted demo without a repository exposes the providers reported by its host', async () => {
  const host = fakeHost();
  const floor = make(host);
  floor.deliver({ t: 'ready', floor: { floorId: 'f1', name: 'API', seats: 2, accepting: false, workers: [], forge: 'github', providers: ['claude', 'codex'] } });
  assert.equal(floor.project.name, 'API');
  assert.equal(floor.project.dir, '');
  assert.equal(floor.project.agentProviders.includes('codex'), true, 'spawn validation can find the selected provider without a repo');
  const spawned = floor.workers.spawn('desk-1', 'Sam', 'demo', false, 'agent', 'codex');
  assert.equal(host.sent[0].provider, 'codex');
  floor.deliver({ t: 'result', floorId: 'f1', seq: host.sent[0].seq as number, value: { id: 'demo-worker' } });
  assert.deepEqual(await spawned, { id: 'demo-worker' });
});

test('a state event with the same sequence as a call does not settle the call', async () => {
  const host = fakeHost();
  const floor = make(host);
  const pending = floor.queue.add('task', 'Alice');
  const seq = host.sent[0].seq as number;
  const state = { tasks: [], maxWorkers: 3 };
  floor.deliver({ t: 'event', floorId: 'f1', seq, msg: { t: 'queue', state } });
  assert.deepEqual(floor.queue.state(), state);
  floor.deliver({ t: 'result', floorId: 'f1', seq, value: 'actual reply' });
  assert.equal(await pending, 'actual reply');
});

test('browser-shaped room updates fill the mirror', () => {
  const floor = make();
  floor.deliver({ t: 'event', floorId: 'f1', seq: 0, msg: { t: 'plan', plan: { wing: 2, labels: {} } } });
  floor.deliver({ t: 'event', floorId: 'f1', seq: 0, msg: { t: 'decor', items: [{ id: 'picture' }] } });
  floor.deliver({ t: 'event', floorId: 'f1', seq: 0, msg: { t: 'ball', ball: { holder: 'alice' } } });
  assert.equal(floor.plan.wing, 2);
  assert.equal(floor.decor.list()[0].id, 'picture');
  assert.equal(floor.court.state().holder, 'alice');
});

test('a new ready restores a disconnected floor and calls use the new connection', async () => {
  const host = fakeHost();
  const floor = make(host);
  const pending = floor.queue.add('before disconnect', 'Alice');
  host.setReachable(false);
  floor.onGone('f1');
  assert.equal(await pending, 'Alice’s laptop is asleep');
  assert.equal(floor.reachable, false);
  host.setReachable(true);
  floor.deliver({ t: 'ready', floor: { floorId: 'f1', name: 'API', seats: 4, accepting: false, workers: [], forge: 'github' } });
  assert.equal(floor.reachable, true);
  const resumed = floor.queue.add('after reconnect', 'Alice');
  assert.equal(host.sent.length, 2);
  floor.deliver({ t: 'result', floorId: 'f1', seq: host.sent[1].seq as number, value: undefined });
  assert.equal(await resumed, '');
});

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
  assert.equal(r, 'Alice’s laptop refused: seats', 'the refusal reaches the person who asked, naming the machine');
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
  assert.equal(await added, 'Alice’s laptop refused: not-accepting', 'the refusal reaches the person who asked, naming the machine');
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
  // would mean the office reading a checkout it must never touch, so they are not on the surface at
  // all and `refuses` is how the office says so out loud — naming the machine. A gap that names
  // itself beats a button that does nothing.
  const floor = make();
  for (const feature of ['the whiteboard', 'the dog', 'the docs'] as const) {
    assert.equal(floor.refuses(feature), `${feature} is on Alice’s laptop, which hosts this floor`);
  }
  // And they really are unreachable rather than merely unimplemented: nothing on the surface can
  // return one, which is the guarantee the office relies on to never ask for them.
  const surface = floor as unknown as Record<string, unknown>;
  for (const member of ['whiteboard', 'dog', 'docs']) {
    assert.equal(surface[member], undefined, `a hosted floor must not be asked for its ${member}`);
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

test('a result carries the real value, not a flattened string', async () => {
  // The bug this exists for: every answer was squeezed through a string check, so a `WorkerInfo`, a
  // `Decoration` or a `string[]` arrived as `undefined` and the office dereferenced it. Twenty call
  // sites did that, and only the string-returning ones worked — which is why an end-to-end test of
  // `queue.add` passed while the rest were broken.
  const host = fakeHost();
  const floor = make(host);
  const spawned = floor.workers.spawn('desk-1', 'bob', 'do a thing');
  const worker = { id: 'w1', deskId: 'desk-1', kind: 'agent', provider: 'claude', name: 'Sable', color: '#fff', status: 'working', acked: true, createdBy: 'bob', createdAt: 1, cols: 80, rows: 24, viewers: [], viewerIds: [] };
  floor.deliver({ t: 'result', floorId: 'f1', seq: host.sent[0].seq as number, value: worker });
  assert.deepEqual(await spawned, worker, 'the whole WorkerInfo arrives, not a string');

  // A list of strings is a value too, and `floor.expand`'s caller maps over it.
  const expanded = floor.plan.expand();
  floor.deliver({ t: 'result', floorId: 'f1', seq: host.sent[1].seq as number, value: ['desk-9', 'desk-10'] });
  assert.deepEqual(await expanded, ['desk-9', 'desk-10']);

  // And a boolean: `ball.take`'s caller reads it as "did the ball change hands".
  const taken = floor.court.take('c1');
  floor.deliver({ t: 'result', floorId: 'f1', seq: host.sent[2].seq as number, value: true });
  assert.equal(await taken, true);
});

test('a refusal names the machine, and an empty reason is not a refusal', async () => {
  // Two halves of one rule. A refusal reaches the person who asked and has to say which machine it
  // came from — that is what every refusal in this feature promises. An empty reason is the host
  // saying a call worked, so it must not be dressed up as a refusal.
  const host = fakeHost();
  const floor = make(host);
  const denied = floor.queue.add('do a thing', 'bob');
  floor.deliver({ t: 'refused', floorId: 'f1', reason: 'no free desk', seq: host.sent[0].seq as number });
  assert.equal(await denied, 'Alice’s laptop refused: no free desk');

  const fine = floor.queue.add('another', 'bob');
  floor.deliver({ t: 'refused', floorId: 'f1', reason: '', seq: host.sent[1].seq as number });
  // `queue.add` returns `string | undefined` and the office tests it for truthiness, so its wrapper
  // stringifies — what matters is that a call that worked is falsy rather than a phantom refusal.
  assert.ok(!(await fine), 'a call that worked resolves to nothing, not to a warning');
});

test('every state the proxy reads is filled by the event that carries it', () => {
  // One assertion per read, because the failure mode is a read that silently returns its default
  // forever. The earlier test only covered `queue`, which was the one key that happened to match.
  const host = fakeHost();
  const floor = make(host);
  const event = (t: string, state: unknown) => floor.deliver({ t: 'event', floorId: 'f1', seq: 1, msg: { t, state } });

  event('plan', { wing: 3, labels: {} });
  assert.equal(floor.plan.wing, 3, 'plan.wing comes from the `plan` event');
  assert.equal(floor.info().wing, 3, 'and the elevator shows it');

  event('decor', [{ id: 'd1', title: 'a picture' }]);
  assert.equal(floor.decor.list().length, 1);

  event('jukebox', { on: true, track: 't1', title: 'Radio', startedAt: 1, elapsed: 2 });
  assert.equal(floor.jukebox.state().on, true);
  assert.equal(floor.jukebox.title(), 'Radio');

  event('ball', { holder: 'c1' });
  assert.equal(floor.court.state().holder, 'c1');

  event('cars', [{ car: 1, driver: 'c1' }]);
  assert.equal(floor.garage.state().length, 1);

  event('meeting', { current: null, past: [] });
  assert.deepEqual(floor.meetings.state(), { current: null, past: [] });

  event('tv', { on: true, playing: false, position: 12, at: 5 });
  assert.equal(floor.tv.state().on, true);

  event('queue', { tasks: [{ id: 't1' }], maxWorkers: 2 });
  assert.equal((floor.queue.state() as { tasks: unknown[] }).tasks.length, 1);
});

test('the viewer and the typist travel with the call', async () => {
  // An anonymous viewer on the host is a viewer nobody can see, and the office sends who they are.
  const host = fakeHost();
  const floor = make(host);
  void floor.workers.attach('w1', 'client-7', 'Ada');
  void floor.workers.write('w1', 'ls\n', 'Ada');
  void floor.workers.detach('w1', 'client-7');
  assert.deepEqual(host.sent[0], { t: 'worker.attach', floorId: 'f1', seq: 1, workerId: 'w1', clientId: 'client-7', name: 'Ada' });
  assert.equal(host.sent[1].by, 'Ada', 'the typist is named');
  assert.equal(host.sent[2].clientId, 'client-7', 'and detach says which viewer left');
});


test('the hosted theatre switch returns booleans and follows the TV state mirror', async () => {
  const host = fakeHost();
  const floor = make(host);
  assert.equal(floor.tv.state().theatre, false, 'a floor without a TV event starts with the lights up');
  const turnDown = floor.tv.theatre(true, 'Alice');
  assert.equal(host.sent[0].t, 'tv.theatre');
  assert.equal(host.sent[0].on, true);
  floor.deliver({ t: 'result', floorId: 'f1', seq: host.sent[0].seq as number, value: true });
  assert.equal(await turnDown, true);
  const unchanged = floor.tv.theatre(true, 'Alice');
  floor.deliver({ t: 'result', floorId: 'f1', seq: host.sent[1].seq as number, value: false });
  assert.equal(await unchanged, false, 'a no-op must not announce another theatre change');
  floor.deliver({ t: 'event', floorId: 'f1', seq: 1, msg: { t: 'tv', state: { on: false, playing: false, position: 0, at: 0, theatre: true } } });
  assert.equal(floor.tv.state().theatre, true);
});

test('a hosted helper request uses the floor action and returns the hired worker', async () => {
  const host = fakeHost();
  const floor = make(host);
  const result = floor.sendHelper('host-worker', 'Alice', 'codex');
  assert.equal(host.sent[0].t, 'worker.helper');
  assert.equal(host.sent[0].hostId, 'host-worker');
  const helper = { id: 'helper-worker', name: 'Gizmo' };
  floor.deliver({ t: 'result', floorId: 'f1', seq: host.sent[0].seq as number, value: helper });
  assert.deepEqual(await result, helper);
});
