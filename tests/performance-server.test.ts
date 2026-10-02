import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import headless from '@xterm/headless';
import { DEFAULT_OFFICE_PERFORMANCE, isOfficePerformanceSettings } from '../src/shared/performance.js';
import { Performance } from '../src/server/performance.js';
import { Services } from '../src/server/services.js';
import { Changes } from '../src/server/changes.js';
import { UntrackedCounts } from '../src/server/changes-counts.js';
import { checkBlocked, flushScreens, fullScreens, newTerm } from '../src/server/workers/terminal.js';
import { newWorker } from '../src/server/workers/worker.js';
import { newTracker } from '../src/server/usage.js';
import { messaging } from '../src/server/office/messaging.js';
import type { Floor } from '../src/server/floor.js';
import type { WorkerInfo, ServerMsg } from '../src/shared/protocol.js';
import type { WorkerEvents } from '../src/server/workers/types.js';
import { performanceHandlers } from '../src/server/ws/handlers/performance.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';

function directory(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-performance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('office settings validate all fields without coercing partial or non-finite values', () => {
  assert.ok(isOfficePerformanceSettings(DEFAULT_OFFICE_PERFORMANCE));
  for (const value of [null, [], {}, { ...DEFAULT_OFFICE_PERFORMANCE, screenFps: 0 },
    { ...DEFAULT_OFFICE_PERFORMANCE, serviceScanSeconds: '10' }, { ...DEFAULT_OFFICE_PERFORMANCE, usageScanSeconds: Infinity }]) {
    assert.equal(isOfficePerformanceSettings(value), false);
  }
});

test('valid settings persist atomically, invalid/reset/storage failure retain correct state', t => {
  const root = directory(t);
  const states: unknown[] = [];
  const performance = new Performance(root, state => states.push(state));
  assert.deepEqual(performance.state().settings, DEFAULT_OFFICE_PERFORMANCE);
  const settings = { ...DEFAULT_OFFICE_PERFORMANCE, screenFps: 4 as const, usageScanSeconds: 2 as const };
  assert.equal(performance.set(settings, 'Admin'), undefined);
  assert.equal(states.length, 1);
  assert.deepEqual(new Performance(root, () => {}).state(), performance.state());
  assert.ok(performance.set({ ...settings, changesPollSeconds: 0 }, 'Admin'));
  assert.equal(states.length, 1);
  assert.deepEqual(performance.state().settings, settings);
  assert.equal(performance.set(null, 'Admin'), undefined);
  assert.deepEqual(performance.state(), { settings: { ...DEFAULT_OFFICE_PERFORMANCE } });
  const saved = JSON.parse(readFileSync(path.join(root, 'performance.json'), 'utf8'));
  assert.deepEqual(saved, performance.state());
  const broken = new Performance(path.join(root, 'missing'), () => assert.fail('must not apply'));
  assert.ok(broken.set(settings, 'Admin'));
  assert.deepEqual(broken.state().settings, DEFAULT_OFFICE_PERFORMANCE);
});

test('performance handler rejects a revoked admin before touching settings', () => {
  let changes = 0;
  const warnings: string[] = [];
  const ctx = { meOf: () => ({ admin: false }), performance: { set: () => { changes++; } },
    warn: (_c: Client, warning: string) => warnings.push(warning) } as unknown as Ctx;
  const c = { admin: true, peer: { name: 'revoked' } } as Client;
  performanceHandlers['performance.set'](ctx, c, { t: 'performance.set', settings: { ...DEFAULT_OFFICE_PERFORMANCE } });
  assert.equal(changes, 0);
  assert.match(warnings[0], /Only admins/);
});

test('service rescheduling creates one clock and empty owners never produce services', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let scans = 0;
  const services = new Services(() => { scans++; return []; }, () => assert.fail('nothing changed'));
  services.start();
  await services.scan();
  assert.equal(scans, 1);
  services.setScanSeconds(4);
  t.mock.timers.tick(4000);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(scans, 2);
  services.setScanSeconds(30);
  t.mock.timers.tick(29_999);
  assert.equal(scans, 2);
  t.mock.timers.tick(1);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(scans, 3);
  services.stop();
  t.mock.timers.tick(60_000);
  assert.equal(scans, 3);
});

test('Changes reschedules once and preserves immediate watches', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let polls = 0;
  const changes = new Changes('', undefined, () => { polls++; return undefined; }, () => undefined,
    { state() {}, toast() {}, refreshGitHub() {} });
  changes.watch('worker', 'client');
  await Promise.resolve();
  assert.equal(polls, 1);
  changes.setPollSeconds(2);
  t.mock.timers.tick(2000);
  await Promise.resolve();
  assert.equal(polls, 2);
  changes.setPollSeconds(10);
  t.mock.timers.tick(9999);
  assert.equal(polls, 2);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.equal(polls, 3);
  changes.unwatch('worker', 'client');
  t.mock.timers.tick(20_000);
  assert.equal(polls, 3);
});

test('untracked counts invalidate on equal-sized replacement and refuse outside symlinks', async t => {
  const root = directory(t);
  const counts = new UntrackedCounts();
  const file = path.join(root, 'new.txt');
  writeFileSync(file, 'a\nb\n');
  assert.deepEqual(await counts.read(root, 'new.txt'), { lines: 2, binary: false });
  assert.deepEqual(await counts.read(root, 'new.txt'), { lines: 2, binary: false });
  const replacement = path.join(root, 'replacement');
  writeFileSync(replacement, 'aaaa');
  renameSync(replacement, file);
  assert.deepEqual(await counts.read(root, 'new.txt'), { lines: 1, binary: false });
  writeFileSync(file, Buffer.from([0, 1, 2, 3]));
  assert.deepEqual(await counts.read(root, 'new.txt'), { lines: 0, binary: true });
  const outside = directory(t);
  writeFileSync(path.join(outside, 'secret'), 'one\ntwo');
  rmSync(file);
  symlinkSync(path.join(outside, 'secret'), file);
  assert.deepEqual(await counts.read(root, 'new.txt'), { lines: 0, binary: false });
});

test('zero thumbnail demand still checks lifecycle and preserves dirty content for resume', async t => {
  const info: WorkerInfo = { id: 'worker', kind: 'shell', deskId: 'desk-1', name: 'shell', color: '#fff',
    status: 'idle', acked: false, createdBy: 'test', createdAt: 0, cols: 20, rows: 2, viewers: [], viewerIds: [] };
  const w = newWorker(info, newTracker());
  w.term = new headless.Terminal({ cols: 20, rows: 2, allowProposedApi: true });
  t.after(() => w.term?.dispose());
  await new Promise<void>(resolve => w.term!.write('fresh output', resolve));
  let frames = 0, checks = 0;
  const events: WorkerEvents = { update() {}, remove() {}, data() {}, toast() {}, screen() { frames++; } };
  const buffer = t.mock.method(w.term.buffer.active, 'getNullCell', () => { throw new Error('unexpected extraction'); });
  flushScreens([w], events, () => checks++, false);
  assert.equal(frames, 0);
  assert.equal(checks, 1);
  assert.equal(w.screenDirty, true);
  flushScreens([w], events, () => checks++, false);
  assert.equal(checks, 1);
  buffer.mock.restore();
  const snapshots = fullScreens([w]);
  assert.equal(snapshots[0].frame.full, true);
  assert.match(snapshots[0].frame.lines[0][0][0], /fresh output/);
  flushScreens([w], events, () => checks++, true);
  assert.equal(frames, 1);
  assert.equal(w.screenDirty, false);
});


test('an unattended Claude setup gate changes status without extracting a thumbnail', async t => {
  const info: WorkerInfo = { id: 'worker', kind: 'agent', provider: 'claude', deskId: 'desk-1', name: 'Claude', color: '#fff',
    status: 'starting', acked: false, createdBy: 'test', createdAt: 0, cols: 80, rows: 4, viewers: [], viewerIds: [] };
  const w = newWorker(info, newTracker());
  w.term = new headless.Terminal({ cols: 80, rows: 4, allowProposedApi: true });
  t.after(() => w.term?.dispose());
  const events: WorkerEvents = { update() {}, remove() {}, data() {}, toast() {}, screen() { assert.fail('unwatched screen'); } };
  const check = () => checkBlocked(w, status => { w.info.status = status; });
  await new Promise<void>(resolve => w.term!.write('Do you trust the files', resolve));
  const cells = t.mock.method(w.term.buffer.active, 'getNullCell', () => { throw new Error('unexpected thumbnail'); });
  flushScreens([w], events, check, false);
  assert.equal(w.info.status, 'needs_input');
  assert.equal(w.bootBlocked, true);
  cells.mock.restore();
  await new Promise<void>(resolve => w.term!.write('\x1b[2J\x1b[HReady', resolve));
  w.screenDirty = w.blockedDirty = true;
  flushScreens([w], events, check, false);
  assert.equal(w.info.status, 'idle');
  assert.equal(w.bootBlocked, false);
});


test('screen subscription resumes with one fresh full frame and leaves raw attachments intact', () => {
  let snapshots = 0;
  const frames: ServerMsg[] = [];
  const floor = { workers: { fullScreens: () => {
    snapshots++;
    return [{ workerId: 'worker', frame: { cols: 1, rows: 1, lines: { 0: [['latest', -1, -1, 0]] }, cursor: [0, 0], full: true } }];
  } } } as unknown as Floor;
  const ctx = { floorOf: () => floor, sendTo: (_c: Client, frame: ServerMsg) => frames.push(frame) } as unknown as Ctx;
  const c = { screens: false, peer: { lite: false }, attached: new Set(['raw-worker']) } as Client;
  const watch = (on: boolean) => performanceHandlers['screen.watch'](ctx, c, { t: 'screen.watch', on });
  watch(true); watch(true);
  assert.equal(snapshots, 1);
  assert.equal(frames[0].t, 'screen');
  watch(false);
  assert.deepEqual([...c.attached], ['raw-worker']);
  watch(true);
  assert.equal(snapshots, 2);
  c.peer.lite = true;
  watch(true);
  assert.equal(c.screens, false);
  assert.equal(snapshots, 2);
});

test('floor thumbnail messages skip serialization with no eligible clients', () => {
  let serialized = 0;
  const frame: Extract<ServerMsg, { t: 'screen' }> = { t: 'screen', workerId: 'worker', cols: 1, rows: 1,
    lines: {}, cursor: [0, 0], full: true };
  Object.defineProperty(frame, 'toJSON', { value: () => { serialized++; return { t: 'screen' }; } });
  const clients = new Map<string, Client>();
  const ctx = { clients } as Ctx;
  const floor = { id: 'f' } as Floor;
  const messages = messaging(ctx);
  messages.toFloor(floor, frame, true);
  assert.equal(serialized, 0);
  const c = { id: 'lite', screens: true, peer: { floor: 'f', lite: true }, ws: { readyState: 1, bufferedAmount: 0, send() {} } } as unknown as Client;
  clients.set(c.id, c);
  messages.toFloor(floor, frame, true);
  assert.equal(serialized, 0);
  c.peer.lite = false;
  c.screens = false;
  messages.toFloor(floor, frame, true);
  assert.equal(serialized, 0);
  c.screens = true;
  messages.toFloor(floor, frame, true);
  assert.equal(serialized, 1);
});


test('parsed terminal output rearms an unattended lifecycle check after a pre-parse flush', async t => {
  const info: WorkerInfo = { id: 'worker', kind: 'agent', provider: 'claude', deskId: 'desk-1', name: 'Claude', color: '#fff',
    status: 'starting', acked: false, createdBy: 'test', createdAt: 0, cols: 80, rows: 4, viewers: [], viewerIds: [] };
  const w = newWorker(info, newTracker());
  const term = newTerm(w, { title() {} });
  t.after(() => term.dispose());
  const events: WorkerEvents = { update() {}, remove() {}, data() {}, toast() {}, screen() { assert.fail('unwatched screen'); } };
  let checks = 0;
  const check = () => { checks++; checkBlocked(w, status => { w.info.status = status; }); };
  const parsed = new Promise<void>(resolve => term.write('Do you trust the files', resolve));
  // xterm has queued the write, but its buffer is still empty at this synchronous timer flush.
  flushScreens([w], events, check, false);
  assert.equal(w.info.status, 'starting');
  assert.equal(w.blockedDirty, false);
  await parsed;
  assert.equal(w.blockedDirty, true);
  flushScreens([w], events, check, false);
  assert.equal(w.info.status, 'needs_input');
  assert.equal(w.bootBlocked, true);
  assert.equal(checks, 2);
  flushScreens([w], events, check, false);
  assert.equal(checks, 2);
  assert.equal(w.screenDirty, true);
});
