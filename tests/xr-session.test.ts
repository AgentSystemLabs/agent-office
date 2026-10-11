import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { XrSessions } from '../src/server/xr-playtests/store.js';
import type { XrSnapshot } from '../src/shared/xr-session.js';
import { requestCommand, commandResults } from '../src/server/xr-playtests/commands.js';
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'xr-session-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, '.agent-office'));
  const file = path.join(dir, '.agent-office', 'playtests.json');
  const items = [
    { id: 'rift', revision: 1, title: 'RIFT grip', steps: 'Hold pistol', expected: 'Stable', modes: ['RIFT'], playStyles: ['solo', 'local-coop'], done: true, notes: 'Keep this' },
    { id: 'rb', revision: 1, title: 'RB', steps: 'Play', expected: 'Play', modes: ['RB'], playStyles: [] },
    { id: 'legacy', revision: 1, title: 'RIFT appears in prose' },
  ]; writeFileSync(file, JSON.stringify({ items }));
  const store = new XrSessions(dir), pair = store.start('human');
  const inventory = [{ serial: 'one', name: 'Quest 1', status: 'device' }, { serial: 'two', name: 'Quest 2', status: 'device' }];
  let time = 10000;
  const feed = (snapshots: Record<string, unknown> = {}, token = pair.token) => store.ingest(pair.id, token, { bridgeId: 'bridge-1234567890', devices: inventory, snapshots }, time);
  feed(); store.control('human', pair.id, 'select', ['one']);
  return { dir, file, store, pair, feed, items, now: () => time, advance: (n = 1000) => time += n };
}
function sample(sequence = 1, change: Partial<XrSnapshot> = {}): XrSnapshot {
  return { protocol: 1, appSession: 'app-1', sequence, role: 'solo', context: { mode: 'RIFT', style: 'solo', phase: 'playing', build: 'build-1', focused: true, connected: true, sampledAt: 123 }, signals: { tracking: true }, events: [], ...change };
}
test('whole-session selection switches mode, persists evidence across restarts and never changes manual results', t => {
  const f = fixture(t), original = readFileSync(f.file, 'utf8');
  f.feed({ one: sample() });
  assert.deepEqual(f.store.view('human', f.pair.id, f.now()).devices[0].active, ['rift']);
  f.advance(); const rb = sample(2); rb.context.mode = 'RB'; f.feed({ one: rb });
  const loaded = new XrSessions(f.dir).view('human', f.pair.id, f.now());
  assert.deepEqual(loaded.devices[0].active, ['rb']); assert.equal(loaded.run!.observations.length, 2);
  assert.equal(loaded.run!.observations[0].revision, 1); assert.equal(readFileSync(f.file, 'utf8'), original);
  assert.ok(!JSON.stringify(loaded).includes(f.pair.token)); assert.ok(!JSON.stringify(loaded).includes('tokenHash'));
});
test('pairing scopes owner, token and helper; repeated starts do not create duplicate sessions', t => {
  const f = fixture(t);
  assert.throws(() => f.store.start('human'), /bereits/);
  assert.throws(() => f.feed({}, 'bad'), /Kopplung/);
  assert.throws(() => f.store.control('other', f.pair.id, 'stop'), /nicht gefunden/);
  assert.throws(() => f.store.ingest(f.pair.id, f.pair.token, { bridgeId: 'different-1234567890', devices: [], snapshots: {} }), /bereits/);
  f.store.control('human', f.pair.id, 'pair'); assert.throws(() => f.feed(), /Kopplung/);
});
test('lost focus, stale or duplicate data and build changes never satisfy tests', t => {
  const f = fixture(t); f.feed({ one: sample() }); f.advance(6000);
  f.feed({ one: sample() }); // duplicate sequence must not refresh sample timestamp
  assert.deepEqual(f.store.view('human', f.pair.id, f.now()).devices[0].active, []);
  const unfocused = sample(2); unfocused.context.focused = false; f.feed({ one: unfocused });
  assert.deepEqual(f.store.view('human', f.pair.id, f.now()).devices[0].active, []);
  const changed = sample(3); changed.context.build = 'build-2'; f.feed({ one: changed });
  assert.match(f.store.view('human', f.pair.id, f.now()).devices[0].reason!, /Build/);
});
test('explicit criteria are revision-bound; two-headset checks need matching host and guest', t => {
  const f = fixture(t);
  f.store.setRule('rift', { revision: 1, role: 'guest', twoDevices: true, phases: ['playing'], signal: 'tracking', equals: true });
  f.store.control('human', f.pair.id, 'select', ['one', 'two']);
  const host = sample(1, { role: 'host' }), guest = sample(1, { role: 'guest' });
  host.context.style = guest.context.style = 'local-coop';
  host.signals.sessionGroup = guest.signals.sessionGroup = 'group-1';
  f.feed({ one: host }); assert.deepEqual(f.store.view('human', f.pair.id, f.now()).devices[0].active, []);
  f.feed({ two: guest });
  const view = f.store.view('human', f.pair.id, f.now());
  assert.deepEqual(view.devices[1].active, ['rift']); assert.equal(view.run!.observations.at(-1)!.outcome, 'matched');
  f.items[0].revision = 2; writeFileSync(f.file, JSON.stringify({ items: f.items }));
  assert.deepEqual(f.store.view('human', f.pair.id, f.now()).devices[1].active, []);
});
test('headset pause and stop persist, and ended sessions reject further telemetry', t => {
  const f = fixture(t); f.feed({ one: sample(1, { request: 'pause' }) });
  assert.equal(f.store.view('human').run!.status, 'paused');
  f.store.control('human', f.pair.id, 'resume'); f.feed({ one: sample(2, { request: 'stop' }) });
  assert.equal(f.store.view('human').run!.status, 'stopped'); assert.equal(f.feed({}).stopped, true);
});
test('preparation requires explicit consent and expires without an automatic retry', t => {
  const f = fixture(t); f.feed({ one: sample() }); const run = f.store.view('human', f.pair.id, f.now()).run!;
  assert.throws(() => requestCommand(run, { device: 'one', kind: 'reserve-ammo' }, f.now()), /ausdrücklich/);
  requestCommand(run, { device: 'one', kind: 'reserve-ammo', confirmed: true }, f.now());
  assert.throws(() => requestCommand(run, { device: 'one', kind: 'screenshot' }, f.now()), /bereits/);
  commandResults(f.dir, run, [], f.now() + 31000); assert.equal(run.commands![0].status, 'error');
  assert.match(run.commands![0].result!, /nicht automatisch/);
});
test('a headset bug marker is kept while paused and retry does not duplicate it', t => {
  const f = fixture(t); f.store.control('human', f.pair.id, 'pause');
  f.feed({ one: sample(1, { request: 'bug', events: [{ id: 4, kind: 'tester', message: 'bug' }] }) });
  f.feed({ one: sample(2, { request: 'bug', events: [{ id: 4, kind: 'tester', message: 'bug' }] }) });
  assert.equal(f.store.view('human').run!.markers!.length, 1);
  assert.equal(f.store.view('human').run!.observations.length, 0);
});
