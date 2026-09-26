import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  mergeOpenCodeConfigContent,
  writeOpenCodePlugin,
} from '../src/server/opencode.js';

test('merges the inline OpenCode config and preserves user plugins', () => {
  const plugin = 'file:///tmp/agent-office-opencode.mjs';
  const merged = JSON.parse(mergeOpenCodeConfigContent(JSON.stringify({ model: 'x/y', plugin: ['one'] }), plugin));
  assert.equal(merged.model, 'x/y');
  assert.deepEqual(merged.plugin, ['one', plugin]);
});

test('does not duplicate the generated plugin in inline config', () => {
  const plugin = 'file:///tmp/agent-office-opencode.mjs';
  const merged = JSON.parse(mergeOpenCodeConfigContent(JSON.stringify({ plugin: [plugin] }), plugin));
  assert.deepEqual(merged.plugin, [plugin]);
});

test('rejects malformed inline OpenCode config instead of dropping user settings', () => {
  assert.throws(() => mergeOpenCodeConfigContent('{model:', 'file:///tmp/agent-office-opencode.mjs'), /OPENCODE_CONFIG_CONTENT/);
});

test('writes a loadable plugin module that forwards root events and excludes subagents', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-opencode-'));
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.AGENT_OFFICE_HOOK_URL;
  const oldToken = process.env.AGENT_OFFICE_HOOK_TOKEN;
  const oldWorker = process.env.AGENT_OFFICE_WORKER_ID;
  const oldSession = process.env.AGENT_OFFICE_SESSION_ID;
  const sent: unknown[] = [];
  try {
    const file = writeOpenCodePlugin(dir);
    process.env.AGENT_OFFICE_HOOK_URL = 'http://127.0.0.1:1';
    process.env.AGENT_OFFICE_HOOK_TOKEN = 'token';
    process.env.AGENT_OFFICE_WORKER_ID = 'worker';
    process.env.AGENT_OFFICE_SESSION_ID = 'ses_existing';
    globalThis.fetch = (async (_url, init) => {
      sent.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const mod = await import(`${pathToFileURL(file).href}?test=${Date.now()}`) as { default: (ctx?: unknown) => Promise<any> };
    const hooks = await mod.default({});
    await hooks.event({ event: { type: 'session.status', properties: { sessionID: 'ses_existing', status: { type: 'busy' } } } });
    await hooks.event({ event: { type: 'session.created', properties: { info: { id: 'ses_root' } } } });
    await hooks.event({ event: { type: 'session.created', properties: { info: { id: 'ses_child', parentID: 'ses_root' } } } });
    await hooks.event({ event: { type: 'session.status', properties: { sessionID: 'ses_child', status: { type: 'busy' } } } });
    await hooks['chat.message']({ sessionID: 'ses_root' }, { parts: [{ type: 'text', text: 'fix the thing' }] });
    await hooks.event({ event: { type: 'session.status', properties: { sessionID: 'ses_root', status: { type: 'busy' } } } });
    assert.deepEqual(sent, [
      { type: 'session', sessionId: 'ses_existing', status: 'working' },
      { type: 'session', sessionId: 'ses_root', status: 'starting' },
      { type: 'prompt', sessionId: 'ses_root', status: 'working', prompt: 'fix the thing' },
      { type: 'session', sessionId: 'ses_root', status: 'working' },
    ]);

    // Selecting an existing root conversation emits no session.created event. Verify it through
    // the SDK before adopting it, and serialize that lookup with subsequent busy/idle events.
    const selected = await mod.default({ client: { session: { get: async ({ path }: any) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { data: { id: path.id, ...(path.id === 'child' ? { parentID: 'parent' } : {}) } };
    } } } });
    sent.length = 0;
    await Promise.all([
      selected['chat.message']({ sessionID: 'saved' }, { parts: [{ type: 'text', text: 'continue here' }] }),
      selected.event({ event: { type: 'session.status', properties: { sessionID: 'saved', status: { type: 'idle' } } } }),
    ]);
    assert.deepEqual(sent, [
      { type: 'session', sessionId: 'saved', status: 'starting' },
      { type: 'prompt', sessionId: 'saved', status: 'working', prompt: 'continue here' },
      { type: 'session', sessionId: 'saved', status: 'done' },
    ]);
    await selected['chat.message']({ sessionID: 'child' }, { parts: [{ type: 'text', text: 'child task' }] });
    assert.equal(sent.length, 3, 'a child prompt must not take over the worker');

    // State belongs to the plugin instance, even when OpenCode caches the module itself.
    await hooks.event({ event: { type: 'session.status', properties: { sessionID: 'ses_root', status: { type: 'idle' } } } });
    assert.deepEqual(sent.at(-1), { type: 'session', sessionId: 'ses_root', status: 'done' });

    sent.length = 0;
    const event = (type: string, properties: Record<string, unknown>) => selected.event({ event: { type, properties: { sessionID: 'saved', ...properties } } });
    await event('permission.asked', { id: 'permission-1', permission: 'edit' });
    await event('question.asked', { id: 'question-1', questions: [{ question: 'Which file?' }] });
    await event('permission.replied', { requestID: 'permission-1', reply: 'once' });
    assert.equal((sent.at(-1) as any).status, 'needs_input');
    await event('question.replied', { requestID: 'question-1', answers: [['one.ts']] });
    assert.equal((sent.at(-1) as any).status, 'working');
    await event('session.error', { error: { name: 'APIError', data: { message: 'Unavailable' } } });
    assert.deepEqual(sent.at(-1), { type: 'error', sessionId: 'saved', status: 'needs_input', detail: 'Unavailable' });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.AGENT_OFFICE_HOOK_URL; else process.env.AGENT_OFFICE_HOOK_URL = oldUrl;
    if (oldToken === undefined) delete process.env.AGENT_OFFICE_HOOK_TOKEN; else process.env.AGENT_OFFICE_HOOK_TOKEN = oldToken;
    if (oldWorker === undefined) delete process.env.AGENT_OFFICE_WORKER_ID; else process.env.AGENT_OFFICE_WORKER_ID = oldWorker;
    if (oldSession === undefined) delete process.env.AGENT_OFFICE_SESSION_ID; else process.env.AGENT_OFFICE_SESSION_ID = oldSession;
    rmSync(dir, { recursive: true, force: true });
  }
});
