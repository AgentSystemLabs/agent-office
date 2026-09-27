import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  codex: string;
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
    CODEX_HOME: process.env.CODEX_HOME,
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
  process.env.CODEX_HOME = path.join(config, 'codex');
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
  const codex = path.join(bin, 'codex');
  mkdirSync(data, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(claude, fakeAgent, { mode: 0o700 });
  writeFileSync(opencode, fakeAgent, { mode: 0o700 });
  writeFileSync(custom, fakeAgent, { mode: 0o700 });
  writeFileSync(codex, fakeAgent, { mode: 0o700 });
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
    codex,
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

function manager(f: Fixture, cmd: string, updates: WorkerInfo[], args = ['--from-test']) {
  return new WorkerManager(f.root, f.data, cmd, args, { url: 'http://127.0.0.1:1', token: '' }, events(updates), ledger(f.data));
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
  // Wakes the workers from before the restart (see WorkerManager.start).
  await restored.start();
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

test('OpenCode model overrides configured model flags on first launch and is omitted on resume', async (t) => {
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

  const workers = manager(f, f.opencode, updates, ['--model', 'old/model', '--keep', 'yes', '-m', 'older/model']);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test', 'modelled prompt', false, 'agent', 'opencode', 'openai/gpt-5/nested');
  assert.equal(typeof worker, 'object');
  if (typeof worker === 'string') return;
  const first = await waitFor(() => f.read(), (records) => records.some((r) => r.kind === 'opencode'));
  const firstInvocation = first.find((r) => r.kind === 'opencode')!;
  assert.deepEqual(firstInvocation.args, ['--keep', 'yes', '--model', 'openai/gpt-5/nested', '--prompt', 'modelled prompt']);
  assert.equal(workers.get(worker.id)?.model, 'openai/gpt-5/nested');

  assert.equal(workers.handleOpenCodeHook(worker.id, firstInvocation.env.hookToken!, { type: 'session', sessionId: 'oc-model', status: 'starting' }), true);
  await waitFor(() => workers.get(worker.id)?.status, (status) => status === 'exited');
  assert.equal(workers.resume(worker.id), undefined);
  const all = await waitFor(() => f.read(), (records) => records.filter((r) => r.kind === 'opencode').length >= 2);
  const resumed = all.filter((r) => r.kind === 'opencode')[1];
  assert.ok(resumed.args.includes('--session'));
  assert.ok(resumed.args.includes('oc-model'));
  assert.equal(resumed.args.includes('--model'), false);
  assert.equal(resumed.args.includes('openai/gpt-5/nested'), false);
});

test('OpenCode keeps configured model flags when no explicit model is selected, then strips them on resume', async (t) => {
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

  const workers = manager(f, f.opencode, updates, ['--model', 'configured/model', '--keep', 'yes']);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test', 'configured prompt');
  assert.equal(typeof worker, 'object');
  if (typeof worker === 'string') return;
  const first = await waitFor(() => f.read(), (records) => records.some((r) => r.kind === 'opencode'));
  const firstInvocation = first.find((r) => r.kind === 'opencode')!;
  assert.ok(firstInvocation.args.includes('--model'));
  assert.ok(firstInvocation.args.includes('configured/model'));
  assert.equal(workers.handleOpenCodeHook(worker.id, firstInvocation.env.hookToken!, { type: 'session', sessionId: 'oc-configured', status: 'starting' }), true);
  await waitFor(() => workers.get(worker.id)?.status, (status) => status === 'exited');
  assert.equal(workers.resume(worker.id), undefined);
  const all = await waitFor(() => f.read(), (records) => records.filter((r) => r.kind === 'opencode').length >= 2);
  const resumed = all.filter((r) => r.kind === 'opencode')[1];
  assert.ok(resumed.args.includes('--session'));
  assert.equal(resumed.args.includes('--model'), false);
  assert.equal(resumed.args.includes('configured/model'), false);
  assert.ok(resumed.args.includes('--keep'));
});

test('workers reject models for non-OpenCode providers and malformed model ids', (t) => {
  const f = fixture();
  t.after(() => f.close());
  const workers = manager(f, f.claude, []);
  t.after(() => workers.shutdown());
  assert.match(workers.spawn('desk-1', 'test', 'bad', false, 'agent', 'claude', 'openai/gpt-5') as string, /model|OpenCode/i);
  assert.match(workers.spawn('desk-2', 'test', 'bad', false, 'agent', 'opencode', 'gpt-5') as string, /model|format|provider/i);
  assert.match(workers.spawn('desk-3', 'test', 'bad', false, 'agent', 'opencode', 'openai/gpt 5') as string, /model|format|whitespace/i);
  assert.match(workers.spawn('desk-4', 'test', 'bad', false, 'shell', undefined, 'openai/gpt-5') as string, /shell|model/i);
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

test('OpenCode usage snapshots replace totals, persist across restart, and never change status or Claude budget', async (t) => {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  const oldLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => { if (oldLog === undefined) delete process.env.FAKE_AGENT_LOG; else process.env.FAKE_AGENT_LOG = oldLog; f.close(); });
  const book = ledger(f.data);
  const workers = new WorkerManager(f.root, f.data, f.opencode, [], { url: 'http://127.0.0.1:1', token: '' }, events([]), book);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test');
  assert.notEqual(typeof worker, 'string'); if (typeof worker === 'string') return;
  const invocations = await waitFor(f.read, x => x.some(r => r.kind === 'opencode'));
  const token = invocations.find(r => r.kind === 'opencode')!.env.hookToken!;
  workers.handleOpenCodeHook(worker.id, token, { type: 'session', sessionId: 'usage-root', status: 'starting' });
  workers.handleOpenCodeHook(worker.id, token, { type: 'permission', sessionId: 'usage-root', status: 'needs_input' });
  const usage = { input: 20, output: 8, reasoning: 4, cacheRead: 6, cacheWrite: 2, cost: 0.003, calls: 1, costKnown: true };
  const report = { type: 'usage', sessionId: 'usage-root', usage };
  assert.equal(workers.handleOpenCodeHook(worker.id, token, report), true);
  assert.equal(workers.handleOpenCodeHook(worker.id, token, report), true);
  assert.deepEqual(workers.get(worker.id)?.usage, usage);
  assert.equal(workers.get(worker.id)?.status, 'needs_input');
  assert.equal(book.state().total.calls, 0);
  assert.equal(book.state().total.cost, 0);
  for (const bad of [{ ...usage, input: -1 }, { ...usage, cost: Infinity }, { ...usage, calls: '1' }]) {
    assert.equal(workers.handleOpenCodeHook(worker.id, token, { ...report, usage: bad }), false);
  }
  assert.equal(workers.handleOpenCodeHook(worker.id, 'wrong', report), false);
  assert.equal(workers.handleOpenCodeHook(worker.id, token, { ...report, sessionId: 'unrelated' }), false);
  workers.shutdown();
  const restored = manager(f, f.opencode, [], []);
  t.after(() => restored.shutdown());
  // Wakes the workers from before the restart (see WorkerManager.start).
  await restored.start();
  assert.deepEqual(restored.get(worker.id)?.usage, usage);
  const calls = await waitFor(f.read, x => x.filter(r => r.kind === 'opencode' && !r.stdin).length >= 2);
  const nextToken = calls.filter(r => r.kind === 'opencode' && !r.stdin).at(-1)!.env.hookToken!;
  restored.handleOpenCodeHook(worker.id, nextToken, { type: 'session', sessionId: 'next-root', status: 'starting' });
  assert.equal(restored.get(worker.id)?.usage, undefined);
});


test('Codex workers preserve native approvals, follow authenticated root hooks, and resume their provider session', async (t) => {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  const oldLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => { if (oldLog === undefined) delete process.env.FAKE_AGENT_LOG; else process.env.FAKE_AGENT_LOG = oldLog; f.close(); });
  const book = ledger(f.data);
  const workers = new WorkerManager(f.root, f.data, f.claude, ['--claude-only'], { url: 'http://127.0.0.1:1', token: '' }, events([]), book);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test', '- fix the login', false, 'agent', 'codex');
  assert.notEqual(typeof worker, 'string'); if (typeof worker === 'string') return;
  const calls = await waitFor(f.read, x => x.some(r => r.kind === 'codex'));
  const first = calls.find(r => r.kind === 'codex')!;
  const token = first.env.hookToken!;
  assert.equal(worker.status, 'starting');
  assert.ok(first.args.includes('--no-alt-screen'));
  assert.deepEqual(first.args.slice(-2), ['--', '- fix the login']);
  assert.equal(first.args.some(a => /bypass|--yolo|--claude-only|--settings/.test(a)), false);
  assert.equal(first.args.filter(a => a.startsWith('hooks.')).length, 7);
  assert.equal(calls.some(r => r.kind === 'claude'), false);
  const hook = (event: string, extra = {}) => workers.handleCodexHook(worker.id, token, event, { session_id: 'codex-root', ...extra });
  assert.equal(workers.handleCodexHook(worker.id, 'wrong', 'SessionStart', { session_id: 'codex-root' }), false);
  assert.equal(hook('SessionStart', { source: 'startup' }), true);
  assert.equal(worker.status, 'idle');
  assert.equal(hook('UserPromptSubmit', { prompt: 'Implement the actual task' }), true);
  assert.equal(worker.status, 'working');
  assert.equal(hook('PreToolUse', { tool_name: 'exec_command', tool_use_id: 'call-permission' }), true);
  assert.equal(hook('PreToolUse', { tool_name: 'read_file', tool_use_id: 'call-other' }), true);
  assert.equal(hook('PermissionRequest', { tool_name: 'exec_command' }), true);
  assert.equal(hook('PostToolUse', { tool_name: 'read_file', tool_use_id: 'call-other' }), true);
  assert.equal(worker.status, 'needs_input');
  assert.equal(worker.status, 'needs_input');
  assert.equal(hook('Stop', { agent_id: 'child' }), false);
  assert.equal(worker.status, 'needs_input');
  assert.equal(hook('PostToolUse', { tool_name: 'exec_command', tool_use_id: 'call-permission' }), true);
  assert.equal(worker.status, 'working');
  assert.equal(hook('Stop'), true);
  assert.equal(worker.status, 'done');
  assert.equal(workers.handleHook(worker.id, token, 'Stop', { session_id: 'claude' }), false);
  assert.equal(workers.handleOpenCodeHook(worker.id, token, { type: 'session', sessionId: 'oc', status: 'starting' }), false);
  assert.equal(worker.sessionId, 'codex-root');
  assert.equal(worker.usage, undefined);
  assert.equal(book.state().total.calls, 0);
  workers.shutdown();
  const restored = manager(f, f.claude, [], []);
  t.after(() => restored.shutdown());
  // Wakes the workers from before the restart (see WorkerManager.start).
  await restored.start();
  const nextCalls = await waitFor(f.read, x => x.filter(r => r.kind === 'codex' && !r.stdin).length >= 2);
  const next = nextCalls.filter(r => r.kind === 'codex' && !r.stdin).at(-1)!;
  assert.deepEqual(next.args.slice(-2), ['resume', 'codex-root']);
  assert.notEqual(next.env.hookToken, token);
  assert.equal(restored.get(worker.id)?.provider, 'codex');
  assert.equal(restored.handleCodexHook(worker.id, token, 'Stop', { session_id: 'codex-root' }), false);
  assert.equal(restored.handleCodexHook(worker.id, next.env.hookToken!, 'SessionStart', { session_id: 'codex-root', source: 'resume' }), true);
  assert.equal(restored.get(worker.id)?.status, 'idle');
});


test('Codex token snapshots survive restart, preserve permissions, and stay outside Claude spend', async (t) => {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  process.env.CODEX_HOME = 'relative-codex-home';
  const oldLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => { if (oldLog === undefined) delete process.env.FAKE_AGENT_LOG; else process.env.FAKE_AGENT_LOG = oldLog; f.close(); });
  const book = ledger(f.data);
  const workers = new WorkerManager(f.root, f.data, f.codex, [], { url: 'http://127.0.0.1:1', token: '' }, events([]), book);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test');
  assert.notEqual(typeof worker, 'string'); if (typeof worker === 'string') return;
  const calls = await waitFor(f.read, x => x.some(r => r.kind === 'codex'));
  const token = calls.find(r => r.kind === 'codex')!.env.hookToken!;
  const dir = path.join(f.root, process.env.CODEX_HOME!, 'sessions', '2026', '09', '26');
  mkdirSync(dir, { recursive: true });
  const transcript = path.join(dir, 'rollout-fixture-metrics-root.jsonl');
  const metric = (input: number) => JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: {
    input_tokens: input, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 10, total_tokens: input + 30,
  } } } }) + '\n';
  writeFileSync(transcript, JSON.stringify({ type: 'session_meta', payload: { id: 'metrics-root' } }) + '\n' + metric(120));
  assert.equal(workers.handleCodexHook(worker.id, 'wrong', 'SessionStart', { session_id: 'metrics-root', transcript_path: transcript }), false);
  assert.equal(worker.usage, undefined);
  workers.handleCodexHook(worker.id, token, 'SessionStart', { session_id: 'metrics-root', transcript_path: transcript });
  workers.handleCodexHook(worker.id, token, 'PermissionRequest', { session_id: 'metrics-root', tool_name: 'Bash' });
  await waitFor(() => worker.usage, u => u?.input === 100);
  assert.equal(worker.status, 'needs_input');
  assert.equal(worker.usage?.output, 20);
  assert.equal(worker.usage?.reasoning, 10);
  assert.equal(worker.usage?.cacheRead, 20);
  assert.equal(worker.usage?.costKnown, false);
  assert.equal(worker.usage?.callsKnown, false);
  assert.equal('codexTranscript' in worker, false);
  appendFileSync(transcript, metric(120) + metric(240));
  workers.handleCodexHook(worker.id, token, 'Stop', { session_id: 'metrics-root' });
  await waitFor(() => worker.usage, u => u?.input === 220);
  assert.equal(book.state().total.calls, 0);
  assert.equal(book.state().total.cost, 0);
  workers.shutdown();
  const restored = manager(f, f.codex, [], []);
  t.after(() => restored.shutdown());
  // Wakes the workers from before the restart (see WorkerManager.start).
  await restored.start();
  assert.deepEqual(restored.get(worker.id)?.usage, worker.usage);
  const nextCalls = await waitFor(f.read, x => x.filter(r => r.kind === 'codex' && !r.stdin).length >= 2);
  const next = nextCalls.filter(r => r.kind === 'codex' && !r.stdin).at(-1)!;
  appendFileSync(transcript, metric(300));
  restored.handleCodexHook(worker.id, next.env.hookToken!, 'SessionStart', { session_id: 'metrics-root', transcript_path: transcript });
  await waitFor(() => restored.get(worker.id)?.usage, u => u?.input === 280);
  restored.handleCodexHook(worker.id, next.env.hookToken!, 'SessionStart', { session_id: 'new-root', source: 'clear' });
  assert.equal(restored.get(worker.id)?.usage, undefined);
});

test('a board agent is hired with its brief on the first prompt, then prompted, woken and asked to prove who it is', async (t) => {
  const f = fixture();
  const updates: WorkerInfo[] = [];
  isolateProviderEnvironment(f, t);
  const previousExit = process.env.FAKE_AGENT_EXIT_MS;
  const previousLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_EXIT_MS = '600';
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
  // Each start of the agent, not what it reads from its terminal afterwards.
  const launches = () => f.read().filter((r) => r.kind === 'claude' && r.args.includes('--settings') && r.stdin === undefined);

  assert.match(workers.station('desk-1', 'test', 'file an issue') as string, /no agent/i);
  assert.match(workers.station('station-issues', 'test', '   ') as string, /empty/i);
  assert.match(workers.spawn('station-issues', 'test', undefined, false, 'shell') as string, /shell/i);

  // Nobody there yet: it's hired, told what it's for, with the request after that.
  const hired = workers.station('station-issues', 'Ada', 'File an issue about the dog');
  assert.equal(typeof hired, 'object');
  if (typeof hired === 'string') return;
  assert.equal(hired.hired, true);
  assert.equal(hired.info.name, 'Issues agent');
  assert.equal(hired.info.deskId, 'station-issues');
  assert.equal(hired.info.activity, 'File an issue about the dog');
  const [first] = await waitFor(launches, (l) => l.length === 1);
  const initial = first.args.at(-1)!;
  assert.match(initial, /Issues agent/);
  assert.match(initial, /office\/queue/);
  assert.ok(initial.endsWith('File an issue about the dog'));
  const id = hired.info.id;

  // The same agent takes the next request in its session.
  const again = workers.station('station-issues', 'Grace', 'Label it as a bug');
  assert.deepEqual(typeof again === 'object' && [again.hired, again.info.id], [false, id]);
  await waitFor(() => f.read(), (records) => records.some((r) => r.stdin?.includes('Label it as a bug')));

  // Waiting on an answer, a prompt would answer the question, so it's refused.
  assert.equal(workers.handleHook(id, first.env.hookToken!, 'SessionStart', { session_id: 'issues-session' }), true);
  assert.equal(workers.handleHook(id, first.env.hookToken!, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'gh issue create' } }), true);
  assert.equal(workers.get(id)?.status, 'needs_input');
  assert.match(workers.station('station-issues', 'Ada', 'hello?') as string, /waiting on an answer/i);

  // Its own token proves who it is; anyone else's doesn't.
  assert.equal(workers.authenticate(id, first.env.hookToken!)?.id, id);
  assert.equal(workers.authenticate(id, 'not-its-token'), undefined);
  assert.equal(workers.authenticate(id, ''), undefined);

  // Asleep, a request wakes it up carrying on its session, without the brief again.
  await waitFor(() => workers.get(id)?.status, (s) => s === 'exited');
  assert.equal(workers.authenticate(id, first.env.hookToken!), undefined);
  const woken = workers.station('station-issues', 'Ada', 'Close the duplicates');
  assert.deepEqual(typeof woken === 'object' && [woken.hired, woken.info.id], [false, id]);
  const [, second] = await waitFor(launches, (l) => l.length === 2);
  assert.ok(second.args.includes('--resume') && second.args.includes('issues-session'));
  assert.equal(second.args.at(-1), 'Close the duplicates');
});
