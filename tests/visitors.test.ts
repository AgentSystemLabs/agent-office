import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { VisitorsState } from '../src/shared/protocol.js';
import { appOf, sessionOf, turnOf } from '../src/server/visitors/transcript.js';
import { SessionScanner } from '../src/server/visitors/scan.js';
import { Visitors, claudeProjectsDir, floorFor, shortFolder, visitorOf } from '../src/server/visitors/index.js';

const NOW = Date.UTC(2026, 10, 9, 12);
const lines = (...es: object[]) => es.map((e) => JSON.stringify(e)).join('\n') + '\n';
const assistant = (content: object[], stop_reason: string | null, extra: object = {}) => ({ type: 'assistant', message: { model: 'claude-opus-5-5', content, stop_reason }, ...extra });
const user = (content: unknown, extra: object = {}) => ({ type: 'user', message: { role: 'user', content }, ...extra });
const toolUse = (name: string, input: object) => ({ type: 'tool_use', id: 't1', name, input });

test("how a session is getting on, from its transcript's last messages", () => {
  assert.deepEqual(turnOf([user('fix it'), assistant([toolUse('Bash', { command: 'npm test' })], 'tool_use')]), { status: 'working', activity: 'Bash: npm test', model: 'claude-opus-5-5', found: true });
  // A tool's result came last: still at work, on the call before it.
  assert.equal(turnOf([assistant([toolUse('Read', { file_path: '/a.ts' })], 'tool_use'), user([{ type: 'tool_result', tool_use_id: 't1', content: 'x' }])]).activity, 'Read: /a.ts');
  assert.equal(turnOf([assistant([toolUse('AskUserQuestion', { questions: [] })], 'tool_use')]).status, 'needs_input');
  assert.deepEqual(turnOf([assistant([{ type: 'text', text: 'All   done\nhere.' }], 'end_turn'), { type: 'system', subtype: 'stop_hook_summary' }]), { status: 'done', activity: 'All done here.', model: 'claude-opus-5-5', found: true });
  assert.equal(turnOf([assistant([{ type: 'text', text: 'x' }], 'tool_use'), user('[Request interrupted by user]')]).status, 'done');
  assert.equal(turnOf([user('go')]).status, 'working');
  assert.equal(turnOf([assistant([toolUse('mcp__Claude_Browser__browser_batch', {})], 'tool_use')]).activity, 'browser_batch');
  // A subagent's transcript is all off the main thread.
  const side = [assistant([toolUse('Grep', { pattern: 'login' })], 'tool_use', { isSidechain: true })];
  assert.equal(turnOf(side).found, false);
  assert.equal(turnOf(side, true).activity, 'Grep: login');
  assert.equal(turnOf([]).found, false);
});

test("what a session is called, where it runs, and in which app", () => {
  const head = [
    { type: 'queue-operation', operation: 'enqueue' },
    user('<system-reminder>not a prompt</system-reminder>', { entrypoint: 'claude-desktop', cwd: '/Users/o/Work/site', gitBranch: 'HEAD' }),
    user('Make the hero section load faster on phones', { entrypoint: 'claude-desktop', cwd: '/Users/o/Work/site' }),
  ];
  assert.deepEqual(sessionOf(head, head), { app: 'desktop', prompt: 'Make the hero section load faster on phones', cwd: '/Users/o/Work/site' });
  const tail = [{ type: 'custom-title', customTitle: 'Old name' }, { type: 'custom-title', customTitle: 'Hero speed' }, user('ok', { gitBranch: 'dev' })];
  assert.equal(sessionOf(head, tail).title, 'Hero speed');
  assert.equal(sessionOf(head, tail).branch, 'dev');
  assert.equal(sessionOf([{ type: 'summary', summary: 'Login fix' }], []).title, 'Login fix');
  assert.equal(appOf('cli'), 'cli');
  assert.equal(appOf('claude-vscode'), 'ide');
  assert.equal(appOf('sdk-cli'), 'other');
  assert.equal(shortFolder('/Users/o/Work/site'), 'Work/site');
  assert.equal(claudeProjectsDir({ CLAUDE_CONFIG_DIR: '/x/claude' }), path.join('/x/claude', 'projects'));
});

/** Claude Code's projects folder, as it lays it out, with files dated `ago` ms before NOW. */
function projects(t: test.TestContext) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ao-visitors-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (rel: string, body: string, ago: number) => {
    const file = path.join(root, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
    const at = (NOW - ago) / 1000;
    utimesSync(file, at, at);
  };
  return { root, put };
}

const UUID = (n: number) => `0000000${n}-aaaa-bbbb-cccc-000000000000`;

/** Every file under `dir`, with what's in it and when it was written. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = `${st.mtimeMs}|${createHash('sha1').update(readFileSync(p)).digest('hex')}`;
    }
  };
  walk(dir);
  return out;
}

test('the scanner finds the sessions in use and their subagents at work, and never writes a byte', (t) => {
  const { root, put } = projects(t);
  const cwd = '/Users/o/Work/site';
  // In use: written a minute ago, with one subagent at work, one finished and one long quiet.
  put(`-Users-o-Work-site/${UUID(1)}.jsonl`, lines({ type: 'custom-title', customTitle: 'Hero speed' }, user('go', { entrypoint: 'claude-desktop', cwd }), assistant([toolUse('Agent', { description: 'Measure LCP' })], 'tool_use')), 60_000);
  put(`-Users-o-Work-site/${UUID(1)}/subagents/agent-a1.jsonl`, lines(assistant([toolUse('Bash', { command: 'lighthouse' })], 'tool_use', { isSidechain: true })), 5_000);
  put(`-Users-o-Work-site/${UUID(1)}/subagents/agent-a1.meta.json`, JSON.stringify({ agentType: 'general-purpose', description: 'Measure LCP' }), 5_000);
  put(`-Users-o-Work-site/${UUID(1)}/subagents/agent-a2.jsonl`, lines(assistant([{ type: 'text', text: 'ok' }], 'end_turn', { isSidechain: true })), 5_000);
  put(`-Users-o-Work-site/${UUID(1)}/subagents/agent-a2.meta.json`, JSON.stringify({ agentType: 'Explore', finished: true }), 5_000);
  put(`-Users-o-Work-site/${UUID(1)}/subagents/agent-a3.jsonl`, lines(assistant([{ type: 'text', text: 'ok' }], 'end_turn', { isSidechain: true })), 30 * 60_000);
  // Its own turn ended an hour ago, but a workflow it started is still at work.
  put(`-Users-o-Work-api/${UUID(2)}.jsonl`, lines(user('run the audit', { entrypoint: 'cli', cwd: '/Users/o/Work/api' }), assistant([{ type: 'text', text: 'Started.' }], 'end_turn')), 60 * 60_000);
  put(`-Users-o-Work-api/${UUID(2)}/subagents/workflows/wf_1/agent-b1.jsonl`, lines(assistant([toolUse('Read', { file_path: 'LICENSE' })], 'tool_use', { isSidechain: true })), 2_000);
  put(`-Users-o-Work-api/${UUID(2)}/subagents/workflows/wf_1/agent-b1.meta.json`, JSON.stringify({ agentType: 'workflow-subagent', description: 'verify:licence', workflowPhase: 'Verify' }), 2_000);
  // Done an hour ago, with nothing at work: gone home. And the office's own worker.
  put(`-Users-o-Work-api/${UUID(3)}.jsonl`, lines(user('hi', { cwd: '/Users/o/Work/api' }), assistant([{ type: 'text', text: 'hi' }], 'end_turn')), 60 * 60_000);
  put(`-Users-o-Work-site/${UUID(4)}.jsonl`, lines(user('worker task', { cwd }), assistant([toolUse('Edit', {})], 'tool_use')), 1_000);
  // Not a session's transcript at all.
  put('-Users-o-Work-site/memory/notes.jsonl', 'x\n', 1_000);
  const before = snapshot(root);

  const scanner = new SessionScanner(root);
  const seen = scanner.scan((id) => id === UUID(4), NOW).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(seen.map((s) => s.id), [UUID(1), UUID(2)]);
  const [site, api] = seen;
  assert.equal(site.facts.title, 'Hero speed');
  assert.equal(site.facts.app, 'desktop');
  assert.equal(site.turn.activity, 'Agent: Measure LCP');
  assert.deepEqual(site.subagents.map((s) => [s.id, s.type, s.title, s.activity]), [['a1', 'general-purpose', 'Measure LCP', 'Bash: lighthouse']]);
  assert.equal(api.turn.status, 'done');
  assert.deepEqual(api.subagents.map((s) => [s.id, s.phase, s.activity]), [['b1', 'Verify', 'Read: LICENSE']]);
  // Waiting on its workflow, it's at work too.
  const v = visitorOf(api, true);
  assert.equal(v.status, 'working');
  assert.equal(v.activity, '1 subagent at work');
  assert.equal(v.title, 'run the audit');
  assert.equal(v.lobby, true);
  // Again, from what it kept, and with nothing changed on disk.
  assert.equal(scanner.scan((id) => id === UUID(4), NOW + 1000).length, 2);
  assert.deepEqual(snapshot(root), before);
});

test('a visitor goes to the floor it works in, by folder or by repository, else to the lobby', () => {
  const floors = [
    { id: 'lobby-floor', dir: '/srv/office/acme/web', repo: 'acme/web' },
    { id: 'site', dir: '/srv/office/o/site', repo: 'Omar-Tnzxo/omar-agha-site' },
  ];
  assert.deepEqual(floorFor('/srv/office/o/site/src', undefined, floors), { floor: 'site', lobby: false });
  assert.deepEqual(floorFor('/Users/o/Work/portfolio', 'omar-tnzxo/OMAR-AGHA-SITE', floors), { floor: 'site', lobby: false });
  assert.deepEqual(floorFor('/Users/o/Work/other', 'o/other', floors), { floor: 'lobby-floor', lobby: true });
  assert.deepEqual(floorFor(undefined, undefined, floors), { floor: 'lobby-floor', lobby: true });
  // A worker's own worktree: the office's, never a visitor.
  assert.equal(floorFor('/srv/office/o/site/.agent-office/worktrees/w1', 'Omar-Tnzxo/omar-agha-site', floors), undefined);
  assert.equal(floorFor('/x', undefined, []), undefined);
});

test("the office tells each floor its visitors when they change, never counts its own workers, and can be switched off", async (t) => {
  const { root, put } = projects(t);
  const now = Date.now();
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-floor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  put(`p/${UUID(5)}.jsonl`, lines(user('visit', { entrypoint: 'cli', cwd: dir }), assistant([toolUse('Bash', { command: 'ls' })], 'tool_use')), 0);
  put(`p/${UUID(6)}.jsonl`, lines(user('worker', { cwd: dir }), assistant([toolUse('Bash', { command: 'ls' })], 'tool_use')), 0);
  for (const f of [`p/${UUID(5)}.jsonl`, `p/${UUID(6)}.jsonl`]) utimesSync(path.join(root, f), now / 1000, now / 1000);
  const sent: [string, VisitorsState][] = [];
  const visitors = new Visitors(
    { root },
    {
      floors: () => [{ id: 'f1', dir }, { id: 'f2', dir: '/nowhere' }],
      workerSessions: () => new Set([UUID(6)]),
      watched: () => true,
      send: (floor, state) => void sent.push([floor, state]),
    },
  );
  await visitors.look(now);
  assert.deepEqual(sent.map(([f, s]) => [f, s.visitors.map((v) => [v.id, v.app, v.status, v.lobby])]), [
    ['f1', [[UUID(5), 'cli', 'working', false]]],
    ['f2', []],
  ]);
  assert.equal(visitors.state('f1').visitors[0].activity, 'Bash: ls');
  await visitors.look(now + 1);
  assert.equal(sent.length, 2, 'nothing changed, nothing sent');
  const off = new Visitors({ root, off: true }, { floors: () => [], workerSessions: () => new Set(), watched: () => true, send: () => assert.fail('sent while off') });
  await off.look(now);
  assert.deepEqual(off.state('f1'), { visitors: [], off: true });
});
