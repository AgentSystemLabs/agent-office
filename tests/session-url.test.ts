import test from 'node:test';
import assert from 'node:assert/strict';
import { claude } from '../src/server/providers/claude.js';
import type { WorkerHandle } from '../src/server/workers/types.js';

/**
 * A worker's terminal offers a page its provider points at (see WorkerInfo.sessionUrl), opened as a
 * pinned tab beside the terminal. How it gets there: Claude Code's hook route, which any provider
 * can speak (see hooksAs), carries the address with the worker's session.
 */

/** A handle enough for the hook: what the worker is, and what may be done to it. */
function handleWith(info: ReturnType<WorkerHandle['setStatus']> extends never ? never : WorkerHandle['info']): WorkerHandle & { emitted: number } {
  const h = {
    info,
    state: undefined,
    running: true,
    bootBlocked: false,
    leftNeedsInputAt: 0,
    failStreak: 0,
    tracker: { transcript: undefined } as unknown as WorkerHandle['tracker'],
    pendingPrompt: undefined,
    emitted: 0,
    setStatus: (status: WorkerHandle['info']['status']) => {
      info.status = status;
    },
    emit: () => {
      h.emitted += 1;
    },
    persist: () => {},
    notePrompt: () => {},
    noteTool: () => {},
    notePr: () => {},
    clearTask: () => {},
    scheduleScan: () => {},
    prompt: () => undefined,
  };
  return h as unknown as WorkerHandle & { emitted: number };
}

const start = (url: unknown) => ({ session_id: 's-1', source: 'startup', web_url: url });

test("a session's own web page becomes the worker's session url", () => {
  const h = handleWith({ id: 'w1', kind: 'agent', status: 'starting' } as WorkerHandle['info']);
  assert.equal(claude.hook?.handle(h, 'SessionStart', start('https://openfox.local/p/p1/s/s1')), true);
  assert.equal(h.info.sessionUrl, 'https://openfox.local/p/p1/s/s1');
  assert.ok(h.emitted >= 1, 'everyone on the floor is told');
});

test('an embed url is taken too, when that is what the provider sends', () => {
  const h = handleWith({ id: 'w1', kind: 'agent', status: 'starting' } as WorkerHandle['info']);
  claude.hook?.handle(h, 'SessionStart', { session_id: 's-1', embed_url: 'http://127.0.0.1:10469/p/p1/s/s1' });
  assert.equal(h.info.sessionUrl, 'http://127.0.0.1:10469/p/p1/s/s1');
});

test('a session url that is not a web link is never taken', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'openfox.local/p/p1/s/s1', '']) {
    const h = handleWith({ id: 'w1', kind: 'agent', status: 'starting' } as WorkerHandle['info']);
    claude.hook?.handle(h, 'SessionStart', start(bad));
    assert.equal(h.info.sessionUrl, undefined, `${bad} refused`);
  }
});

test('a session url stays put when the same one comes round again', () => {
  const h = handleWith({ id: 'w1', kind: 'agent', status: 'starting' } as WorkerHandle['info']);
  claude.hook?.handle(h, 'SessionStart', start('https://openfox.local/p/p1/s/s1'));
  const before = h.emitted;
  claude.hook?.handle(h, 'SessionStart', start('https://openfox.local/p/p1/s/s1'));
  assert.equal(h.emitted, before, 'nothing new to say');
});

test('a session url is taken whenever it arrives, not only at the session start', () => {
  // A provider may only know where its session is after it has begun, and says so on a later event.
  const h = handleWith({ id: 'w1', kind: 'agent', status: 'working' } as WorkerHandle['info']);
  claude.hook?.handle(h, 'UserPromptSubmit', { session_id: 's-1', prompt: 'go', web_url: 'https://openfox.local/p/p1/s/s1' });
  assert.equal(h.info.sessionUrl, 'https://openfox.local/p/p1/s/s1');
});
