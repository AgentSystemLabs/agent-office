import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CURSOR_HOOK_EVENTS,
  addCursorHooks,
  cursorBlocked,
  normalizeCursorHook,
  removeCursorHooks,
  withoutCursorLaunchArgs,
  writeCursorHook,
} from '../src/server/cursor.js';
import { isValidCursorModel } from '../src/shared/providers.js';

function scratch(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-cursor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const hooksFile = (cwd: string) => path.join(cwd, '.cursor', 'hooks.json');
const readHooks = (cwd: string) => JSON.parse(readFileSync(hooksFile(cwd), 'utf8')) as { version: number; hooks: Record<string, { command: string; timeout?: number }[]> };

test('maps Cursor hook events onto the lifecycle, keeping only bounded root fields', () => {
  assert.deepEqual(normalizeCursorHook('sessionStart', {
    conversation_id: 'chat-1', session_id: 'chat-1', model: 'gpt-5', composer_mode: 'agent', is_background_agent: false, transcript_path: '/secret',
  }), { sessionId: 'chat-1', event: 'SessionStart' });
  assert.deepEqual(normalizeCursorHook('beforeSubmitPrompt', {
    conversation_id: 'chat-1', prompt: '  fix the login  ', attachments: [{ file_path: '/secret' }],
  }), { sessionId: 'chat-1', event: 'UserPromptSubmit', prompt: 'fix the login' });
  assert.deepEqual(normalizeCursorHook('preToolUse', {
    conversation_id: 'chat-1', tool_name: 'Shell', tool_use_id: 'tool-1', tool_input: { command: 'cat .env' }, agent_message: 'private',
  }), { sessionId: 'chat-1', event: 'PreToolUse', tool: 'Shell', toolUseId: 'tool-1' });
  assert.deepEqual(normalizeCursorHook('postToolUse', {
    conversation_id: 'chat-1', tool_name: 'Shell', tool_use_id: 'tool-1', tool_output: 'private',
  }), { sessionId: 'chat-1', event: 'PostToolUse', tool: 'Shell', toolUseId: 'tool-1' });
  assert.deepEqual(normalizeCursorHook('postToolUseFailure', {
    conversation_id: 'chat-1', tool_name: 'Shell', failure_type: 'permission_denied', error_message: 'private',
  }), { sessionId: 'chat-1', event: 'PostToolUseFailure', tool: 'Shell' });
  assert.deepEqual(normalizeCursorHook('stop', { session_id: 'chat-1', status: 'completed', loop_count: 0 }), { sessionId: 'chat-1', event: 'Stop' });
});

test('rejects unknown, malformed, child-scoped and unsafe Cursor events', () => {
  assert.equal(normalizeCursorHook('afterAgentResponse', { conversation_id: 'chat-1', text: 'private' }), undefined);
  assert.equal(normalizeCursorHook('Stop', { conversation_id: 'chat-1' }), undefined);
  assert.equal(normalizeCursorHook('stop', null), undefined);
  assert.equal(normalizeCursorHook('stop', {}), undefined);
  assert.equal(normalizeCursorHook('stop', { conversation_id: '' }), undefined);
  assert.equal(normalizeCursorHook('stop', { conversation_id: 'x'.repeat(129) }), undefined);
  assert.equal(normalizeCursorHook('stop', { conversation_id: 'chat-1', subagent_id: 'child-1' }), undefined);
  assert.equal(normalizeCursorHook('preToolUse', { conversation_id: 'chat-1', parent_conversation_id: 'chat-0' }), undefined);
  assert.equal(normalizeCursorHook('sessionStart', { conversation_id: 'chat-1', is_background_agent: true }), undefined);
  // A chat id goes back on the command line when the worker is resumed: nothing that reads as a flag.
  assert.equal(normalizeCursorHook('sessionStart', { conversation_id: '--force' }), undefined);
  assert.equal(normalizeCursorHook('sessionStart', { conversation_id: 'chat 1' }), undefined);
});

test('strips launch flags the office sets itself and the ones that skip permission prompts', () => {
  assert.deepEqual(
    withoutCursorLaunchArgs(['--keep', 'yes', '--model', 'gpt-5', '--force', '-f', '--yolo', '--trust', '--resume', 'abc', '--continue', '-p', '--output-format', 'json', '--workspace=/x', '-w', '--mode', 'plan']),
    ['--keep', 'yes', '--mode', 'plan'],
  );
  assert.deepEqual(withoutCursorLaunchArgs(['--resume', '--sandbox', 'enabled', '--', 'a prompt']), ['--sandbox', 'enabled']);
});

test('Cursor model ids are checked before they reach the command line', () => {
  for (const ok of ['gpt-5', 'sonnet-4-thinking', 'composer-2.5', 'claude-opus-4-8[context=1m,effort=high,fast=false]']) assert.equal(isValidCursorModel(ok), true, ok);
  for (const bad of ['', '--force', '-m', 'gpt 5', 'gpt-5[effort]', 'gpt-5[effort=high', 'gpt-5]', 'a/b', 'gpt-5;rm', 'gpt\u00005', 'x'.repeat(129), 42, undefined]) {
    assert.equal(isValidCursorModel(bad), false, String(bad));
  }
});

test('reads the login screen off the terminal', () => {
  assert.match(cursorBlocked('  v2026.09.08-6caf4ff\n  Press any key to log in...') ?? '', /signed in/);
  assert.equal(cursorBlocked('→ Add a follow-up'), undefined);
});

test('puts a worker\'s hooks in its folder and takes the file away with them', (t) => {
  const dir = scratch(t);
  const cwd = path.join(dir, 'worktree');
  mkdirSync(cwd);
  execFileSync('git', ['init', '-q', cwd]);
  const hook = writeCursorHook(path.join(dir, 'data'));
  assert.equal(addCursorHooks(cwd, hook, 'abc123'), true);
  const written = readHooks(cwd);
  assert.equal(written.version, 1);
  assert.deepEqual(Object.keys(written.hooks), Object.keys(CURSOR_HOOK_EVENTS));
  for (const [event, entries] of Object.entries(written.hooks)) {
    assert.equal(entries.length, 1);
    assert.ok(entries[0].command.includes(hook));
    assert.ok(entries[0].command.endsWith(` '${event}' 'abc123'`));
    assert.equal(entries[0].timeout, 5);
  }
  // The office made it, so it's no change of the worker's.
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }), '');
  // Starting again doesn't double them.
  assert.equal(addCursorHooks(cwd, hook, 'abc123'), true);
  assert.equal(readHooks(cwd).hooks.stop.length, 1);
  removeCursorHooks(cwd, 'abc123');
  assert.equal(existsSync(hooksFile(cwd)), false);
  assert.equal(existsSync(path.join(cwd, '.cursor')), false);
  // Nothing there: nothing to do.
  removeCursorHooks(cwd, 'abc123');
});

test('workers sharing a folder each keep their own entries', (t) => {
  const dir = scratch(t);
  const hook = writeCursorHook(path.join(dir, 'data'));
  assert.equal(addCursorHooks(dir, hook, 'worker-a'), true);
  assert.equal(addCursorHooks(dir, hook, 'worker-b'), true);
  assert.deepEqual(readHooks(dir).hooks.stop.map((e) => e.command.split(' ').at(-1)), ["'worker-a'", "'worker-b'"]);
  removeCursorHooks(dir, 'worker-a');
  assert.deepEqual(readHooks(dir).hooks.stop.map((e) => e.command.split(' ').at(-1)), ["'worker-b'"]);
  removeCursorHooks(dir, 'worker-b');
  assert.equal(existsSync(hooksFile(dir)), false);
});

test('a project\'s own hooks.json keeps its hooks and comes back byte for byte', (t) => {
  const dir = scratch(t);
  const hook = writeCursorHook(path.join(dir, 'data'));
  mkdirSync(path.join(dir, '.cursor'));
  writeFileSync(path.join(dir, '.cursor', 'rules.md'), 'be kind\n');
  const original = '{\n\t"version": 1,\n\t"hooks": {\n\t\t"stop": [{ "command": "./notify.sh" }],\n\t\t"afterFileEdit": [{ "command": "./format.sh" }]\n\t}\n}';
  writeFileSync(hooksFile(dir), original);
  assert.equal(addCursorHooks(dir, hook, 'abc123'), true);
  const merged = readHooks(dir);
  assert.equal(merged.hooks.stop.length, 2);
  assert.equal(merged.hooks.stop[0].command, './notify.sh');
  assert.equal(merged.hooks.afterFileEdit.length, 1);
  assert.equal(merged.hooks.sessionStart.length, 1);
  removeCursorHooks(dir, 'abc123');
  assert.equal(readFileSync(hooksFile(dir), 'utf8'), original);

  // Changed by the project while the worker ran: its change stays, laid out as the file was.
  assert.equal(addCursorHooks(dir, hook, 'abc123'), true);
  const edited = readHooks(dir);
  edited.hooks.afterFileEdit.push({ command: './lint.sh' });
  writeFileSync(hooksFile(dir), JSON.stringify(edited, null, '\t'));
  removeCursorHooks(dir, 'abc123');
  const after = readFileSync(hooksFile(dir), 'utf8');
  assert.deepEqual(JSON.parse(after), { version: 1, hooks: { stop: [{ command: './notify.sh' }], afterFileEdit: [{ command: './format.sh' }, { command: './lint.sh' }] } });
  assert.match(after, /^\{\n\t"version"/);
  assert.equal(after.endsWith('\n'), false);
  assert.equal(existsSync(path.join(dir, '.cursor', 'rules.md')), true);
});

test('a hooks.json the office cannot read is left alone', (t) => {
  const dir = scratch(t);
  const hook = writeCursorHook(path.join(dir, 'data'));
  mkdirSync(path.join(dir, '.cursor'));
  const jsonc = '{\n  // our hooks\n  "version": 1,\n  "hooks": {}\n}\n';
  writeFileSync(hooksFile(dir), jsonc);
  assert.equal(addCursorHooks(dir, hook, 'abc123'), false);
  removeCursorHooks(dir, 'abc123');
  assert.equal(readFileSync(hooksFile(dir), 'utf8'), jsonc);
  assert.equal(addCursorHooks(dir, hook, "bad'id"), false);
});

/** Runs the helper as Cursor would for one hook, and says what the office's hook server got. */
async function runHelper(t: { after(fn: () => void): void }, argv: string[], env: Record<string, string>, input: unknown) {
  const dir = scratch(t);
  const received: { url?: string; authorization?: string; body?: unknown }[] = [];
  const server = createServer((req, res) => {
    // Only the helper posts here. A running office looks at every new local port (its Services list) with a GET.
    if (req.method !== 'POST') return void res.writeHead(404).end();
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ url: req.url, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const child = spawn(process.execPath, [writeCursorHook(dir), ...argv], {
      env: { PATH: process.env.PATH, AGENT_OFFICE_HOOK_URL: `http://127.0.0.1:${address.port}`, AGENT_OFFICE_HOOK_TOKEN: 'hook-token', ...env },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const stdout = await new Promise<string>((resolve, reject) => {
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.on('error', reject);
      child.on('close', () => resolve(output));
      child.stdin.end(JSON.stringify(input));
    });
    return { stdout, received };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('helper forwards only the bounded root event fields to the authenticated bridge', async (t) => {
  const source = readFileSync(writeCursorHook(scratch(t)), 'utf8');
  assert.match(source, /AGENT_OFFICE_HOOK_TOKEN/);
  assert.doesNotMatch(source, /readFile|readSync|createReadStream|permission/);
  const prompt = await runHelper(t, ['beforeSubmitPrompt', 'worker-1'], { AGENT_OFFICE_WORKER_ID: 'worker-1' }, {
    conversation_id: 'chat-1', generation_id: 'gen-1', prompt: 'fix it', attachments: [{ file_path: '/private' }], user_email: 'me@example.com', transcript_path: '/private',
  });
  // No decision of its own: Cursor's permission prompts are as they'd be without it.
  assert.equal(prompt.stdout, '{}');
  assert.deepEqual(prompt.received, [{
    url: '/hooks/cursor?worker=worker-1&event=beforeSubmitPrompt',
    authorization: 'Bearer hook-token',
    body: { conversation_id: 'chat-1', hook_event_name: 'beforeSubmitPrompt', prompt: 'fix it' },
  }]);
  const tool = await runHelper(t, ['preToolUse', 'worker-1'], { AGENT_OFFICE_WORKER_ID: 'worker-1' }, {
    conversation_id: 'chat-1', tool_name: 'Shell', tool_use_id: 'tool-1', tool_input: { command: 'cat .env' }, agent_message: 'private',
  });
  assert.equal(tool.stdout, '{}');
  assert.deepEqual(tool.received.map((r) => r.body), [{ conversation_id: 'chat-1', hook_event_name: 'preToolUse', tool_name: 'Shell', tool_use_id: 'tool-1' }]);
});

test('helper stays quiet for another worker, a person\'s own Cursor session, a subagent and unknown events', async (t) => {
  const payload = { conversation_id: 'chat-1' };
  for (const [argv, env, input] of [
    [['stop', 'worker-1'], { AGENT_OFFICE_WORKER_ID: 'worker-2' }, payload],
    [['stop', 'worker-1'], {}, payload],
    [['stop', 'worker-1'], { AGENT_OFFICE_WORKER_ID: 'worker-1' }, { ...payload, subagent_id: 'child-1' }],
    [['afterAgentResponse', 'worker-1'], { AGENT_OFFICE_WORKER_ID: 'worker-1' }, { ...payload, text: 'private' }],
  ] as const) {
    const { stdout, received } = await runHelper(t, [...argv], { ...env }, input);
    assert.equal(stdout, '{}');
    assert.deepEqual(received, []);
  }
});
