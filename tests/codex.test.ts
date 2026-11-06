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
  codexModelArgs,
  normalizeCodexHook,
  validateCodexHook,
  writeCodexHook,
} from '../src/server/codex.js';
import { codex } from '../src/server/providers/codex.js';

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

test('keeps paths out of Windows shell expansion and retains POSIX apostrophe escaping', () => {
  const file = "/office data/O'Neil/hook.cjs";
  const commandOf = (platform: NodeJS.Platform) =>
    JSON.parse(codexHookArgs(file, platform)[1].match(/command=("(?:[^"\\]|\\.)*")/)![1]) as string;
  assert.ok(commandOf('win32').startsWith('node.exe -e "require(process.env.AGENT_OFFICE_CODEX_HOOK)"'));
  assert.equal(commandOf('win32').includes(file), false);
  assert.ok(commandOf('linux').includes(`'/office data/O'"'"'Neil/hook.cjs'`));
});

test('generated hooks execute through the native shell with spaced Unicode and apostrophe paths', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "office Việt %TEMP% $env:TEMP ` & O'Neil ".replaceAll(':', '-')));
  const events: string[] = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      events.push(new URL(req.url!, 'http://localhost').searchParams.get('event')!);
      res.writeHead(200).end();
    });
  });
  try {
    const file = writeCodexHook(dir);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const args = codexHookArgs(file);
    const windows = process.platform === 'win32';
    const launched = codex.launch({ h: { info: {}, state: codex.createState!() } as never, args: [], setup: { hook: file } });
    if (windows) {
      assert.equal(launched.env?.AGENT_OFFICE_CODEX_HOOK, file);
      const pathValue = Object.entries(launched.env!).find(([key]) => key.toUpperCase() === 'PATH')![1];
      assert.equal(pathValue?.split(path.delimiter)[0], path.dirname(process.execPath));
    }
    const shells = windows ? ['cmd', 'powershell'] : ['sh'];
    for (const shell of shells) for (const event of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
      const config = args[CODEX_HOOK_EVENTS.indexOf(event as typeof CODEX_HOOK_EVENTS[number]) * 2 + 1];
      const command = JSON.parse(config.match(/command=("(?:[^"\\]|\\.)*")/)![1]) as string;
      // Exercise both Codex Windows runners, rather than spawning the helper directly.
      const program = shell === 'cmd' ? process.env.ComSpec || 'cmd.exe' : shell === 'powershell' ? 'powershell.exe' : '/bin/sh';
      const shellArgs = shell === 'cmd' ? ['/C', `"${command}"`] : shell === 'powershell' ? ['-NoProfile', '-NonInteractive', '-Command', command] : ['-c', command];
      const child = spawn(program, shellArgs, {
          windowsVerbatimArguments: shell === 'cmd',
          env: {
            ...process.env,
            ...launched.env,
            AGENT_OFFICE_HOOK_URL: `http://127.0.0.1:${address.port}`,
            AGENT_OFFICE_HOOK_TOKEN: 'test-token',
            AGENT_OFFICE_WORKER_ID: 'test-worker',
          },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        let stdout = '', stderr = '';
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(JSON.stringify({ session_id: 'test-session', source: 'startup', prompt: 'test' }));
      });
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stdout, '{}');
    }
    assert.deepEqual(events, shells.flatMap(() => ['SessionStart', 'UserPromptSubmit', 'Stop']));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a worker\'s own model and effort go on Codex\'s command line, in place of an office-wide model', () => {
  assert.deepEqual(codexModelArgs([]), []);
  assert.deepEqual(codexModelArgs(['--yolo'], 'gpt-5.5', 'high'), ['--yolo', '--model', 'gpt-5.5', '-c', 'model_reasoning_effort="high"']);
  // Codex refuses --model twice: the office's --agent-args one gives way, however it was written.
  assert.deepEqual(codexModelArgs(['-m', 'gpt-6-astra', '--yolo'], 'gpt-5.5'), ['--yolo', '--model', 'gpt-5.5']);
  assert.deepEqual(codexModelArgs(['--model', 'gpt-6-astra'], 'gpt-5.5'), ['--model', 'gpt-5.5']);
  assert.deepEqual(codexModelArgs(['--model=gpt-6-astra', '-mgpt-6-astra', '--yolo'], 'gpt-5.5'), ['--yolo', '--model', 'gpt-5.5']);
  // With only an effort picked, the office-wide model stays.
  assert.deepEqual(codexModelArgs(['-m', 'gpt-6-astra'], undefined, 'xhigh'), ['-m', 'gpt-6-astra', '-c', 'model_reasoning_effort="xhigh"']);
});

test('a Codex worker starts, and resumes, on the model and effort picked for it', () => {
  const launch = (info: { model?: string; effort?: string }, more: { prompt?: string; resumeSessionId?: string } = {}) =>
    codex.launch({ h: { info, state: codex.createState!() } as never, args: ['--yolo'], setup: { hook: '/data/hook.cjs' }, ...more }).args;
  const fresh = launch({ model: 'gpt-5.5', effort: 'high' }, { prompt: 'fix it' });
  assert.deepEqual(fresh.slice(0, 5), ['--yolo', '--model', 'gpt-5.5', '-c', 'model_reasoning_effort="high"']);
  assert.deepEqual(fresh.slice(-2), ['--', 'fix it']);
  // Its options come before the `resume` subcommand, which then takes the session.
  const resumed = launch({ model: 'gpt-5.5', effort: 'high' }, { resumeSessionId: 'thread-1' });
  assert.deepEqual(resumed.slice(0, 5), ['--yolo', '--model', 'gpt-5.5', '-c', 'model_reasoning_effort="high"']);
  assert.deepEqual(resumed.slice(-2), ['resume', 'thread-1']);
  // Left on its defaults, nothing is added.
  const plain = launch({});
  assert.equal(plain.includes('--model'), false);
  assert.equal(plain.some((a) => a.startsWith('model_reasoning_effort')), false);
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
