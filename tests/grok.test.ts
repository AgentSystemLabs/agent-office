import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  GROK_HOOK_EVENTS,
  normalizeGrokHook,
  validateGrokHook,
  withoutGrokLaunchArgs,
  writeGrokHome,
  writeGrokHook,
} from '../src/server/grok.js';

test('normalizes bounded root Grok hook payloads from camelCase or snake_case', () => {
  assert.deepEqual(normalizeGrokHook('SessionStart', {
    sessionId: 'sess-1', source: 'startup', toolInput: { command: 'secret' },
  }), { sessionId: 'sess-1', event: 'SessionStart', source: 'startup' });
  assert.deepEqual(normalizeGrokHook('UserPromptSubmit', {
    session_id: 'sess-1', prompt: '  fix the login  ', model: 'secret-model',
  }), { sessionId: 'sess-1', event: 'UserPromptSubmit', prompt: 'fix the login' });
  assert.deepEqual(normalizeGrokHook('PreToolUse', {
    sessionId: 'sess-1', toolName: 'run_terminal_command', toolUseId: 'tool-1',
  }), { sessionId: 'sess-1', event: 'PreToolUse', tool: 'run_terminal_command', toolUseId: 'tool-1' });
  assert.deepEqual(normalizeGrokHook('Notification', {
    sessionId: 'sess-1', notificationType: 'permission_prompt',
  }), { sessionId: 'sess-1', event: 'Notification', notificationType: 'permission_prompt' });
});

test('rejects unknown, malformed, empty, oversized, and child-scoped Grok events', () => {
  assert.equal(validateGrokHook('Unknown', { sessionId: 'x' }), false);
  assert.equal(validateGrokHook('Stop', null), false);
  assert.equal(validateGrokHook('Stop', { sessionId: '' }), false);
  assert.equal(validateGrokHook('Stop', { sessionId: 'x'.repeat(161) }), false);
  assert.equal(validateGrokHook('Stop', { sessionId: 'x', subagentType: 'explore' }), false);
  assert.equal(validateGrokHook('Stop', { sessionId: 'x', agent_id: 'child-1' }), false);
});

test('strips launch flags the office always sets itself', () => {
  assert.deepEqual(
    withoutGrokLaunchArgs(['--keep', 'yes', '--model', 'old', '--no-alt-screen', '--trust', '--session-id', 'abc', '--effort', 'high']),
    ['--keep', 'yes'],
  );
});

test('writes an isolated GROK_HOME with a helper that never reads transcripts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-grok-'));
  try {
    const written = writeGrokHome(dir);
    assert.equal(written.home, path.join(dir, 'grok-home'));
    const source = readFileSync(written.hook, 'utf8');
    assert.match(source, /MAX = 64 \* 1024/);
    assert.match(source, /AGENT_OFFICE_HOOK_TOKEN/);
    assert.doesNotMatch(source, /readFile|readSync|createReadStream/);
    const hooks = JSON.parse(readFileSync(path.join(written.home, 'hooks', 'agent-office.json'), 'utf8')) as { hooks: Record<string, unknown> };
    for (const event of GROK_HOOK_EVENTS) assert.ok(hooks.hooks[event]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('helper forwards only the bounded root event fields to the authenticated bridge', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-grok-'));
  const received: { url?: string; authorization?: string; body?: unknown } = {};
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.url = req.url;
      received.authorization = req.headers.authorization;
      received.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200).end();
    });
  });
  try {
    const file = writeGrokHook(dir);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const child = spawn(process.execPath, [file, 'UserPromptSubmit'], {
      env: {
        PATH: process.env.PATH,
        AGENT_OFFICE_HOOK_URL: `http://127.0.0.1:${address.port}`,
        AGENT_OFFICE_HOOK_TOKEN: 'hook-token',
        AGENT_OFFICE_WORKER_ID: 'worker-1',
      },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const stdout = await new Promise<string>((resolve, reject) => {
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.on('error', reject);
      child.on('close', () => resolve(output));
      child.stdin.end(JSON.stringify({
        sessionId: 'sess-1', prompt: 'fix it', toolInput: { command: 'private' },
        subagentType: '', hookEventName: 'forged',
      }));
    });
    assert.equal(stdout, '{}');
    assert.equal(received.authorization, 'Bearer hook-token');
    assert.equal(received.url, '/hooks/grok?worker=worker-1&event=UserPromptSubmit');
    assert.deepEqual(received.body, {
      session_id: 'sess-1', hook_event_name: 'UserPromptSubmit', prompt: 'fix it',
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
