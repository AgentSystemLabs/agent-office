import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Pocket browser modules are deliberately plain JavaScript.
import { roomPeople, workerStatus, roomViews } from '../integrations/pi-pocket/office-v2-client/views.js';
// @ts-ignore Pocket browser modules are deliberately plain JavaScript.
import { createBridge, validRequest } from '../integrations/pi-pocket/office-v2-client/bridge.js';

test('avatar action bridge uses only the fixed source and server-bound client identity', async () => {
  const calls: unknown[][] = [];
  const frame = {};
  const payload = { source: 99, clientId: 'another-person', action: { t: 'act' } };
  assert.equal(validRequest({ source: frame, origin: 'https://pocket.test', data: { type: 'office-v2:request', channel: 'channel', id: 'act-1', op: 'presence', payload } }, frame, 'https://pocket.test', 'channel'), true);
  const handle = createBridge({ pocket: { api: async (...args: unknown[]) => { calls.push(args); return {}; } }, source: 3, clientId: 'fixed-client', signal: new AbortController().signal });
  await handle('presence', payload);
  assert.deepEqual(calls[0].slice(0, 2), ['presence/3', { clientId: 'fixed-client', action: { t: 'act' } }]);
});

test('native people list groups tabs by authenticated account, never by display name', () => {
  const owner = { id: 'owner:first-tab', name: 'Sam' };
  const otherTab = { id: 'owner:second-tab', name: 'Sam' };
  const guest = { id: 'guest:first-tab', name: 'Sam' };
  assert.deepEqual(roomPeople([owner, otherTab, guest]), [otherTab, guest]);
  assert.deepEqual(roomPeople([{ id: 'unscoped' }, { id: 'another' }]).length, 2);
});

test('native room never equates unknown metadata or idle with successful completion', () => {
  assert.equal(workerStatus('working'), 'Working');
  assert.equal(workerStatus('idle'), 'Idle');
  for (const status of ['offline', 'done', 'exited', undefined, 'unknown']) assert.equal(workerStatus(status), 'Status unavailable');
});

test('native room components register without fetching assets, creating a scene, or accessing a browser', () => {
  const views = roomViews({}, () => {});
  assert.equal(typeof views.Avatar, 'function');
  assert.equal(typeof views.Hire, 'function');
});

test('optional 3D customization opens native Pocket preferences without a model or API request', async () => {
  let opened = 0;
  const frame = {};
  const request = { type: 'office-v2:request', channel: 'channel', id: 'customize-1', op: 'customize', payload: {} };
  assert.equal(validRequest({ source: frame, origin: 'https://pocket.test', data: request }, frame, 'https://pocket.test', 'channel'), true);
  const handle = createBridge({ pocket: { api: () => { throw new Error('No API request allowed'); } }, source: 3, clientId: 'client', signal: new AbortController().signal, customize: () => opened++ });
  assert.deepEqual(await handle('customize', {}), { opened: true });
  assert.equal(opened, 1);
});

test('native open refreshes authorization without changing presence and cannot navigate after disposal', async () => {
  const stop = new AbortController();
  let finish: (value: unknown) => void = () => {};
  let opened = 0;
  let route = '';
  const pocket = {
    api: (path: string) => { route = path; return new Promise((resolve) => { finish = resolve; }); },
    openConversation: () => opened++,
  };
  const handle = createBridge({ pocket, source: 3, clientId: 'client', signal: stop.signal });
  const pending = handle('open', { workerId: 'worker' });
  assert.equal(new URL(route, 'https://pocket.test').searchParams.has('presence'), false);
  stop.abort();
  finish({ bindings: [{ workerId: 'worker', conversationId: 4 }] });
  await assert.rejects(pending, /closed/);
  assert.equal(opened, 0);
});

test('scoped inspector handoff checks lifetime after its asynchronous host opens', async () => {
  const stop = new AbortController();
  let drafts = 0;
  const pocket = {
    api: async () => ({ bindings: [{ workerId: 'worker', conversationId: 4 }] }),
    openConversation: () => { throw new Error('Parent navigation is forbidden'); },
    insertText: () => drafts++,
  };
  const handle = createBridge({ pocket, source: 3, clientId: 'client', signal: stop.signal, inspect: async () => { stop.abort(); } });
  await assert.rejects(handle('open', { workerId: 'worker', prompt: 'Unsent follow-up' }), /closed/);
  assert.equal(drafts, 0);
});
