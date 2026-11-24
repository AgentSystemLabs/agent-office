import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERMES_PLUGIN_MANIFEST, HERMES_PLUGIN_SOURCE, hermesArgs, normalizeHermesHook, writeHermesPlugin } from '../src/server/hermes.js';
import { isValidHermesModel } from '../src/shared/providers.js';
import { WorkerManager, type WorkerEvents } from '../src/server/workers.js';
import { Ledger } from '../src/server/usage.js';
import type { Pty, PtyExit, SpawnOpts } from '../src/server/ptys.js';

test('Hermes launch takes the office\'s query, model and effort, and drops the ones --agent-args already had', () => {
  const args = hermesArgs(
    ['--query', 'old', '--query-file', 'f.txt', '--resume', 'other', '-r', 'other', '--continue', 'named', '-c', '--oneshot', '--yolo', '--agent-args', 'x=1', '--model=z', '--'],
    { sessionId: '20261124_104347_b76354', model: 'anthropic/claude-sonnet-4', effort: 'high', prompt: 'fix login' },
  );
  assert.deepEqual(args, ['chat', '--yolo', '--agent-args', 'x=1', '-m', 'anthropic/claude-sonnet-4', '--reasoning', 'high', '--resume', '20261124_104347_b76354', '-q', 'fix login']);
  // A model the person put in --agent-args goes only when the office picks one; it never appears twice.
  assert.deepEqual(hermesArgs(['-m', 'old', '--reasoning', 'low'], {}), ['chat', '-m', 'old', '--reasoning', 'low']);
  // The query and the session are always the office's; a model only when the office picked one.
  assert.deepEqual(hermesArgs(['--resume=x', '--model=y', '-qold'], {}), ['chat', '--model=y']);
  assert.deepEqual(hermesArgs(['--resume=x', '--model=y', '-qold'], { model: 'gpt-5' }), ['chat', '-m', 'gpt-5']);
  assert.deepEqual(hermesArgs([], { prompt: 'fix login' }), ['chat', '-q', 'fix login']);
});

test('Hermes hook reports are bounded to lifecycle fields and safe session ids', () => {
  assert.deepEqual(normalizeHermesHook({ type: 'tool', status: 'working', sessionId: '20261124_104347_b76354', tool: 'read_file', args: { path: 'secret' }, apiKey: 'secret', message: 'secret' }),
    { type: 'tool', status: 'working', sessionId: '20261124_104347_b76354', tool: 'read_file' });
  assert.deepEqual(normalizeHermesHook({ type: 'prompt', status: 'working', sessionId: 'local-' + 'a'.repeat(64), prompt: 'Fix login' }),
    { type: 'prompt', status: 'working', sessionId: 'local-' + 'a'.repeat(64), prompt: 'Fix login' });
  for (const value of [
    null, [], {}, 'text',
    { type: 'unknown', status: 'working', sessionId: 'root' },
    { type: 'session', status: 'bad', sessionId: 'root' },
    { type: 'session', status: 'working', sessionId: 'x'.repeat(161) },
    { type: 'session', status: 'working', sessionId: 'a b' },
    { type: 'session', status: 'working', sessionId: 'id\u0000' },
    { type: 'prompt', status: 'working', sessionId: 'root', prompt: 'x'.repeat(20001) },
    { type: 'prompt', status: 'working', sessionId: 'root', prompt: 42 },
    { type: 'tool', status: 'working', sessionId: 'root', tool: 'x'.repeat(161) },
    { type: 'tool', status: 'working', sessionId: 'root', tool: 'bad\ttool' },
  ]) {
    assert.equal(normalizeHermesHook(value), undefined, JSON.stringify(value));
  }
  assert.equal(isValidHermesModel('anthropic/claude-sonnet-4'), true);
  assert.equal(isValidHermesModel('claude-opus-5-5'), true);
  assert.equal(isValidHermesModel('-m'), false);
  assert.equal(isValidHermesModel('--yolo'), false);
  assert.equal(isValidHermesModel('bad model'), false);
  assert.equal(isValidHermesModel('bad​model'), false);
  assert.equal(isValidHermesModel('x'.repeat(129)), false);
});

test('the office plugin is written into the Hermes home, and nowhere when Hermes is not installed', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-hermes-home-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(writeHermesPlugin(path.join(root, 'missing')), undefined);
  const home = path.join(root, 'hermes-home');
  mkdirSync(home);
  const dir = writeHermesPlugin(home);
  assert.equal(dir, path.join(home, 'plugins', 'agent-office'));
  assert.equal(readFileSync(path.join(dir!, 'plugin.yaml'), 'utf8'), HERMES_PLUGIN_MANIFEST);
  const plugin = readFileSync(path.join(dir!, '__init__.py'), 'utf8');
  assert.equal(plugin, HERMES_PLUGIN_SOURCE);
  // It is off unless the office started the run, and it only ever calls loopback.
  assert.match(plugin, /AGENT_OFFICE_HOOK_FILE/);
  assert.match(plugin, /AGENT_OFFICE_HOOK_TOKEN/);
  // Its endpoint arrives as the session's client environment, since Hermes' gateway runs the hooks.
  assert.match(plugin, /from agent\.session_client_env import session_env/);
  assert.match(plugin, /_setting\("AGENT_OFFICE_HOOK_FILE"\)/);
  assert.match(plugin, /127\.0\.0\.1/);
  assert.match(plugin, /ProxyHandler\(\{\}\)/);
  for (const hook of ['on_session_start', 'pre_llm_call', 'pre_tool_call', 'post_llm_call', 'on_session_end', 'on_session_finalize', 'on_session_reset']) {
    assert.ok(HERMES_PLUGIN_MANIFEST.includes(hook) && plugin.includes(hook), hook);
  }
});

test('Hermes worker launches its own session, authenticates hooks, resumes it, and restores its choices', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-hermes-worker-'));
  const file = path.join(root, process.platform === 'win32' ? 'hermes.cmd' : 'hermes');
  writeFileSync(file, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', { mode: 0o700 });
  const data = path.join(root, 'data');
  mkdirSync(data);
  // The office writes its plugin into the Hermes home: point that at the fixture, not the real one.
  const home = path.join(root, 'hermes-home');
  mkdirSync(home);
  const previousHome = process.env.HERMES_HOME;
  process.env.HERMES_HOME = home;
  process.env.HERMES_SESSION_ID = 'office-session';
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
  t.after(() => {
    managers.forEach((m) => m.shutdown());
    if (previousHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = previousHome;
    delete process.env.HERMES_SESSION_ID;
    rmSync(root, { recursive: true, force: true });
  });
  const workers = open();
  const worker = workers.spawn('desk-1', 'Tester', 'fix login', false, 'agent', 'hermes', 'anthropic/claude-sonnet-4', 'high');
  assert.ok(typeof worker === 'object');
  const first = launches[0].opts;
  assert.equal(first.file, file);
  assert.deepEqual(first.args, ['chat', '-m', 'anthropic/claude-sonnet-4', '--reasoning', 'high', '-q', 'fix login']);
  assert.ok(first.env.AGENT_OFFICE_HOOK_TOKEN);
  // Its plugin went into the person's Hermes home, enabled once with `hermes plugins enable agent-office`.
  assert.equal(readFileSync(path.join(home, 'plugins', 'agent-office', 'plugin.yaml'), 'utf8'), HERMES_PLUGIN_MANIFEST);
  assert.match(first.env.AGENT_OFFICE_HOOK_URL ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(first.env.HERMES_SESSION_ID, undefined, 'a worker never inherits the office\'s own Hermes session');
  // The gateway never sees the worker's environment, so its endpoint travels as a file whose path
  // does; the file holds the token the office rotated just before the spawn.
  const hookFile = first.env.AGENT_OFFICE_HOOK_FILE;
  assert.equal(path.dirname(hookFile ?? ''), data);
  assert.deepEqual(JSON.parse(readFileSync(hookFile!, 'utf8')), {
    url: first.env.AGENT_OFFICE_HOOK_URL,
    token: first.env.AGENT_OFFICE_HOOK_TOKEN,
    workerId: first.env.AGENT_OFFICE_WORKER_ID,
  });
  const token = first.env.AGENT_OFFICE_HOOK_TOKEN;
  const hermesHook = (id: string, key: string, payload: unknown) => workers.handleProviderHook('hermes', id, key, '', payload);
  const hook = (type: string, status: string, extra = {}) => hermesHook(worker.id, token, { type, status, sessionId: '20261124_104347_b76354', ...extra });
  assert.equal(hermesHook(worker.id, 'wrong', { type: 'session', status: 'starting', sessionId: '20261124_104347_b76354' }), false);
  assert.equal(workers.handleOpenCodeHook(worker.id, token, { type: 'session', status: 'starting', sessionId: '20261124_104347_b76354' }), false);
  assert.equal(workers.handleProviderHook('pi', worker.id, token, '', { type: 'session', status: 'starting', sessionId: '20261124_104347_b76354' }), false);
  assert.equal(hook('session', 'starting'), true);
  assert.equal(workers.get(worker.id)?.status, 'idle');
  assert.equal(workers.get(worker.id)?.sessionId, '20261124_104347_b76354');
  hook('prompt', 'working', { prompt: 'Fix login' });
  assert.equal(workers.get(worker.id)?.status, 'working');
  hook('tool', 'working', { tool: 'read_file' });
  assert.equal(workers.get(worker.id)?.status, 'working');
  hook('session', 'done');
  assert.equal(workers.get(worker.id)?.status, 'done');
  // A report from another Hermes session never lands on this desk.
  assert.equal(hermesHook(worker.id, token, { type: 'tool', status: 'working', sessionId: 'local-' + 'b'.repeat(64), tool: 'bash' }), false);
  launches[0].exit?.({ exitCode: 0 });
  assert.equal(workers.resume(worker.id), undefined);
  assert.ok(launches[1].opts.args.includes('--resume'));
  assert.ok(launches[1].opts.args.includes('20261124_104347_b76354'));
  assert.ok(!launches[1].opts.args.includes('fix login'));
  workers.shutdown();
  const restored = open(process.execPath);
  const saved = restored.get(worker.id);
  assert.deepEqual([saved?.provider, saved?.model, saved?.effort, saved?.sessionId], ['hermes', 'anthropic/claude-sonnet-4', 'high', '20261124_104347_b76354']);
});
