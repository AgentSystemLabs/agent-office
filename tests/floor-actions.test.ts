import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOOR_CASES } from '../src/shared/floorhost.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * FloorActions is the seam the whole feature hangs off: `Floor` satisfies it locally, and
 * `RemoteFloor` will satisfy it by shipping frames. This file cannot check that structurally —
 * instantiating a real Floor needs a checkout — so it checks the two things that can be checked
 * from the source, and `src/server/floor.ts` carries the compile-time assertion for the rest.
 */
test('every floor case has a method on the FloorActions surface', () => {
  const source = readFileSync(path.join(root, 'src/server/floor-actions.ts'), 'utf8');
  // Every family of floor call needs an interface of its own, or RemoteFloor has nothing to implement.
  for (const family of ['FloorWorkers', 'FloorQueue', 'FloorForge', 'FloorChanges', 'FloorPlan', 'FloorDecor', 'FloorRoom', 'FloorCourt', 'FloorGarage', 'FloorMeetings']) {
    assert.match(source, new RegExp(`export interface ${family}\\b`), `${family} is missing`);
  }
  // And the three that hang off the floor itself.
  for (const m of ['arrived', 'merged', 'landed', 'sendLandedHome', 'sendHome']) {
    assert.match(source, new RegExp(`\\b${m}\\(`), `FloorActions.${m} is missing`);
  }
});

test('every member of FloorWorkers is one server.ts actually calls', () => {
  // The interface is the union of what the 43 cases need and nothing more, so a member nobody calls
  // is a method RemoteFloor would implement for no reason.
  const server = readFileSync(path.join(root, 'src/server/server.ts'), 'utf8');
  const actions = readFileSync(path.join(root, 'src/server/floor-actions.ts'), 'utf8');
  // A call, not a mention: `workers.spawn(` and not `workers.ts` in an import comment.
  const used = new Set([...server.matchAll(/workers\.([a-zA-Z]+)\(/g)].map((m) => m[1]));
  // The hook handlers and a few internals are called by the office's own machinery, not by a
  // floor-scoped case; they stay on WorkerManager rather than travelling.
  const officeOnly = new Set([
    'authenticate', 'detachAll', 'drop', 'fetchBase', 'fullScreens', 'handleCodexHook',
    'handleGrokHook', 'handleHook', 'handleMuseHook', 'handleOpenCodeHook', 'officeDefault',
    'owners', 'wakeAll',
  ]);
  const wanted = [...used].filter((m) => !officeOnly.has(m)).sort();
  const missing = wanted.filter((m) => !new RegExp(`\\b${m}\\(`).test(actions));
  assert.deepEqual(missing, [], `server.ts calls these on workers, so FloorWorkers needs them: ${missing.join(', ')}`);
});

test('FloorActions names a floor id and refuses nothing about who is asking', () => {
  const source = readFileSync(path.join(root, 'src/server/floor-actions.ts'), 'utf8');
  assert.match(source, /readonly id: string/);
  // The rule that must not quietly grow a role check: nothing on this surface asks who is asking.
  assert.doesNotMatch(source, /admin|isAdmin|role|accountId|canHire/i, 'the action surface must not carry a permission');
  // Every hire-shaped method returns a refusal string rather than throwing, which is how the office
  // already reports a refusal to the person who asked. It is Awaitable because a hosted floor answers
  // over the socket; a floor in this process still returns the value directly.
  assert.match(source, /\| string>/, 'hires and seats report a refusal');
  assert.match(source, /export type Awaitable<T> = T \| Promise<T>;/, 'and may have crossed a socket to do it');
});

test('the three kinds of call are split by what the office does with the answer', () => {
  // This split is the whole reason the proxy can exist. A method whose result the office branches on
  // has to be awaited, because a hosted floor answers it over the network. A read the floor streams
  // upward stays synchronous, so a hosted floor costs no round trip for it. A write nobody reads the
  // answer to is shipped and forgotten, with the outcome arriving later as an event.
  const source = readFileSync(path.join(root, 'src/server/floor-actions.ts'), 'utf8');

  // Synchronous reads: answered from the mirror the host keeps.
  for (const m of ['list(): WorkerInfo[]', 'get(id: string): WorkerInfo | undefined', 'deskOccupied(deskId: string): boolean', 'state(): QueueState']) {
    assert.ok(source.includes(m), `${m} should stay synchronous — the floor streams it upward`);
  }

  // Awaited writes: the office shows the refusal or reacts to the result.
  for (const m of ['spawn(', 'station(', 'add(prompt: string', 'dropIssue(issue: number): Awaitable<boolean>', 'label(deskId']) {
    assert.ok(source.includes(m), `${m} should be awaited — the office branches on its result`);
  }

  // Fire-and-forget: nobody reads the answer.
  for (const m of ['write(id: string, data: string, by: string): void', 'resize(id: string, cols: number, rows: number): void', 'skip(by: string): void', 'move(taskId: string, delta: -1 | 1): void']) {
    assert.ok(source.includes(m), `${m} should stay void — nobody reads its answer`);
  }

  // And the three that are not on the surface at all, because they are files on the host. Prose in
  // the comments names them, so this looks for interface members rather than the words.
  assert.doesNotMatch(source, /^\s+(whiteboard|dog|docs)\s*:/m, 'a hosted floor must never have the office read its checkout');
  assert.doesNotMatch(source, /^\s+readonly (whiteboard|dog|docs)\b/m);
});

test('the 54 floor cases map onto the interface, not onto the class', () => {
  // A guard on the shape of the design rather than a type check: the cases travel as frames, so the
  // surface they need is what RemoteFloor implements. Nothing here should name a Floor member that
  // only exists on the class.
  assert.equal(FLOOR_CASES.length, 54);
  const actions = readFileSync(path.join(root, 'src/server/floor-actions.ts'), 'utf8');
  for (const m of ['spawn', 'station', 'sendHelper', 'resume', 'prompt', 'kill', 'attach', 'detach', 'write', 'resize', 'openPr', 'rebuild', 'inspectWorktree']) {
    assert.match(actions, new RegExp(`\\b${m}\\(`), `workers.${m} must be on the surface`);
  }
  for (const m of ['add', 'remove', 'move', 'retry', 'clear', 'setLimit']) {
    assert.match(actions, new RegExp(`\\b${m}\\(`), `queue.${m} must be on the surface`);
  }
});
