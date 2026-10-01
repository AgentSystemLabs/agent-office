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

test('the protocol is 54 messages, not 121', () => {
  // The number that matters. `handleMessage` is 121 cases across three switches (108 here, 7 in
  // handleSignIns, 6 in handleAccounts); only these act on a Floor and need to travel. If this drifts,
  // a case started or stopped touching a floor and nobody decided where it should run.
  assert.equal(FLOOR_CASES.length, 54);
  assert.equal(new Set(FLOOR_CASES).size, 54, 'no duplicates');
  for (const c of FLOOR_CASES) assert.match(c, /^[a-z]+\.[a-zA-Z]+$/, `${c} is not a namespaced case`);
});

/**
 * The cases that reach a floor but must still stay office-side: they look a floor up and then hand it
 * to an office-side manager, or the lookup only exists to close/notify. "Mentions a floor" is not
 * "acts on one", and these are where that distinction is paid for. See the plan's finding 9.
 */
const LOOKUP_ONLY = [
  'cabinet.play',
  // Musical chairs is a game the office machine runs for its own floor, in its own memory: there is
  // nothing on a host's disk to read, and nobody in the room is there to play it.
  'chairs.start',
  'chairs.stop',
  'dog.name',
  'dog.pet',
  'floor.go',
  'floor.remove',
  'leaveOnMerge.set',
  'meeting.clear',
  'wb.update',
];

/**
 * Floor calls the office makes on its own initiative, with no client message of their own.
 *
 * `ball.left` is the only one, and it became a call when riding onto a hosted floor did: the office
 * puts the ball back under the hoop when somebody leaves, and the ball is wherever that floor is — so
 * on a hosted floor the machine holding the floor is the one that has to drop it. It is still a
 * shipped case rather than something the office does itself, because the office has never seen the
 * ball. Named here so the check below keeps its teeth: a typo is still a typo.
 */
const NO_MESSAGE_CASE = new Set(['ball.left']);

test('every floor case named is a real case in the message switch', () => {
  // The robust half: no ghosts and no typos. A name here that server.ts does not have would be a
  // frame the host accepts and then refuses for a reason nobody can see.
  const source = readFileSync(path.join(root, 'src/server/server.ts'), 'utf8');
  for (const c of FLOOR_CASES) {
    if (NO_MESSAGE_CASE.has(c)) continue;
    assert.ok(new RegExp(`case '${c.replace('.', '\\.')}'`).test(source), `${c} is not a case in server.ts`);
  }
});

test('FLOOR_CASES matches the cases server.ts actually acts on a Floor with', () => {
  // The mechanical check, in both directions. A 46th case added to the switch without a decision
  // about where it runs must fail here rather than silently staying office-side.
  //
  // The shape that made this hard: `ball.take`/`ball.throw` and `car.enter`/`car.leave` are two
  // labels over one body, and the body names only one of each pair. So a run of adjacent `case` lines
  // is one unit, and a body found under it belongs to **every** label in the run.
  const source = readFileSync(path.join(root, 'src/server/server.ts'), 'utf8');
  const lines = source.split('\n');
  const start = lines.findIndex((l) => /^ {4}switch \(msg\.t\)/.test(l));
  assert.notEqual(start, -1, 'the message switch moved — this test needs rewriting');
  let end = start;
  while (end < lines.length && !/^ {4}\}/.test(lines[end])) end++;
  assert.ok(end < lines.length, 'the switch never closes');

  const touches = new Map<string, boolean>();
  // A group is a run of adjacent `case` labels, and the body that follows belongs to every label in
  // it — which is the shape `ball.take`/`ball.throw` and `car.enter`/`car.leave` take. Reading only
  // the first line of a body, or attributing a body to just the last label, is how two cases went
  // missing the first time.
  let group: string[] = [];
  let bodyStarted = false;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    const open = line.match(/^ {6}case '([^']+)'/);
    if (open) {
      if (bodyStarted) group = [];
      group.push(open[1]);
      bodyStarted = false;
      continue;
    }
    if (!group.length || line.trim() === '') continue;
    bodyStarted = true;
    const hit =
      /\.(workers|queue|forge|plan|jukebox|changes|decor|court|garage|meetings|dog|tv)\./.test(line) ||
      /\.(sendHome|sendLandedHome|landed|arrived|merged)\(/.test(line) ||
      /\bhere\(\)|\bfloors\.(get|values)\(/.test(line);
    if (hit) for (const label of group) touches.set(label, true);
  }

  const derived = [...touches.keys()].filter((k) => touches.get(k)).sort();
  assert.ok(derived.length > 40, `the scan only saw ${derived.length} cases, so it is looking in the wrong place`);
  // Everything derived must be declared. The other direction is not mechanical: several cases reach a
  // floor and hand it to an office-side manager (`floor.go`, `dog.pet`, `wb.update`), so they are
  // derived and stay office-side by decision. What matters is that nothing is derived *and* missing.
  const missing = derived.filter((c) => !FLOOR_CASES.includes(c as never) && !LOOKUP_ONLY.includes(c));
  assert.deepEqual(missing, [], `these act on a floor and are neither shipped nor named as lookup-only: ${missing.join(', ')}`);
});

test('the office validates what a machine sends, rather than trusting it', () => {
  // There is no runtime schema in the office to inherit, so the frames check themselves.
  // The office's frames: a welcome, a goodbye, and the floor calls.
  assert.equal(isToOffice({ t: 'welcome', hostId: 'h1', token: 'x', floors: [] }), true);
  assert.equal(isToOffice({ t: 'welcome', hostId: 'h1', floors: [] }), false, 'a welcome with no token is not one');
  assert.equal(isToOffice({ t: 'bye' }), true);
  assert.equal(isToOffice({ t: 'bye', why: 'wrong protocol' }), true);

  // A floor case needs its envelope, or the host cannot tell which floor it is for.
  assert.equal(isToOffice({ t: 'worker.spawn', floorId: 'f1', seq: 1, deskId: 'desk-1' }), true);
  assert.equal(isToOffice({ t: 'worker.spawn', seq: 1, deskId: 'desk-1' }), false, 'no floorId');
  assert.equal(isToOffice({ t: 'worker.spawn', floorId: 'f1', deskId: 'desk-1' }), false, 'no seq');

  assert.equal(isToOffice({ t: 'made.up' }), false);
  assert.equal(isToOffice({ t: 'move' }), false, 'client-local cases never travel');
  // And a machine's frames are not the office's, in either direction.
  assert.equal(isToOffice({ t: 'hello', token: 'x', protocol: 1 }), false, 'a hello comes from the machine');
  assert.equal(isToOffice({ t: 'ready', floor: {} }), false);
  assert.equal(isToOffice('worker.spawn'), false);
  assert.equal(isToOffice(null), false);
});

test('a machine frames are validated the same way', () => {
  // A machine's first frame: a token, or a code if it has never paired.
  assert.equal(isFromFloor({ t: 'hello', protocol: FLOORHOST_PROTOCOL, token: 'x' }), true);
  assert.equal(isFromFloor({ t: 'hello', protocol: FLOORHOST_PROTOCOL, code: 'ABCD-2345', name: 'Laptop' }), true);
  assert.equal(isFromFloor({ t: 'hello', protocol: 1 }), false, 'neither a token nor a code');
  assert.equal(isFromFloor({ t: 'hello', token: 'x' }), false, 'no protocol');
  assert.equal(isFromFloor({ t: 'welcome', hostId: 'h', token: 'x', floors: [] }), false, 'a welcome comes from the office');

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

test('every frame the proxy ships is one the host answers', () => {
  // The two are hand-written on either side of a socket, so they drift — and drift here is silent: a
  // shipped frame with no case falls through the host's `default`, pays a full round trip, and comes
  // back refused. Four had already drifted (`worker.search`, `queue.dropIssue`, `gh.claim`,
  // `meeting.stop`) before this existed.
  const proxy = readFileSync(path.join(root, 'src/server/remote-floor.ts'), 'utf8');
  const host = readFileSync(path.join(root, 'src/server/host-floor.ts'), 'utf8');
  const shipped = new Set([...proxy.matchAll(/call\('([a-zA-Z.]+)'/g)].map((m) => m[1]));
  const answered = new Set([...host.matchAll(/case '([a-zA-Z.]+)'/g)].map((m) => m[1]));
  assert.ok(shipped.size > 40, `the proxy scan saw only ${shipped.size}, so it is looking in the wrong place`);
  const unanswered = [...shipped].filter((t) => !answered.has(t)).sort();
  assert.deepEqual(unanswered, [], `these travel to the host and would always be refused: ${unanswered.join(', ')}`);
  // And every case the host answers is one the proxy can send, so the dispatcher carries nothing dead.
  const unsendable = [...answered].filter((t) => !shipped.has(t)).sort();
  assert.deepEqual(unsendable, [], `the host answers these but nothing sends them: ${unsendable.join(', ')}`);
});

test('every frame the host ships is one the office understands', () => {
  // The mirror half: a frame whose `t` the office has no notion of is dropped on arrival.
  const host = readFileSync(path.join(root, 'src/server/host-floor.ts'), 'utf8');
  const protocol = readFileSync(path.join(root, 'src/shared/floorhost.ts'), 'utf8');
  // Every frame the host sends. Matched at `send({ t: ...` so the *inner* ServerMsg payloads a frame
  // carries (`toast`, `changes`, `worker.update`) are not mistaken for frame kinds.
  const cli = readFileSync(path.join(root, 'src/server/floor-host-cli.ts'), 'utf8');
  const sent = new Set(
    [...host.matchAll(/parts\.send\(\{ t: '([a-zA-Z.]+)'/g), ...cli.matchAll(/send\(\{ t: '([a-zA-Z.]+)'/g)].map((m) => m[1]),
  );
  // ...must be one of the frame kinds the protocol defines for that direction.
  const kinds = new Set([...protocol.matchAll(/^  \| \{ t: '([a-zA-Z.]+)'/gm)].map((m) => m[1]));
  const unknown = [...sent].filter((t) => !kinds.has(t));
  assert.deepEqual(unknown, [], `the host sends frames the protocol does not define: ${unknown.join(', ')}`);
});

test('every state a hosted floor is read for is one the host actually reports', () => {
  // The bug this exists for: the reads used composite names (`decor.list`, `jukebox.state`,
  // `court.state`) that no event ever carried, so seven of eight reads silently returned their empty
  // default while the office went on believing it had the floor's state.
  const proxy = readFileSync(path.join(root, 'src/server/remote-floor.ts'), 'utf8');
  const host = readFileSync(path.join(root, 'src/server/host-floor.ts'), 'utf8');
  const read = new Set([...proxy.matchAll(/last<[^>]*>\('([a-zA-Z.]+)'/g)].map((m) => m[1]));
  const reported = new Set([...host.matchAll(/state\('([a-zA-Z.]+)'/g)].map((m) => m[1]));
  assert.ok(read.size >= 6, `only ${read.size} reads found — the scan is looking in the wrong place`);
  const unserved = [...read].filter((k) => k !== 'queue' && k !== 'meeting' && !reported.has(k));
  assert.deepEqual(unserved, [], `read for state the host never reports: ${unserved.join(', ')}`);
});
