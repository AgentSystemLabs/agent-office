import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Browser module is deliberately plain JavaScript for Pocket.
import { validRequest, createBridge, listenToFrame } from '../integrations/pi-pocket/office-v2-client/bridge.js';

const frameWindow = {};
const origin = 'https://pocket.example';
const channel = 'test-channel';
const request = { type: 'office-v2:request', channel, id: 'request-1', op: 'hire', payload: { deskId: 'desk-1', prompt: 'test' } };

test('Pocket bridge validates the exact source, origin, channel, operation, and bounded schema', () => {
  const good = { source: frameWindow, origin, data: request };
  assert.equal(validRequest(good, frameWindow, origin, channel), true);
  assert.equal(validRequest({ ...good, source: {} }, frameWindow, origin, channel), false);
  assert.equal(validRequest({ ...good, origin: 'https://attacker.example' }, frameWindow, origin, channel), false);
  for (const data of [
    { ...request, channel: 'wrong' }, { ...request, type: 'other' }, { ...request, id: 1 },
    { ...request, op: 'shell' }, { ...request, payload: [] }, { ...request, payload: { text: 'x'.repeat(32000) } },
  ]) assert.equal(validRequest({ ...good, data }, frameWindow, origin, channel), false);
});

test('Pocket bridge fixes the source and translates hire keys without accepting browser model overrides', async () => {
  const calls: unknown[] = [];
  const pocket = { api: async (...args: unknown[]) => { calls.push(args); return {}; } };
  const handle = createBridge({ pocket, source: 42, clientId: 'client', signal: new AbortController().signal });
  await handle('hire', { source: 99, deskId: 'desk-1', prompt: 'task', key: 'stable', model: 'forbidden' });
  assert.deepEqual((calls[0] as unknown[]).slice(0, 2), ['hire/42', { deskId: 'desk-1', prompt: 'task', requestId: 'stable', clientId: 'client' }]);
  await assert.rejects(handle('shell', {}), /not supported/);
});

test('Opening a desk refreshes authorized bindings and inserts only a draft in the selected session', async () => {
  const actions: unknown[] = [];
  let current = 42;
  const pocket = {
    api: async () => ({ bindings: [{ workerId: 'pocket-1', conversationId: 73 }] }),
    openConversation: (id: number) => { current = id; actions.push(['open', id]); },
    conversationId: () => current,
    insertText: (text: string) => actions.push(['draft', current, text]),
    notify: () => {},
  };
  const handle = createBridge({ pocket, source: 42, clientId: 'client', signal: new AbortController().signal });
  assert.deepEqual(await handle('open', { workerId: 'pocket-1', prompt: 'follow up' }), { opened: true, draft: true, sent: false });
  assert.deepEqual(actions, [['open', 73], ['draft', 73, 'follow up']]);
  await assert.rejects(handle('open', { workerId: 'hidden-session' }), /no session you can open/);
});

test('Closing the bridge stops operations and never falls back to another runtime', async () => {
  const stop = new AbortController(); stop.abort();
  const handle = createBridge({ pocket: { api: () => { throw new Error('must not call'); } }, source: 42, clientId: 'client', signal: stop.signal });
  await assert.rejects(handle('hire', {}), /closed/);
});

test('Duplicate frame requests reuse one result; changed payloads and messages after disposal cannot act', async () => {
  let listener: ((event: unknown) => Promise<void>) | undefined;
  const old = (globalThis as any).window;
  const replies: unknown[] = [];
  const frame = { contentWindow: { postMessage: (reply: unknown) => replies.push(reply) } };
  (globalThis as any).window = {
    addEventListener: (_: string, fn: typeof listener) => { listener = fn; },
    removeEventListener: () => {},
  };
  try {
    let calls = 0;
    const dispose = listenToFrame({ frame, origin, channel, handle: async () => { calls++; return { ok: true }; } });
    const event = { source: frame.contentWindow, origin, data: request };
    await listener!(event); await listener!(event);
    assert.equal(calls, 1);
    assert.equal(replies.length, 2);
    await listener!({ ...event, data: { ...request, payload: { prompt: 'different' } } });
    assert.equal(calls, 1);
    assert.match(JSON.stringify(replies.at(-1)), /reused/);
    dispose(); await listener!(event);
    assert.equal(replies.length, 3);
  } finally { (globalThis as any).window = old; }
});
