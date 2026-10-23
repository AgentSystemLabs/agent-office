import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { addClineHooks, writeClineHooks } from '../src/server/cline-hooks.js';
import { cline } from '../src/server/providers/cline.js';

test('Cline native hooks report parent lifecycle and errors without secrets or permission overrides', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'office-cline-hooks-'));
  const reports: any[] = [];
  const token = 'b'.repeat(32);
  const id = '123456abcdef';
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    assert.equal(req.url, `/hooks/cline?worker=${id}`);
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => { reports.push(JSON.parse(body)); res.writeHead(204).end(); });
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const hooks = writeClineHooks(dir);
    const cases = [
      ['TaskStart', 'agent_start', null], ['PreToolUse', 'tool_call', null],
      ['TaskComplete', 'agent_end', 'child-parent'], ['TaskComplete', 'agent_end', null],
      ['TaskError', 'agent_error', null], ['TaskCancel', 'agent_abort', null],
    ];
    for (const [file, hookName, parent_agent_id] of cases) {
      const child = spawn(process.execPath, [path.join(hooks, file + '.cjs')], { env: { ...process.env,
        AGENT_OFFICE_WORKER_ID: id, AGENT_OFFICE_HOOK_TOKEN: token,
        AGENT_OFFICE_HOOK_URL: `http://127.0.0.1:${addr.port}` }, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stdin.end(JSON.stringify({ hookName, parent_agent_id, tool_call: { name: 'read_file', input: 'private-key-value' }, userPromptSubmit: { prompt: 'private-prompt' } }));
      const [code] = await once(child, 'close');
      assert.equal(code, 0);
      assert.deepEqual(JSON.parse(stdout), {});
    }
    assert.deepEqual(reports.map(r => r.status), ['working', 'needs_input', 'done', 'needs_input', 'needs_input']);
    assert.doesNotMatch(JSON.stringify(reports), /private-key-value|private-prompt/);
    assert.equal(reports[1].tool, 'read_file');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    assert.equal(path.dirname(dir), tmpdir());
    await rm(dir, { recursive: true, force: true });
  }
});

test('Cline launch uses project hooks, manual approval and strict lifecycle reduction', async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'office-cline-launch-'));
  t.after(async () => { assert.equal(path.dirname(cwd), tmpdir()); await rm(cwd, { recursive: true, force: true }); });
  const info = { id: '123456abcdef', sessionId: '', status: 'starting' };
  const h = { info, state: {}, running: true, setStatus(s: string) { info.status = s; }, persist() {}, emit() {}, notePrompt() {}, clearTask() {} } as never;
  const plan = cline.launch({ h, cwd, prompt: 'hi', setup: { hooks: 'scoped-hooks' }, args: ['--unsafe'] });
  assert.match(await readFile(path.join(cwd, '.cline/hooks/TaskComplete.cjs'), 'utf8'), /Agent Office managed/);
  assert.equal(plan.args[plan.args.indexOf('--auto-approve') + 1], 'false');
  assert.ok(!plan.args.includes('--unsafe'));
  const env: Record<string, string> = {};
  plan.finishEnv?.(env);
  assert.equal(env.CLINE_SESSION_BACKEND_MODE, 'local');
  assert.equal(env.CLINE_SANDBOX, '1');
  assert.ok(env.CLINE_SANDBOX_DATA_DIR.endsWith(path.join('.cline', 'data')));
  for (const status of ['working', 'done']) {
    assert.equal(cline.hook!.handle(h, '', { type: 'session', status, sessionId: info.sessionId }), true);
    assert.equal(info.status, status);
  }
  assert.equal(cline.hook!.handle(h, '', { type: 'session', status: 'done', sessionId: 'other' }), false);
});

test('Cline project hook install refuses user hooks and linked paths', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'office-cline-collision-'));
  try {
    await mkdir(path.join(cwd, '.cline/hooks'), { recursive: true });
    await writeFile(path.join(cwd, '.cline/hooks/TaskStart.sh'), 'user-owned');
    assert.throws(() => addClineHooks(cwd, 'source'), /existing project/);
    assert.equal(await readFile(path.join(cwd, '.cline/hooks/TaskStart.sh'), 'utf8'), 'user-owned');
    const other = path.join(cwd, 'linked-project');
    await mkdir(other);
    await symlink(path.join(cwd, '.cline'), path.join(other, '.cline'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => addClineHooks(other, 'source'), /linked project/);
  } finally { assert.equal(path.dirname(cwd), tmpdir()); await rm(cwd, { recursive: true, force: true }); }
});
