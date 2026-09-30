import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { TOOLS, UsageError, buildRequest, formatHome, formatWorkers, handleMcp, main, parseArgs } from '../bin/office-workers.js';
import { codexMcpArgs, findWorker, readHireRequest, readHomeRequest, workerRow } from '../src/server/office-workers.js';
import { notLeaving } from '../src/server/leave-on-merge.js';
import type { GhPull, WorkerInfo } from '../src/shared/protocol.js';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'office-workers.js');
const ENV = { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:4455/', AGENT_OFFICE_WORKER_ID: 'w1', AGENT_OFFICE_HOOK_TOKEN: 'tok' };
const OFFICE = { url: 'http://127.0.0.1:4455', worker: 'w1', token: 'tok' };

function worker(id: string, more: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    id, kind: 'agent', deskId: 'desk-1', name: id[0].toUpperCase() + id.slice(1), color: '#fff', status: 'done', acked: false, createdBy: 'Ada', createdAt: 0, cols: 80, rows: 24, viewers: [],
    worktree: { path: `.agent-office/worktrees/${id}`, branch: `office/${id}`, base: 'abc' },
    ...more,
  };
}

const pull = (number: number, state: string, headRefName: string, headRefOid?: string): GhPull => ({
  number, title: `PR ${number}`, state, isDraft: false, url: `https://github.com/acme/app/pull/${number}`, author: '', labels: [], reviewDecision: '',
  headRefName, headRefOid, baseRefName: 'main', createdAt: '', updatedAt: '', additions: 0, deletions: 0, checks: 'none', body: '', closes: [],
});

test('parses list, hire, home, tell and mcp', () => {
  assert.deepEqual(parseArgs([]), { cmd: 'help' });
  assert.deepEqual(parseArgs(['home', '--help']), { cmd: 'help' });
  assert.deepEqual(parseArgs(['mcp']), { cmd: 'mcp' });
  assert.deepEqual(parseArgs(['list']), { cmd: 'list', json: false });
  assert.deepEqual(parseArgs(['ls', '--json']), { cmd: 'list', json: true });
  assert.deepEqual(parseArgs(['home', 'Mochi', 'b0b']), { cmd: 'home', workers: ['Mochi', 'b0b'], merged: false, json: false });
  assert.deepEqual(parseArgs(['home', '--merged', '--cleanup=keep']), { cmd: 'home', workers: [], merged: true, cleanup: 'keep', json: false });
  assert.deepEqual(parseArgs(['send-home', '--merged']), { cmd: 'home', workers: [], merged: true, json: false });
  assert.deepEqual(parseArgs(['tell', 'Mochi', '--prompt', '- rebase on main']), { cmd: 'tell', worker: 'Mochi', prompt: '- rebase on main' });
  assert.deepEqual(parseArgs(['hire', '--provider', 'codex', '--effort=high', '--issue', '#12', '--no-worktree', '--desk', 'desk-4']), {
    cmd: 'hire', json: false, provider: 'codex', effort: 'high', issue: 12, worktree: false, desk: 'desk-4',
  });
});

test('says what is wrong with a bad command line', () => {
  const bad: [string[], RegExp][] = [
    [['frobnicate'], /Unknown command: frobnicate/],
    [['list', 'x'], /list takes no arguments/],
    [['home'], /Say who goes home/],
    [['home', 'Mochi', '--merged'], /not both/],
    [['home', '--merged', '--cleanup', 'nuke'], /--cleanup is one of auto, keep, worktree, all/],
    [['home', '-f', 'Mochi'], /Unknown option: -f/],
    [['tell'], /tell takes one worker/],
    [['tell', 'a', 'b'], /tell takes one worker/],
    [['hire', 'do it'], /Unexpected argument: do it/],
    [['hire', '--effort', 'huge'], /--effort is one of/],
    [['hire', '--issue', 'twelve'], /--issue takes an issue number/],
    [['hire', '--model'], /--model needs a value/],
    [['mcp', 'x'], /mcp takes no arguments/],
  ];
  for (const [argv, why] of bad) assert.throws(() => parseArgs(argv), (e: Error) => e instanceof UsageError && why.test(e.message), argv.join(' '));
});

test('builds requests for each call, with the worker and its token', () => {
  const list = buildRequest('list', OFFICE);
  assert.equal(list.method, 'GET');
  assert.equal(list.url, 'http://127.0.0.1:4455/office/workers?worker=w1');
  assert.equal(list.headers.authorization, 'Bearer tok');
  const home = buildRequest('home', OFFICE, { merged: true });
  assert.equal(home.url, 'http://127.0.0.1:4455/office/workers/home?worker=w1');
  assert.equal(home.method, 'POST');
  assert.equal(home.body, '{"merged":true}');
  assert.ok(home.timeout > list.timeout, 'sending home waits on git');
  assert.equal(buildRequest('tell', OFFICE, {}).url, 'http://127.0.0.1:4455/office/workers/tell?worker=w1');
  assert.equal(buildRequest('hire', OFFICE, {}).url, 'http://127.0.0.1:4455/office/workers?worker=w1');
});

test('lists workers and how sending them home went, a line each', () => {
  const text = formatWorkers({
    floor: { name: 'app', repo: 'acme/app' },
    leaveOnMerge: false,
    freeDesk: 'desk-3',
    workers: [
      { id: 'w1', name: 'Mochi', you: true, kind: 'agent', provider: 'claude', status: 'working', desk: 'Desk 1', task: 'Fixing login', merged: false },
      { id: 'w2', name: 'Bolt', kind: 'agent', provider: 'codex', status: 'done', desk: 'Desk 2', worktree: { branch: 'office/bolt-1' }, pr: { number: 7, state: 'merged', title: 'Fix it' }, merged: true },
      { id: 'w3', name: 'Zed', kind: 'agent', status: 'idle', desk: 'Desk 3', pr: { number: 8, state: 'merged' }, merged: true, staying: 'Ada has its terminal open' },
    ],
  });
  assert.equal(text.split('\n')[0], '3 workers on app (acme/app) · go home once merged is off');
  assert.match(text, /^w1 {2}Mochi \(you, claude\) · working · Desk 1 · Fixing login$/m);
  assert.match(text, /^w2 {2}Bolt \(codex\) · done · Desk 2 · branch office\/bolt-1 · PR #7 merged “Fix it” · landed: free to go home$/m);
  assert.match(text, /landed, staying: Ada has its terminal open/);

  assert.equal(formatHome({ results: [] }, true), "Nobody's pull request has merged: nobody to send home.");
  assert.equal(
    formatHome({
      results: [
        { worker: 'Zed', skipped: "PR #8 merged, but it's still working" },
        { worker: 'Bolt', went: true, note: "Deleted Bolt's worktree and branch office/bolt-1" },
        { worker: 'Nope', error: 'No worker here is called Nope' },
      ],
    }),
    "– Zed stayed: PR #8 merged, but it's still working\n✓ Bolt went home — Deleted Bolt's worktree and branch office/bolt-1\n✗ Nope: No worker here is called Nope",
  );
});

test('the command reads a prompt from stdin, reports refusals and exits non-zero on a failed send-home', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const reply = (status: number, body: unknown) => async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  };
  const run = async (argv: string[], fetchImpl: typeof fetch, stdin = '') => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(argv, { env: ENV, fetch: fetchImpl, stdin: Readable.from([stdin]), out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const hired = await run(['hire', '--model', 'haiku'], reply(200, { ok: true, worker: { id: 'n1', name: 'Nova', desk: 'Desk 4', worktree: { branch: 'office/nova-1' } } }) as typeof fetch, 'Fix the flaky test\r\n');
  assert.deepEqual(hired, { code: 0, out: 'n1', err: 'Hired Nova at Desk 4 on branch office/nova-1.' });
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { model: 'haiku', prompt: 'Fix the flaky test' });

  const home = await run(['home', 'Bolt', 'Nope'], reply(200, { results: [{ worker: 'Bolt', went: true }, { worker: 'Nope', error: 'No worker here is called Nope' }] }) as typeof fetch);
  assert.equal(home.code, 1);
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), { workers: ['Bolt', 'Nope'] });

  const refused = await run(['list'], reply(401, { error: 'bad token' }) as typeof fetch);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /didn't accept this worker's token \(401\): bad token/);

  const noEnv = await main(['list'], { env: {}, err: (s) => assert.match(s, /AGENT_OFFICE_HOOK_URL, AGENT_OFFICE_WORKER_ID, AGENT_OFFICE_HOOK_TOKEN aren't set/) });
  assert.equal(noEnv, 1);
});

test('answers MCP: the handshake, its tools, and a call', async () => {
  const io = { env: ENV, fetch: (async () => new Response(JSON.stringify({ results: [{ worker: 'Bolt', went: true, note: 'Deleted it' }] }))) as typeof fetch };
  const init = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }, io);
  assert.equal(init?.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init?.result.capabilities, { tools: { listChanged: false } });
  assert.equal((await handleMcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, io))?.result.protocolVersion, '2025-11-25');
  assert.equal(await handleMcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, io), undefined);
  const tools = await handleMcp({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, io);
  assert.deepEqual(tools?.result.tools.map((t: { name: string }) => t.name), ['list_workers', 'hire_worker', 'send_home', 'tell_worker']);
  const call = await handleMcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'send_home', arguments: { merged: true } } }, io);
  assert.deepEqual(call?.result, { content: [{ type: 'text', text: '✓ Bolt went home — Deleted it' }] });
  // Nobody it named went: the call failed, as far as the model is concerned.
  const nobody = { env: ENV, fetch: (async () => new Response(JSON.stringify({ results: [{ worker: 'Zed', error: 'No worker here is called Zed' }] }))) as typeof fetch };
  const missed = await handleMcp({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'send_home', arguments: { workers: ['Zed'] } } }, nobody);
  assert.equal(missed?.result.isError, true);
  // A failed call is the tool's error, for the model to read; an unknown tool or method is the protocol's.
  const failed = await handleMcp({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_workers' } }, { env: {}, fetch: io.fetch });
  assert.equal(failed?.result.isError, true);
  assert.match(failed?.result.content[0].text, /only works inside Agent Office/);
  assert.equal((await handleMcp({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'fire_everyone' } }, io))?.error.code, -32602);
  assert.equal((await handleMcp({ jsonrpc: '2.0', id: 7, method: 'resources/list' }, io))?.error.code, -32601);
  for (const t of TOOLS) assert.equal(t.inputSchema.type, 'object', t.name);
});

test('office-workers mcp serves a real client over stdio, as the worker', async (t) => {
  const seen: { url: string; auth?: string; body: string }[] = [];
  const office = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url ?? '', auth: req.headers.authorization, body });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ floor: { name: 'app' }, you: 'w1', workers: [{ id: 'w2', name: 'Bolt', merged: true }] }));
    });
  });
  await new Promise<void>((r) => office.listen(0, '127.0.0.1', r));
  t.after(() => office.close());
  const port = (office.address() as AddressInfo).port;
  const child = spawn(process.execPath, [SCRIPT, 'mcp'], { env: { ...process.env, AGENT_OFFICE_HOOK_URL: `http://127.0.0.1:${port}`, AGENT_OFFICE_WORKER_ID: 'w1', AGENT_OFFICE_HOOK_TOKEN: 'sekrit' }, stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => child.kill());
  const replies = createInterface({ input: child.stdout! })[Symbol.asyncIterator]();
  const ask = async (msg: object) => {
    child.stdin!.write(`${JSON.stringify(msg)}\n`);
    return JSON.parse((await replies.next()).value);
  };
  assert.equal((await ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })).result.serverInfo.name, 'agent-office');
  child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const listed = await ask({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_workers', arguments: {} } });
  assert.equal(JSON.parse(listed.result.content[0].text).workers[0].name, 'Bolt');
  assert.deepEqual(seen, [{ url: '/office/workers?worker=w1', auth: 'Bearer sekrit', body: '' }]);
  assert.equal((await ask({ jsonrpc: '2.0', id: 3, method: 'ping' })).result && true, true);
  child.stdin!.end();
  assert.equal(await new Promise((r) => child.on('exit', r)), 0);
});

test("a worker's row says where its pull request stands, and whether it would go home by itself", () => {
  const head = 'a'.repeat(40);
  const view = { pulls: [pull(7, 'MERGED', 'office/bolt', head), pull(8, 'OPEN', 'office/zed')], tasks: [] };
  const bolt = workerRow(worker('bolt', { task: { name: 'Login fix', summary: 'Fixed the redirect' } }), view, 'mochi');
  assert.deepEqual(bolt, {
    id: 'bolt', name: 'Bolt', kind: 'agent', desk: 'Desk 1', status: 'done', task: 'Login fix: Fixed the redirect', hiredBy: 'Ada', hiredAt: '1970-01-01T00:00:00.000Z',
    worktree: { path: '.agent-office/worktrees/bolt', branch: 'office/bolt' },
    pr: { number: 7, state: 'merged', title: 'PR 7', url: 'https://github.com/acme/app/pull/7' },
    merged: true,
  });
  assert.equal(workerRow(worker('zed'), view).merged, false);
  assert.equal(workerRow(worker('zed'), view).pr?.state, 'open');
  const watched = workerRow(worker('bolt', { status: 'working', viewers: [] }), view);
  assert.equal(watched.staying, 'still working');
  assert.equal(workerRow(worker('mochi'), view, 'mochi').you, true);
  assert.equal(workerRow(worker('pat', { deskId: 'station-pulls' }), view).board, 'PR agent');
  assert.equal(notLeaving(worker('bolt', { viewers: ['Ada', 'Grace'] })), 'Ada, Grace have its terminal open');
  assert.equal(notLeaving(worker('bolt')), undefined);
});

test('finds a worker by id or name, and says who there is when it cannot', () => {
  const list = [worker('bolt'), worker('mochi', { name: 'Mochi 🐚', kind: 'shell' }), worker('x1', { name: 'Twin' }), worker('x2', { name: 'Twin' })];
  assert.equal((findWorker(list, 'bolt') as WorkerInfo).id, 'bolt');
  assert.equal((findWorker(list, ' BOLT ') as WorkerInfo).id, 'bolt');
  assert.equal((findWorker(list, 'mochi') as WorkerInfo).id, 'mochi');
  assert.match(findWorker(list, 'Twin') as string, /More than one worker is called Twin: use an id \(x1, x2\)/);
  assert.match(findWorker(list, 'Nope') as string, /No worker here is called Nope \(there's Bolt, Mochi 🐚, Twin, Twin\)/);
  assert.match(findWorker([], 'Nope') as string, /nobody is at a desk/);
});

test('reads send-home and hire requests', () => {
  assert.deepEqual(readHomeRequest({ workers: ['Bolt', ' Bolt ', 'Zed'] }), { workers: ['Bolt', 'Zed'], merged: false });
  assert.deepEqual(readHomeRequest({ worker: 'Bolt', cleanup: 'auto' }), { workers: ['Bolt'], merged: false });
  assert.deepEqual(readHomeRequest({ merged: true, cleanup: 'worktree' }), { workers: [], merged: true, cleanup: 'worktree' });
  assert.match(readHomeRequest({}) as string, /Say who/);
  assert.match(readHomeRequest({ workers: ['a'], merged: true }) as string, /not both/);
  assert.match(readHomeRequest({ workers: 'Bolt' }) as string, /list/);
  assert.match(readHomeRequest({ merged: true, cleanup: 'nuke' }) as string, /cleanup is one of/);

  const providers = ['claude', 'codex'] as const;
  assert.deepEqual(readHireRequest({ prompt: ' Fix it\r\n', provider: 'codex', effort: 'high', worktree: false, desk: 'desk-3', issue: 4 }, [...providers]), {
    prompt: 'Fix it', provider: 'codex', effort: 'high', worktree: false, desk: 'desk-3', issue: 4,
  });
  assert.match(readHireRequest({}, [...providers]) as string, /prompt/);
  assert.match(readHireRequest({ prompt: 'x', provider: 'grok' }, [...providers]) as string, /provider is one of claude, codex/);
  assert.match(readHireRequest({ prompt: 'x', desk: 'station-queue' }, [...providers]) as string, /desk/);
  assert.match(readHireRequest({ prompt: 'x', issue: 0 }, [...providers]) as string, /issue/);
});

test("Codex is told to pass the office's variables on to the MCP server", () => {
  const args = codexMcpArgs('/opt/app/bin/office-workers.js');
  assert.deepEqual(args.filter((_, i) => i % 2 === 0), ['-c', '-c', '-c']);
  assert.deepEqual(args.filter((_, i) => i % 2 === 1), [
    `mcp_servers.agent-office.command=${JSON.stringify(process.execPath)}`,
    'mcp_servers.agent-office.args=["/opt/app/bin/office-workers.js","mcp"]',
    'mcp_servers.agent-office.env_vars=["AGENT_OFFICE_HOOK_URL","AGENT_OFFICE_WORKER_ID","AGENT_OFFICE_HOOK_TOKEN"]',
  ]);
});
