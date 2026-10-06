import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Collaborators } from '../src/server/triage/authors.js';
import { TriageCache, issueHash } from '../src/server/triage/cache.js';
import { JevClassifier, jevAnswers, toAnswers } from '../src/server/triage/classifier.js';
import { ensureLabels, humanOverrode, labelDiff } from '../src/server/triage/labels.js';
import { questions, stateBlock } from '../src/server/triage/state-block.js';

const lbl = (...names: string[]) => names.map((name) => ({ name, color: '#fff' }));
const issue = { title: 'Login breaks', body: 'Steps…', labels: lbl('bug-report'), comments: 2 };

test('issue hash ignores triage-owned labels and triage comments, but not anything else', () => {
  const h = issueHash(issue, 0);
  assert.equal(issueHash({ ...issue, labels: lbl('bug-report', 'type:bug', 'triage:queued') }, 0), h);
  assert.equal(issueHash({ ...issue, comments: 3 }, 1), h);
  assert.notEqual(issueHash({ ...issue, comments: 3 }, 0), h);
  assert.notEqual(issueHash({ ...issue, body: 'More steps' }, 0), h);
  assert.notEqual(issueHash({ ...issue, labels: lbl('bug-report', 'urgent') }, 0), h);
});

test('labels: only owned ones are added and removed, and a hand-made change is noticed', () => {
  assert.deepEqual(labelDiff(['bug-report', 'type:feature', 'size:s'], ['type:bug', 'size:s']), { add: ['type:bug'], remove: ['type:feature'] });
  assert.equal(humanOverrode(['bug-report', 'type:bug', 'size:s'], ['size:s', 'type:bug']), false);
  assert.equal(humanOverrode(['type:feature', 'size:s'], ['type:bug', 'size:s']), true);
  assert.equal(humanOverrode(['size:s'], ['type:bug', 'size:s']), true);
  assert.equal(humanOverrode(['bug-report'], undefined), false);
  assert.equal(humanOverrode(['type:bug'], undefined), true);
});

test('ensureLabels creates only the missing ones and shrugs off "already exists"', async () => {
  const calls: string[][] = [];
  const known = new Set(['type:bug']);
  await ensureLabels(async (args) => {
    calls.push(args);
    if (args[2] === 'size:s') throw new Error('label with name "size:s" already exists');
    return '';
  }, ['type:bug', 'size:s', 'triage:queued'], known);
  assert.deepEqual(calls.map((c) => c[2]), ['size:s', 'triage:queued']);
  assert.equal(calls[1][4], '0e8a16');
  assert.ok(known.has('triage:queued'));
});

test('collaborators: write access or the floor list is trusted, and answers are kept', async () => {
  let asked = 0;
  const c = new Collaborators(async (args) => {
    asked++;
    if (args[1].includes('/stranger/')) throw new Error('HTTP 404');
    return args[1].includes('/reader/') ? 'read\n' : 'write\n';
  });
  assert.equal(await c.trusted('dev', []), true);
  assert.equal(await c.trusted('dev', []), true);
  assert.equal(await c.trusted('reader', []), false);
  assert.equal(await c.trusted('stranger', []), false);
  assert.equal(await c.trusted('Friend', ['friend']), true);
  assert.equal(await c.trusted('bad/login', []), false);
  assert.equal(asked, 3);
});

test('cache keeps counts per day and forgets closed issues', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-triage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const c = new TriageCache(dir);
  const now = new Date(2026, 9, 5, 12).getTime();
  c.count('triaged', now);
  c.count('queued', now);
  c.spend(0.0012, now);
  c.set({ number: 1, at: now, hash: 'x', ourComments: 0, decision: 'queued', reason: '', labels: [], shadow: false });
  c.set({ number: 2, at: now, hash: 'y', ourComments: 0, decision: 'held', reason: '', labels: [], shadow: false });
  const again = new TriageCache(dir);
  assert.deepEqual(again.stats(10, now), { day: '2026-10-05', triaged: 1, queued: 1, cap: 10, spend: 0.0012 });
  assert.equal(again.stats(10, now + 86_400_000).queued, 0);
  again.keepOnly(new Set([2]));
  assert.deepEqual(again.entries().map((e) => e.number), [2]);
});

test('state block keeps the newest comments that fit and clips long bodies', () => {
  const s = stateBlock({
    repo: 'me/app',
    description: '',
    areas: [],
    folders: ['src'],
    issue: { number: 7, title: 't', body: 'x'.repeat(30_000), author: 'a', labels: [] },
    comments: Array.from({ length: 15 }, (_, i) => ({ author: 'c', body: `${i}:${'y'.repeat(9_000)}` })),
  }) as any;
  assert.ok(s.issue.body.length < 20_100);
  assert.ok(JSON.stringify(s).length <= 60_000);
  // The last ten, each clipped.
  assert.equal(s.comments.length, 10);
  assert.ok(s.comments[0].body.startsWith('5:') && s.comments[0].body.length < 3_100);
  assert.ok(s.comments.at(-1).body.startsWith('14:'));
  assert.deepEqual(s.repository.top_level_folders, ['src']);
});

test('questions ask about areas only when the floor has some', () => {
  assert.equal(questions([]).area, undefined);
  assert.deepEqual(Object.keys((questions([{ name: 'api', description: 'HTTP' }]).area as any).criteria), ['api']);
});

const JEV_RESPONSE = {
  model: 'jev-1.13.0',
  answers: {
    type: { type: 'choice', choice: 'bug', probabilities: { bug: 0.88, feature: 0.12 }, confidence: 0.81 },
    agent_ready: { type: 'noul', noul: 0.91 },
    size: { type: 'choice', choice: 's', probabilities: { s: 0.7, m: 0.3 }, confidence: 0.6 },
    priority: { type: 'choice', choice: 'p2', probabilities: { p2: 0.66 }, confidence: 0.5 },
    needs_human: { type: 'noul', noul: 0.04 },
    cross_repo: { type: 'noul', noul: 0.02 },
  },
  usage: { input_tokens: 1_000_000, output_tokens: 20 },
};

test("Jev's answers become typed answers, with the chosen option's probability", () => {
  const a = toAnswers(jevAnswers(JEV_RESPONSE), []);
  assert.deepEqual(a.type, { value: 'bug', p: 0.88 });
  assert.deepEqual(a.agentReady, { p: 0.91 });
  assert.deepEqual(a.area, { value: '', p: 1 });
  assert.throws(() => toAnswers(jevAnswers({ answers: { ...JEV_RESPONSE.answers, size: { type: 'choice', choice: 'huge', probabilities: { huge: 1 } } } }), []), /size/);
});

test('JevClassifier sends the documented request, prices input tokens, and retries 529', async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  let calls = 0;
  const fake = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    if (calls++ === 0) return new Response('busy', { status: 529 });
    return new Response(JSON.stringify(JEV_RESPONSE), { status: 200 });
  }) as unknown as typeof fetch;
  const jev = new JevClassifier({ apiKey: 'k', fetch: fake });
  // The first retry waits 2s; that's the backoff working.
  const r = await jev.classify({ repo: 'me/app', description: '', areas: [], folders: [], issue: { number: 1, title: 't', body: 'b', author: 'a', labels: [] }, comments: [] });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal((sent[0].init.headers as Record<string, string>).authorization, 'Bearer k');
  const body = JSON.parse(sent[0].init.body as string);
  assert.equal(body.model, 'jev-latest');
  assert.equal(body.questions.agent_ready.type, 'noul');
  assert.deepEqual(Object.keys(body.questions.size.criteria), ['xs', 's', 'm', 'l', 'xl']);
  assert.equal(r.cost, 0.042);
  assert.equal(r.answers.size.value, 's');
});

test('JevClassifier does not retry a rejected key', async () => {
  let calls = 0;
  const fake = (async () => (calls++, new Response('no', { status: 401 }))) as unknown as typeof fetch;
  await assert.rejects(new JevClassifier({ apiKey: 'bad', fetch: fake }).classify({ repo: 'r', description: '', areas: [], folders: [], issue: { number: 1, title: 't', body: '', author: 'a', labels: [] }, comments: [] }), /401/);
  assert.equal(calls, 1);
});
