import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OmpUsageReader, ompAgentDir, ompSessionFile, ompSessionFileIn } from '../src/server/omp-usage.js';

/** One assistant record as OMP writes it, with what it says about the response. */
const record = (usage: unknown) => JSON.stringify({ type: 'message', message: { role: 'assistant', model: 'deepseek-v4-flash', usage } });

/** A response's numbers: total = input + output + cacheRead + cacheWrite. */
const spent = { input: 210, output: 267, cacheRead: 19072, cacheWrite: 0, totalTokens: 19549, reasoningTokens: 113, cost: { total: 0.000248916 } };

const scratch = (t: { after(fn: () => void): void }) => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-omp-usage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
};

test('OMP sessions are found in the store OMP itself keeps them in', (t) => {
  const root = scratch(t);
  const sessions = path.join(root, 'agent', 'sessions');
  const project = path.join(sessions, '-work-project');
  mkdirSync(project, { recursive: true });
  const file = path.join(project, '2026-10-08T13-41-09-440Z_01a11bbf.jsonl');
  writeFileSync(file, record(spent) + '\n');

  // Where OMP keeps everything: $PI_CODING_AGENT_DIR, else ~/.omp/agent (see `omp --help`).
  assert.equal(ompAgentDir('/cwd', { HOME: root }), path.join(root, '.omp', 'agent'));
  assert.equal(ompAgentDir('/cwd', { HOME: root, PI_CODING_AGENT_DIR: path.join(root, 'agent') }), path.join(root, 'agent'));
  // A session is found in whichever project folder holds it, and in a desk folder of its own.
  assert.equal(ompSessionFile(sessions, '01a11bbf'), file);
  assert.equal(ompSessionFile(sessions, '0100nope'), undefined);
  assert.equal(ompSessionFileIn(project, '01a11bbf'), file);
  // A session id names a file: none of it ever reaches outside the folder it is looked for in.
  assert.equal(ompSessionFileIn(project, '../outside'), undefined);
});

test('OMP usage is what its session records say, counted neither twice nor once too often', (t) => {
  const root = scratch(t);
  const file = path.join(root, 'session.jsonl');
  writeFileSync(file, record(spent) + '\n' + record(spent) + '\n');
  const reader = new OmpUsageReader();

  // output is reported including reasoning, which the office keeps apart; the cost is OMP's own.
  assert.deepEqual(reader.read(file, root), {
    input: 420,
    output: 308,
    cacheRead: 38144,
    cacheWrite: 0,
    cost: 0.000248916 + 0.000248916,
    calls: 2,
    costKnown: true,
    reasoning: 226,
    model: 'deepseek-v4-flash',
  });
  // The file grows as the agent works: what was already read is never counted again...
  writeFileSync(file, record(spent) + '\n', { flag: 'a' });
  assert.equal(reader.read(file, root)?.calls, 3);
  // ...and a scan with nothing new to read changes nothing.
  assert.equal(reader.read(file, root)?.calls, 3);
});

test('the reader takes only this desk\'s own session, and never invents a number', (t) => {
  const root = scratch(t);
  const file = path.join(root, 'session.jsonl');
  const outside = path.join(root, '..', 'other.jsonl');
  writeFileSync(file, record(spent) + '\n');
  writeFileSync(outside, record(spent) + '\n');
  const reader = new OmpUsageReader();

  // A file outside the folder a desk's session lives in is not this desk's conversation.
  assert.equal(reader.read(outside, root), undefined);
  // A record whose numbers don't add up is skipped, one without a price leaves the cost a floor, and
  // a user message or a line that isn't JSON at all is not a response.
  writeFileSync(file, [
    record({ ...spent, reasoningTokens: 999 }),
    record({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }),
    JSON.stringify({ type: 'message', message: { role: 'user', model: 'deepseek-v4-flash', usage: spent } }),
    'not json',
  ].join('\n') + '\n');
  assert.deepEqual(reader.read(file, root), {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    calls: 1,
    costKnown: false,
    model: 'deepseek-v4-flash',
  });
});
