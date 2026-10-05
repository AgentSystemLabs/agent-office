import test from 'node:test';
import assert from 'node:assert/strict';
import { helperDesk, helperHost, helperId, helperSpot, isHelperId, plainText } from '../src/shared/helper.js';
import { DESK_BY_ID } from '../src/shared/layout.js';
import { nearestWalkable, route, walkable, type Pt } from '../src/shared/nav.js';

const host = DESK_BY_ID.get('desk-1')!;

test('a helper is addressed by the desk it is helping at', () => {
  assert.equal(helperId('desk-3'), 'helper:desk-3');
  assert.equal(helperHost('helper:desk-3'), 'desk-3');
  assert.equal(isHelperId('helper:desk-3'), true);
  // An ordinary seat is not a helper's id, and asking gives nothing rather than a wrong desk.
  assert.equal(isHelperId('desk-3'), false);
  assert.equal(helperHost('desk-3'), undefined);
});

test('a helper stands beside its host’s desk, on a spot it can stand on', () => {
  const spot = helperSpot(host);
  assert.ok(walkable(spot.at[0], spot.at[1]), 'the standing spot should be walkable');
  // Out of the chair, or it would be sitting in the host's place.
  const chair = [host.x + Math.cos(host.rotY) * 0, host.z - Math.sin(host.rotY) * 0];
  assert.notDeepEqual(spot.at, chair);
});

test('a helper’s desk is its host’s moved beside it, with no chair of its own', () => {
  const desk = helperDesk(host, '🆘 helping Widget');
  assert.equal(desk.id, 'helper:desk-1');
  assert.equal(desk.label, '🆘 helping Widget');
  // Standing where the helper stands, not at the seat the host occupies.
  assert.deepEqual([desk.x, desk.z], helperSpot(host).at);
  // Not one of the floor's own desks, so nothing builds it and nothing sits anyone in it.
  assert.equal(desk.wing, undefined);
  // A helper cannot be helped itself, so nothing treats its id as a real seat to fill.
  assert.equal(DESK_BY_ID.has(helperId(host.id)), false);
});

test('a helper’s id is not a seat, so nothing else can be seated there', () => {
  // A helper is placed by the Floor, from its host's desk, rather than looked up in the room's own
  // seats. That is what stops a meeting or a board agent from ever being seated at a helper's spot.
  assert.equal(DESK_BY_ID.has(helperId(host.id)), false);
  // Nor is a helper ever seated at a board agent's kiosk or a meeting chair, for the same reason.
  assert.equal(DESK_BY_ID.has(helperId('station-issues')), false);
  assert.equal(DESK_BY_ID.has(helperId('meeting-0')), false);
});

test('a helper can actually be walked to every desk on the floor', () => {
  // The walk is the office's (see server/helpers.ts), worked out with the same A* the dog uses, so
  // every browser flies the model along the same points. It has to work from the doors to every desk,
  // or a helper would stop in the furniture on the way.
  const doors: Pt = [0, 0];
  const from = walkable(doors[0], doors[1]) ? doors : nearestWalkable(doors);
  const stuck: string[] = [];
  for (const [id, desk] of DESK_BY_ID) {
    if (desk.station || desk.room) continue;
    const spot = helperSpot(desk);
    const at = walkable(spot.at[0], spot.at[1]) ? spot.at : nearestWalkable(spot.at);
    const path = route(from, at);
    if (path.length < 2) {
      stuck.push(`${id}: no route`);
      continue;
    }
    // It has to arrive where the office said it would, not merely somewhere on the floor.
    const end = path[path.length - 1];
    if (end[0] !== at[0] || end[1] !== at[1]) stuck.push(`${id}: ends at ${end}, not ${at}`);
    // And every step of it has to be somewhere a body can stand.
    for (const p of path) if (!walkable(p[0], p[1])) stuck.push(`${id}: passes through unwalkable ${p}`);
  }
  assert.deepEqual(stuck, [], `a helper could not be walked to: ${stuck.join('; ')}`);
});

test('what a helper said comes out as plain text a prompt can carry', () => {
  // Escape sequences, carriage returns and trailing space would all end up in the worker's prompt.
  const raw = '[32mIt fails here[0m\r\n\r\n\r\n   \r\nbecause of the token check   ';
  const out = plainText(raw);
  assert.equal(out.includes(''), false);
  assert.equal(out.includes('\r'), false);
  assert.ok(out.startsWith('It fails here'));
  assert.ok(out.includes('because of the token check'));
  assert.ok(!/\n{3,}/.test(out), 'runs of blank lines are collapsed');
  assert.ok(!/[ \t]$/m.test(out), 'trailing space is trimmed');
  assert.equal(plainText(''), '');
});

import { Floor } from '../src/server/floor.js';
import { Helpers } from '../src/server/helpers.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

test('requesting a helper publishes its walk and refuses a duplicate at the desk', () => {
  const worker = { id: 'host', deskId: 'desk-1', name: 'Byte' } as WorkerInfo;
  const helper = { id: 'helper', deskId: 'helper:desk-1', name: 'Gizmo' } as WorkerInfo;
  const published: unknown[] = [];
  let hires = 0;
  const helpers = new Helpers({ workers: () => [worker, helper], send: states => published.push(states), sendHome: () => {} });
  const floor = { workers: { get: () => worker, sendHelper: () => { hires++; return helper; } }, helpers } as unknown as Floor;
  assert.equal(Floor.prototype.sendHelper.call(floor, 'host', 'Alice'), helper);
  assert.equal(published.length, 1);
  assert.equal(helpers.states()[0].workerId, 'helper');
  assert.ok(helpers.states()[0].path.length > 0);
  assert.match(Floor.prototype.sendHelper.call(floor, 'host', 'Alice') as string, /already has a helper/);
  assert.equal(hires, 1);
});

import * as THREE from 'three';
import { HelperWalk } from '../src/client/world/helper.js';
import type { HelperState } from '../src/shared/helper.js';

test('helper motion continues through serialized updates and reading phase changes', () => {
  const walk = new HelperWalk(new THREE.Group(), () => 0);
  const state: HelperState = { hostId: 'host', workerId: 'helper', path: [[0, 0], [10, 0]], speed: 1, face: 0, phase: 'walking' };
  walk.sync([state], performance.now() - 5000);
  const before = walk.positions(new Map())[0].x;
  walk.sync([{ ...JSON.parse(JSON.stringify(state)), phase: 'reading' }], performance.now());
  const after = walk.positions(new Map())[0].x;
  assert.ok(before >= 5 && after >= before, 'phase updates must not restart the walk at the door');
});

import { WorkerManager } from '../src/server/workers.js';
import { PROMPTS } from '../src/shared/prompts.js';

test('helpers can be hired for shell and agent workers in the shared checkout', () => {
  for (const kind of ['shell', 'agent'] as const) {
    const host = { id: 'host', name: 'Pixel', kind, deskId: 'desk-1' } as WorkerInfo;
    let args: unknown[] = [];
    const manager = {
      get: () => host,
      prompts: { text: (id: keyof typeof PROMPTS) => PROMPTS[id].text },
      finding: () => 'command failed with exit 1',
      spawn: (...values: unknown[]) => { args = values; return { id: 'helper' }; },
    } as unknown as WorkerManager;
    assert.equal(typeof WorkerManager.prototype.sendHelper.call(manager, 'host', 'Alice'), 'object');
    assert.match(args[2] as string, /shared project checkout/);
    assert.match(args[2] as string, /command failed with exit 1/);
    assert.equal(args[4], 'agent');
  }
});

test('a shell helper report is published to chat without being executed in the shell', () => {
  const host = { id: 'host', name: 'Pixel', kind: 'shell' } as WorkerInfo;
  const helper = { id: 'helper', name: 'Gizmo', color: '#123456', status: 'done', helper: { hostId: 'host', hostName: 'Pixel' } } as WorkerInfo;
  const events: unknown[] = [];
  let reported = false;
  const floor = {
    reportedHelpers: new Set(),
    helpers: { reporting: () => {}, reported: () => { reported = true; } },
    workers: { get: () => host, finding: () => 'Check the missing dependency', prompt: () => { throw Error('Report executed in shell'); } },
    ctx: { prompts: { text: () => '' }, emit: (_floor: unknown, event: unknown) => events.push(event) },
  };
  (Floor.prototype as any).onHelperUpdate.call(floor, helper);
  assert.equal((events[0] as any).t, 'chat');
  assert.match((events[0] as any).text, /Check the missing dependency/);
  assert.equal(reported, true);
});

test('busy workers retain helper findings without queuing a prompt', () => {
  const info = { id: 'host', kind: 'agent', status: 'working' } as WorkerInfo;
  const worker = { info };
  const manager = { workers: new Map([['host', worker]]), emitUpdate: () => {}, persist: () => {}, prompt: () => { throw Error('Report was queued'); } };
  WorkerManager.prototype.stageHelperReport.call(manager as any, 'host', 'Widget', 'Install dependencies');
  assert.equal(info.helperReport?.state, 'pending');
});

test('interrupt delivery waits for idle, submits once, and refuses repeat delivery', async () => {
  const info = { id: 'host', kind: 'agent', provider: 'opencode', status: 'working', helperReport: { helperName: 'Widget', text: 'Install dependencies', state: 'pending' } } as WorkerInfo;
  const writes: string[] = [];
  const worker = { info, pty: { write: (text: string) => { writes.push(text); setTimeout(() => { info.status = 'ready'; }, 30); } } };
  let prompts = 0;
  const manager = { workers: new Map([['host', worker]]), emitUpdate: () => {}, persist: () => {}, prompt: (_id: string, text: string) => { assert.equal(info.status, 'ready'); assert.equal(text, 'Install dependencies'); prompts++; } };
  assert.equal(await WorkerManager.prototype.deliverHelperReport.call(manager as any, 'host', 'Alice'), undefined);
  assert.deepEqual(writes, ['\x1b']);
  assert.equal(info.helperReport?.state, 'submitted');
  assert.match(await WorkerManager.prototype.deliverHelperReport.call(manager as any, 'host', 'Alice') as string, /already submitted/);
  assert.equal(prompts, 1);
});

test('a failed interruption retains the report without queuing it', async () => {
  const info = { id: 'host', kind: 'agent', provider: 'opencode', status: 'working', helperReport: { helperName: 'Widget', text: 'Install dependencies', state: 'pending' } } as WorkerInfo;
  const worker = { info, pty: { write: () => {} } };
  const manager = { workers: new Map([['host', worker]]), emitUpdate: () => {}, persist: () => {}, prompt: () => { throw Error('Must not queue after timeout'); } };
  const error = await WorkerManager.prototype.deliverHelperReport.call(manager as any, 'host', 'Alice');
  assert.match(error as string, /did not stop/);
  assert.equal(info.helperReport?.state, 'failed');
  assert.equal(info.helperReport?.text, 'Install dependencies');
});

test('permission questions are left intact and reports are not queued', async () => {
  const info = { id: 'host', kind: 'agent', provider: 'opencode', status: 'needs_input', helperReport: { helperName: 'Widget', text: 'Report', state: 'pending' } } as WorkerInfo;
  const manager = { workers: new Map([['host', { info, pty: { write: () => { throw Error('Permission interrupted'); } } }]]) };
  assert.match(await WorkerManager.prototype.deliverHelperReport.call(manager as any, 'host') as string, /question or permission/);
  assert.equal(info.helperReport?.state, 'pending');
});

test('a terminal interruption error releases the delivery button for retry', async () => {
  const info = { id: 'host', kind: 'agent', provider: 'opencode', status: 'working', helperReport: { helperName: 'Widget', text: 'Report', state: 'pending' } } as WorkerInfo;
  const worker = { info, pty: { write: () => { throw Error('Disconnected terminal'); } } };
  const manager = { workers: new Map([['host', worker]]), emitUpdate: () => {}, persist: () => {} };
  assert.match(await WorkerManager.prototype.deliverHelperReport.call(manager as any, 'host') as string, /Could not interrupt/);
  assert.equal(info.helperReport?.state, 'failed');
});

function removalHarness() {
  const removed: string[] = [];
  const stopped: string[] = [];
  const workers = new Map<string, any>();
  const manager: any = {
    workers, namer: { forget() {} }, scrollback: { remove() {} }, drops: { remove() {} },
    events: { remove(id: string) { removed.push(id); } }, persist() {},
    current: async (wt: unknown) => wt,
    trees: { remove: async () => { stopped.push('worktree'); } },
  };
  manager.kill = WorkerManager.prototype.kill.bind(manager);
  const add = (id: string, hostId?: string) => workers.set(id, {
    info: { id, name: id, worktree: { path: '/shared', branch: 'office/task' }, ...(hostId ? { helper: { hostId } } : {}) },
    pty: { kill() { stopped.push(id); } },
  });
  return { manager, workers, removed, stopped, add };
}

test('sending a host home stops its helper before cleaning the shared worktree', async () => {
  const h = removalHarness();
  h.add('host'); h.add('helper', 'host'); h.add('other-helper', 'other-host');
  await h.manager.kill('host', 'worktree');
  assert.deepEqual(h.stopped, ['helper', 'host', 'worktree']);
  assert.deepEqual(h.removed, ['helper', 'host']);
  assert.equal(h.workers.has('other-helper'), true);
});

test('sending only a helper home never cleans its host worktree', async () => {
  const h = removalHarness(); h.add('host'); h.add('helper', 'host');
  await h.manager.kill('helper', 'all');
  assert.deepEqual(h.stopped, ['helper']);
  assert.equal(h.workers.has('host'), true);
});
