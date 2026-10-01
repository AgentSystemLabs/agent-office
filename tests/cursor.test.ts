import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CURSOR_HOOK_EVENTS, cursorArgs, normalizeCursorHook, writeCursorHook, writeCursorPlugin } from '../src/server/cursor.js';
import { isValidCursorModel } from '../src/shared/providers.js';

test('maps Cursor hook payloads onto the office lifecycle, keyed by conversation id', () => {
  assert.deepEqual(normalizeCursorHook('sessionStart', { conversation_id: 'c-1', session_id: 's', transcript_path: '/secret' }), { sessionId: 'c-1', event: 'SessionStart' });
  assert.deepEqual(normalizeCursorHook('beforeSubmitPrompt', { conversation_id: 'c-1', prompt: '  fix the login  ', attachments: [{ file_path: '/x' }] }), {
    sessionId: 'c-1', event: 'UserPromptSubmit', prompt: 'fix the login',
  });
  assert.deepEqual(normalizeCursorHook('postToolUse', { conversation_id: 'c-1', tool_name: 'Read', tool_input: { path: 'a' }, tool_output: 'secret' }), {
    sessionId: 'c-1', event: 'PreToolUse', tool: 'Read',
  });
  assert.deepEqual(normalizeCursorHook('postToolUseFailure', { conversation_id: 'c-1', tool_name: 'Shell', tool_input: { command: 'cat ~/.ssh/id_rsa' } }), {
    sessionId: 'c-1', event: 'PreToolUse', tool: 'Shell',
  });
  assert.deepEqual(normalizeCursorHook('stop', { conversation_id: 'c-1', status: 'completed', loop_count: 0 }), { sessionId: 'c-1', event: 'Stop' });
});

test('rejects unknown, malformed, oversized and subagent Cursor events', () => {
  assert.equal(normalizeCursorHook('afterAgentResponse', { conversation_id: 'c', text: 'assistant text' }), undefined);
  assert.equal(normalizeCursorHook('beforeShellExecution', { conversation_id: 'c' }), undefined);
  assert.equal(normalizeCursorHook('toString', { conversation_id: 'c' }), undefined);
  assert.equal(normalizeCursorHook('stop', null), undefined);
  assert.equal(normalizeCursorHook('stop', { conversation_id: '' }), undefined);
  assert.equal(normalizeCursorHook('stop', { conversation_id: 'x'.repeat(161) }), undefined);
  assert.equal(normalizeCursorHook('stop', { conversation_id: 'a\u0007b' }), undefined);
  assert.equal(normalizeCursorHook('stop', { conversation_id: 'child', parent_conversation_id: 'c' }), undefined);
  assert.equal(normalizeCursorHook('stop', { conversation_id: 'c', subagent_id: 'sub' }), undefined);
});

test('never registers a hook that gates a tool (a failing one blocks it, an answer could approve it)', () => {
  assert.deepEqual(Object.keys(CURSOR_HOOK_EVENTS).sort(), ['beforeSubmitPrompt', 'postToolUse', 'postToolUseFailure', 'sessionStart', 'stop']);
});

test('builds the command line without approval-skipping, headless or office-owned flags', () => {
  const plugin = '/office/cursor-plugin';
  const base = ['--keep', '--force', '-f', '--yolo', '--auto-review', '-p', '--print', '--output-format', 'json', '--model', 'old', '--resume', 'abc', '--continue',
    '--workspace', '/x', '--model=x', '-w', 'mine', '--worktree-base', 'main', '--trust'];
  assert.deepEqual(cursorArgs(base, { plugin, model: 'gpt-5', prompt: '- fix it' }), ['--keep', '--trust', '--plugin-dir', plugin, '--model', 'gpt-5', '--', '- fix it']);
  assert.deepEqual(cursorArgs([], { plugin, sessionId: 'chat-1', model: 'gpt-5', prompt: 'carry on' }), ['--trust', '--plugin-dir', plugin, '--resume', 'chat-1', '--', 'carry on']);
  assert.deepEqual(cursorArgs(['--resume', '--worktree'], { plugin }), ['--trust', '--plugin-dir', plugin]);
});

test('accepts Cursor model ids and rejects anything that could become another argument', () => {
  for (const model of ['auto', 'gpt-5', 'sonnet-4.5-thinking', 'composer-1', 'claude-opus-4-8[context=1m,effort=high,fast=false]']) assert.equal(isValidCursorModel(model), true, model);
  for (const model of ['', '-p', '--force', 'gpt 5', 'a;b', 'a[b', 'a[b]c', 'a[$(x)]', 'x'.repeat(129), 'a\nb']) assert.equal(isValidCursorModel(model), false, model);
});

test('writes a plugin of the office\'s own with only its hooks', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-cursor-'));
  try {
    const plugin = writeCursorPlugin(dir);
    assert.equal(plugin, path.join(dir, 'cursor-plugin'));
    assert.equal((JSON.parse(readFileSync(path.join(plugin, '.cursor-plugin', 'plugin.json'), 'utf8')) as { name: string }).name, 'agent-office');
    const json = JSON.parse(readFileSync(path.join(plugin, 'hooks', 'hooks.json'), 'utf8')) as { version: number; hooks: Record<string, { command: string }[]> };
    assert.equal(json.version, 1);
    assert.deepEqual(Object.keys(json.hooks).sort(), Object.keys(CURSOR_HOOK_EVENTS).sort());
    assert.ok(json.hooks.stop[0].command.includes(path.join(dir, 'agent-office-cursor-hook.cjs')));
    assert.match(json.hooks.stop[0].command, /stop'?$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function runHelper(file: string, event: string, input: string, env: Record<string, string | undefined>): Promise<{ stdout: string; code: number | null }> {
  const child = spawn(process.execPath, [file, event], { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'ignore'] });
  return new Promise((resolve, reject) => {
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, code }));
    child.stdin.end(input);
  });
}

test('helper forwards only bounded root fields to the authenticated bridge, and always allows', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-cursor-'));
  const received: { url?: string; authorization?: string; body?: unknown }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      // Only the helper's own requests: anything else on this machine may find the port too.
      if (req.url?.startsWith('/hooks/cursor')) received.push({ url: req.url, authorization: req.headers.authorization, body: text ? JSON.parse(text) : text });
      res.writeHead(200).end();
    });
  });
  try {
    const file = writeCursorHook(dir);
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /readFile|readSync|createReadStream|transcript/);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const env = { AGENT_OFFICE_HOOK_URL: `http://127.0.0.1:${address.port}`, AGENT_OFFICE_HOOK_TOKEN: 'hook-token', AGENT_OFFICE_WORKER_ID: 'worker-1' };

    const prompt = await runHelper(file, 'beforeSubmitPrompt', JSON.stringify({
      conversation_id: 'c-1', prompt: 'fix it', attachments: [{ file_path: '/secret' }], user_email: 'me@example.com', transcript_path: '/t',
    }), env);
    assert.deepEqual(prompt, { stdout: '{}', code: 0 });
    assert.equal(received[0].authorization, 'Bearer hook-token');
    assert.equal(received[0].url, '/hooks/cursor?worker=worker-1&event=beforeSubmitPrompt');
    assert.deepEqual(received[0].body, { conversation_id: 'c-1', prompt: 'fix it' });

    const tool = await runHelper(file, 'postToolUse', JSON.stringify({ conversation_id: 'c-1', tool_name: 'Read', tool_input: { p: 1 }, tool_output: 'secret' }), env);
    assert.deepEqual(tool, { stdout: '{}', code: 0 });
    assert.deepEqual(received[1].body, { conversation_id: 'c-1', tool_name: 'Read' });

    // A subagent's event, or a run outside the office, sends nothing and still lets Cursor carry on.
    assert.deepEqual(await runHelper(file, 'stop', JSON.stringify({ conversation_id: 'x', parent_conversation_id: 'c-1' }), env), { stdout: '{}', code: 0 });
    assert.deepEqual(await runHelper(file, 'beforeSubmitPrompt', JSON.stringify({ conversation_id: 'c-1', prompt: 'mine' }), {}), { stdout: '{}', code: 0 });
    assert.deepEqual(await runHelper(file, 'stop', 'not json', env), { stdout: '{}', code: 0 });
    assert.equal(received.length, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('helper allows the prompt even when the office is unreachable', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-cursor-'));
  try {
    const file = writeCursorHook(dir);
    const result = await runHelper(file, 'beforeSubmitPrompt', JSON.stringify({ conversation_id: 'c-1', prompt: 'hi' }), {
      AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:1', AGENT_OFFICE_HOOK_TOKEN: 't', AGENT_OFFICE_WORKER_ID: 'w',
    });
    assert.deepEqual(result, { stdout: '{}', code: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
