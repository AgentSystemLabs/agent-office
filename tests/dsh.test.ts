// DeepSeek Harness over ACP: the translation core, the session, and the office wiring.
//
// Nothing here needs a DSH install or a PTY: the fake agent below speaks ACP v1 over stdio, the
// same way the shipped `dsh --profile acp` does (see docs/dsh-acp-integration.md).

import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DshRenderer,
  DshSession,
  configOptionValues,
  dshArgs,
  dshEffort,
  dshSessionsRoot,
  dshUsage,
  permissionChoice,
  permissionOptions,
  renderPermission,
  resolveConfigValue,
  toolKindAction,
  writeDshPatch,
  type DshLaunch,
} from '../src/server/dsh.js';
import { Ledger } from '../src/server/usage.js';
import { WorkerManager, type WorkerEvents } from '../src/server/workers.js';
import type { Usage, WorkerAction, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

// ---------------------------------------------------------------------------
// A fake ACP agent
// ---------------------------------------------------------------------------

/** Sessions survive the process: that is how a restart resumes one (see DSH_FAKE_SESSIONS). */
const fakeAgent = String.raw`import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';

const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const log = process.env.DSH_FAKE_LOG;
const sessionsFile = process.env.DSH_FAKE_SESSIONS;
/** A fake agent never takes the suite down with it: a bad log path is not a protocol error. */
const append = (file, text) => { try { if (file) appendFileSync(file, text); } catch { /* ignore */ } };
append(log, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  profile: process.env.AGENT_OFFICE_DSH_PROFILE,
  workerId: process.env.AGENT_OFFICE_WORKER_ID,
}) + '\n');

const readSessions = () => {
  if (!sessionsFile || !existsSync(sessionsFile)) return [];
  try { return readFileSync(sessionsFile, 'utf8').split('\n').filter(Boolean); } catch { return []; }
};
const remember = (id) => append(sessionsFile, id + '\n');

let modelValue = '["fake-provider","fake-flash"]';
let effort = 'high';
const modelValues = ['["fake-provider","fake-flash"]', '["fake-provider","fake-pro"]'];
const effortValues = ['off', 'low', 'high', 'max'];
// The shape dsh 0.1.7-rc.2 really sends: route tuples, grouped by provider.
const configOptions = () => [
  {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: modelValue,
    options: [{ group: 'fake-provider', name: 'Fake', options: [{ value: modelValues[0], name: 'fake-flash' }, { value: modelValues[1], name: 'Fake Pro' }] }],
  },
  {
    id: 'reasoning_effort',
    name: 'Reasoning effort',
    category: 'thought_level',
    type: 'select',
    currentValue: effort,
    options: effortValues.map((value) => ({ value, name: value })),
  },
];

let agentRequestId = 500;
let pendingPrompt = null;
let pendingPermission = null;

createInterface({ input: process.stdin }).on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try { msg = JSON.parse(text); } catch { return; }

  // The client answering something we asked (a permission request).
  if (msg.method === undefined && msg.id !== undefined) {
    if (!pendingPermission || msg.id !== pendingPermission.id) return;
    const answer = process.env.DSH_FAKE_ANSWER;
    if (answer) append(answer, JSON.stringify(msg.result) + '\n');
    const cancelled = msg.result?.outcome?.outcome === 'cancelled';
    const promptId = pendingPermission.promptId;
    pendingPermission = null;
    out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', title: 'Run tests', status: cancelled ? 'failed' : 'completed' } } });
    out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'sess-1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ng' } } } });
    out({ jsonrpc: '2.0', id: promptId, result: { stopReason: cancelled ? 'cancelled' : 'end_turn' } });
    pendingPrompt = null;
    return;
  }

  if (msg.method === 'initialize') {
    return out({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { list: {}, resume: {}, close: {} } }, authMethods: [], agentInfo: { name: 'fake-dsh', version: '0' } } });
  }
  if (msg.method === 'session/new') {
    const id = 'sess-' + (readSessions().length + 1);
    remember(id);
    return out({ jsonrpc: '2.0', id: msg.id, result: { sessionId: id, configOptions: configOptions() } });
  }
  if (msg.method === 'session/list') {
    return out({ jsonrpc: '2.0', id: msg.id, result: { sessions: readSessions().slice().reverse().map((id) => ({ sessionId: id, cwd: msg.params.cwd, title: 'fake' })) } });
  }
  if (msg.method === 'session/resume') {
    const known = readSessions().includes(msg.params.sessionId);
    if (process.env.DSH_FAKE_RESUME_FAILS === '1' || !known) {
      return out({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'unknown session' } });
    }
    if (log) append(log, JSON.stringify({ resumed: msg.params.sessionId }) + '\n');
    return out({ jsonrpc: '2.0', id: msg.id, result: { configOptions: configOptions() } });
  }
  if (msg.method === 'session/set_config_option') {
    const { configId, value } = msg.params;
    if (configId === 'model' && modelValues.includes(value)) modelValue = value;
    else if (configId === 'reasoning_effort' && effortValues.includes(value)) effort = value;
    else return out({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'unknown ' + configId } });
    return out({ jsonrpc: '2.0', id: msg.id, result: { configOptions: configOptions() } });
  }
  if (msg.method === 'session/close') {
    out({ jsonrpc: '2.0', id: msg.id, result: {} });
    setTimeout(() => process.exit(0), 10);
    return;
  }
  if (msg.method === 'session/cancel') {
    if (pendingPrompt !== null) {
      out({ jsonrpc: '2.0', id: pendingPrompt, result: { stopReason: 'cancelled' } });
      pendingPrompt = null;
    }
    return;
  }
  if (msg.method === 'session/prompt') {
    const sessionId = msg.params.sessionId;
    pendingPrompt = msg.id;
    const update = (u) => out({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: u } });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'po' } });
    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'weighing it up' } });
    update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Run tests', kind: 'execute', status: 'pending', rawInput: { command: 'npm test' } });
    update({ sessionUpdate: 'usage_update', used: 1234, size: 200000, ...(process.env.DSH_FAKE_NO_COST === '1' ? {} : { cost: { amount: 0.02, currency: 'USD' } }) });
    if (process.env.DSH_FAKE_NO_SETTLE === '1') return;
    if (process.env.DSH_FAKE_NO_PERMISSION === '1') {
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ng' } });
      out({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn' } });
      pendingPrompt = null;
      return;
    }
    pendingPermission = { id: agentRequestId++, promptId: msg.id };
    out({
      jsonrpc: '2.0',
      id: pendingPermission.id,
      method: 'session/request_permission',
      params: {
        sessionId,
        toolCall: { toolCallId: 't1', title: 'Run tests', kind: 'execute', status: 'pending' },
        options: process.env.DSH_FAKE_NO_REJECT === '1'
          ? [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }]
          : process.env.DSH_FAKE_ALWAYS_ONLY === '1'
          ? [{ optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' }, { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }]
          : [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }],
      },
    });
    return;
  }
});
`;

type Fixture = {
  root: string;
  data: string;
  agent: string;
  dsh: string;
  log: string;
  sessions: string;
  answers: string;
  close(): void;
};

/** A temp floor with the fake agent, plus a `dsh` executable that runs it. */
function fixture(): Fixture {
  // realpath: on macOS the temp dir is /var -> /private/var, and the agent reports its real cwd.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'agent-office-dsh-')));
  const data = path.join(root, '.agent-office');
  const agent = path.join(root, 'fake-acp-agent.mjs');
  const dsh = path.join(root, 'dsh');
  const log = path.join(root, 'invocations.jsonl');
  const sessions = path.join(root, 'sessions.txt');
  const answers = path.join(root, 'answers.jsonl');
  mkdirSync(data, { recursive: true });
  writeFileSync(agent, fakeAgent);
  writeFileSync(dsh, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(agent)} "$@"\n`, { mode: 0o700 });
  chmodSync(dsh, 0o700);
  writeFileSync(log, '');
  writeFileSync(answers, '');
  return {
    root,
    data,
    agent,
    dsh,
    log,
    sessions,
    answers,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

type Recorded = {
  statuses: WorkerStatus[];
  output: string;
  actions: (WorkerAction | undefined)[];
  usage: Usage[];
  sessions: string[];
  prompts: string[];
  exits: { code: number | null; error: string | undefined; quiet: boolean }[];
};

function recorder() {
  const state: Recorded = { statuses: [], output: '', actions: [], usage: [], sessions: [], prompts: [], exits: [] };
  return {
    state,
    events: {
      output: (text: string) => {
        state.output += text;
      },
      status: (status: WorkerStatus) => {
        state.statuses.push(status);
      },
      action: (action: WorkerAction | undefined) => {
        state.actions.push(action);
      },
      usage: (usage: Usage) => {
        state.usage.push(usage);
      },
      session: (id: string) => {
        state.sessions.push(id);
      },
      prompted: (text: string) => {
        state.prompts.push(text);
      },
      exit: (code: number | null, error: string | undefined, quiet: boolean) => {
        state.exits.push({ code, error, quiet });
      },
    },
  };
}

function startSession(f: Fixture, launch: Partial<DshLaunch> = {}, env: Record<string, string> = {}) {
  const { state, events } = recorder();
  const session = new DshSession(
    {
      file: process.execPath,
      args: [f.agent],
      cwd: f.root,
      env: { ...process.env, DSH_FAKE_LOG: f.log, DSH_FAKE_SESSIONS: f.sessions, DSH_FAKE_ANSWER: f.answers, ...env },
      ...launch,
    },
    events,
  );
  session.start();
  return { session, state };
}

async function waitFor<T>(read: () => T, predicate: (value: T) => boolean, timeout = 5000): Promise<T> {
  const end = Date.now() + timeout;
  let value = read();
  while (!predicate(value) && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = read();
  }
  assert.ok(predicate(value), `timed out; last value ${JSON.stringify(value)}`);
  return value;
}

/** Every fixture used by a test is closed after it, so a stray child never outlives the suite. */
function tracked(t: { after(fn: () => void): void }): Fixture {
  const f = fixture();
  t.after(() => f.close());
  return f;
}

// ---------------------------------------------------------------------------
// The translation core
// ---------------------------------------------------------------------------

test('ACP tool kinds become the office actions, with the name as a fallback', () => {
  assert.equal(toolKindAction('read', undefined, undefined, undefined), 'read');
  assert.equal(toolKindAction('edit', undefined, undefined, undefined), 'edit');
  assert.equal(toolKindAction('delete', undefined, undefined, undefined), 'edit');
  assert.equal(toolKindAction('move', undefined, undefined, undefined), 'edit');
  assert.equal(toolKindAction('fetch', undefined, undefined, undefined), 'web');
  // execute: the command decides whether it is tests/a build or just looking at things
  assert.equal(toolKindAction('execute', undefined, undefined, { command: 'npm test' }), 'test');
  assert.equal(toolKindAction('execute', undefined, undefined, { command: 'git status' }), 'read');
  assert.equal(toolKindAction('execute', undefined, undefined, { command: 'echo hi' }), undefined);
  assert.equal(toolKindAction('execute', undefined, undefined, undefined), undefined);
  // search: code search reads, a web search browses
  assert.equal(toolKindAction('search', 'grep', 'Search the code', undefined), 'read');
  assert.equal(toolKindAction('search', 'web_search', 'Search the web', undefined), 'web');
  // think / switch_mode / other: nothing to act out
  assert.equal(toolKindAction('think', undefined, undefined, undefined), undefined);
  assert.equal(toolKindAction('other', undefined, undefined, undefined), undefined);
  // no kind at all: the same name-based mapper the other providers use
  assert.equal(toolKindAction(undefined, 'View', undefined, undefined), 'read');
  assert.equal(toolKindAction(undefined, 'Bash', undefined, { command: 'pytest -q' }), 'test');
});

test('context usage maps to the office Usage shape, cost only when the harness sends it', () => {
  const withCost = dshUsage({ used: 1234, size: 200000, cost: { amount: 0.02, currency: 'USD' } });
  assert.equal(withCost?.input, 1234);
  assert.equal(withCost?.totalTokens, 1234);
  assert.equal(withCost?.contextSize, 200000);
  assert.equal(withCost?.cost, 0.02);
  assert.equal(withCost?.costKnown, true);
  assert.equal(withCost?.callsKnown, false);

  const withoutCost = dshUsage({ used: 10, size: 100 });
  assert.equal(withoutCost?.costKnown, false);
  assert.equal(withoutCost?.cost, 0);
  assert.equal(withoutCost?.contextSize, 100);

  assert.equal(dshUsage({ used: 1 }), undefined);
  assert.equal(dshUsage('nonsense'), undefined);
});

test('a permission request offers its choices, and a typed line picks one', () => {
  const params = {
    toolCall: { title: 'Run tests' },
    options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }],
  };
  const options = permissionOptions(params);
  assert.deepEqual(options.map((o) => o.optionId), ['allow-once', 'reject-once']);
  assert.equal(options[0].once, true);
  assert.equal(permissionChoice('1', options)?.optionId, 'allow-once');
  assert.equal(permissionChoice(' allow-once ', options)?.optionId, 'allow-once');
  assert.equal(permissionChoice('Reject', options)?.optionId, 'reject-once');
  assert.equal(permissionChoice('3', options), undefined);
  assert.equal(permissionChoice('', options), undefined);
  const rendered = renderPermission(params, options);
  assert.match(rendered, /Waiting for approval/);
  assert.match(rendered, /Run tests/);
  assert.match(rendered, /Allow once/);
  assert.match(rendered, /Enter allows once, Esc rejects/);
  // junk on the wire is dropped rather than throwing
  assert.deepEqual(permissionOptions({ options: [{ name: 'no id' }, 'x', null] }), []);
});

test('the renderer emits committed lines, tools with their outcome, and skips what it does not know', () => {
  const renderer = new DshRenderer();
  // Text is buffered by line: nothing is written until the line is complete, and it ends CRLF.
  const first = renderer.render({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'po' } });
  assert.equal(first.text, '', 'a partial line is not written yet');
  const complete = renderer.render({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ng\n' } });
  assert.match(complete.text, /pong/);
  assert.ok(complete.text.endsWith('\r\n'), 'every line ends CRLF, so the cursor never drifts');
  assert.ok(!/[^\r]\n/.test(complete.text), 'no bare newline anywhere');
  assert.equal(renderer.render({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'second\n' } }).text.match(/\n/g)?.length, 1);

  // A tool row is the harness's own: an icon, its human title, and the argument it summarizes by.
  const tool = renderer.render({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Run tests', kind: 'execute', rawInput: { command: 'npm test' } });
  assert.match(tool.text, /Bash/);
  assert.match(tool.text, /npm test/, 'the command is what makes a tool row useful');
  assert.match(tool.text, /❯/);
  assert.equal(tool.action, 'test');
  assert.ok(tool.text.endsWith('\r\n'));

  // The harness leaves a finished tool call collapsed, with no check mark: nothing more is printed,
  // and an update carrying only the id never leaks that id into the transcript.
  const done = renderer.render({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
  assert.equal(done.text, '');
  assert.doesNotMatch(done.text, /t1/);

  const failed = renderer.render({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'failed', rawOutput: { message: 'exit code 1' } });
  assert.equal(failed.action, 'failing');
  assert.equal(failed.failed, true);
  assert.match(failed.text, /Bash failed/);
  assert.match(failed.text, /exit code 1/);

  const usage = renderer.render({ sessionUpdate: 'usage_update', used: 5, size: 10 });
  assert.equal(usage.text, '');
  assert.equal(usage.usage?.input, 5);

  for (const unknown of [{ sessionUpdate: 'plan', entries: [] }, { sessionUpdate: 'available_commands_update' }, { nonsense: true }, 'x', null]) {
    assert.equal(renderer.render(unknown).text, '');
  }

  // Reasoning is its own ruled block, and it closes the answer line before it starts.
  const thought = renderer.render({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'weighing\nit up\n' } });
  assert.match(thought.text, /✻ Think/, 'reasoning opens with the chat\'s own Think row');
  assert.match(thought.text, /│ weighing/);
  assert.match(thought.text, /│ it up/);
  assert.match(renderer.endTurn(), /Worked · 1 tool call/, 'the turn ends with the chat\'s process row');
  assert.match(renderer.endTurn('Stopped'), /Stopped/);
});

test('markdown is rendered the way the harness web chat shows it, not printed raw', () => {
  const renderer = new DshRenderer();
  const out: string[] = [];
  const send = (text: string) => out.push(renderer.render({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }).text);
  send('## What it is\n');
  send('A **Tunisian** storefront with `payload` and a [link](https://example.com).\n');
  send('- first item\n');
  send('* second item\n');
  send('> a quote\n');
  send('---\n');
  send('```ts\nconst x: number = 1;\n```\n');
  const text = out.join('');
  assert.doesNotMatch(text, /\*\*/, 'bold markers are gone');
  assert.doesNotMatch(text, /^## /m, 'heading hashes are gone');
  assert.match(text, /What it is/);
  assert.ok(text.includes('\x1b[1m'), 'bold is bold');
  assert.ok(text.includes('\x1b[4m'), 'a heading is underlined');
  assert.ok(text.includes('\x1b[3m') === false, 'nothing here is italic');
  assert.match(text, /\x1b\[48;2;/, 'inline code gets the harness\'s code background');
  assert.ok(text.includes('•') && text.includes('first item'));
  assert.match(text, /│ a quote/);
  assert.ok(!/^- /m.test(text), 'bullets become bullets, not hyphens');
  assert.match(text, /example\.com/, 'a link keeps its target');
  assert.match(text, /const x: number = 1;/, 'code inside a fence is verbatim');
  assert.match(text, /┌─/, 'the fence opens a block');
  assert.match(text, /└─/, 'and closes it');
});

test('nothing the harness sends can drive the office terminal', () => {
  const renderer = new DshRenderer();
  const injected = renderer.render({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'plain\x1b[2Jwiped\x07title\x1b]0;owned\x07\n' },
  });
  assert.doesNotMatch(injected.text, /\x1b\[2J/, 'a screen clear never reaches the terminal');
  assert.doesNotMatch(injected.text, /\x1b\]0;/, 'nor a title change');
  assert.doesNotMatch(injected.text, /\x07/);
  assert.match(injected.text, /plainwipedtitle/);
});

test('8-bit C1 controls and bidi overrides never reach the terminal either', () => {
  const renderer = new DshRenderer();
  // CSI and OSC in their 8-bit forms: xterm acts on them just as on ESC [ and ESC ].
  const injected = renderer.render({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'a\u009b2Ab\u009d0;owned\u009cc\u009d8;;https://evil\u009cd\u202eright-to-left\u2066e\n' },
  });
  assert.doesNotMatch(injected.text, /[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/);
  // The same goes for a failing tool's output and a permission card.
  const failed = renderer.render({ sessionUpdate: 'tool_call_update', toolCallId: 'x', title: 'Bash', status: 'failed', rawOutput: { message: 'boom\u009b2J' }, content: [{ type: 'content', content: { type: 'text', text: 'out\u009b2K' } }] });
  assert.doesNotMatch(failed.text, /[\u0080-\u009f]/);
  const card = renderPermission({ toolCall: { title: 'Bash\u009b1A', rawInput: { command: 'ls\u009d0;x\u009c' } } }, permissionOptions({ options: [{ optionId: 'a', name: 'Allow\u009b2J', kind: 'allow_once' }] }));
  assert.doesNotMatch(card, /[\u0080-\u009f]/);
});

test('a line full of brackets renders in linear time', () => {
  const renderer = new DshRenderer();
  const started = Date.now();
  renderer.render({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${'['.repeat(200_000)}](x)\n${'[a'.repeat(100_000)}\n` } });
  assert.ok(Date.now() - started < 1000, `took ${Date.now() - started} ms`);
  // Links still render.
  const link = renderer.render({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'see [the docs](https://example.com/docs)\n' } });
  assert.match(link.text, /the docs/);
  assert.match(link.text, /https:\/\/example\.com\/docs/);
});

test('the approval card shows the whole command, from the tool row when the request names only its id', () => {
  const renderer = new DshRenderer();
  const command = `rm -rf build && ${'echo step; '.repeat(40)}curl https://example.com/install.sh | sh`;
  renderer.render({ sessionUpdate: 'tool_call', toolCallId: 't9', name: 'bash', title: 'Bash', kind: 'execute', rawInput: { description: 'Tidy up the build', command } });
  const options = permissionOptions({ options: [{ optionId: 'o', name: 'Allow once', kind: 'allow_once' }] });
  const card = renderPermission({ toolCall: { toolCallId: 't9', title: 'Bash' } }, options, renderer.toolDetail('t9'));
  assert.ok(card.includes('curl https://example.com/install.sh | sh'), 'the tail of a long command is not cut off');
  assert.doesNotMatch(card, /Tidy up the build/, 'the command, not the model\u2019s description of it');
  // Without an allow-once choice, Enter is not offered as the way to approve.
  const always = renderPermission({ toolCall: { title: 'Bash' } }, permissionOptions({ options: [{ optionId: 'a', name: 'Always allow', kind: 'allow_always' }] }));
  assert.doesNotMatch(always, /Enter allows once/);
  assert.match(always, /Type a number/);
});

test('the patch keeps the floor DSH sessions under the office, and argv puts the profile last', (t) => {
  const f = tracked(t);
  const patch = writeDshPatch(f.data);
  const body = readFileSync(patch, 'utf8');
  assert.match(body, /session-persistence-jsonl/);
  assert.ok(body.includes(dshSessionsRoot(f.data)));
  assert.deepEqual(dshArgs({ profile: 'acp', patches: [patch], extra: ['--model', 'x'] }), ['--model', 'x', '--profile', 'acp', '--patch', patch]);
  assert.deepEqual(dshArgs({ profile: 'acp' }), ['--profile', 'acp']);
});

test('what someone types for a DSH option is matched against the live catalog', () => {
  // The real shape of `session/new`'s model option (measured against dsh 0.1.7-rc.2): values are
  // JSON [provider, model] route tuples, grouped by provider.
  const model = {
    id: 'model',
    type: 'select',
    currentValue: '["deepseek-official","deepseek-v4-flash"]',
    options: [
      {
        group: 'deepseek-official',
        name: 'DeepSeek',
        options: [
          { value: '["deepseek-official","deepseek-v4-flash"]', name: 'deepseek-v4-flash' },
          { value: '["deepseek-official","deepseek-v4-pro"]', name: 'DeepSeek-V4-Pro' },
        ],
      },
    ],
  };
  const values = configOptionValues(model);
  assert.deepEqual(values.map((v) => v.name), ['deepseek-v4-flash', 'DeepSeek-V4-Pro'], 'grouped options are flattened');
  // The exact advertised value wins.
  assert.equal(resolveConfigValue('["deepseek-official","deepseek-v4-pro"]', model), '["deepseek-official","deepseek-v4-pro"]');
  // So does the bare model name a person would actually type.
  assert.equal(resolveConfigValue('deepseek-v4-pro', model), '["deepseek-official","deepseek-v4-pro"]');
  assert.equal(resolveConfigValue('  DeepSeek-V4-Pro ', model), '["deepseek-official","deepseek-v4-pro"]', 'the label matches too');
  // Something the catalog has never heard of is passed through for the harness to reject.
  assert.equal(resolveConfigValue('no-such-model', model), 'no-such-model');
  assert.equal(resolveConfigValue('anything', undefined), 'anything');
});

test('the office effort levels land on the rungs DSH actually has', () => {
  // Measured: off, low, high, max (no medium, no xhigh).
  assert.equal(dshEffort('low'), 'low');
  assert.equal(dshEffort('medium'), 'high');
  assert.equal(dshEffort('high'), 'high');
  assert.equal(dshEffort('xhigh'), 'max');
  assert.equal(dshEffort('max'), 'max');
  const effort = { id: 'reasoning_effort', type: 'select', currentValue: 'high', options: [{ value: 'off', name: 'Off' }, { value: 'low', name: 'Low' }, { value: 'high', name: 'High' }, { value: 'max', name: 'Max' }] };
  assert.equal(resolveConfigValue(dshEffort('xhigh'), effort), 'max');
});

// ---------------------------------------------------------------------------
// The session, against a real child process
// ---------------------------------------------------------------------------

test('a session initializes, creates one, and applies the model and effort it was given', async (t) => {
  const f = tracked(t);
  // The office stores/asks for the friendly name; the wire wants the advertised route tuple.
  const { session, state } = startSession(f, { model: 'Fake Pro', effort: 'xhigh' });
  t.after(() => session.close());

  await waitFor(() => state.statuses, (s) => s.includes('idle'));
  assert.deepEqual(state.sessions, ['sess-1']);
  await waitFor(() => state.output, (o) => o.includes('model → ["fake-provider","fake-pro"]'));
  assert.match(state.output, /reasoning_effort → max/, 'xhigh lands on DSH\'s top rung');
  assert.doesNotMatch(state.output, /was not accepted/);
  // The office's environment reaches the child.
  const invocation = JSON.parse(readFileSync(f.log, 'utf8').trim().split('\n')[0]) as { profile?: string; cwd?: string };
  assert.equal(invocation.profile, undefined, 'profile comes from argv, not the environment, unless the office sets it');
});

test('a stale saved model degrades to the profile default instead of failing the launch', async (t) => {
  const f = tracked(t);
  const { session, state } = startSession(f, { model: 'no-such-model' });
  t.after(() => session.close());

  await waitFor(() => state.output, (o) => o.includes('was not accepted'));
  await waitFor(() => state.statuses, (s) => s.includes('idle'));
  assert.deepEqual(state.sessions, ['sess-1']);
});

test('a prompt works, raises needs_input on a permission request, and answers it from the terminal', async (t) => {
  const f = tracked(t);
  const { session, state } = startSession(f);
  t.after(() => session.close());
  await waitFor(() => state.statuses, (s) => s.includes('idle'));

  session.prompt('run the tests');
  await waitFor(() => state.statuses, (s) => s.includes('needs_input'));
  assert.ok(state.statuses.includes('working'), 'a prompt in flight is working');
  assert.match(state.output, /Waiting for approval/);
  assert.match(state.output, /Run tests/);
  assert.ok(state.actions.includes('test'), 'the execute tool call is acted out as a test run');

  // The person types "1" and presses Enter in the worker's terminal.
  session.writeInput('1\r');
  await waitFor(() => state.statuses, (s) => s.includes('done'));
  const answer = JSON.parse(readFileSync(f.answers, 'utf8').trim().split('\n')[0]) as { outcome: { outcome: string; optionId?: string } };
  assert.equal(answer.outcome.outcome, 'selected');
  assert.equal(answer.outcome.optionId, 'allow-once');
  assert.match(state.output, /permission answered: allow-once/);

  // Context usage came off the wire, with the cumulative cost the harness supplied.
  await waitFor(() => state.usage, (u) => u.length > 0);
  assert.equal(state.usage.at(-1)?.contextSize, 200000);
  assert.equal(state.usage.at(-1)?.costKnown, true);
  assert.equal(state.usage.at(-1)?.cost, 0.02);
  assert.ok(state.actions.includes('failing') === false, 'a completed tool call is not a failure');
});

test('Escape cancels a turn that is waiting on a person', async (t) => {
  const f = tracked(t);
  const { session, state } = startSession(f, {}, { DSH_FAKE_NO_SETTLE: '1' });
  t.after(() => session.close());
  await waitFor(() => state.statuses, (s) => s.includes('idle'));

  session.prompt('something long');
  await waitFor(() => state.statuses, (s) => s.includes('working'));
  session.writeInput('\x1b');
  await waitFor(() => state.statuses, (s) => s.includes('done'));
  assert.match(state.output, /cancelled/);
});

test('Escape rejects an approval, and an empty Enter allows once, the way the harness binds them', async (t) => {
  const f = tracked(t);
  const { session, state } = startSession(f);
  t.after(() => session.close());
  await waitFor(() => state.statuses, (s) => s.includes('idle'));

  session.prompt('run the tests');
  await waitFor(() => state.statuses, (s) => s.includes('needs_input'));
  session.writeInput('\x1b');
  await waitFor(() => state.statuses, (s) => s.includes('done'));
  const rejected = JSON.parse(readFileSync(f.answers, 'utf8').trim().split('\n')[0]) as { outcome: { outcome: string; optionId?: string } };
  assert.equal(rejected.outcome.outcome, 'selected');
  assert.equal(rejected.outcome.optionId, 'reject-once', 'Escape is the Reject button');

  // Enter on an empty line is Allow once.
  const second = startSession(f);
  t.after(() => second.session.close());
  await waitFor(() => second.state.statuses, (s) => s.includes('idle'));
  second.session.prompt('run the tests again');
  await waitFor(() => second.state.statuses, (s) => s.includes('needs_input'));
  second.session.writeInput('\r');
  await waitFor(() => second.state.statuses, (s) => s.includes('done'));
  const lines = readFileSync(f.answers, 'utf8').trim().split('\n');
  const allowed = JSON.parse(lines[lines.length - 1]) as { outcome: { outcome: string; optionId?: string } };
  assert.equal(allowed.outcome.optionId, 'allow-once');
});

test('Enter never grants more than allow once, and a pasted blank line answers nothing', async (t) => {
  const f = tracked(t);
  const { session, state } = startSession(f, {}, { DSH_FAKE_ALWAYS_ONLY: '1' });
  t.after(() => session.close());
  await waitFor(() => state.statuses, (s) => s.includes('idle'));

  session.prompt('run the tests');
  await waitFor(() => state.statuses, (s) => s.includes('needs_input'));
  // Only "always allow" is on offer: Enter asks for a number instead of picking it.
  session.writeInput('\r');
  await waitFor(() => state.output, (o) => o.includes('no allow-once choice here'));
  // A paste with blank lines in it is typing, not a stack of Enter presses.
  session.writeInput('some pasted text\r\r\r');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(readFileSync(f.answers, 'utf8').trim(), '', 'nothing was answered');
  assert.equal(state.statuses[state.statuses.length - 1], 'needs_input');
  session.writeInput('\x1b');
  await waitFor(() => state.statuses, (s) => s.includes('done'));
  const answer = JSON.parse(readFileSync(f.answers, 'utf8').trim().split('\n')[0]) as { outcome: { optionId?: string } };
  assert.equal(answer.outcome.optionId, 'reject-once');
});

test('the office prompt and typed keys are echoed without escape sequences', async (t) => {
  const f = tracked(t);
  const { session, state } = startSession(f, {}, { DSH_FAKE_NO_PERMISSION: '1' });
  t.after(() => session.close());
  await waitFor(() => state.statuses, (s) => s.includes('idle'));
  session.prompt('fix \x1b]0;owned\x07it\nand \u009b2Jthis');
  await waitFor(() => state.statuses, (s) => s.includes('done'));
  const echoed = state.output.slice(state.output.indexOf('fix '));
  assert.doesNotMatch(echoed, /\x1b\]0;|\x07|\u009b/);
  assert.match(echoed, /fix it\r\n {2}and 2Jthis/);
  const before = state.output.length;
  session.writeInput('a');
  session.writeInput('\u009b');
  session.writeInput('b\u202ec');
  assert.equal(state.output.slice(before), 'abc');
});

test('an approval with no reject choice is cancelled when Escape is pressed', async (t) => {
  const f = tracked(t);
  const { session, state } = startSession(f, {}, { DSH_FAKE_NO_REJECT: '1' });
  t.after(() => session.close());
  await waitFor(() => state.statuses, (s) => s.includes('idle'));

  session.prompt('run the tests');
  await waitFor(() => state.statuses, (s) => s.includes('needs_input'));
  session.writeInput('\x1b');
  await waitFor(() => state.statuses, (s) => s.includes('done'));
  const answer = JSON.parse(readFileSync(f.answers, 'utf8').trim().split('\n')[0]) as { outcome: { outcome: string } };
  assert.equal(answer.outcome.outcome, 'cancelled');
});

test('a restart resumes the session the agent remembers, and falls back when it cannot', async (t) => {
  const f = tracked(t);
  const first = startSession(f);
  await waitFor(() => first.state.sessions, (s) => s.length === 1);
  first.session.close();
  await waitFor(() => first.state.exits, (e) => e.length > 0);

  // A second process: the fake remembers sess-1, so the office picks it back up.
  const second = startSession(f, { resumeSessionId: 'sess-1' });
  t.after(() => second.session.close());
  await waitFor(() => second.state.output, (o) => o.includes('resumed session sess-1'));
  assert.deepEqual(second.state.sessions, ['sess-1']);

  // An agent that no longer has it: a fresh session, not a dead worker.
  const third = startSession(f, { resumeSessionId: 'sess-1' }, { DSH_FAKE_RESUME_FAILS: '1' });
  t.after(() => third.session.close());
  await waitFor(() => third.state.output, (o) => o.includes('could not resume session sess-1'));
  await waitFor(() => third.state.statuses, (s) => s.includes('idle'));
  assert.equal(third.state.sessions.length, 1);
  assert.notEqual(third.state.sessions[0], 'sess-1');
});

test('a fresh hire starts its own session, never the newest one another desk left in the checkout', async (t) => {
  const f = tracked(t);
  const first = startSession(f);
  await waitFor(() => first.state.sessions, (s) => s.length === 1);
  first.session.close();
  await waitFor(() => first.state.exits, (e) => e.length > 0);

  const second = startSession(f);
  t.after(() => second.session.close());
  await waitFor(() => second.state.statuses, (s) => s.includes('idle'));
  assert.equal(second.state.sessions.length, 1);
  assert.notEqual(second.state.sessions[0], 'sess-1');
  assert.doesNotMatch(second.state.output, /resumed session/);
  assert.doesNotMatch(readFileSync(f.log, 'utf8'), /"resumed"/);
});

test('a second prompt while one is running is refused, not queued silently', async (t) => {
  const f = tracked(t);
  const { session, state } = startSession(f, {}, { DSH_FAKE_NO_SETTLE: '1' });
  t.after(() => session.close());
  await waitFor(() => state.statuses, (s) => s.includes('idle'));

  session.prompt('first');
  await waitFor(() => state.statuses, (s) => s.includes('working'));
  session.prompt('second');
  assert.match(state.output, /one prompt at a time/);
});

test('a line typed into the terminal is echoed, submitted as one prompt, and reported to the office', async (t) => {
  const f = tracked(t);
  const { session, state } = startSession(f, {}, { DSH_FAKE_NO_PERMISSION: '1' });
  t.after(() => session.close());
  await waitFor(() => state.statuses, (s) => s.includes('idle'));

  // ACP has no terminal: the session echoes what is typed and only submits on Enter.
  session.writeInput('fix the');
  assert.equal(state.prompts.length, 0, 'nothing is submitted until Enter');
  session.writeInput(' login');
  session.writeInput('x\x7f'); // backspace
  session.writeInput('\r');
  await waitFor(() => state.prompts, (p) => p.length === 1);
  assert.deepEqual(state.prompts, ['fix the login']);
  assert.match(state.output, /fix the login/);
  await waitFor(() => state.statuses, (s) => s.includes('done'));
});

// ---------------------------------------------------------------------------
// The office wiring
// ---------------------------------------------------------------------------

function workerEvents(updates: WorkerInfo[]): WorkerEvents {
  return { update: (info) => updates.push(info), remove() {}, data() {}, screen() {}, toast() {} };
}

function manager(f: Fixture, updates: WorkerInfo[]) {
  return new WorkerManager(f.root, f.data, f.dsh, [], { url: 'http://127.0.0.1:1', token: '' }, workerEvents(updates), new Ledger(f.data, { pauseHiring: false }, () => {}, () => {}));
}

/**
 * The fake agent reads where to record things from the environment, which it inherits from the
 * office process. Each test points those at its own fixture and puts them back afterwards, so one
 * test's deleted temp dir is never another test's log path.
 */
function pointFakeAt(t: { after(fn: () => void): void }, f: Fixture) {
  const keys = ['DSH_FAKE_LOG', 'DSH_FAKE_SESSIONS', 'DSH_FAKE_ANSWER'] as const;
  const previous = keys.map((key) => [key, process.env[key]] as const);
  process.env.DSH_FAKE_LOG = f.log;
  process.env.DSH_FAKE_SESSIONS = f.sessions;
  process.env.DSH_FAKE_ANSWER = f.answers;
  t.after(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

/** A manager owns timers and a child process: every test that makes one takes it down again. */
function supervised(t: { after(fn: () => void): void }, f: Fixture, updates: WorkerInfo[]) {
  pointFakeAt(t, f);
  const mgr = manager(f, updates);
  t.after(() => mgr.shutdown(false));
  return mgr;
}

test('the office hires a DSH worker over ACP, and its desk shows the work', async (t) => {
  const f = tracked(t);
  const updates: WorkerInfo[] = [];
  const mgr = supervised(t, f, updates);

  const spawned = mgr.spawn('desk-1', 'tester', 'run the tests');
  assert.equal(typeof spawned, 'object', typeof spawned === 'string' ? spawned : '');
  const id = (spawned as WorkerInfo).id;

  await waitFor(() => mgr.get(id)?.sessionId, (s) => s === 'sess-1');
  await waitFor(() => mgr.get(id)?.status, (s) => s === 'needs_input');
  assert.equal(mgr.get(id)?.provider, 'dsh');

  // The office ran `dsh --profile acp --patch <the floor's patch>`, with the ACP env.
  const invocation = JSON.parse(readFileSync(f.log, 'utf8').trim().split('\n')[0]) as { argv: string[]; profile?: string; workerId?: string; cwd?: string };
  assert.deepEqual(invocation.argv.slice(0, 2), ['--profile', 'acp']);
  assert.equal(invocation.argv[2], '--patch');
  assert.ok(invocation.argv[3].endsWith('dsh-patch.yml'));
  assert.equal(invocation.cwd, f.root);
  assert.equal(invocation.workerId, id);
  assert.equal(invocation.profile, 'acp', 'the office tells the child which profile it booted');

  // The patch keeps this floor's sessions in the office's own directory.
  const patch = readFileSync(path.join(f.data, 'dsh-patch.yml'), 'utf8');
  assert.ok(patch.includes(dshSessionsRoot(f.data)));

  // Answering the permission from the terminal finishes the turn at the desk.
  mgr.write(id, '1\r', 'tester');
  await waitFor(() => mgr.get(id)?.status, (s) => s === 'done');

  // Usage and the session id survive in the floor's state file.
  await waitFor(() => mgr.get(id)?.usage, (u) => u !== undefined);
  assert.equal(mgr.get(id)?.usage?.contextSize, 200000);
  const saved = JSON.parse(readFileSync(path.join(f.data, 'workers.json'), 'utf8')) as { provider?: string; sessionId?: string; usage?: { contextSize?: number } }[];
  const row = saved.find((s) => s.provider === 'dsh');
  assert.equal(row?.sessionId, 'sess-1');
  assert.equal(row?.usage?.contextSize, 200000);
});

test('a DSH worker comes back offline after a restart, then resumes its session', async (t) => {
  const f = tracked(t);
  const first = supervised(t, f, []);
  const spawned = first.spawn('desk-1', 'tester', 'run the tests') as WorkerInfo;
  const id = spawned.id;
  await waitFor(() => first.get(id)?.sessionId, (s) => s === 'sess-1');
  await waitFor(() => first.get(id)?.status, (s) => s === 'needs_input');
  first.write(id, '1\r', 'tester');
  await waitFor(() => first.get(id)?.status, (s) => s === 'done');

  // The office goes down. A DSH child dies with it, so nothing is left running.
  first.shutdown(true);
  const afterShutdown = JSON.parse(readFileSync(path.join(f.data, 'workers.json'), 'utf8')) as { provider?: string; pty?: unknown }[];
  assert.equal(afterShutdown.find((s) => s.provider === 'dsh')?.pty, undefined, 'a DSH worker is not a hosted terminal claim to pick back up');

  // The next office finds it offline, with the session and its usage still on the card.
  const second = supervised(t, f, []);
  const restored = second.get(id);
  assert.equal(restored?.provider, 'dsh');
  assert.equal(restored?.status, 'offline');
  assert.equal(restored?.sessionId, 'sess-1');
  assert.equal(restored?.usage?.contextSize, 200000);
  assert.ok(!existsSync(path.join(f.data, 'pty-host.json')), 'the office ran no PTY host for a DSH worker');

  // R: it resumes the remembered session instead of starting a new conversation, and waits for
  // the next prompt (the doc's R affordance, the same as an exited Claude worker).
  assert.equal(second.resume(id), undefined);
  await waitFor(() => readFileSync(f.log, 'utf8'), (text) => text.includes('"resumed":"sess-1"'));
  await waitFor(() => second.get(id)?.status, (s) => s === 'idle');
  assert.match(second.get(id)?.sessionId ?? '', /^sess-1$/);
});

test('a DSH board agent proves itself with its token, and a second question goes to its running session', async (t) => {
  const f = tracked(t);
  const mgr = supervised(t, f, []);
  const asked = mgr.station('station-issues', 'tester', 'which issues are stale?');
  assert.equal(typeof asked, 'object', typeof asked === 'string' ? asked : '');
  const { info, hired } = asked as { info: WorkerInfo; hired: boolean };
  assert.equal(hired, true);
  const id = info.id;
  await waitFor(() => mgr.get(id)?.status, (s) => s === 'needs_input');
  mgr.write(id, '1\r', 'tester');
  await waitFor(() => mgr.get(id)?.status, (s) => s === 'done');

  // office-queue authenticates with the token the office handed the child, though there is no PTY.
  const saved = JSON.parse(readFileSync(path.join(f.data, 'workers.json'), 'utf8')) as { id: string; hookToken?: string }[];
  const token = saved.find((s) => s.id === id)?.hookToken ?? '';
  assert.ok(token);
  assert.equal(mgr.authenticate(id, token)?.id, id);
  assert.equal(mgr.authenticate(id, 'not-the-token'), undefined);

  // Asked again, the running agent gets the prompt; it is not "resumed" into an error.
  const again = mgr.station('station-issues', 'tester', 'and the oldest one?');
  assert.equal(typeof again, 'object', typeof again === 'string' ? again : '');
  assert.equal((again as { hired: boolean }).hired, false);
  await waitFor(() => mgr.get(id)?.status, (s) => s === 'needs_input');
});

test('a DSH terminal fits the window it is shown in, though the agent has no size', async (t) => {
  const f = tracked(t);
  const mgr = supervised(t, f, []);
  const id = (mgr.spawn('desk-1', 'tester', 'run the tests') as WorkerInfo).id;
  await waitFor(() => mgr.get(id)?.status, (s) => s === 'needs_input');
  mgr.resize(id, 120, 48);
  assert.equal(mgr.get(id)?.cols, 120);
  assert.equal(mgr.get(id)?.rows, 48);
});
