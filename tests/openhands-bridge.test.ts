import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OPENHANDS_BRIDGE_SOURCE } from '../src/server/providers/openhands-bridge.js';

const AGENT_ID = '4d92aeec-2478-484c-9663-8d3956bb3c01';
const CONVERSATION_ID = 'ac40c16d-be36-4bfb-8740-a689121ddf89';

async function probe(model: string, resume = false, scenario: 'done' | 'idle' | 'running' | 'rate-limit' = 'done') {
  const home = await mkdtemp(path.join(tmpdir(), 'agent-office-bridge-test-'));
  const project = path.join(home, 'project');
  await mkdir(project);
  const canonicalProject = await realpath(project);
  let created = 0;
  let extraRun = 0;
  let stateReads = 0;
  let eventPosts = 0;
  const server = createServer((req, res) => {
    if (req.headers['x-session-api-key'] !== 'local-test-key') { res.writeHead(401).end(); return; }
    const route = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    let body: unknown;
    if (route === '/api/agent-profiles') body = { active_agent_profile_id: AGENT_ID, profiles: [{ id: AGENT_ID, llm_profile_ref: 'active-profile' }] };
    else if (route === '/api/profiles/active-profile') body = { config: { model } };
    else if (route === '/api/conversations' && req.method === 'POST') { created++; body = { id: CONVERSATION_ID }; }
    else if (route === `/api/conversations/${CONVERSATION_ID}/events/search`) body = {
      items: [
        { id: 'event-1', timestamp: '2026-10-22T00:00:00Z', kind: 'ActionEvent', tool_name: 'terminal', action: { kind: 'TerminalAction', command: '\x1b[2Junsafe-command\x07' } },
        { id: 'event-2', timestamp: '2026-10-22T00:00:01Z', kind: 'ObservationEvent', observation: { kind: 'TerminalObservation', content: [{ type: 'text', text: '\x1b]8;;https://example.invalid\x07unsafe-output\x1b\\' }] } },
      ],
    };
    else if (route === `/api/conversations/${CONVERSATION_ID}/events`) { eventPosts++; if (scenario === 'rate-limit') { res.writeHead(429).end(); return; } body = {}; }
    else if (route === `/api/conversations/${CONVERSATION_ID}/run`) { extraRun++; body = {}; }
    else if (route === `/api/conversations/${CONVERSATION_ID}`) body = { workspace: { working_dir: canonicalProject }, agent: { llm: { model } }, execution_status: ++stateReads < 5 && (scenario === 'idle' || scenario === 'running') ? scenario : 'done' };
    else { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  try {
    await mkdir(path.join(home, '.openhands', 'agent-canvas'), { recursive: true });
    await writeFile(path.join(home, '.openhands', 'agent-canvas', 'api-key.txt'), 'local-test-key');
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    const bridge = OPENHANDS_BRIDGE_SOURCE.replace("const BASE = 'http://127.0.0.1:8000';", `const BASE = '${url}';`)
      .replace('setTimeout(resolve, 1200)', 'setTimeout(resolve, 20)');
    assert.notEqual(bridge, OPENHANDS_BRIDGE_SOURCE);
    const script = path.join(home, 'bridge.mjs');
    // Advance wall time by 31 minutes per read while keeping the fixture fast.
    await writeFile(script, 'const actualNow = Date.now; let clockTicks = 0; Date.now = () => actualNow() + (++clockTicks * 31 * 60 * 1000);\n' + bridge);
    const child = spawn(process.execPath, [script, '--cwd', project, ...(resume ? ['--resume', CONVERSATION_ID] : []), ...(!resume || scenario === 'rate-limit' ? ['--prompt', 'Check the provider'] : [])], {
      env: { ...process.env, USERPROFILE: home, HOME: home, AGENT_OFFICE_HOOK_URL: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let error = '';
    const marker = resume && !model.startsWith('nvidia_nim/')
      ? 'refusing to resume it in this Office worker.'
      : 'OpenHands ready for another prompt.';
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Bridge probe timed out: ' + output.slice(-300) + error.slice(-200))), 12000);
        child.stdout.on('data', (chunk) => {
          output += chunk.toString();
          if (output.includes(marker)) { clearTimeout(timeout); resolve(); }
        });
        child.stderr.on('data', (chunk) => { error += chunk.toString(); });
        child.once('error', (cause) => { clearTimeout(timeout); reject(cause); });
        child.once('exit', (code) => { if (!output.includes(marker)) { clearTimeout(timeout); reject(new Error(`Bridge exited ${code}: ${error}`)); } });
      });
    } finally {
      if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    }
    return { output, created, extraRun, eventPosts, stateReads };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    assert.equal(path.dirname(home), tmpdir());
    await rm(home, { recursive: true, force: true });
  }
}

test('OpenHands bridge rejects a non-NVIDIA active profile before creating a conversation', async () => {
  const result = await probe('openai/other-model');
  assert.match(result.output, /does not use NVIDIA/);
  assert.equal(result.created, 0);
});

test('OpenHands bridge rejects a resumed conversation that uses another provider', async () => {
  const result = await probe('openai/other-model', true);
  assert.match(result.output, /does not use an NVIDIA model/);
  assert.equal(result.created, 0);
});

test('OpenHands bridge starts with NVIDIA and strips terminal controls from tool output', async () => {
  const result = await probe('nvidia_nim/z-ai/glm-5.3');
  assert.equal(result.created, 1);
  assert.match(result.output, /unsafe-command/);
  assert.match(result.output, /unsafe-output/);
  assert.doesNotMatch(result.output.replace(/\r\n/g, '\n'), /[\x00-\x08\x0B-\x1F\x7F-\x9F]/);
});

test('OpenHands bridge keeps watching idle transitions beyond 30 minutes', async () => {
  const result = await probe('nvidia_nim/z-ai/glm-5.3', false, 'idle');
  assert.equal(result.stateReads, 5);
  assert.doesNotMatch(result.output, /exceeded 30 minutes|remained idle|\[OpenHands bridge\]/);
});

test('OpenHands bridge reconnects to an active run without submitting duplicate work', async () => {
  const result = await probe('nvidia_nim/z-ai/glm-5.3', true, 'running');
  assert.equal(result.stateReads, 5);
  assert.equal(result.created, 0);
  assert.equal(result.eventPosts, 0);
  assert.equal(result.extraRun, 0);
  assert.match(result.output, /still watching this conversation/);
  assert.doesNotMatch(result.output, /exceeded 30 minutes|\[OpenHands bridge\]/);
});

test('OpenHands bridge reports ambiguous rate limits without starting an extra run', async () => {
  const result = await probe('nvidia_nim/z-ai/glm-5.3', true, 'rate-limit');
  assert.match(result.output, /Check Agent Canvas for whether it was saved/);
  assert.equal(result.extraRun, 0);
});
