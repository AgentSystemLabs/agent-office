import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addGooseHooks, GOOSE_EVENTS, writeGooseHook } from '../src/server/goose-hooks.js';
import { goose } from '../src/server/providers/goose.js';

test('native Goose hooks report authenticated start, tool and completion without raw payloads', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'office-goose-hooks-'));
  const reports: any[] = [];
  const token = 'a'.repeat(32);
  const id = '123456abcdef';
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    assert.equal(req.url, `/hooks/goose?worker=${id}`);
    let body = '';
    req.on('data', data => { body += data; });
    req.on('end', () => { reports.push(JSON.parse(body)); res.writeHead(204).end(); });
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const hook = writeGooseHook(dir);
    addGooseHooks(dir, hook);
    const config = JSON.parse(await readFile(path.join(dir, '.agents/plugins/agent-office-status/hooks/hooks.json'), 'utf8'));
    assert.deepEqual(Object.keys(config.hooks), [...GOOSE_EVENTS]);
    for (const [event, session] of [['SessionStart', 'native-session'], ['UserPromptSubmit', 'native-session'],
      ['SessionStart', 'child-session'], ['Stop', 'child-session'], ['PreToolUse', 'native-session'], ['Stop', 'native-session']]) {
      const child = spawn(process.execPath, [hook], { env: { ...process.env,
        AGENT_OFFICE_WORKER_ID: id, AGENT_OFFICE_HOOK_TOKEN: token,
        AGENT_OFFICE_INITIAL_PROMPT: '1',
        AGENT_OFFICE_HOOK_URL: `http://127.0.0.1:${addr.port}` }, stdio: ['pipe', 'ignore', 'pipe'] });
      child.stdin.end(JSON.stringify({ event, session_id: session, tool_name: 'shell', message: 'private-prompt', tool_input: { credential: 'private-token' } }));
      const [code] = await once(child, 'close');
      assert.equal(code, 0);
    }
    assert.deepEqual(reports.map(r => r.status), ['working', 'working', 'working', 'done']);
    assert.ok(reports.every(r => r.sessionId === `agent-office-${id}`));
    assert.equal(reports[2].tool, 'shell');
    assert.doesNotMatch(JSON.stringify(reports), /private-prompt|private-token/);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    assert.equal(path.dirname(dir), tmpdir());
    await rm(dir, { recursive: true, force: true });
  }
});

test('Goose refuses a plugin collision instead of overwriting project-owned files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'office-goose-collision-'));
  try {
    await mkdir(path.join(dir, '.agents/plugins/agent-office-status'), { recursive: true });
    assert.throws(() => addGooseHooks(dir, 'hook.cjs'), /does not own/);
  } finally {
    assert.equal(path.dirname(dir), tmpdir());
    await rm(dir, { recursive: true, force: true });
  }
});

test('Goose lifecycle reducer transitions working to done and rejects another worker session', () => {
  const info = { id: '123456abcdef', sessionId: 'agent-office-123456abcdef', status: 'idle' };
  const h = { info, state: {}, running: true, setStatus: (s: string) => { info.status = s; }, persist() {}, emit() {}, notePrompt() {}, clearTask() {} } as never;
  assert.equal(goose.hook!.handle(h, '', { type: 'prompt', status: 'working', sessionId: info.sessionId }), true);
  assert.equal(info.status, 'working');
  assert.equal(goose.hook!.handle(h, '', { type: 'session', status: 'done', sessionId: info.sessionId }), true);
  assert.equal(info.status, 'done');
  assert.equal(goose.hook!.handle(h, '', { type: 'session', status: 'done', sessionId: 'other' }), false);
});

test('Goose generated hooks cannot follow a project junction outside the workspace', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'office-goose-link-'));
  try {
    const project = path.join(dir, 'project');
    const external = path.join(dir, 'external');
    await mkdir(project);
    await mkdir(external);
    await symlink(external, path.join(project, '.agents'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => addGooseHooks(project, 'hook.cjs'), /linked project paths/);
  } finally {
    assert.equal(path.dirname(dir), tmpdir());
    await rm(dir, { recursive: true, force: true });
  }
});
