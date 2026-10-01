import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  MUSE_HOOK_EVENTS,
  normalizeMuseHook,
  validateMuseHook,
  withoutMuseLaunchArgs,
  writeMuseHome,
  writeMuseHook,
} from '../src/server/muse.js';

test('normalizes bounded root Muse hook payloads from camelCase or snake_case', () => {
  assert.deepEqual(normalizeMuseHook('SessionStart', {
    session_id: 'sess-1', source: 'startup', last_assistant_message: 'secret',
  }), { sessionId: 'sess-1', event: 'SessionStart', source: 'startup' });
  assert.deepEqual(normalizeMuseHook('', {
    hook_event_name: 'UserPromptSubmit', session_id: 'sess-1', prompt: '  fix the login  ',
  }), { sessionId: 'sess-1', event: 'UserPromptSubmit', prompt: 'fix the login' });
  assert.deepEqual(normalizeMuseHook('PreToolUse', {
    sessionId: 'sess-1', tool_name: 'run_terminal_command', tool_use_id: 'tool-1',
  }), { sessionId: 'sess-1', event: 'PreToolUse', tool: 'run_terminal_command', toolUseId: 'tool-1' });
  assert.deepEqual(normalizeMuseHook('PermissionRequest', {
    session_id: 'sess-1', tool: 'shell',
  }), { sessionId: 'sess-1', event: 'PermissionRequest', tool: 'shell' });
});

test('rejects unknown, malformed, empty, oversized, and child-scoped Muse events', () => {
  assert.equal(validateMuseHook('Unknown', { session_id: 'x' }), false);
  assert.equal(validateMuseHook('Stop', null), false);
  assert.equal(validateMuseHook('Stop', { session_id: '' }), false);
  assert.equal(validateMuseHook('Stop', { session_id: 'x'.repeat(161) }), false);
  assert.equal(validateMuseHook('Stop', { session_id: 'x', subagent_type: 'explore' }), false);
  assert.equal(validateMuseHook('Stop', { session_id: 'x', parent_session_id: 'root' }), false);
});

test('strips launch flags the office always sets itself', () => {
  assert.deepEqual(
    withoutMuseLaunchArgs(['--keep', 'yes', '--model', 'old', '--trust-workspace', '--yolo', '-w', 'resume', 'abc', '--reasoning-effort', 'high', '--', 'prompt']),
    ['--keep', 'yes'],
  );
});

test('writes an isolated Muse XDG home with a helper that never reads transcripts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-muse-'));
  try {
    const user = path.join(dir, 'user-muse');
    mkdirSync(user, { recursive: true });
    writeFileSync(path.join(user, 'settings.json'), JSON.stringify({
      schema_version: 1, provider: 'meta', model: 'muse-spark-1.3-contributor',
      managed_hooks_path: '/tmp/orca-hooks.json',
    }), { mode: 0o600 });
    writeFileSync(path.join(user, 'auth.json'), '{"token":"secret"}', { mode: 0o600 });
    const written = writeMuseHome(dir, user);
    assert.equal(written.home, path.join(dir, 'muse-home'));
    const source = readFileSync(written.hook, 'utf8');
    assert.match(source, /MAX = 64 \* 1024/);
    assert.match(source, /AGENT_OFFICE_HOOK_TOKEN/);
    assert.doesNotMatch(source, /readFile|readSync|createReadStream/);
    const settings = JSON.parse(readFileSync(path.join(written.configHome, 'muse', 'settings.json'), 'utf8')) as {
      provider: string; model?: string; managed_hooks_path?: string; hooks: Record<string, unknown>;
    };
    assert.equal(settings.provider, 'meta');
    assert.equal(settings.model, 'muse-spark-1.3-contributor');
    assert.equal(settings.managed_hooks_path, undefined);
    for (const event of MUSE_HOOK_EVENTS) assert.ok(settings.hooks[event]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('helper forwards only the bounded root event fields to the authenticated bridge', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-muse-'));
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
    const file = writeMuseHook(dir);
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
        session_id: 'sess-1', prompt: 'fix it', last_assistant_message: 'private',
        hook_event_name: 'UserPromptSubmit',
      }));
    });
    assert.equal(stdout, '{}');
    assert.equal(received.authorization, 'Bearer hook-token');
    assert.equal(received.url, '/hooks/muse?worker=worker-1&event=UserPromptSubmit');
    assert.deepEqual(received.body, {
      session_id: 'sess-1', hook_event_name: 'UserPromptSubmit', prompt: 'fix it',
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
