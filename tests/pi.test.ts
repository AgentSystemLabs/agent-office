import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizePiHook, piArgs, PI_EXTENSION_SOURCE, writePiExtension } from '../src/server/pi.js';
import { isValidPiModel } from '../src/shared/providers.js';
import { WorkerManager, type WorkerEvents } from '../src/server/workers.js';
import { Ledger } from '../src/server/usage.js';
import type { Pty, PtyExit, SpawnOpts } from '../src/server/ptys.js';

test('Pi launch uses interactive mode, an isolated session, and safe prompt arguments', () => {
  const args = piArgs(['--provider', 'openai', '--model', 'old', '--thinking', 'low', '--mode', 'rpc', '-p', '--continue', '--session', 'other', '--session-dir', '/shared', '-e', '/user-extension.mjs'], {
    extension: '/office-extension.mjs', sessionDir: '/worker-session', sessionId: 'worker-session-id', model: 'openai/gpt-4.1', effort: 'high', prompt: '- fix login',
  });
  assert.deepEqual(args, ['-e', '/user-extension.mjs', '--session-dir', '/worker-session', '--extension', '/office-extension.mjs', '--session-id', 'worker-session-id', '--model', 'openai/gpt-4.1', '--thinking', 'high', '--', '- fix login']);
  assert.deepEqual(piArgs(['--model', 'sonnet', '--thinking', 'off', '--no-extensions'], { extension: 'office.mjs', sessionDir: 'worker' }),
    ['--model', 'sonnet', '--thinking', 'off', '--no-extensions', '--session-dir', 'worker', '--extension', 'office.mjs']);
});

test('Pi bridge bounds fields and drops assistant text, tool input, and credentials', () => {
  assert.deepEqual(normalizePiHook({ type: 'tool', status: 'working', sessionId: 'root', tool: 'bash', args: { command: 'secret' }, apiKey: 'secret', assistantMessage: 'secret' }),
    { type: 'tool', status: 'working', sessionId: 'root', tool: 'bash' });
  for (const value of [null, [], {}, { type: 'unknown', status: 'working', sessionId: 'root' }, { type: 'session', status: 'working', sessionId: 'x'.repeat(161) }, { type: 'session', status: 'bad', sessionId: 'root' }, { type: 'prompt', status: 'working', sessionId: 'root', prompt: 'x'.repeat(20001) }]) {
    assert.equal(normalizePiHook(value), undefined);
  }
  assert.equal(isValidPiModel('sonnet:high'), true);
  assert.equal(isValidPiModel('openai/gpt-4.1'), true);
  assert.equal(isValidPiModel('--print'), false);
  assert.equal(isValidPiModel('bad\u200bmodel'), false);
});

test('what reaches the Pi command line from a hook or the hire dialog is only ever plain values', () => {
  // A session id goes back to Pi as --session-id on resume: only what Pi itself takes.
  for (const sessionId of ['a b', 'x&calc', 'id|more', '../up', 'flag\u0000']) {
    assert.equal(normalizePiHook({ type: 'session', status: 'starting', sessionId }), undefined, sessionId);
  }
  assert.equal(normalizePiHook({ type: 'session', status: 'starting', sessionId: '0192f-a_b.c' })?.sessionId, '0192f-a_b.c');
  // A Windows .cmd launcher runs through cmd.exe: none of its metacharacters get into a model.
  for (const model of ['a&b', 'a|b', 'a^b', '%PATH%', 'a<b', 'a>b', 'a"b', '-m']) assert.equal(isValidPiModel(model), false, model);
  // Pi reads a leading '@' as a file to include: a prompt that starts with one stays text.
  assert.deepEqual(piArgs([], { extension: 'x.mjs', sessionDir: 'd', prompt: '@README.md fix the typo' }).slice(-2), ['--', ' @README.md fix the typo']);
});

test('Pi extension reports ordered lifecycle events and waits for actual settlement', async () => {
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const requests: { url: string; token: string; body: any }[] = [];
  const install = new Function('process', 'fetch', PI_EXTENSION_SOURCE.replace('export default function', 'return function'))(
    { env: { AGENT_OFFICE_WORKER_ID: 'worker', AGENT_OFFICE_HOOK_TOKEN: 'worker-token', AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1234' } },
    async (url: URL, options: any) => { requests.push({ url: String(url), token: options.headers.Authorization, body: JSON.parse(options.body) }); },
  );
  install({ on: (name: string, fn: (event: any, ctx: any) => unknown) => handlers.set(name, fn) });
  const ctx = { sessionManager: { getSessionId: () => 'session-1' }, isIdle: () => false };
  const fire = (name: string, event: any = {}) => handlers.get(name)?.(event, ctx);
  await fire('session_start');
  await fire('before_agent_start', { prompt: 'Fix login' });
  await fire('tool_execution_start', { toolName: 'bash', args: { command: 'secret' } });
  await fire('tool_execution_end', { toolName: 'bash', isError: true });
  await fire('ui_prompt_start');
  await fire('ui_prompt_end');
  const before = requests.length;
  await fire('agent_end');
  assert.equal(requests.length, before, 'intermediate agent_end must not complete a queued task');
  await fire('agent_settled');
  assert.deepEqual(requests.map((r) => r.body.status), ['starting', 'working', 'working', 'working', 'needs_input', 'working', 'done']);
  assert.ok(requests.every((r) => r.url === 'http://127.0.0.1:1234/hooks/pi?worker=worker' && r.token === 'Bearer worker-token'));
  assert.ok(requests.every((r) => !('args' in r.body)));
  await fire('session_shutdown');
});

test('Pi extension connectivity failures never interrupt the agent', async () => {
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const install = new Function('process', 'fetch', PI_EXTENSION_SOURCE.replace('export default function', 'return function'))(
    { env: { AGENT_OFFICE_WORKER_ID: 'worker', AGENT_OFFICE_HOOK_TOKEN: 'token', AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1234' } },
    async () => { throw new Error('office unavailable'); },
  );
  install({ on: (name: string, fn: (event: any, ctx: any) => unknown) => handlers.set(name, fn) });
  await handlers.get('session_start')?.({}, { sessionManager: { getSessionId: () => 'root' } });
  await handlers.get('session_shutdown')?.({}, {});
});

test('Pi worker launches, authenticates hooks, resumes its own session, and restores its choices', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-pi-worker-'));
  const file = path.join(root, process.platform === 'win32' ? 'pi.cmd' : 'pi');
  writeFileSync(file, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', { mode: 0o700 });
  const data = path.join(root, 'data');
  mkdirSync(data);
  const launches: { opts: SpawnOpts; exit?: (event: PtyExit) => void }[] = [];
  const managers: WorkerManager[] = [];
  const events: WorkerEvents = { update() {}, remove() {}, data() {}, screen() {}, toast() {} };
  const open = (command = file) => {
    const manager = new WorkerManager(root, data, command, [], { url: 'http://127.0.0.1:1', token: '' }, events, new Ledger(data, { pauseHiring: false }, () => {}, () => {}));
    managers.push(manager);
    (manager as unknown as { host: { spawn(opts: SpawnOpts): Pty } }).host = {
      spawn(opts) {
        const launch: { opts: SpawnOpts; exit?: (event: PtyExit) => void } = { opts };
        launches.push(launch);
        return { pid: 123, write() {}, resize() {}, kill() { launch.exit?.({ exitCode: 0 }); }, onData() {}, onExit(cb) { launch.exit = cb; } };
      },
      stop() {},
      detach() {},
    } as any;
    return manager;
  };
  t.after(() => { managers.forEach((m) => m.shutdown()); rmSync(root, { recursive: true, force: true }); });
  const workers = open();
  const worker = workers.spawn('desk-1', 'Tester', '- fix login', false, 'agent', 'pi', 'openai/gpt-4.1', 'high');
  assert.ok(typeof worker === 'object');
  const first = launches[0].opts;
  assert.equal(first.file, file);
  assert.ok(first.args.includes(path.join(data, 'pi-sessions', worker.id)));
  assert.deepEqual(first.args.slice(-6), ['--model', 'openai/gpt-4.1', '--thinking', 'high', '--', '- fix login']);
  assert.match(readFileSync(writePiExtension(data), 'utf8'), /agent_settled/);
  const token = first.env.AGENT_OFFICE_HOOK_TOKEN;
  const piHook = (id: string, key: string, payload: unknown) => workers.handleProviderHook('pi', id, key, '', payload);
  const hook = (type: string, status: string, extra = {}) => piHook(worker.id, token, { type, status, sessionId: 'pi-root', ...extra });
  assert.equal(piHook(worker.id, 'wrong', { type: 'session', status: 'starting', sessionId: 'pi-root' }), false);
  assert.equal(workers.handleOpenCodeHook(worker.id, token, { type: 'session', status: 'starting', sessionId: 'pi-root' }), false);
  assert.equal(hook('session', 'starting'), true);
  assert.equal(workers.get(worker.id)?.status, 'idle');
  hook('prompt', 'working', { prompt: 'Fix login' });
  assert.equal(workers.get(worker.id)?.status, 'working');
  hook('question', 'needs_input');
  assert.equal(workers.get(worker.id)?.status, 'needs_input');
  hook('session', 'done');
  assert.equal(workers.get(worker.id)?.status, 'done');
  assert.equal(piHook(worker.id, token, { type: 'tool', status: 'working', sessionId: 'other-root' }), false);
  launches[0].exit?.({ exitCode: 0 });
  assert.equal(workers.resume(worker.id), undefined);
  assert.ok(launches[1].opts.args.includes('--session-id'));
  assert.ok(launches[1].opts.args.includes('pi-root'));
  assert.ok(!launches[1].opts.args.includes('- fix login'));
  workers.shutdown();
  const restored = open(process.execPath);
  const saved = restored.get(worker.id);
  assert.deepEqual([saved?.provider, saved?.model, saved?.effort, saved?.sessionId], ['pi', 'openai/gpt-4.1', 'high', 'pi-root']);
});
