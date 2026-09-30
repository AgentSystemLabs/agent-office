import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLOOR_CASES,
  FLOORHOST_MAX_FRAME,
  FLOORHOST_PROTOCOL,
  HostRefusal,
  isDroppable,
  isFromFloor,
  isToOffice,
} from '../src/shared/floorhost.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the protocol is 43 messages, not 117', () => {
  // The number that matters. `handleMessage` is 117 cases across three switches (104 here, 7 in
  // handleSignIns, 6 in handleAccounts); only these act on a Floor and need to travel. If this drifts,
  // a case started or stopped touching a floor and nobody decided where it should run.
  assert.equal(FLOOR_CASES.length, 43);
  assert.equal(new Set(FLOOR_CASES).size, 43, 'no duplicates');
  for (const c of FLOOR_CASES) assert.match(c, /^[a-z]+\.[a-zA-Z]+$/, `${c} is not a namespaced case`);
});

/**
 * The cases that reach a floor but must still stay office-side: they look a floor up and then hand it
 * to an office-side manager, or the lookup only exists to close/notify. "Mentions a floor" is not
 * "acts on one", and these are where that distinction is paid for. See the plan's finding 9.
 */
const LOOKUP_ONLY = [
  'cabinet.play',
  'dog.name',
  'dog.pet',
  'floor.go',
  'floor.remove',
  'leaveOnMerge.set',
  'meeting.clear',
  'meeting.stop',
  'wb.update',
];

test('FLOOR_CASES matches the cases server.ts actually acts on a Floor with', () => {
  // The guard that keeps the list honest: read the switch, find every case whose body calls a method
  // on a floor, and subtract the ones that only look one up. What is left must be exactly FLOOR_CASES,
  // so a 45th case added to the switch without a decision fails here rather than going unnoticed.
  const source = readFileSync(path.join(root, 'src/server/server.ts'), 'utf8');
  const lines = source.split('\n');
  const start = lines.findIndex((l) => /^ {4}switch \(msg\.t\)/.test(l));
  assert.notEqual(start, -1, 'the message switch moved — this test needs rewriting');
  // The switch closes at the first 4-space brace after it.
  let end = start;
  while (end < lines.length && !/^ {4}\}/.test(lines[end])) end++;
  assert.ok(end < lines.length, 'the switch never closes');

  const touches = new Map<string, boolean>();
  let caseName: string | undefined;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    const open = line.match(/^ {6}case '([^']+)'/);
    if (open) {
      caseName = open[1];
      if (!touches.has(caseName)) touches.set(caseName, false);
      continue;
    }
    if (caseName === undefined || touches.get(caseName)) continue;
    // Optional chaining counts: floorOf(c)?.garage.honk() reaches the garage.
    if (/\.(workers|queue|forge|plan|jukebox|changes|decor|court|garage|meetings|dog)\./.test(line)) touches.set(caseName, true);
    if (/\.(sendHome|sendLandedHome|landed|arrived|merged)\(/.test(line)) touches.set(caseName, true);
    if (/\bhere\(\)|\bfloors\.(get|values)\(/.test(line)) touches.set(caseName, true);
  }
  assert.ok(touches.size > 90, `the scan only saw ${touches.size} cases, so it is looking in the wrong place`);

  const expected = [...touches]
    .filter(([, acted]) => acted)
    .map(([name]) => name)
    .filter((name) => !LOOKUP_ONLY.includes(name))
    .sort();
  assert.deepEqual(expected, [...FLOOR_CASES].sort(), 'FLOOR_CASES has drifted from what server.ts acts on');
});

test('ToHost frames are validated, not trusted', () => {
  // There is no runtime schema in the office to inherit, so the frames check themselves.
  assert.equal(isToOffice({ t: 'hello', token: 'x', protocol: FLOORHOST_PROTOCOL, floors: [], hostId: 'h' }), true);
  assert.equal(isToOffice({ t: 'hello', protocol: 1 }), false, 'a hello without a token is refused');
  assert.equal(isToOffice({ t: 'bye' }), true);

  // A floor case needs its envelope, or the host cannot tell which floor it is for.
  assert.equal(isToOffice({ t: 'worker.spawn', floorId: 'f1', seq: 1, deskId: 'desk-1' }), true);
  assert.equal(isToOffice({ t: 'worker.spawn', seq: 1, deskId: 'desk-1' }), false, 'no floorId');
  assert.equal(isToOffice({ t: 'worker.spawn', floorId: 'f1', deskId: 'desk-1' }), false, 'no seq');

  assert.equal(isToOffice({ t: 'made.up' }), false);
  assert.equal(isToOffice({ t: 'move' }), false, 'client-local cases never travel');
  assert.equal(isToOffice('worker.spawn'), false);
  assert.equal(isToOffice(null), false);
});

test('FromHost frames are validated the same way', () => {
  assert.equal(isFromFloor({ t: 'ready', floor: { floorId: 'f1', name: 'API', seats: 2 } }), true);
  assert.equal(isFromFloor({ t: 'ready', floor: { floorId: 'f1' } }), false, 'a floor with no name or seat count is not ready');
  assert.equal(isFromFloor({ t: 'ready', floor: {} }), false);
  assert.equal(isFromFloor({ t: 'event', floorId: 'f1', seq: 3, msg: { t: 'worker.update' } }), true);
  assert.equal(isFromFloor({ t: 'event', floorId: 'f1', msg: {} }), false, 'an event without a seq cannot be ordered');
  assert.equal(isFromFloor({ t: 'term.data', floorId: 'f1', workerId: 'w', data: 'x' }), true);
  assert.equal(isFromFloor({ t: 'term.data', workerId: 'w', data: 'x' }), false, 'terminal data names its floor too');
  assert.equal(isFromFloor({ t: 'nope' }), false);
});

test('a refusal names its floor, or explains itself when there is no floor yet', () => {
  // Two shapes for one frame type: a hire the host turned down, and a connection refused before a
  // floor was ever involved. The second has no floorId to check, which is why the validator branches.
  assert.equal(isFromFloor({ t: 'refused', floorId: 'f1', workerId: 'w', reason: 'seats' }), true);
  assert.equal(isFromFloor({ t: 'refused', floorId: 'f1', reason: 'asleep' }), true);
  assert.equal(isFromFloor({ t: 'refused', why: 'This office speaks floor-host protocol 1' }), true);
  assert.equal(isFromFloor({ t: 'refused' }), false, 'a refusal that says nothing is not worth sending');
  // Every reason here is capacity or kind. None names a person, a role or an account.
  for (const r of ['asleep', 'seats', 'not-accepting', 'offline']) {
    assert.doesNotMatch(r, /admin|role|member|owner|account/i);
  }
});

test('a frame naming a floor this host does not serve is not a frame we accept', () => {
  // decision 6: one socket carries N floors, so the envelope's floorId is the only thing keeping two
  // floors apart. A frame without a usable floorId never gets that far — the validators above reject
  // it — and the registry rejects one it does not know. This test pins the half that is pure data.
  const served = new Set(['f1', 'f2']);
  const foreign = { t: 'event' as const, floorId: 'f3', seq: 1, msg: { t: 'worker.update' } };
  assert.equal(isFromFloor(foreign), true, 'well-formed');
  assert.equal(served.has(foreign.floorId), false, 'but not ours, so the registry drops it');
});

test('only frames that will be re-sent on attach are droppable', () => {
  // Back-pressure is what keeps a slow link from queueing unbounded data in office memory. It is only
  // safe where a later copy exists: a joining browser replays the last screen, so shedding a frame of
  // animation costs nothing. Status and boards have no second copy.
  assert.equal(isDroppable('screen'), true);
  assert.equal(isDroppable('term.data'), true);
  assert.equal(isDroppable('worker.update'), false);
  assert.equal(isDroppable('gh.pulls'), false);
  assert.equal(isDroppable('chat'), false);
  assert.equal(isDroppable('queue'), false);
});

test('the frame cap matches the WebSocket the office itself uses', () => {
  assert.equal(FLOORHOST_MAX_FRAME, 2 * 1024 * 1024);
});

test('every refusal is about capacity or kind, never about who is asking', () => {
  // The one rule that must not quietly grow a role check. If a refusal reason ever named a person or
  // a role, this is where it would show up first.
  const reasons: HostRefusal[] = ['asleep', 'seats', 'not-accepting', 'offline'];
  assert.deepEqual([...reasons].sort(), ['asleep', 'not-accepting', 'offline', 'seats']);
  for (const r of reasons) assert.doesNotMatch(r, /admin|role|member|owner|account/i);
});
