import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ledger } from '../src/server/usage.js';
import { WorkerManager, type WorkerEvents } from '../src/server/workers.js';
import type { AgentProvider, WorkerInfo } from '../src/shared/protocol.js';

type Invocation = {
  kind: string;
  args: string[];
  stdin?: string;
  env: {
    workerId?: string;
    hookToken?: string;
    hookUrl?: string;
    opencodeConfig?: string;
  };
};

type Fixture = {
  root: string;
  data: string;
  log: string;
  claude: string;
  opencode: string;
  custom: string;
  read(): Invocation[];
  close(): void;
};

/** Keep provider CLIs in this test fixture from seeing a user's config or credentials. */
function isolateProviderEnvironment(f: Fixture, t: { after(fn: () => void): void }) {
  const previous = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
  };
  const home = path.join(f.root, 'home');
  const config = path.join(f.root, 'config');
  const data = path.join(f.root, 'xdg-data');
  const state = path.join(f.root, 'xdg-state');
  const cache = path.join(f.root, 'xdg-cache');
  process.env.PATH = `${path.dirname(f.claude)}${path.delimiter}${previous.PATH ?? ''}`;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.XDG_CONFIG_HOME = config;
  process.env.XDG_DATA_HOME = data;
  process.env.XDG_STATE_HOME = state;
  process.env.XDG_CACHE_HOME = cache;
  process.env.CLAUDE_CONFIG_DIR = path.join(config, 'claude');
  process.env.OPENCODE_CONFIG_DIR = path.join(config, 'opencode');
  // Delete by variable name only. Do not read or log any credential value.
  for (const key of Object.keys(process.env)) {
    // These are the office hook variables used by the in-process OpenCode
    // plugin test; they are synthetic protocol values, not provider secrets.
    if (key.startsWith('AGENT_OFFICE_')) continue;
    if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET|PASSWORD|CREDENTIAL|TOKEN)/i.test(key)) delete process.env[key];
  }
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const fakeAgent = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const log = process.env.FAKE_AGENT_LOG;
const kind = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const record = (extra = {}) => fs.appendFileSync(log, JSON.stringify({
  kind,
  args,
  ...extra,
  env: {
    workerId: process.env.AGENT_OFFICE_WORKER_ID,
    hookToken: process.env.AGENT_OFFICE_HOOK_TOKEN,
    hookUrl: process.env.AGENT_OFFICE_HOOK_URL,
    opencodeConfig: process.env.OPENCODE_CONFIG_CONTENT,
  },
}) + '\\n');
record();

// The task namer invokes Claude as a non-interactive JSON command. Keep that
// invocation deterministic and separate from the worker's real PTY process.
if (args.includes('--output-format')) {
  process.stdout.write(JSON.stringify({ structured_output: { name: 'Fake Task', summary: 'Recording a deterministic test task' } }));
  process.exit(0);
}

process.stdout.write('fake-agent-ready\\r\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => record({ stdin: chunk }));
process.stdin.resume();
const delay = Number(process.env.FAKE_AGENT_EXIT_MS || 0);
if (delay > 0) setTimeout(() => process.exit(0), delay).unref();
`;

function fixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-workers-'));
  const data = path.join(root, 'data');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'invocations.jsonl');
  const claude = path.join(bin, 'claude');
  const opencode = path.join(bin, 'opencode');
  const custom = path.join(bin, 'custom-agent');
  mkdirSync(data, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(claude, fakeAgent, { mode: 0o700 });
  writeFileSync(opencode, fakeAgent, { mode: 0o700 });
  writeFileSync(custom, fakeAgent, { mode: 0o700 });
  chmodSync(claude, 0o700);
  chmodSync(opencode, 0o700);
  chmodSync(custom, 0o700);
  writeFileSync(log, '');
  return {
    root,
    data,
    log,
    claude,
    opencode,
    custom,
    read() {
      if (!existsSync(log)) return [];
      return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Invocation);
    },
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function events(updates: WorkerInfo[]): WorkerEvents {
  return {
    update: (info) => updates.push(info),
    remove() {},
    data() {},
    screen() {},
    toast() {},
  };
}

function ledger(data: string): Ledger {
  return new Ledger(data, { pauseHiring: false }, () => {}, () => {});
}

function manager(f: Fixture, cmd: string, updates: WorkerInfo[]) {
  return new WorkerManager(f.root, f.data, cmd, ['--from-test'], { url: 'http://127.0.0.1:1', token: '' }, events(updates), ledger(f.data));
}

async function waitFor<T>(read: () => T, predicate: (value: T) => boolean, timeout = 4000): Promise<T> {
  const end = Date.now() + timeout;
  let value = read();
  while (!predicate(value) && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    value = read();
  }
  assert.ok(predicate(value), 'timed out waiting for fake agent state');
  return value;
}

function hasPrompt(invocation: Invocation, prompt: string): boolean {
  return invocation.args.includes(prompt) || invocation.stdin?.includes(prompt) === true;
}

test('Claude workers use the configured executable, pass prompts and resume ids, and stay hook-operational', async (t) => {
  const f = fixture();
  const updates: WorkerInfo[] = [];
  isolateProviderEnvironment(f, t);
  const previousExit = process.env.FAKE_AGENT_EXIT_MS;
  const previousLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_EXIT_MS = '180';
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => {
    if (previousExit === undefined) delete process.env.FAKE_AGENT_EXIT_MS;
    else process.env.FAKE_AGENT_EXIT_MS = previousExit;
    if (previousLog === undefined) delete process.env.FAKE_AGENT_LOG;
    else process.env.FAKE_AGENT_LOG = previousLog;
    f.close();
  });

  const workers = manager(f, f.claude, updates);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test', 'initial Claude prompt');
  assert.equal(typeof worker, 'object');
  if (typeof worker === 'string') return;
  const first = await waitFor(() => f.read(), (records) => records.some((r) => r.kind === 'claude' && r.args.includes('--settings')));
  const firstWorker = first.find((r) => r.kind === 'claude' && r.args.includes('--settings'))!;
  assert.ok(firstWorker.args.includes('--from-test'));
  assert.ok(hasPrompt(firstWorker, 'initial Claude prompt'));
  assert.equal(firstWorker.env.workerId, worker.id);
  assert.ok(firstWorker.env.hookToken);

  assert.equal(workers.handleHook(worker.id, firstWorker.env.hookToken!, 'SessionStart', { session_id: 'claude-session-1' }), true);
  assert.equal(workers.get(worker.id)?.status, 'idle');
  await waitFor(() => workers.get(worker.id)?.status, (status) => status === 'exited');
  assert.equal(workers.resume(worker.id), undefined);
  const resumed = await waitFor(() => f.read(), (records) => records.filter((r) => r.kind === 'claude' && r.args.includes('--settings')).length >= 2);
  const secondWorker = resumed.filter((r) => r.kind === 'claude' && r.args.includes('--settings'))[1];
  assert.ok(secondWorker.args.includes('--resume'));
  assert.ok(secondWorker.args.includes('claude-session-1'));
  assert.equal(secondWorker.args.includes('initial Claude prompt'), false);

  // The Claude hook remains accepted after a resume and updates the activity state.
  assert.equal(workers.handleHook(worker.id, firstWorker.env.hookToken!, 'UserPromptSubmit', { prompt: 'follow-up' }), true);
  assert.equal(workers.get(worker.id)?.activity, 'follow-up');

  // Selecting the alternate provider uses its binary with a clean argument set.
  const alternate = workers.spawn('desk-4', 'test', 'alternate provider prompt', false, 'agent', 'opencode');
  assert.equal(typeof alternate, 'object');
  if (typeof alternate !== 'string') {
    const alternateRecords = await waitFor(() => f.read(), (records) => records.some((r) => r.kind === 'opencode'));
    const alternateInvocation = alternateRecords.find((r) => r.kind === 'opencode')!;
    assert.equal(alternateInvocation.args.includes('--from-test'), false);
    assert.equal(alternateInvocation.args.includes('--settings'), false);
    assert.ok(hasPrompt(alternateInvocation, 'alternate provider prompt'));
    await workers.kill(alternate.id);
  }
});

test('OpenCode workers use OpenCode-only hooks/config, never invoke Claude naming, and restore provider sessions', async (t) => {
  const f = fixture();
  const updates: WorkerInfo[] = [];
  isolateProviderEnvironment(f, t);
  const previousExit = process.env.FAKE_AGENT_EXIT_MS;
  const previousLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_EXIT_MS = '900';
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => {
    if (previousExit === undefined) delete process.env.FAKE_AGENT_EXIT_MS;
    else process.env.FAKE_AGENT_EXIT_MS = previousExit;
    if (previousLog === undefined) delete process.env.FAKE_AGENT_LOG;
    else process.env.FAKE_AGENT_LOG = previousLog;
    f.close();
  });

  const workers = manager(f, f.opencode, updates);
  t.after(() => workers.shutdown());
  assert.equal(workers.defaultProvider, 'opencode');
  const worker = workers.spawn('desk-2', 'test', 'initial OpenCode prompt');
  assert.equal(typeof worker, 'object');
  if (typeof worker === 'string') return;

  const first = await waitFor(() => f.read(), (records) => records.some((r) => r.kind === 'opencode'));
  const firstWorker = first.find((r) => r.kind === 'opencode')!;
  assert.ok(firstWorker.args.includes('--from-test'));
  assert.ok(hasPrompt(firstWorker, 'initial OpenCode prompt'));
  const initialTask = workers.get(worker.id)?.task;
  assert.ok(initialTask);
  assert.equal(firstWorker.args.includes('--settings'), false);
  assert.equal(firstWorker.env.workerId, worker.id);
  assert.ok(firstWorker.env.hookToken);
  assert.ok(firstWorker.env.opencodeConfig?.includes('agent-office-opencode'));
  assert.equal(first.filter((r) => r.kind === 'claude').length, 0, 'OpenCode must not launch the Claude task namer');

  const transcript = path.join(f.root, 'must-not-be-read.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', message: { id: 'x', model: 'opus', usage: { input_tokens: 9000, output_tokens: 1000 } } }) + '\n');
  assert.equal(workers.handleOpenCodeHook(worker.id, 'wrong-token', { type: 'session', sessionId: 'oc-1', status: 'starting' }), false);
  assert.equal(workers.handleOpenCodeHook(worker.id, firstWorker.env.hookToken!, { type: 'session', sessionId: 'oc-1', status: 'starting', transcript_path: transcript }), true);
  assert.equal(workers.get(worker.id)?.status, 'idle');
  assert.equal(workers.handleOpenCodeHook(worker.id, firstWorker.env.hookToken!, { type: 'prompt', sessionId: 'oc-1', status: 'working', prompt: 'do the thing' }), true);
  assert.equal(workers.get(worker.id)?.status, 'working');
  assert.equal(workers.handleOpenCodeHook(worker.id, firstWorker.env.hookToken!, { type: 'permission', sessionId: 'oc-1', status: 'needs_input', detail: 'write file' }), true);
  assert.equal(workers.get(worker.id)?.status, 'needs_input');
  assert.equal(workers.handleOpenCodeHook(worker.id, firstWorker.env.hookToken!, { type: 'error', sessionId: 'oc-1', status: 'done', detail: 'provider unavailable' }), true);
  assert.equal(workers.get(worker.id)?.status, 'needs_input');
  assert.equal(workers.get(worker.id)?.activity, 'provider unavailable');
  assert.equal(workers.handleOpenCodeHook(worker.id, firstWorker.env.hookToken!, { type: 'prompt', sessionId: 'oc-1', status: 'working', prompt: 'retry the thing' }), true);
  assert.equal(workers.get(worker.id)?.status, 'working');
  // A fresh root session is accepted at the start of a new OpenCode turn.
  assert.equal(workers.handleOpenCodeHook(worker.id, firstWorker.env.hookToken!, { type: 'session', sessionId: 'oc-child', status: 'starting' }), true);
  assert.equal(workers.get(worker.id)?.sessionId, 'oc-child');
  assert.equal(workers.get(worker.id)?.task, undefined, 'a new OpenCode session starts a new task card');
  assert.equal(workers.handleOpenCodeHook(worker.id, firstWorker.env.hookToken!, { type: 'prompt', sessionId: 'oc-child', status: 'working', prompt: 'replace the previous task with this one' }), true);
  assert.notDeepEqual(workers.get(worker.id)?.task, initialTask);
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(workers.get(worker.id)?.usage, undefined, 'OpenCode must not run Claude transcript usage parsing');
  assert.equal(workers.handleOpenCodeHook(worker.id, firstWorker.env.hookToken!, { type: 'session', sessionId: 'oc-child', status: 'done' }), true);

  await waitFor(() => workers.get(worker.id)?.status, (status) => status === 'exited');
  assert.equal(workers.resume(worker.id), undefined);
  const resumed = await waitFor(() => f.read(), (records) => records.filter((r) => r.kind === 'opencode').length >= 2);
  const secondWorker = resumed.filter((r) => r.kind === 'opencode')[1];
  assert.ok(secondWorker.args.includes('--session') || secondWorker.args.includes('-s'));
  assert.ok(secondWorker.args.includes('oc-child'));
  assert.equal(secondWorker.args.includes('initial OpenCode prompt'), false);
  assert.ok(secondWorker.env.hookToken);
  assert.notEqual(secondWorker.env.hookToken, firstWorker.env.hookToken, 'resuming OpenCode rotates its hook token');
  assert.equal(workers.handleOpenCodeHook(worker.id, firstWorker.env.hookToken!, { type: 'prompt', sessionId: 'oc-child', status: 'working', prompt: 'stale token' }), false);
  assert.equal(workers.handleOpenCodeHook(worker.id, secondWorker.env.hookToken!, { type: 'prompt', sessionId: 'oc-child', status: 'working', prompt: 'fresh token' }), true);

  workers.shutdown();
  const restoredUpdates: WorkerInfo[] = [];
  const restored = manager(f, f.opencode, restoredUpdates);
  t.after(() => restored.shutdown());
  assert.equal(restored.get(worker.id)?.provider, 'opencode');
  assert.equal(restored.get(worker.id)?.prompt, 'initial OpenCode prompt');
  assert.equal(restored.get(worker.id)?.sessionId, 'oc-child');
  await waitFor(() => f.read(), (records) => records.filter((r) => r.kind === 'opencode').length >= 3);
  const restoredInvocation = f.read().filter((r) => r.kind === 'opencode')[2];
  assert.ok(restoredInvocation.args.includes('--session') || restoredInvocation.args.includes('-s'));
  assert.ok(restoredInvocation.args.includes('oc-child'));
  assert.ok(restored.get(worker.id)?.status === 'idle' || restored.get(worker.id)?.status === 'exited' || restored.get(worker.id)?.status === 'done');
  assert.equal(f.read().filter((r) => r.kind === 'claude').length, 0, 'OpenCode must never invoke Claude task naming');
});

test('provider and hook boundaries reject invalid combinations', async (t) => {
  const f = fixture();
  t.after(() => f.close());
  const updates: WorkerInfo[] = [];
  const previousLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = f.log;
  const workers = manager(f, f.claude, updates);
  t.after(() => {
    workers.shutdown();
    if (previousLog === undefined) delete process.env.FAKE_AGENT_LOG;
    else process.env.FAKE_AGENT_LOG = previousLog;
  });
  const invalidProvider = workers.spawn('desk-3', 'test', undefined, false, 'agent', 'custom' as AgentProvider);
  assert.equal(typeof invalidProvider, 'string');
  assert.match(invalidProvider as string, /configured|provider|executable/i);
  const claude = workers.spawn('desk-3', 'test', 'claude task');
  assert.equal(typeof claude, 'object');
  if (typeof claude === 'string') return;
  assert.equal(workers.handleOpenCodeHook(claude.id, 'any-token', { type: 'session', sessionId: 'wrong', status: 'starting' }), false);

  // A custom wrapper still speaks the Claude hook protocol; only OpenCode is
  // excluded from that path.
  const customFixture = fixture();
  const customUpdates: WorkerInfo[] = [];
  const customPreviousLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = customFixture.log;
  const customWorkers = manager(customFixture, customFixture.custom, customUpdates);
  t.after(() => {
    customWorkers.shutdown();
    if (customPreviousLog === undefined) delete process.env.FAKE_AGENT_LOG;
    else process.env.FAKE_AGENT_LOG = customPreviousLog;
    customFixture.close();
  });
  assert.equal(customWorkers.defaultProvider, 'custom');
  const custom = customWorkers.spawn('desk-4', 'test', 'custom wrapper task');
  assert.equal(typeof custom, 'object');
  if (typeof custom !== 'string') {
    const invocation = await waitFor(() => customFixture.read(), (records) => records.some((r) => r.kind === 'custom-agent'));
    const token = invocation.find((r) => r.kind === 'custom-agent')?.env.hookToken;
    assert.ok(token);
    assert.equal(customWorkers.handleHook(custom.id, token!, 'SessionStart', { session_id: 'custom-session' }), true);
  }
});
