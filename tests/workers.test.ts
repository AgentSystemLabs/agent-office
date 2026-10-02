import test from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, appendFileSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ledger } from '../src/server/usage.js';
import { CARRY_ON_PROMPT, WorkerManager, type WorkerEvents } from '../src/server/workers.js';
import { Worktrees } from '../src/server/worktrees.js';
import type { AgentProvider, WorkerInfo } from '../src/shared/protocol.js';
import type { PromptSource } from '../src/server/prompts.js';
import { PROMPTS } from '../src/shared/prompts.js';

type Invocation = {
  kind: string;
  args: string[];
  stdin?: string;
  env: {
    workerId?: string;
    hookToken?: string;
    hookUrl?: string;
    opencodeConfig?: string;
    grokHome?: string;
    grokAuth?: string;
    xdgConfig?: string;
    xdgData?: string;
    xdgState?: string;
    path?: string;
  };
};

type Fixture = {
  root: string;
  data: string;
  log: string;
  claude: string;
  opencode: string;
  codex: string;
  grok: string;
  muse: string;
  cursor: string;
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
    GROK_HOME: process.env.GROK_HOME,
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
  process.env.GROK_HOME = path.join(home, '.grok');
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
    grokHome: process.env.GROK_HOME,
    grokAuth: process.env.GROK_AUTH_PATH,
    xdgConfig: process.env.XDG_CONFIG_HOME,
    xdgData: process.env.XDG_DATA_HOME,
    xdgState: process.env.XDG_STATE_HOME,
    path: process.env.PATH,
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
  const grok = path.join(bin, 'grok');
  const muse = path.join(bin, 'muse');
  const cursor = path.join(bin, 'cursor-agent');
  mkdirSync(data, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(claude, fakeAgent, { mode: 0o700 });
  writeFileSync(opencode, fakeAgent, { mode: 0o700 });
  writeFileSync(custom, fakeAgent, { mode: 0o700 });
  writeFileSync(codex, fakeAgent, { mode: 0o700 });
  writeFileSync(grok, fakeAgent, { mode: 0o700 });
  writeFileSync(muse, fakeAgent, { mode: 0o700 });
  writeFileSync(cursor, fakeAgent, { mode: 0o700 });
  chmodSync(claude, 0o700);
  chmodSync(opencode, 0o700);
  chmodSync(custom, 0o700);
  chmodSync(grok, 0o700);
  chmodSync(muse, 0o700);
  chmodSync(cursor, 0o700);
  writeFileSync(log, '');
  return {
    root,
    data,
    log,
    claude,
    opencode,
    codex,
    grok,
    muse,
    cursor,
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
  // The office's MCP server, which OpenCode runs with the worker's environment.
  const mcp = JSON.parse(firstWorker.env.opencodeConfig!).mcp?.['agent-office'];
  assert.deepEqual(mcp?.command?.slice(-1), ['mcp']);
  assert.ok(mcp?.command?.[1].endsWith(path.join('bin', 'office-workers.js')));
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

test('workers reject models for providers that cannot select one and malformed model ids', (t) => {
  const f = fixture();
  t.after(() => f.close());
  const workers = manager(f, f.claude, []);
  t.after(() => workers.shutdown());
  assert.match(workers.spawn('desk-1', 'test', 'bad', false, 'agent', 'claude', 'openai/gpt-5') as string, /model/i);
  assert.match(workers.spawn('desk-2', 'test', 'bad', false, 'agent', 'opencode', 'gpt-5') as string, /model|format|provider/i);
  assert.match(workers.spawn('desk-3', 'test', 'bad', false, 'agent', 'opencode', 'openai/gpt 5') as string, /model|format|whitespace/i);
  assert.match(workers.spawn('desk-4', 'test', 'bad', false, 'agent', 'grok', 'openai/gpt-5') as string, /model/i);
  assert.match(workers.spawn('desk-5', 'test', 'bad', false, 'agent', 'muse', 'openai/gpt-5') as string, /model/i);
  assert.match(workers.spawn('desk-6', 'test', 'bad', false, 'shell', undefined, 'openai/gpt-5') as string, /shell|model/i);
});

test('workers reject reasoning effort for providers without one and unknown levels', (t) => {
  const f = fixture();
  t.after(() => f.close());
  const workers = manager(f, f.claude, []);
  t.after(() => workers.shutdown());
  assert.match(workers.spawn('desk-1', 'test', 'bad', false, 'agent', 'claude', undefined, 'overdrive' as any) as string, /effort/i);
  assert.match(workers.spawn('desk-2', 'test', 'bad', false, 'agent', 'custom', undefined, 'high' as any) as string, /effort can only be selected/i);
  assert.match(workers.spawn('desk-2', 'test', 'bad', false, 'agent', 'opencode', undefined, 'overdrive' as any) as string, /Invalid effort/i);
  assert.match(workers.spawn('desk-3', 'test', 'bad', false, 'shell', undefined, undefined, 'high' as any) as string, /shell|effort/i);
});

test('an explicit Claude model/effort overrides --agent-args and persists across resume', async (t) => {
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

  const workers = manager(f, f.claude, updates, ['--model', 'opus']);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test', 'haiku task', false, 'agent', 'claude', 'haiku', 'high');
  assert.equal(typeof worker, 'object');
  if (typeof worker === 'string') return;
  assert.equal(workers.get(worker.id)?.model, 'haiku');
  assert.equal(workers.get(worker.id)?.effort, 'high');
  const first = await waitFor(() => f.read(), (records) => records.some((r) => r.kind === 'claude' && !r.args.includes('--output-format')));
  const firstInvocation = first.find((r) => r.kind === 'claude' && !r.args.includes('--output-format'))!;
  // The per-worker choice is appended after --agent-args, so it wins even though "opus" also appears.
  assert.deepEqual(firstInvocation.args.slice(firstInvocation.args.indexOf('--model')), ['--model', 'opus', '--model', 'haiku', '--effort', 'high', '--', 'haiku task']);

  assert.equal(workers.handleHook(worker.id, firstInvocation.env.hookToken!, 'SessionStart', { session_id: 'claude-model-1' }), true);
  await waitFor(() => workers.get(worker.id)?.status, (status) => status === 'exited');
  assert.equal(workers.resume(worker.id), undefined);
  const resumed = await waitFor(() => f.read(), (records) => records.filter((r) => r.kind === 'claude' && !r.args.includes('--output-format')).length >= 2);
  const secondInvocation = resumed.filter((r) => r.kind === 'claude' && !r.args.includes('--output-format'))[1];
  assert.ok(secondInvocation.args.includes('--model'));
  assert.ok(secondInvocation.args.includes('haiku'));
  assert.ok(secondInvocation.args.includes('--effort'));
  assert.ok(secondInvocation.args.includes('high'));
  assert.ok(secondInvocation.args.includes('--resume'));

  workers.shutdown();
  const restoredUpdates: WorkerInfo[] = [];
  const restored = manager(f, f.claude, restoredUpdates, ['--model', 'opus']);
  t.after(() => restored.shutdown());
  await restored.start();
  assert.equal(restored.get(worker.id)?.model, 'haiku');
  assert.equal(restored.get(worker.id)?.effort, 'high');
});

test('a worker hired on Fable launches with --model fable and keeps it across a restart', async (t) => {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  const previousLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => {
    if (previousLog === undefined) delete process.env.FAKE_AGENT_LOG;
    else process.env.FAKE_AGENT_LOG = previousLog;
    f.close();
  });

  const workers = manager(f, f.claude, [], ['--model', 'opus']);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test', 'fable task', false, 'agent', 'claude', 'fable');
  assert.equal(typeof worker, 'object');
  if (typeof worker === 'string') return;
  const records = await waitFor(() => f.read(), (rs) => rs.some((r) => r.kind === 'claude' && !r.args.includes('--output-format')));
  const launch = records.find((r) => r.kind === 'claude' && !r.args.includes('--output-format'))!;
  assert.deepEqual(launch.args.slice(launch.args.indexOf('--model')), ['--model', 'opus', '--model', 'fable', '--', 'fable task']);

  workers.shutdown();
  const restored = manager(f, f.claude, [], ['--model', 'opus']);
  t.after(() => restored.shutdown());
  await restored.start();
  assert.equal(restored.get(worker.id)?.model, 'fable');
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
  // The office's MCP server, with the office's variables passed on to it, which Codex doesn't do unasked.
  assert.ok(first.args.some((a) => a.startsWith('mcp_servers.agent-office.args=') && a.includes('office-workers.js')));
  assert.ok(first.args.includes('mcp_servers.agent-office.env_vars=["AGENT_OFFICE_HOOK_URL","AGENT_OFFICE_WORKER_ID","AGENT_OFFICE_HOOK_TOKEN"]'));
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


test('Grok workers isolate GROK_HOME, follow authenticated hooks, and resume their session', async (t) => {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  const oldLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => { if (oldLog === undefined) delete process.env.FAKE_AGENT_LOG; else process.env.FAKE_AGENT_LOG = oldLog; f.close(); });
  const book = ledger(f.data);
  const workers = new WorkerManager(f.root, f.data, f.claude, ['--claude-only'], { url: 'http://127.0.0.1:1', token: '' }, events([]), book);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test', '- fix the login', false, 'agent', 'grok', 'grok-4.6', 'high');
  assert.notEqual(typeof worker, 'string'); if (typeof worker === 'string') return;
  const calls = await waitFor(f.read, x => x.some(r => r.kind === 'grok'));
  const first = calls.find(r => r.kind === 'grok')!;
  const token = first.env.hookToken!;
  assert.equal(worker.status, 'starting');
  assert.equal(worker.model, 'grok-4.6');
  assert.equal(worker.effort, 'high');
  assert.ok(first.args.includes('--no-alt-screen'));
  assert.ok(first.args.includes('--trust'));
  assert.ok(first.args.includes('--session-id'));
  assert.ok(first.args.includes('--model'));
  assert.ok(first.args.includes('grok-4.6'));
  assert.ok(first.args.includes('--effort'));
  assert.ok(first.args.includes('high'));
  assert.deepEqual(first.args.slice(-2), ['--', '- fix the login']);
  assert.equal(first.args.includes('--claude-only'), false);
  assert.equal(first.env.grokHome, path.join(f.data, 'grok-home'));
  assert.equal(calls.some(r => r.kind === 'claude'), false);
  const sessionId = worker.sessionId!;
  assert.match(sessionId, /^[0-9a-f-]{36}$/i);
  const hook = (event: string, extra = {}) => workers.handleGrokHook(worker.id, token, event, { sessionId, ...extra });
  assert.equal(workers.handleGrokHook(worker.id, 'wrong', 'SessionStart', { sessionId }), false);
  assert.equal(hook('SessionStart', { source: 'startup' }), true);
  assert.equal(worker.status, 'idle');
  assert.equal(hook('UserPromptSubmit', { prompt: 'Implement the actual task' }), true);
  assert.equal(worker.status, 'working');
  assert.equal(hook('PreToolUse', { toolName: 'run_terminal_command' }), true);
  assert.equal(hook('Notification', { notificationType: 'permission_prompt' }), true);
  assert.equal(worker.status, 'needs_input');
  assert.equal(hook('Stop', { subagentType: 'explore' }), false);
  assert.equal(worker.status, 'needs_input');
  assert.equal(hook('Stop'), true);
  assert.equal(worker.status, 'done');
  assert.equal(workers.handleHook(worker.id, token, 'Stop', { session_id: 'claude' }), false);
  assert.equal(workers.handleCodexHook(worker.id, token, 'Stop', { session_id: sessionId }), false);
  assert.equal(worker.usage, undefined);
  assert.equal(book.state().total.calls, 0);
  workers.shutdown();
  const restored = manager(f, f.claude, [], []);
  t.after(() => restored.shutdown());
  await restored.start();
  const nextCalls = await waitFor(f.read, x => x.filter(r => r.kind === 'grok' && !r.stdin).length >= 2);
  const next = nextCalls.filter(r => r.kind === 'grok' && !r.stdin).at(-1)!;
  assert.ok(next.args.includes('--resume'));
  assert.ok(next.args.includes(sessionId));
  assert.equal(next.args.includes('--session-id'), false);
  assert.equal(next.args.includes('--model'), false);
  assert.notEqual(next.env.hookToken, token);
  assert.equal(restored.get(worker.id)?.provider, 'grok');
  assert.equal(restored.get(worker.id)?.model, 'grok-4.6');
  assert.equal(restored.get(worker.id)?.effort, 'high');
  assert.equal(restored.handleGrokHook(worker.id, token, 'Stop', { sessionId }), false);
  assert.equal(restored.handleGrokHook(worker.id, next.env.hookToken!, 'SessionStart', { sessionId, source: 'resume' }), true);
  assert.equal(restored.get(worker.id)?.status, 'idle');
});


test('Muse workers isolate XDG, follow authenticated hooks, resume by uuid, and paste a follow-up prompt', async (t) => {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  const oldLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => {
    if (oldLog === undefined) delete process.env.FAKE_AGENT_LOG; else process.env.FAKE_AGENT_LOG = oldLog;
    delete process.env.FAKE_AGENT_EXIT_MS;
    f.close();
  });
  const book = ledger(f.data);
  const workers = new WorkerManager(f.root, f.data, f.claude, ['--claude-only'], { url: 'http://127.0.0.1:1', token: '' }, events([]), book);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test', '- fix the login', false, 'agent', 'muse', 'muse-spark-1.3-contributor', 'high');
  assert.notEqual(typeof worker, 'string'); if (typeof worker === 'string') return;
  const calls = await waitFor(f.read, x => x.some(r => r.kind === 'muse'));
  const first = calls.find(r => r.kind === 'muse')!;
  const token = first.env.hookToken!;
  assert.equal(worker.status, 'starting');
  assert.equal(worker.model, 'muse-spark-1.3-contributor');
  assert.equal(worker.effort, 'high');
  assert.equal(worker.sessionId, undefined);
  assert.ok(first.args.includes('--trust-workspace'));
  assert.ok(first.args.includes('--model'));
  assert.ok(first.args.includes('muse-spark-1.3-contributor'));
  assert.ok(first.args.includes('--reasoning-effort'));
  assert.ok(first.args.includes('high'));
  assert.deepEqual(first.args.slice(-2), ['--', '- fix the login']);
  assert.equal(first.args.includes('resume'), false);
  assert.equal(first.args.includes('--yolo'), false);
  assert.equal(first.args.includes('--claude-only'), false);
  assert.equal(first.env.xdgConfig, path.join(f.data, 'muse-home', 'config'));
  assert.equal(first.env.xdgData, path.join(f.data, 'muse-home', 'share'));
  assert.equal(first.env.xdgState, path.join(f.data, 'muse-home', 'state'));
  assert.equal(calls.some(r => r.kind === 'claude'), false);
  const sessionId = 'muse-root';
  const hook = (event: string, extra = {}) => workers.handleMuseHook(worker.id, token, event, { session_id: sessionId, ...extra });
  assert.equal(workers.handleMuseHook(worker.id, 'wrong', 'SessionStart', { session_id: sessionId }), false);
  assert.equal(hook('SessionStart', { source: 'startup' }), true);
  assert.equal(worker.status, 'idle');
  assert.equal(worker.sessionId, sessionId);
  assert.equal(hook('UserPromptSubmit', { prompt: 'Implement the actual task' }), true);
  assert.equal(worker.status, 'working');
  assert.equal(hook('PreToolUse', { tool_name: 'run_terminal_command' }), true);
  assert.equal(hook('PermissionRequest', { tool_name: 'shell' }), true);
  assert.equal(worker.status, 'needs_input');
  assert.equal(hook('PostToolUseFailure', { tool_name: 'shell' }), true);
  assert.equal(worker.status, 'working');
  assert.equal(hook('Stop', { subagent_type: 'explore' }), false);
  assert.equal(worker.status, 'working');
  assert.equal(hook('Stop'), true);
  assert.equal(worker.status, 'done');
  assert.equal(workers.handleHook(worker.id, token, 'Stop', { session_id: 'claude' }), false);
  assert.equal(workers.handleGrokHook(worker.id, token, 'Stop', { sessionId }), false);
  assert.equal(worker.usage, undefined);
  assert.equal(book.state().total.calls, 0);
  workers.shutdown();
  process.env.FAKE_AGENT_EXIT_MS = '1500';
  const restored = manager(f, f.claude, [], []);
  t.after(() => restored.shutdown());
  await restored.start();
  const nextCalls = await waitFor(f.read, x => x.filter(r => r.kind === 'muse' && !r.stdin).length >= 2);
  const next = nextCalls.filter(r => r.kind === 'muse' && !r.stdin).at(-1)!;
  assert.ok(next.args.includes('--trust-workspace'));
  assert.ok(next.args.includes('resume'));
  assert.ok(next.args.includes(sessionId));
  assert.equal(next.args.includes('--model'), false);
  assert.equal(next.args.includes('- fix the login'), false);
  assert.notEqual(next.env.hookToken, token);
  assert.equal(restored.get(worker.id)?.provider, 'muse');
  assert.equal(restored.get(worker.id)?.model, 'muse-spark-1.3-contributor');
  assert.equal(restored.get(worker.id)?.effort, 'high');
  assert.equal(restored.handleMuseHook(worker.id, token, 'Stop', { session_id: sessionId }), false);
  assert.equal(restored.handleMuseHook(worker.id, next.env.hookToken!, 'SessionStart', { session_id: sessionId, source: 'resume' }), true);
  assert.equal(restored.get(worker.id)?.status, 'idle');
  await waitFor(() => restored.get(worker.id)?.status, (status) => status === 'exited');
  delete process.env.FAKE_AGENT_EXIT_MS;
  assert.equal(restored.resume(worker.id, 'follow-up from the queue'), undefined);
  const pastedLaunch = await waitFor(f.read, x => x.filter(r => r.kind === 'muse' && !r.stdin).length >= 3);
  const launched = pastedLaunch.filter(r => r.kind === 'muse' && !r.stdin).at(-1)!;
  assert.ok(launched.args.includes('resume'));
  assert.ok(launched.args.includes(sessionId));
  assert.equal(launched.args.includes('follow-up from the queue'), false);
  assert.equal(restored.handleMuseHook(worker.id, launched.env.hookToken!, 'SessionStart', { session_id: sessionId, source: 'resume' }), true);
  await waitFor(f.read, x => x.some(r => r.kind === 'muse' && r.stdin?.includes('follow-up from the queue') === true));
});


test('Cursor workers keep their hooks in their folder, follow them, and resume their chat with a follow-up prompt', async (t) => {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  const oldLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => {
    if (oldLog === undefined) delete process.env.FAKE_AGENT_LOG; else process.env.FAKE_AGENT_LOG = oldLog;
    delete process.env.FAKE_AGENT_EXIT_MS;
    f.close();
  });
  const hooksFile = path.join(f.root, '.cursor', 'hooks.json');
  const entries = () => (existsSync(hooksFile) ? (JSON.parse(readFileSync(hooksFile, 'utf8')) as { hooks: Record<string, { command: string }[]> }).hooks : undefined);
  const book = ledger(f.data);
  const workers = new WorkerManager(f.root, f.data, f.claude, ['--claude-only'], { url: 'http://127.0.0.1:1', token: '' }, events([]), book);
  t.after(() => workers.shutdown());
  assert.match(workers.spawn('desk-2', 'test', 'bad', false, 'agent', 'cursor', '--force') as string, /Invalid Cursor model/);
  assert.match(workers.spawn('desk-2', 'test', 'bad', false, 'agent', 'cursor', 'gpt-5', 'high') as string, /effort/i);
  const worker = workers.spawn('desk-1', 'test', '- fix the login', false, 'agent', 'cursor', 'gpt-5');
  assert.notEqual(typeof worker, 'string'); if (typeof worker === 'string') return;
  // The provider is "cursor"; its executable is cursor-agent.
  const calls = await waitFor(f.read, x => x.some(r => r.kind === 'cursor-agent'));
  const first = calls.find(r => r.kind === 'cursor-agent')!;
  const token = first.env.hookToken!;
  // A resumed chat fires no sessionStart, so it never waits for one: it's idle as soon as it runs.
  assert.equal(worker.status, 'idle');
  assert.equal(worker.model, 'gpt-5');
  assert.equal(worker.sessionId, undefined);
  assert.deepEqual(first.args, ['--trust', '--model', 'gpt-5', '--', '- fix the login']);
  assert.equal(calls.some(r => r.kind === 'claude'), false);
  // Its hooks are in the folder it runs in, one entry an event, each naming this worker.
  assert.deepEqual(Object.keys(entries()!), ['sessionStart', 'beforeSubmitPrompt', 'preToolUse', 'postToolUse', 'postToolUseFailure', 'stop']);
  assert.ok(entries()!.stop[0].command.endsWith(` 'stop' '${worker.id}'`));
  assert.ok(entries()!.stop[0].command.includes(path.join(f.data, 'agent-office-cursor-hook.cjs')));
  const sessionId = '0b9a7d0e-5c1f-4a57-9d55-3a1d2f6f0c11';
  const hook = (event: string, extra = {}) => workers.handleProviderHook('cursor', worker.id, token, event, { conversation_id: sessionId, ...extra });
  assert.equal(workers.handleProviderHook('cursor', worker.id, 'wrong', 'sessionStart', { conversation_id: sessionId }), false);
  assert.equal(hook('sessionStart', { composer_mode: 'agent' }), true);
  assert.equal(worker.status, 'idle');
  assert.equal(worker.sessionId, sessionId);
  assert.equal(hook('beforeSubmitPrompt', { prompt: 'Implement the actual task' }), true);
  assert.equal(worker.status, 'working');
  assert.equal(worker.activity, 'Implement the actual task');
  assert.equal(hook('preToolUse', { tool_name: 'Read', tool_use_id: 'tool-1' }), true);
  assert.equal(worker.activity, 'Read');
  assert.equal(worker.action, 'read');
  // A subagent's events, and another chat's, don't move the desk.
  assert.equal(hook('stop', { subagent_id: 'child-1' }), false);
  assert.equal(workers.handleProviderHook('cursor', worker.id, token, 'stop', { conversation_id: 'another-chat' }), false);
  assert.equal(hook('afterAgentResponse', { text: 'private' }), false);
  assert.equal(worker.status, 'working');
  assert.equal(hook('postToolUseFailure', { tool_name: 'Shell', failure_type: 'permission_denied' }), true);
  assert.equal(hook('stop', { status: 'completed' }), true);
  assert.equal(worker.status, 'done');
  assert.equal(workers.handleHook(worker.id, token, 'Stop', { session_id: 'claude' }), false);
  // A chat started over inside the terminal fires no sessionStart: its first prompt takes the desk to it.
  assert.equal(workers.handleProviderHook('cursor', worker.id, token, 'beforeSubmitPrompt', { conversation_id: 'second-chat', prompt: 'Something else' }), true);
  assert.equal(worker.sessionId, 'second-chat');
  assert.equal(worker.status, 'working');
  assert.equal(workers.handleProviderHook('cursor', worker.id, token, 'stop', { conversation_id: 'second-chat' }), true);
  assert.equal(worker.usage, undefined);
  assert.equal(book.state().total.calls, 0);
  // The office stops, and the worker with it: nothing of its hooks is left in the project.
  workers.shutdown();
  assert.equal(existsSync(hooksFile), false);
  process.env.FAKE_AGENT_EXIT_MS = '1500';
  const restored = manager(f, f.claude, [], []);
  t.after(() => restored.shutdown());
  await restored.start();
  const nextCalls = await waitFor(f.read, x => x.filter(r => r.kind === 'cursor-agent' && !r.stdin).length >= 2);
  const next = nextCalls.filter(r => r.kind === 'cursor-agent' && !r.stdin).at(-1)!;
  assert.deepEqual(next.args, ['--trust', '--resume=second-chat']);
  assert.notEqual(next.env.hookToken, token);
  assert.equal(restored.get(worker.id)?.provider, 'cursor');
  assert.equal(restored.get(worker.id)?.model, 'gpt-5');
  assert.equal(restored.handleProviderHook('cursor', worker.id, token, 'stop', { conversation_id: 'second-chat' }), false);
  assert.equal(entries()!.stop.length, 1);
  // Its process ends: its entries go, and the file with them.
  await waitFor(() => restored.get(worker.id)?.status, (status) => status === 'exited');
  assert.equal(existsSync(hooksFile), false);
  delete process.env.FAKE_AGENT_EXIT_MS;
  assert.equal(restored.resume(worker.id, 'follow-up from the queue'), undefined);
  const resumed = await waitFor(f.read, x => x.filter(r => r.kind === 'cursor-agent' && !r.stdin).length >= 3);
  assert.deepEqual(resumed.filter(r => r.kind === 'cursor-agent' && !r.stdin).at(-1)!.args, ['--trust', '--resume=second-chat', '--', 'follow-up from the queue']);
  assert.equal(entries()!.stop.length, 1);
  // Sent home: the folder is the project's own, so its entries are taken out of it.
  await restored.kill(worker.id);
  await waitFor(() => existsSync(hooksFile), (there) => !there);
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
  assert.match(initial, /office-queue add/);
  // Only the queue agent loses its file-editing tools.
  assert.equal(first.args.includes('--disallowedTools'), false);
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

test('a worker nobody picked a model for starts on the office default, and a board agent is told its rewritten brief', async (t) => {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  const previousLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => {
    if (previousLog === undefined) delete process.env.FAKE_AGENT_LOG;
    else process.env.FAKE_AGENT_LOG = previousLog;
    f.close();
  });
  const prompts: PromptSource = {
    text: (id) => (id === 'station.issues' ? 'You triage issues. The request:' : PROMPTS[id].text),
    agent: () => ({ provider: 'claude', model: 'sonnet', effort: 'low' }),
  };
  const workers = new WorkerManager(f.root, f.data, f.claude, ['--from-test'], { url: 'http://127.0.0.1:1', token: '' }, events([]), ledger(f.data), undefined, prompts);
  t.after(() => workers.shutdown());
  const launches = (id: string) => f.read().filter((r) => r.kind === 'claude' && r.args.includes('--settings') && r.stdin === undefined && r.env.workerId === id);
  const flag = (args: string[], name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

  const hired = workers.station('station-issues', 'Ada', 'File one about the dog');
  assert.equal(typeof hired, 'object');
  if (typeof hired === 'string') return;
  assert.deepEqual([hired.info.provider, hired.info.model, hired.info.effort], ['claude', 'sonnet', 'low']);
  const [first] = await waitFor(() => launches(hired.info.id), (l) => l.length === 1);
  assert.equal(first.args.at(-1), 'You triage issues. The request:\n\nFile one about the dog');
  assert.deepEqual([flag(first.args, '--model'), flag(first.args, '--effort')], ['sonnet', 'low']);

  // Picked at the desk, the pick wins, down to "the provider's own model".
  const desk = workers.spawn('desk-1', 'Ada', 'Fix it', false, 'agent', 'claude');
  assert.equal(typeof desk, 'object');
  if (typeof desk === 'string') return;
  assert.deepEqual([desk.provider, desk.model, desk.effort], ['claude', undefined, undefined]);
  const [own] = await waitFor(() => launches(desk.id), (l) => l.length === 1);
  assert.equal(own.args.includes('--model'), false);
});

test('the queue agent is launched without file-editing tools, and board agents get office-queue on their PATH', async (t) => {
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
  const launches = (id: string) => f.read().filter((r) => r.kind === 'claude' && r.args.includes('--settings') && r.stdin === undefined && r.env.workerId === id);
  const bin = path.join(f.data, 'bin');
  const onPath = (r: Invocation) => (r.env.path ?? '').split(path.delimiter)[0] === bin;
  const denied = (args: string[]) => {
    const i = args.indexOf('--disallowedTools');
    return i < 0 ? undefined : args.slice(i + 1, i + 4);
  };

  // The command is there, and runs the shipped script with the office's own node.
  accessSync(path.join(bin, 'office-queue'), constants.X_OK);
  assert.match(execFileSync(path.join(bin, 'office-queue'), ['--help'], { encoding: 'utf8' }), /office-queue add --title/);

  const hired = workers.station('station-queue', 'Ada', 'Fix the typo in the README');
  assert.equal(typeof hired, 'object');
  if (typeof hired === 'string') return;
  const id = hired.info.id;
  const [first] = await waitFor(() => launches(id), (l) => l.length === 1);
  assert.deepEqual(denied(first.args), ['Edit', 'Write', 'NotebookEdit']);
  assert.ok(first.args.indexOf('--disallowedTools') < first.args.indexOf('--'), 'the tools come before the prompt');
  assert.ok(first.args.at(-1)!.endsWith('Fix the typo in the README'));
  assert.ok(onPath(first), 'office-queue is first on its PATH');

  // Woken up carrying on its session, it's still without them.
  assert.equal(workers.handleHook(id, first.env.hookToken!, 'SessionStart', { session_id: 'queue-session' }), true);
  await waitFor(() => workers.get(id)?.status, (s) => s === 'exited');
  workers.station('station-queue', 'Grace', 'Also bump the version');
  const [, second] = await waitFor(() => launches(id), (l) => l.length === 2);
  assert.ok(second.args.includes('--resume') && second.args.includes('queue-session'));
  assert.deepEqual(denied(second.args), ['Edit', 'Write', 'NotebookEdit']);
  assert.equal(second.args.at(-1), 'Also bump the version');
  assert.ok(onPath(second));

  // The other board agents keep their tools; they, and a desk worker, get the commands all the same.
  const pulls = workers.station('station-pulls', 'Ada', 'Sum up the open PRs');
  const desk = workers.spawn('desk-2', 'Ada', 'Fix login');
  assert.ok(typeof pulls === 'object' && typeof desk === 'object');
  if (typeof pulls !== 'object' || typeof desk !== 'object') return;
  const [pullsLaunch] = await waitFor(() => launches(pulls.info.id), (l) => l.length === 1);
  const [deskLaunch] = await waitFor(() => launches(desk.id), (l) => l.length === 1);
  assert.equal(denied(pullsLaunch.args), undefined);
  assert.ok(onPath(pullsLaunch));
  assert.equal(denied(deskLaunch.args), undefined);
  assert.ok(onPath(deskLaunch), 'office-workers is first on a desk worker\'s PATH');
});

test("every Claude worker gets the office's MCP server, and office-workers on its PATH", async (t) => {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  const previousLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => {
    if (previousLog === undefined) delete process.env.FAKE_AGENT_LOG;
    else process.env.FAKE_AGENT_LOG = previousLog;
    f.close();
  });
  const workers = manager(f, f.claude, []);
  t.after(() => workers.shutdown());

  const bin = path.join(f.data, 'bin');
  accessSync(path.join(bin, 'office-workers'), constants.X_OK);
  assert.match(execFileSync(path.join(bin, 'office-workers'), ['--help'], { encoding: 'utf8' }), /office-workers home --merged/);
  // Claude Code's --mcp-config: the shipped script, run as an MCP server by the office's own node.
  const config = path.join(f.data, 'agent-office-mcp.json');
  const server = JSON.parse(readFileSync(config, 'utf8')).mcpServers['agent-office'];
  assert.equal(server.command, process.execPath);
  assert.deepEqual(server.args.slice(1), ['mcp']);
  assert.ok(server.args[0].endsWith(path.join('bin', 'office-workers.js')));
  // Looking is allowed without asking; hiring and sending home aren't.
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.data, 'claude-hooks.json'), 'utf8')).permissions, { allow: ['mcp__agent-office__list_workers'] });

  const desk = workers.spawn('desk-2', 'Ada', 'Fix login');
  assert.equal(typeof desk, 'object');
  if (typeof desk !== 'object') return;
  const [launch] = await waitFor(() => f.read().filter((r) => r.kind === 'claude' && r.stdin === undefined && r.env.workerId === desk.id), (l) => l.length === 1);
  // Before --settings, which ends the list of configs --mcp-config takes.
  const at = launch.args.indexOf('--mcp-config');
  assert.ok(at >= 0);
  assert.equal(launch.args[at + 1], config);
  assert.equal(launch.args[at + 2], '--settings');
  assert.equal((launch.env.path ?? '').split(path.delimiter)[0], bin);
});

test('a Claude worker acts out its latest tool call, and puts its head in its hands when its tests keep failing', async (t) => {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  const previousExit = process.env.FAKE_AGENT_EXIT_MS;
  const previousLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_EXIT_MS = '5000';
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => {
    if (previousExit === undefined) delete process.env.FAKE_AGENT_EXIT_MS;
    else process.env.FAKE_AGENT_EXIT_MS = previousExit;
    if (previousLog === undefined) delete process.env.FAKE_AGENT_LOG;
    else process.env.FAKE_AGENT_LOG = previousLog;
    f.close();
  });
  const workers = manager(f, f.claude, []);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test', 'make the tests pass');
  if (typeof worker === 'string') return assert.fail(worker);
  const [launch] = await waitFor(() => f.read().filter((r) => r.kind === 'claude' && r.args.includes('--settings')), (l) => l.length === 1);
  const settings = JSON.parse(readFileSync(launch.args[launch.args.indexOf('--settings') + 1], 'utf8'));
  assert.ok(settings.hooks.PostToolUseFailure, 'failed tool calls are reported');

  const token = launch.env.hookToken!;
  const hook = (event: string, payload: object) => assert.equal(workers.handleHook(worker.id, token, event, { session_id: 'acting', ...payload }), true);
  const action = () => workers.get(worker.id)?.action;
  const npmTest = { tool_name: 'Bash', tool_input: { command: 'npm test 2>&1 | tail -5' } };
  hook('SessionStart', {});
  hook('UserPromptSubmit', { prompt: 'make the tests pass' });
  assert.equal(action(), undefined);
  hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'src/a.ts' } });
  assert.equal(action(), 'read');
  hook('PreToolUse', npmTest);
  assert.equal(action(), 'test');
  // Failed once (by exit code): still watching. An interrupt isn't a failure.
  hook('PostToolUseFailure', { ...npmTest, error: 'Exit code 1\n# fail 2', is_interrupt: false });
  hook('PostToolUseFailure', { ...npmTest, error: 'Interrupted', is_interrupt: true });
  assert.equal(action(), 'test');
  hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' } });
  assert.equal(action(), 'edit');
  // Failed again, by the summary it printed through the pipe: head in hands, until its next tool call.
  hook('PreToolUse', npmTest);
  hook('PostToolUse', { ...npmTest, tool_response: { stdout: '# tests 5\n# pass 3\n# fail 2', stderr: '' } });
  assert.equal(action(), 'failing');
  hook('PreToolUse', npmTest);
  assert.equal(action(), 'test');
  // A pass ends the streak: one more failure isn't "again and again".
  hook('PostToolUse', { ...npmTest, tool_response: { stdout: '# tests 5\n# pass 5\n# fail 0', stderr: '' } });
  hook('PreToolUse', npmTest);
  hook('PostToolUseFailure', { ...npmTest, error: 'Exit code 1' });
  assert.equal(action(), 'test');
  // A failing command that isn't a test run doesn't count.
  hook('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'git push' }, error: 'Exit code 1' });
  assert.equal(action(), 'test');
  hook('Stop', {});
  assert.equal(workers.get(worker.id)?.status, 'done');
  assert.equal(action(), undefined);
});

test('a Claude worker that opens a pull request itself has it as its own', async (t) => {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  const previousExit = process.env.FAKE_AGENT_EXIT_MS;
  const previousLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_EXIT_MS = '5000';
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => {
    if (previousExit === undefined) delete process.env.FAKE_AGENT_EXIT_MS;
    else process.env.FAKE_AGENT_EXIT_MS = previousExit;
    if (previousLog === undefined) delete process.env.FAKE_AGENT_LOG;
    else process.env.FAKE_AGENT_LOG = previousLog;
    f.close();
  });
  execFileSync('git', ['init', '-q'], { cwd: f.root });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/app.git'], { cwd: f.root });
  const toasts: string[] = [];
  const hookEnv = { url: 'http://127.0.0.1:1', token: '' };
  const workers = new WorkerManager(f.root, f.data, f.claude, [], hookEnv, { ...events([]), toast: (text) => toasts.push(text) }, ledger(f.data));
  t.after(() => workers.shutdown());
  // In the main checkout: the branch it pushes is one the office never made.
  const worker = workers.spawn('desk-1', 'test', 'fix the login redirect and open a pull request');
  if (typeof worker === 'string') return assert.fail(worker);
  assert.equal(worker.worktree, undefined);
  const [launch] = await waitFor(() => f.read().filter((r) => r.kind === 'claude' && r.args.includes('--settings')), (l) => l.length === 1);
  const hook = (event: string, payload: object) => assert.equal(workers.handleHook(worker.id, launch.env.hookToken!, event, { session_id: 'pr', ...payload }), true);
  const pr = () => workers.get(worker.id)?.pr;
  const create = { tool_name: 'Bash', tool_input: { command: 'cd ../wt && git push -u origin fix-login && gh pr create --title "Fix login" --body "Closes #4"' } };
  hook('SessionStart', {});
  hook('UserPromptSubmit', { prompt: 'fix the login redirect and open a pull request' });
  // Looking at someone's, naming the command, or opening one in another repository: none of them is its own.
  hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'gh pr view 3 --json url' }, tool_response: { stdout: 'https://github.com/acme/app/pull/3' } });
  hook('PostToolUse', { tool_name: 'Bash', tool_input: { command: 'grep -rn "gh pr create" docs' }, tool_response: { stdout: 'docs/a.md: gh pr create … https://github.com/acme/app/pull/3' } });
  hook('PostToolUse', { ...create, tool_response: { stdout: 'https://github.com/other/thing/pull/9\n', stderr: '' } });
  assert.equal(pr(), undefined);
  hook('PostToolUse', { ...create, tool_response: { stdout: 'https://github.com/acme/app/pull/12\n', stderr: 'Creating pull request for fix-login into main in acme/app' } });
  assert.deepEqual(pr(), { number: 12, url: 'https://github.com/acme/app/pull/12' });
  assert.deepEqual(toasts, [`${worker.name} opened PR #12`]);
  assert.equal(JSON.parse(readFileSync(path.join(f.data, 'workers.json'), 'utf8')).find((w: { id: string }) => w.id === worker.id).pr.number, 12, 'kept across a restart');
  // A follow-up whose branch already had one: gh fails, and says which.
  hook('PostToolUseFailure', { ...create, error: 'Exit code 1\na pull request for branch "fix-more" into branch "main" already exists:\nhttps://github.com/acme/app/pull/14' });
  assert.equal(pr()?.number, 14);
  assert.deepEqual(workers.get(worker.id)?.pastPrs, [12], 'the first one is still its own');
  // Said again, it's no news.
  hook('PostToolUseFailure', { ...create, error: 'Exit code 1\nhttps://github.com/acme/app/pull/14' });
  assert.equal(toasts.length, 2);

  // And someone can say which is whose, or that none is (office-workers pr).
  assert.equal(workers.linkPr(worker.id, { number: 20, url: 'https://github.com/acme/app/pull/20' }), undefined);
  assert.equal(pr()?.number, 20);
  assert.equal(workers.get(worker.id)?.pastPrs, undefined, 'said by someone: only that one');
  assert.equal(workers.linkPr(worker.id), undefined);
  assert.equal(pr(), undefined);
  assert.equal(workers.linkPr('nobody', { number: 20, url: 'https://github.com/acme/app/pull/20' }), 'No such worker');
});

test('a worker is stamped with when it started waiting on someone, afresh each time', async (t) => {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  const oldLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => { if (oldLog === undefined) delete process.env.FAKE_AGENT_LOG; else process.env.FAKE_AGENT_LOG = oldLog; f.close(); });
  const workers = manager(f, f.claude, []);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test', 'fix the login');
  assert.notEqual(typeof worker, 'string'); if (typeof worker === 'string') return;
  const calls = await waitFor(f.read, (x) => x.some((r) => r.kind === 'claude' && r.args.includes('--settings')));
  const token = calls.find((r) => r.kind === 'claude' && r.args.includes('--settings'))!.env.hookToken!;
  const hook = (event: string, extra = {}) => workers.handleHook(worker.id, token, event, { session_id: 'waiting', ...extra });
  hook('SessionStart');
  hook('UserPromptSubmit', { prompt: 'fix the login' });
  assert.equal(worker.status, 'working');
  assert.equal(worker.waitingSince, undefined);
  const before = Date.now();
  hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(worker.status, 'needs_input');
  const asked = worker.waitingSince!;
  assert.ok(asked >= before && asked <= Date.now());
  await new Promise((resolve) => setTimeout(resolve, 5));
  hook('PostToolUse', { tool_name: 'Bash' });
  hook('Stop');
  assert.equal(worker.status, 'done');
  assert.ok(worker.waitingSince! > asked, 'finishing is a new wait');
});

/** Each Claude worker launch so far (not the task namer's calls), oldest first. */
const launches = (f: Fixture) => f.read().filter((r) => r.kind === 'claude' && r.args.includes('--settings'));
/** What a launch was told to do: the prompt after `--`, if any. */
const promptOf = (r: Invocation) => (r.args.includes('--') ? r.args[r.args.indexOf('--') + 1] : undefined);

function carryOnFixture(t: { after(fn: () => void): void }) {
  const f = fixture();
  isolateProviderEnvironment(f, t);
  const oldLog = process.env.FAKE_AGENT_LOG;
  process.env.FAKE_AGENT_LOG = f.log;
  t.after(() => {
    if (oldLog === undefined) delete process.env.FAKE_AGENT_LOG;
    else process.env.FAKE_AGENT_LOG = oldLog;
    f.close();
  });
  return f;
}

/** Hires a Claude worker and puts its session in `state`: mid-turn ('working', 'needs_input') or finished ('done'). */
async function hireInState(f: Fixture, workers: WorkerManager, deskId: string, session: string, state: 'working' | 'needs_input' | 'done') {
  const before = launches(f).length;
  const worker = workers.spawn(deskId, 'test', `task for ${session}`);
  assert.notEqual(typeof worker, 'string');
  if (typeof worker === 'string') throw new Error(worker);
  const token = (await waitFor(() => launches(f), (x) => x.length > before)).at(-1)!.env.hookToken!;
  const hook = (event: string, extra = {}) => assert.equal(workers.handleHook(worker.id, token, event, { session_id: session, ...extra }), true);
  hook('SessionStart');
  hook('UserPromptSubmit', { prompt: `task for ${session}` });
  if (state === 'needs_input') hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm test' } });
  if (state === 'done') hook('Stop');
  assert.equal(workers.get(worker.id)?.status, state);
  return worker;
}

test('a restart that takes a mid-turn worker down resumes it with continue; a finished one just wakes up', async (t) => {
  const f = carryOnFixture(t);
  const before = manager(f, f.claude, []);
  // Never started, so its terminals run in-process and go down with it.
  await hireInState(f, before, 'desk-1', 'mid-turn', 'working');
  await hireInState(f, before, 'desk-2', 'asking', 'needs_input');
  await hireInState(f, before, 'desk-3', 'finished', 'done');
  before.shutdown(true);
  await new Promise((resolve) => setTimeout(resolve, 200));

  const after = manager(f, f.claude, []);
  t.after(() => after.shutdown());
  await after.start();
  const resumed = (await waitFor(() => launches(f), (x) => x.length >= 6)).slice(3);
  const of = (session: string) => resumed.find((r) => r.args.includes(session))!;
  for (const session of ['mid-turn', 'asking']) {
    assert.ok(of(session).args.includes('--resume'));
    assert.equal(promptOf(of(session)), CARRY_ON_PROMPT);
  }
  assert.ok(of('finished').args.includes('--resume'));
  assert.equal(promptOf(of('finished')), undefined);
});

test('a worker whose terminal outlives the office is picked back up mid-turn, not relaunched or told to continue', async (t) => {
  const f = carryOnFixture(t);
  const before = manager(f, f.claude, []);
  await before.start();
  const worker = await hireInState(f, before, 'desk-1', 'kept', 'working');
  before.shutdown(true);

  const after = manager(f, f.claude, []);
  t.after(() => after.shutdown());
  await after.start();
  assert.equal(after.get(worker.id)?.status, 'working');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(launches(f).length, 1);
});

test('a worker whose terminal was in the host when an older office went down carries on if the host is gone', async (t) => {
  const f = carryOnFixture(t);
  // workers.json as the office before midTurn left it: only the host terminal's status says it was mid-turn.
  const saved = (id: string, deskId: string, sessionId: string, status: string) => ({
    id,
    kind: 'agent',
    provider: 'claude',
    deskId,
    name: id,
    sessionId,
    hookToken: `${id}-token`,
    pty: { id: `${id}-pty`, status, acked: true },
  });
  writeFileSync(path.join(f.data, 'workers.json'), JSON.stringify([saved('upgraded', 'desk-1', 'was-working', 'working'), saved('idle', 'desk-2', 'was-done', 'done')]));
  const workers = manager(f, f.claude, []);
  t.after(() => workers.shutdown());
  await workers.start();
  const resumed = await waitFor(() => launches(f), (x) => x.length >= 2);
  assert.equal(promptOf(resumed.find((r) => r.args.includes('was-working'))!), CARRY_ON_PROMPT);
  assert.equal(promptOf(resumed.find((r) => r.args.includes('was-done'))!), undefined);
});

test('stopping the office on purpose (Ctrl+C) leaves nothing to carry on', async (t) => {
  const f = carryOnFixture(t);
  const before = manager(f, f.claude, []);
  // Its terminals run in the host, which ends them without telling the office they exited.
  await before.start();
  await hireInState(f, before, 'desk-1', 'stopped', 'working');
  before.shutdown(false);
  await new Promise((resolve) => setTimeout(resolve, 200));

  const after = manager(f, f.claude, []);
  t.after(() => after.shutdown());
  await after.start();
  const resumed = (await waitFor(() => launches(f), (x) => x.length >= 2))[1];
  assert.ok(resumed.args.includes('stopped'));
  assert.equal(promptOf(resumed), undefined);
});

test('a worktree worker that makes its own branch is followed there: O finds the PR it opened, and sending it home tidies both branches', async (t) => {
  const f = carryOnFixture(t);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
  git(f.root, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(f.root, 'a.txt'), 'a');
  git(f.root, 'add', 'a.txt');
  git(f.root, 'commit', '-qm', 'init');
  // GitHub has one open pull request, from the branch the worker is about to make.
  writeFileSync(path.join(path.dirname(f.claude), 'gh'), `#!/bin/sh\ncase "$*" in *"--head fix-x "*) echo '[{"number":242,"url":"https://github.com/o/r/pull/242"}]';; *) echo '[]';; esac\n`, { mode: 0o700 });
  const updates: WorkerInfo[] = [];
  const workers = manager(f, f.claude, updates);
  t.after(() => workers.shutdown());
  const worker = workers.spawn('desk-1', 'test', 'fix x on a new branch and open a PR', true);
  assert.notEqual(typeof worker, 'string'); if (typeof worker === 'string') return;
  const office = worker.worktree!.branch;
  assert.match(office, /^office\//);
  const token = (await waitFor(() => launches(f), (x) => x.length > 0))[0].env.hookToken!;
  const hook = (event: string, extra = {}) => assert.equal(workers.handleHook(worker.id, token, event, { session_id: 'own-branch', ...extra }), true);
  hook('SessionStart');
  hook('UserPromptSubmit', { prompt: 'fix x on a new branch and open a PR' });
  // What the task (or the repo's CLAUDE.md) told it to do: a branch of its own, a commit, a PR from there.
  const cwd = path.join(f.root, worker.worktree!.path);
  git(cwd, 'checkout', '-qb', 'fix-x');
  writeFileSync(path.join(cwd, 'x.txt'), 'x');
  git(cwd, 'add', 'x.txt');
  git(cwd, 'commit', '-qm', 'fix x');
  hook('Stop');
  const info = await waitFor(() => workers.get(worker.id)!, (w) => w.worktree?.branch === 'fix-x');
  assert.equal(info.worktree!.made, office);
  assert.equal(updates.at(-1)?.worktree?.branch, 'fix-x');
  // Saved, for a restarted office and for `agent-office prune`.
  const saved = JSON.parse(readFileSync(path.join(f.data, 'workers.json'), 'utf8')) as WorkerInfo[];
  assert.deepEqual(saved.find((w) => w.id === worker.id)?.worktree, info.worktree);
  // O at the desk: the PR it opened, not "has no commits on office/… yet".
  const pr = await workers.openPr(worker.id, 'Cody');
  assert.deepEqual(pr, { prs: [{ number: 242, url: 'https://github.com/o/r/pull/242', existed: true, dirty: false }], failed: [] });
  assert.deepEqual(workers.get(worker.id)?.pr, { number: 242, url: 'https://github.com/o/r/pull/242' });
  // Sent home: the worktree goes, with its branch and the office's (which holds nothing fix-x lacks).
  const home = await workers.kill(worker.id, 'all');
  assert.equal(home.error, undefined);
  assert.equal(home.note, `Deleted ${worker.name}'s worktree and branch fix-x`);
  assert.equal(git(f.root, 'branch', '--list', 'fix-x', office), '');
  assert.ok(!existsSync(cwd));
  // One that checked out a branch from before it was hired leaves that branch be.
  execFileSync('git', ['branch', 'release'], { cwd: f.root, env: { ...process.env, GIT_COMMITTER_DATE: '@1000000000 +0000' } });
  const other = workers.spawn('desk-2', 'test', 'look at the release branch', true);
  assert.notEqual(typeof other, 'string'); if (typeof other === 'string') return;
  git(path.join(f.root, other.worktree!.path), 'checkout', '-q', 'release');
  const left = await workers.kill(other.id, 'all');
  assert.equal(left.note, `Deleted ${other.name}'s worktree and branch ${other.worktree!.branch}`);
  assert.equal(git(f.root, 'branch', '--list', '--format=%(refname:short)', 'release', other.worktree!.branch), 'release');
});

test("the office's branch keeps a worker's commits once it has moved on: the dialog warns, and sending it home never deletes them", async (t) => {
  const f = carryOnFixture(t);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
  git(f.root, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(f.root, 'a.txt'), 'a');
  git(f.root, 'add', 'a.txt');
  git(f.root, 'commit', '-qm', 'init');
  execFileSync('git', ['branch', 'release'], { cwd: f.root, env: { ...process.env, GIT_COMMITTER_DATE: '@1000000000 +0000' } });
  const workers = manager(f, f.claude, []);
  t.after(() => workers.shutdown());
  /** A worker that commits on the office's branch, then goes to another one. */
  const hire = (desk: string, ...checkout: string[]) => {
    const w = workers.spawn(desk, 'test', 'commit, then switch branches', true);
    if (typeof w === 'string') throw new Error(w);
    const cwd = path.join(f.root, w.worktree!.path);
    writeFileSync(path.join(cwd, `${desk}.txt`), desk);
    git(cwd, 'add', `${desk}.txt`);
    git(cwd, 'commit', '-qm', `work at ${desk}`);
    git(cwd, 'checkout', '-q', ...checkout);
    return { w, cwd, office: w.worktree!.branch };
  };
  const tip = (branch: string) => git(f.root, 'log', '-1', '--format=%s', branch);
  // Onto release, which was there before it: the commit is only on the office's branch.
  const a = hire('desk-1', 'release');
  assert.deepEqual(await workers.inspectWorktree(a.w.id), { exists: true, dirty: 0, ahead: 1, unpushed: 1 });
  assert.equal(workers.get(a.w.id)?.worktree?.made, a.office);
  // Deleting the worktree and branch anyway: release isn't the office's, and the office's has the commit.
  const sent = await workers.kill(a.w.id, 'all');
  assert.equal(sent.error, undefined);
  assert.equal(sent.note, `Deleted ${a.w.name}'s worktree and kept branch ${a.office} — it has 1 unpushed commit`);
  assert.ok(!existsSync(a.cwd));
  assert.equal(tip(a.office), 'work at desk-1');
  assert.equal(tip('release'), 'init');
  // Sent home with no choice (the queue recycling its desk, leave-on-merge): nothing goes.
  const b = hire('desk-2', 'release');
  assert.equal((await workers.kill(b.w.id)).note, `Kept ${b.w.name}'s worktree and branch release — it has 1 unpushed commit`);
  assert.ok(existsSync(b.cwd));
  assert.equal(tip(b.office), 'work at desk-2');
  // A branch of its own, cut from main without that commit: it goes, the office's stays.
  const c = hire('desk-3', '-b', 'fix-z', 'main');
  const own = await workers.kill(c.w.id, 'all');
  assert.equal(own.note, `Deleted ${c.w.name}'s worktree and branch fix-z, and kept branch ${c.office} — it has 1 unpushed commit`);
  assert.equal(git(f.root, 'branch', '--list', 'fix-z'), '');
  assert.equal(tip(c.office), 'work at desk-3');
});

test("a worker that renames the office's branch goes home with it; one that deletes it leaves the branch it's on", async (t) => {
  const f = carryOnFixture(t);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
  git(f.root, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(f.root, 'a.txt'), 'a');
  git(f.root, 'add', 'a.txt');
  git(f.root, 'commit', '-qm', 'init');
  const workers = manager(f, f.claude, []);
  t.after(() => workers.shutdown());
  const hire = (desk: string) => {
    const w = workers.spawn(desk, 'test', 'fix x and name the branch after it', true);
    if (typeof w === 'string') throw new Error(w);
    return { w, cwd: path.join(f.root, w.worktree!.path), office: w.worktree!.branch };
  };
  const a = hire('desk-1');
  const token = (await waitFor(() => launches(f), (x) => x.length > 0))[0].env.hookToken!;
  const hook = (event: string, extra = {}) => assert.equal(workers.handleHook(a.w.id, token, event, { session_id: 'renamed', ...extra }), true);
  hook('SessionStart');
  hook('UserPromptSubmit', { prompt: 'fix x and name the branch after it' });
  writeFileSync(path.join(a.cwd, 'x.txt'), 'x');
  git(a.cwd, 'add', 'x.txt');
  git(a.cwd, 'commit', '-qm', 'fix x');
  git(a.cwd, 'branch', '-m', 'fix-x');
  hook('Stop');
  // Followed there, with nothing to remember: office/… is gone, fix-x is it.
  const info = await waitFor(() => workers.get(a.w.id)!, (w) => w.worktree?.branch === 'fix-x');
  assert.equal(info.worktree!.made, undefined);
  const sent = await workers.kill(a.w.id, 'all');
  assert.equal(sent.error, undefined);
  assert.equal(sent.note, `Deleted ${a.w.name}'s worktree and branch fix-x`);
  assert.equal(git(f.root, 'branch', '--list', 'fix-x', a.office), '');
  assert.ok(!existsSync(a.cwd));
  // Renamed with nothing unpushed (its PR merged, say) and sent home before it came to rest: all of it goes.
  const b = hire('desk-2');
  git(b.cwd, 'branch', '-m', 'fix-y');
  assert.deepEqual(await workers.kill(b.w.id), { note: `Deleted ${b.w.name}'s worktree and branch fix-y` });
  assert.equal(git(f.root, 'branch', '--list', 'fix-y', b.office), '');
  // The office's branch deleted instead: git can't say whether the one it's on is its own, so it stays.
  const c = hire('desk-3');
  git(c.cwd, 'checkout', '-qb', 'fix-w');
  git(c.cwd, 'branch', '-D', c.office);
  assert.deepEqual(await workers.kill(c.w.id, 'all'), { note: `Deleted ${c.w.name}'s worktree and kept branch fix-w` });
  assert.equal(git(f.root, 'branch', '--list', '--format=%(refname:short)', 'fix-w', c.office), 'fix-w');
  assert.ok(!existsSync(c.cwd));
});

test("only a branch the worker made is its own to delete, and the office's stays when it has commits that one doesn't", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-made-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  git('add', 'a.txt');
  git('commit', '-qm', 'init');
  // A branch that was there long before any worker (its reflog says it was made in 2001).
  execFileSync('git', ['branch', 'release'], { cwd: dir, env: { ...process.env, GIT_COMMITTER_DATE: '@1000000000 +0000' } });
  const trees = new Worktrees(dir);
  const made = trees.create('mochi-1234');
  assert.notEqual(typeof made, 'string'); if (typeof made === 'string') return;
  const cwd = path.join(dir, made.path);
  const gitIn = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
  // A commit on the office's branch, then a fresh branch from main that doesn't have it.
  writeFileSync(path.join(cwd, 'o.txt'), 'o');
  gitIn('add', 'o.txt');
  gitIn('commit', '-qm', 'on the office branch');
  gitIn('checkout', '-qb', 'fix-y', 'main');
  assert.equal(await trees.branchOf(made), 'fix-y');
  assert.equal(await trees.madeSince('fix-y', made.branch), true);
  assert.equal(await trees.madeSince('release', made.branch), false);
  assert.equal(await trees.madeSince('main', made.branch), false);
  assert.equal(await trees.remove({ ...made, branch: 'fix-y', made: made.branch }, 'all'), undefined);
  assert.equal(git('branch', '--list', 'fix-y'), '');
  assert.equal(git('branch', '--list', made.branch).replace(/^\*?\s+/, ''), made.branch);
});

test("a worker whose worktree was deleted outside the office waits, marked lost, instead of failing to start; rebuilding puts it back and it carries on", async (t) => {
  const f = carryOnFixture(t);
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
  git(f.root, 'init', '-q', '-b', 'main');
  writeFileSync(path.join(f.root, 'a.txt'), 'a');
  git(f.root, 'add', 'a.txt');
  git(f.root, 'commit', '-qm', 'init');
  const officeWith = (updates: WorkerInfo[], toasts: string[]) =>
    new WorkerManager(f.root, f.data, f.claude, ['--from-test'], { url: 'http://127.0.0.1:1', token: '' }, { ...events(updates), toast: (text) => toasts.push(text) }, ledger(f.data));
  const before = officeWith([], []);
  const hire = async (deskId: string, session: string) => {
    const n = launches(f).length;
    const w = before.spawn(deskId, 'test', `task for ${session}`, true);
    assert.notEqual(typeof w, 'string');
    if (typeof w === 'string') throw new Error(w);
    const token = (await waitFor(() => launches(f), (x) => x.length > n)).at(-1)!.env.hookToken!;
    assert.equal(before.handleHook(w.id, token, 'SessionStart', { session_id: session }), true);
    return w;
  };
  const kept = await hire('desk-1', 'kept-branch');
  const gone = await hire('desk-2', 'gone-branch');
  // Kept did some work on its branch; gone's branch goes with its folder.
  const keptDir = path.join(f.root, kept.worktree!.path);
  writeFileSync(path.join(keptDir, 'work.txt'), 'work');
  git(keptDir, 'add', 'work.txt');
  git(keptDir, 'commit', '-qm', 'work');
  before.shutdown(true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  // Deleted while the office was down, by hand.
  rmSync(keptDir, { recursive: true, force: true });
  rmSync(path.join(f.root, gone.worktree!.path), { recursive: true, force: true });
  git(f.root, 'worktree', 'prune');
  git(f.root, 'branch', '-D', gone.worktree!.branch);

  const updates: WorkerInfo[] = [];
  const toasts: string[] = [];
  const after = officeWith(updates, toasts);
  t.after(() => after.shutdown());
  const launched = launches(f).length;
  await after.start();
  await new Promise((resolve) => setTimeout(resolve, 200));
  // Nobody started, nobody was told "could not start": both wait at their desks, marked lost.
  assert.equal(launches(f).length, launched);
  assert.deepEqual(toasts, []);
  assert.deepEqual(after.get(kept.id)?.lost, { branch: 'here' });
  assert.deepEqual(after.get(gone.id)?.lost, { branch: 'gone' });
  assert.equal(after.get(kept.id)?.status, 'offline');
  assert.match(after.resume(kept.id) ?? '', /worktree .* was deleted outside agent-office/);
  assert.equal(launches(f).length, launched);

  // Put back on its own branch, work and all, and it carries on its conversation.
  assert.deepEqual(await after.rebuild(kept.id), { rebuilt: true, note: undefined });
  assert.equal(git(keptDir, 'rev-parse', '--abbrev-ref', 'HEAD'), kept.worktree!.branch);
  assert.ok(existsSync(path.join(keptDir, 'work.txt')));
  assert.equal(after.get(kept.id)?.lost, undefined);
  const resumed = await waitFor(() => launches(f).slice(launched), (x) => x.length > 0);
  assert.ok(resumed[0].args.includes('--resume') && resumed[0].args.includes('kept-branch'));

  // Its branch gone too: made again from where it started.
  const again = await after.rebuild(gone.id);
  assert.equal(again.rebuilt, true);
  assert.match(again.note ?? '', /was deleted too/);
  assert.equal(git(path.join(f.root, gone.worktree!.path), 'rev-parse', 'HEAD'), gone.worktree!.base);
  assert.equal(after.get(gone.id)?.lost, undefined);
  assert.deepEqual(toasts, []);
});
