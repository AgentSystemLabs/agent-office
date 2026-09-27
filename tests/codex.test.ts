import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CODEX_HOOK_EVENTS,
  codexHookArgs,
  normalizeCodexHook,
  validateCodexHook,
  writeCodexHook,
} from '../src/server/codex.js';

test('normalizes bounded root Codex hook payloads and passes only the metric reader path', () => {
  assert.deepEqual(normalizeCodexHook('SessionStart', {
    session_id: 'thread-1', source: 'startup', transcript_path: '/private/transcript.jsonl', turn_id: 'turn-1',
  }), { sessionId: 'thread-1', event: 'SessionStart', source: 'startup', turnId: 'turn-1', transcriptPath: '/private/transcript.jsonl' });
  assert.deepEqual(normalizeCodexHook('UserPromptSubmit', {
    session_id: 'thread-1', prompt: '  fix the login  ', turn_id: 'turn-2', model: 'secret-model',
  }), { sessionId: 'thread-1', event: 'UserPromptSubmit', prompt: 'fix the login', turnId: 'turn-2' });
  assert.deepEqual(normalizeCodexHook('PermissionRequest', {
    session_id: 'thread-1', tool_name: 'Bash', tool_use_id: 'tool-1', tool_input: { command: 'secret' },
  }), { sessionId: 'thread-1', event: 'PermissionRequest', tool: 'Bash', toolUseId: 'tool-1' });
});

test('rejects unknown, malformed, empty, oversized, and child-scoped events', () => {
  assert.equal(validateCodexHook('Unknown', { session_id: 'x' }), false);
  assert.equal(validateCodexHook('Stop', null), false);
  assert.equal(validateCodexHook('Stop', { session_id: '' }), false);
  assert.equal(validateCodexHook('Stop', { session_id: 'x'.repeat(161) }), false);
  assert.equal(validateCodexHook('Stop', { session_id: 'x', agent_id: 'child-1' }), false);
  assert.equal(validateCodexHook('Stop', { session_id: 'x', agent_type: 'explorer' }), false);
  assert.equal(validateCodexHook('Stop', { session_id: 'x', agent_id: 'c'.repeat(161) }), false);
});

test('generates one stable CLI hook override per supported event', () => {
  const args = codexHookArgs('/tmp/office data/agent-office-codex-hook.cjs');
  assert.equal(args.length, CODEX_HOOK_EVENTS.length * 2);
  for (let i = 0; i < CODEX_HOOK_EVENTS.length; i++) {
    assert.equal(args[i * 2], '-c');
    assert.match(args[i * 2 + 1], new RegExp(`^hooks\\.${CODEX_HOOK_EVENTS[i]}=\\[\\{hooks=`));
    assert.match(args[i * 2 + 1], /type="command"/);
    assert.match(args[i * 2 + 1], /timeout=3/);
    assert.match(args[i * 2 + 1], /agent-office-codex-hook\.cjs/);
  }
});

test('writes a mode-restricted helper that forwards paths without reading transcripts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-codex-'));
  try {
    const file = writeCodexHook(dir);
    assert.equal(file, path.join(dir, 'agent-office-codex-hook.cjs'));
    const source = readFileSync(file, 'utf8');
    assert.match(source, /MAX = 64 \* 1024/);
    assert.match(source, /AGENT_OFFICE_HOOK_TOKEN/);
    assert.doesNotMatch(source, /readFile|readSync|createReadStream/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('helper forwards only the bounded root event fields to the authenticated bridge', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-codex-'));
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
    const file = writeCodexHook(dir);
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
        session_id: 'thread-1', prompt: 'fix it', turn_id: 'turn-1',
        transcript_path: '/private/transcript.jsonl', model: 'private-model',
        tool_input: { command: 'private' }, hook_event_name: 'forged',
      }));
    });
    assert.equal(stdout, '{}');
    assert.equal(received.authorization, 'Bearer hook-token');
    assert.equal(received.url, '/hooks/codex?worker=worker-1&event=UserPromptSubmit');
    assert.deepEqual(received.body, {
      session_id: 'thread-1', hook_event_name: 'UserPromptSubmit', prompt: 'fix it', turn_id: 'turn-1',
      transcript_path: '/private/transcript.jsonl',
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});
