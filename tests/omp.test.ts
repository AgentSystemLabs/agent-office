import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeOmpHook, ompArgs, OMP_EXTENSION_SOURCE, writeOmpExtension } from '../src/server/omp.js';
import { isValidOmpModel } from '../src/shared/providers.js';
import { WorkerManager, type WorkerEvents } from '../src/server/workers.js';
import { Ledger } from '../src/server/usage.js';
import type { Pty, PtyExit, SpawnOpts } from '../src/server/ptys.js';

test('OMP launch names no session folder of its own, keeps the extension, and takes only plain prompt arguments', () => {
  const args = ompArgs(['--profile', 'work', '--model', 'old', '--thinking', 'low', '--mode', 'rpc', '-p', '--continue', '--resume', 'other', '--session-dir', '/shared', '-e', '/user-extension.mjs'], {
    extension: '/office-extension.mjs', sessionId: 'worker-session-id', model: 'deepseek/deepseek-v4-flash', effort: 'high', prompt: '- fix login',
  });
  assert.deepEqual(args, ['-e', '/user-extension.mjs', '--extension', '/office-extension.mjs', '--resume', 'worker-session-id', '--model', 'deepseek/deepseek-v4-flash', '--thinking', 'high', '--', '- fix login']);
  // A desk that still keeps a session folder of its own resumes inside it; nothing else names one.
  assert.deepEqual(ompArgs([], { extension: 'office.mjs', sessionDir: 'desk-folder', sessionId: 'abc' }),
    ['--session-dir', 'desk-folder', '--extension', 'office.mjs', '--resume', 'abc']);
  assert.deepEqual(ompArgs(['--model', 'sonnet', '--thinking', 'off', '--no-session'], { extension: 'office.mjs' }),
    ['--model', 'sonnet', '--thinking', 'off', '--extension', 'office.mjs']);
});

test('OMP bridge bounds fields and drops assistant text, tool input, and credentials', () => {
  assert.deepEqual(normalizeOmpHook({ type: 'tool', status: 'working', sessionId: 'root', tool: 'bash', args: { command: 'secret' }, apiKey: 'secret', assistantMessage: 'secret' }),
    { type: 'tool', status: 'working', sessionId: 'root', tool: 'bash' });
  for (const value of [null, [], {}, { type: 'unknown', status: 'working', sessionId: 'root' }, { type: 'session', status: 'working', sessionId: 'x'.repeat(161) }, { type: 'session', status: 'bad', sessionId: 'root' }, { type: 'prompt', status: 'working', sessionId: 'root', prompt: 'x'.repeat(20001) }]) {
    assert.equal(normalizeOmpHook(value), undefined);
  }
  assert.equal(isValidOmpModel('sonnet:high'), true);
  assert.equal(isValidOmpModel('deepseek/deepseek-v4-flash'), true);
  assert.equal(isValidOmpModel('--print'), false);
  assert.equal(isValidOmpModel('bad\u200bmodel'), false);
});

test('what reaches the OMP command line from a hook or the hire dialog is only ever plain values', () => {
  // A session id goes back to OMP as --resume: only what OMP itself takes.
  for (const sessionId of ['a b', 'x&calc', 'id|more', '../up', 'flag\u0000']) {
    assert.equal(normalizeOmpHook({ type: 'session', status: 'starting', sessionId }), undefined, sessionId);
  }
  assert.equal(normalizeOmpHook({ type: 'session', status: 'starting', sessionId: '0192f-a_b.c' })?.sessionId, '0192f-a_b.c');
  // A Windows .cmd launcher runs through cmd.exe: none of its metacharacters get into a model.
  for (const model of ['a&b', 'a|b', 'a^b', '%PATH%', 'a<b', 'a>b', 'a"b', '-m']) assert.equal(isValidOmpModel(model), false, model);
  // OMP reads a leading '@' as a file to include: a prompt that starts with one stays text.
  assert.deepEqual(ompArgs([], { extension: 'x.mjs', prompt: '@README.md fix the typo' }).slice(-2), ['--', ' @README.md fix the typo']);
});

test('OMP extension reports ordered lifecycle events, and only a settled turn is done', async () => {
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const requests: { url: string; token: string; body: any }[] = [];
  const install = new Function('process', 'fetch', OMP_EXTENSION_SOURCE.replace('export default function', 'return function'))(
    { env: { AGENT_OFFICE_WORKER_ID: 'worker', AGENT_OFFICE_HOOK_TOKEN: 'worker-token', AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1234' } },
    async (url: URL, options: any) => { requests.push({ url: String(url), token: options.headers.Authorization, body: JSON.parse(options.body) }); },
  );
  install({ on: (name: string, fn: (event: any, ctx: any) => unknown) => handlers.set(name, fn) });
  const ctx = { sessionManager: { getSessionId: () => 'session-1' } };
  const fire = (name: string, event: any = {}) => handlers.get(name)?.(event, ctx);
  await fire('session_start');
  await fire('before_agent_start', { prompt: 'Fix login' });
  await fire('tool_execution_start', { toolName: 'bash', args: { command: 'secret' } });
  await fire('message_end', { message: { role: 'assistant', stopReason: 'error' } });
  await fire('tool_approval_requested', { toolName: 'bash' });
  await fire('tool_approval_resolved', { toolName: 'bash' });
  await fire('tool_execution_start', { toolName: 'ask', args: { questions: [{ question: 'secret' }] } });
  await fire('tool_execution_end', { toolName: 'ask' });
  await fire('agent_end', { willContinue: true });
  await fire('agent_end', { willContinue: false });
  assert.deepEqual(requests.map((r) => r.body.type), ['session', 'prompt', 'tool', 'error', 'question', 'session', 'question', 'session', 'session', 'session']);
  assert.deepEqual(requests.map((r) => r.body.status), ['starting', 'working', 'working', 'working', 'needs_input', 'working', 'needs_input', 'working', 'working', 'done']);
  assert.equal(requests[1].body.prompt, 'Fix login');
  assert.equal(requests[2].body.tool, 'bash');
  assert.ok(requests.every((r) => r.url === 'http://127.0.0.1:1234/hooks/omp?worker=worker' && r.token === 'Bearer worker-token'));
  assert.ok(requests.every((r) => !('args' in r.body)));
  await fire('session_shutdown');
});

test('OMP extension connectivity failures never interrupt the agent', async () => {
  const handlers = new Map<string, (event: any, ctx: any) => unknown>();
  const install = new Function('process', 'fetch', OMP_EXTENSION_SOURCE.replace('export default function', 'return function'))(
    { env: { AGENT_OFFICE_WORKER_ID: 'worker', AGENT_OFFICE_HOOK_TOKEN: 'token', AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1234' } },
    async () => { throw new Error('office unavailable'); },
  );
  install({ on: (name: string, fn: (event: any, ctx: any) => unknown) => handlers.set(name, fn) });
  await handlers.get('session_start')?.({}, { sessionManager: { getSessionId: () => 'root' } });
  await handlers.get('session_shutdown')?.({}, {});
});

test('an OMP worker launches, authenticates hooks, resumes its own session, and restores its choices', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-omp-worker-'));
  const file = path.join(root, process.platform === 'win32' ? 'omp.cmd' : 'omp');
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
  const worker = workers.spawn('desk-1', 'Tester', '- fix login', false, 'agent', 'omp', 'deepseek/deepseek-v4-flash', 'high');
  assert.ok(typeof worker === 'object');
  const first = launches[0].opts;
  assert.equal(first.file, file);
  // Its sessions are OMP's own (the person's store), so a new desk names no folder of its own.
  assert.equal(first.args.includes('--session-dir'), false);
  assert.deepEqual(first.args.slice(-6), ['--model', 'deepseek/deepseek-v4-flash', '--thinking', 'high', '--', '- fix login']);
  assert.match(readFileSync(writeOmpExtension(data), 'utf8'), /willContinue/);
  const token = first.env.AGENT_OFFICE_HOOK_TOKEN;
  const ompHook = (id: string, key: string, payload: unknown) => workers.handleProviderHook('omp', id, key, '', payload);
  const hook = (type: string, status: string, extra = {}) => ompHook(worker.id, token, { type, status, sessionId: 'omp-root', ...extra });
  assert.equal(ompHook(worker.id, 'wrong', { type: 'session', status: 'starting', sessionId: 'omp-root' }), false);
  assert.equal(workers.handleOpenCodeHook(worker.id, token, { type: 'session', status: 'starting', sessionId: 'omp-root' }), false);
  assert.equal(hook('session', 'starting'), true);
  assert.equal(workers.get(worker.id)?.status, 'idle');
  hook('prompt', 'working', { prompt: 'Fix login' });
  assert.equal(workers.get(worker.id)?.status, 'working');
  hook('question', 'needs_input');
  assert.equal(workers.get(worker.id)?.status, 'needs_input');
  hook('session', 'done');
  assert.equal(workers.get(worker.id)?.status, 'done');
  assert.equal(ompHook(worker.id, token, { type: 'tool', status: 'working', sessionId: 'other-root' }), false);
  launches[0].exit?.({ exitCode: 0 });
  assert.equal(workers.resume(worker.id), undefined);
  assert.ok(launches[1].opts.args.includes('--resume'));
  assert.ok(launches[1].opts.args.includes('omp-root'));
  assert.equal(launches[1].opts.args.includes('--session-dir'), false);
  assert.ok(!launches[1].opts.args.includes('- fix login'));
  workers.shutdown();
  const restored = open(process.execPath);
  const saved = restored.get(worker.id);
  assert.deepEqual([saved?.provider, saved?.model, saved?.effort, saved?.sessionId], ['omp', 'deepseek/deepseek-v4-flash', 'high', 'omp-root']);
});
