import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { UsageError, buildRequest, formatQueue, main, officeEnv, parseArgs } from '../bin/office-queue.js';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'office-queue.js');
const ENV = { AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:4455', AGENT_OFFICE_WORKER_ID: 'w1 &x', AGENT_OFFICE_HOOK_TOKEN: 'tok' };
const OFFICE = { url: 'http://127.0.0.1:4455', worker: 'w1', token: 'tok' };

test('parses list, add and remove, with their options', () => {
  assert.deepEqual(parseArgs([]), { cmd: 'help' });
  assert.deepEqual(parseArgs(['--help']), { cmd: 'help' });
  assert.deepEqual(parseArgs(['add', '--help']), { cmd: 'help' });
  assert.deepEqual(parseArgs(['list']), { cmd: 'list' });
  assert.deepEqual(parseArgs(['ls']), { cmd: 'list' });
  assert.deepEqual(parseArgs(['remove', 'abc123']), { cmd: 'remove', id: 'abc123' });
  assert.deepEqual(parseArgs(['rm', 'abc123']), { cmd: 'remove', id: 'abc123' });
  assert.deepEqual(parseArgs(['add', '--title', 'Fix login']), { cmd: 'add', title: 'Fix login' });
  assert.deepEqual(parseArgs(['add', '--title=Fix login', '--issue', '12']), { cmd: 'add', title: 'Fix login', issue: 12 });
  assert.deepEqual(parseArgs(['add', '--issue=#7', '--title', ' Fix login ', '--prompt', 'Do it']), { cmd: 'add', title: 'Fix login', issue: 7, prompt: 'Do it' });
  // A prompt that looks like an option is still the prompt.
  assert.deepEqual(parseArgs(['add', '--title', 'T', '--prompt', '- fix the list']), { cmd: 'add', title: 'T', prompt: '- fix the list' });
});

test('says what is wrong with a bad command line', () => {
  const bad: [string[], RegExp][] = [
    [['frobnicate'], /Unknown command: frobnicate/],
    [['list', 'extra'], /list takes no arguments/],
    [['remove'], /remove takes one task id/],
    [['remove', 'a', 'b'], /remove takes one task id/],
    [['add'], /--title/],
    [['add', '--title'], /--title needs a value/],
    [['add', '--title', '  '], /Give the task a --title/],
    [['add', '--title', 'T', '--issue', 'twelve'], /--issue takes an issue number/],
    [['add', '--title', 'T', '--issue', '0'], /--issue takes an issue number/],
    [['add', '--title', 'T', '--model', 'x'], /Unknown option for add: --model/],
    [['add', 'Fix', 'login'], /Unexpected argument: Fix/],
  ];
  for (const [argv, message] of bad) assert.throws(() => parseArgs(argv), (e: Error) => e instanceof UsageError && message.test(e.message), argv.join(' '));
});

test('needs the office address, its worker id and its token from the environment', () => {
  assert.deepEqual(officeEnv({ ...ENV, AGENT_OFFICE_HOOK_URL: 'http://127.0.0.1:4455/' }), { url: 'http://127.0.0.1:4455', worker: 'w1 &x', token: 'tok' });
  assert.throws(() => officeEnv({}), /AGENT_OFFICE_HOOK_URL, AGENT_OFFICE_WORKER_ID, AGENT_OFFICE_HOOK_TOKEN aren't set.*inside Agent Office/);
  assert.throws(() => officeEnv({ ...ENV, AGENT_OFFICE_HOOK_TOKEN: '' }), /^Error: AGENT_OFFICE_HOOK_TOKEN isn't set/);
});

test('builds the /office/queue requests', () => {
  const auth = { authorization: 'Bearer tok' };
  assert.deepEqual(buildRequest({ cmd: 'list' }, { ...OFFICE, worker: 'w1 &x' }), {
    method: 'GET', url: 'http://127.0.0.1:4455/office/queue?worker=w1+%26x', headers: auth,
  });
  assert.deepEqual(buildRequest({ cmd: 'remove', id: 'abc/123' }, OFFICE), {
    method: 'DELETE', url: 'http://127.0.0.1:4455/office/queue?worker=w1&task=abc%2F123', headers: auth,
  });
  const add = buildRequest({ cmd: 'add', title: 'Fix login', issue: 12 }, OFFICE, 'Fix the redirect in src/login.ts.\r\nThen open a PR.\n');
  assert.equal(add.method, 'POST');
  assert.equal(add.url, 'http://127.0.0.1:4455/office/queue?worker=w1');
  assert.deepEqual(add.headers, { ...auth, 'content-type': 'application/json' });
  assert.deepEqual(JSON.parse(add.body), { title: 'Fix login', prompt: 'Fix the redirect in src/login.ts.\nThen open a PR.', issue: 12 });
  // --prompt wins over stdin; with no issue there's no "issue" key.
  const flagged = buildRequest({ cmd: 'add', title: 'T', prompt: 'from the flag' }, OFFICE, 'from stdin');
  assert.deepEqual(JSON.parse(flagged.body), { title: 'T', prompt: 'from the flag' });
  assert.throws(() => buildRequest({ cmd: 'add', title: 'T' }, OFFICE, '  \n'), /needs a prompt/);
});

test('lists the queue readably: id, status, title, worker and PR', () => {
  assert.equal(formatQueue({ maxWorkers: 2, tasks: [] }), 'The queue is empty · up to 2 at a time.');
  const text = formatQueue({
    maxWorkers: 2,
    tasks: [
      { id: 'aaa111', title: 'Fix login', status: 'running', issue: 12, worker: 'Pixel', branch: 'office/pixel-1a2b' },
      { id: 'bbb222', title: 'Dark mode', status: 'queued' },
      { id: 'ccc333', title: 'Rename the dog', status: 'done', outcome: 'done', worker: 'Byte', pr: { number: 9, url: 'https://github.com/o/r/pull/9', state: 'OPEN', title: 'x' } },
      { id: 'ddd444', title: 'Broken', status: 'done', outcome: 'failed', error: 'no desk' },
    ],
  });
  assert.equal(text, [
    '4 tasks · up to 2 at a time',
    'aaa111  running        Fix login (issue #12) · worker Pixel on office/pixel-1a2b',
    'bbb222  queued         Dark mode',
    'ccc333  done           Rename the dog · worker Byte · PR #9 open https://github.com/o/r/pull/9',
    'ddd444  done (failed)  Broken · error: no desk',
  ].join('\n'));
});

/** Runs main() against a fake fetch; returns what it printed and what it sent. */
async function run(argv: string[], opts: { env?: Record<string, string>; stdin?: string; status?: number; body?: unknown } = {}) {
  const sent: { url: string; init: RequestInit }[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response(JSON.stringify(opts.body ?? {}), { status: opts.status ?? 200 });
  };
  const code = await main(argv, {
    env: opts.env ?? ENV,
    stdin: Readable.from(opts.stdin === undefined ? [] : [opts.stdin]),
    fetch,
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
  });
  return { code, sent, out: out.join('\n'), err: err.join('\n') };
}

test('add sends the prompt from stdin and prints the new task id', async () => {
  const r = await run(['add', '--title', 'Fix login', '--issue', '12'], { stdin: 'Fix it.\n', body: { ok: true, task: { id: 'abc123', title: 'Fix login', status: 'queued' } } });
  assert.equal(r.code, 0);
  assert.equal(r.out, 'abc123');
  assert.match(r.err, /Queued “Fix login” \(queued, issue #12\)/);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(String(r.sent[0].init.body)), { title: 'Fix login', prompt: 'Fix it.', issue: 12 });
});

test('clear errors when the environment is missing or the office says no', async () => {
  const noEnv = await run(['list'], { env: {} });
  assert.equal(noEnv.code, 1);
  assert.equal(noEnv.sent.length, 0);
  assert.match(noEnv.err, /^office-queue: AGENT_OFFICE_HOOK_URL, AGENT_OFFICE_WORKER_ID, AGENT_OFFICE_HOOK_TOKEN aren't set/);

  const desk = await run(['list'], { status: 403, body: { error: 'Only the agents standing by the boards can use the queue' } });
  assert.equal(desk.code, 1);
  assert.equal(desk.err, 'office-queue: The office said no (403): Only the agents standing by the boards can use the queue.');

  const stale = await run(['list'], { status: 401, body: { error: 'Send your own AGENT_OFFICE_WORKER_ID' } });
  assert.match(stale.err, /didn't accept this agent's token \(401\)/);

  const running = await run(['remove', 'abc123'], { status: 400, body: { error: 'Pixel is on it — send the worker home to stop it' } });
  assert.equal(running.err, 'office-queue: The office said no (400): Pixel is on it — send the worker home to stop it.');

  const noPrompt = await run(['add', '--title', 'T'], { stdin: '' });
  assert.equal(noPrompt.code, 2);
  assert.equal(noPrompt.sent.length, 0);
  assert.match(noPrompt.err, /needs a prompt[\s\S]*Usage:/);

  const usage = await run(['add', 'oops']);
  assert.equal(usage.code, 2);
  assert.match(usage.err, /Unexpected argument: oops[\s\S]*Usage:/);
});

test('list and remove print what the office sent back', async () => {
  const list = await run(['list'], { body: { maxWorkers: 1, tasks: [{ id: 'abc123', title: 'Fix login', status: 'queued' }] } });
  assert.equal(list.code, 0);
  assert.equal(list.sent[0].init.method, 'GET');
  assert.equal(list.out, '1 task · up to 1 at a time\nabc123  queued  Fix login');
  const removed = await run(['remove', 'abc123'], { body: { maxWorkers: 1, tasks: [] } });
  assert.equal(removed.code, 0);
  assert.equal(removed.sent[0].init.method, 'DELETE');
  assert.equal(removed.out, 'Took abc123 off the queue.');
});

test('runs as a command: a heredoc prompt goes over HTTP with the agent\'s own token', async (t) => {
  const seen: { method?: string; url?: string; auth?: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const ok = req.headers.authorization === 'Bearer tok';
      res.writeHead(ok ? 200 : 403, { 'content-type': 'application/json' });
      res.end(JSON.stringify(ok ? { ok: true, task: { id: 'f00d', title: 'Fix login', status: 'queued' } } : { error: 'Only the agents standing by the boards can use the queue' }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cli = (env: Record<string, string>, input: string) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = execFile(process.execPath, [SCRIPT, 'add', '--title', 'Fix login'], { env: { PATH: process.env.PATH ?? '', ...env } }, (error, stdout, stderr) =>
        resolve({ code: error ? Number(error.code) : 0, stdout, stderr }));
      child.stdin!.end(input);
    });

  const ok = await cli({ ...ENV, AGENT_OFFICE_HOOK_URL: url, AGENT_OFFICE_WORKER_ID: 'w1' }, "Don't expand $HOME or `this`.\n");
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(ok.stdout, 'f00d\n');
  assert.deepEqual(seen[0], {
    method: 'POST', url: '/office/queue?worker=w1', auth: 'Bearer tok',
    body: JSON.stringify({ title: 'Fix login', prompt: "Don't expand $HOME or `this`." }),
  });

  const desk = await cli({ ...ENV, AGENT_OFFICE_HOOK_URL: url, AGENT_OFFICE_HOOK_TOKEN: 'desk-token' }, 'x');
  assert.equal(desk.code, 1);
  assert.equal(desk.stdout, '');
  assert.match(desk.stderr, /The office said no \(403\): Only the agents standing by the boards/);
});
