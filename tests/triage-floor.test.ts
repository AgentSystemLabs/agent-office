import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StubClassifier, type RawAnswers } from '../src/server/triage/classifier.js';
import { FloorTriage } from '../src/server/triage/index.js';
import type { GhIssue, GhLabel, TriageServerMsg } from '../src/shared/protocol.js';

const READY: RawAnswers = {
  type: { value: 'bug', p: 0.9 },
  agent_ready: { p: 0.95 },
  size: { value: 'm', p: 0.8 },
  priority: { value: 'p0', p: 0.9 },
  needs_human: { p: 0.02 },
  cross_repo: { p: 0.02 },
};

function gi(number: number, over: Partial<GhIssue> = {}): GhIssue {
  return { number, title: `Issue ${number}`, state: 'OPEN', url: `https://github.com/me/app/issues/${number}`, author: 'dev', labels: [], assignees: [], createdAt: '', updatedAt: '', body: 'Do the thing', comments: 0, ...over };
}

function fixture(config: Record<string, unknown>, answers: (n: number) => RawAnswers = () => READY) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-triage-floor-'));
  writeFileSync(path.join(dir, 'triage.json'), JSON.stringify(config));
  const classifier = new StubClassifier((i) => answers(i.issue.number));
  const labels = new Map<number, string[]>();
  const queued: { n: number; model: unknown; priority: number }[] = [];
  const comments: number[] = [];
  const sent: TriageServerMsg[] = [];
  const gh: string[][] = [];
  let board = (_items: GhIssue[]) => {};
  let shown: GhIssue[] = [];
  const triage = new FloorTriage({
    dir,
    dataDir: dir,
    classifier,
    run: async (args) => (gh.push(args), args[0] === 'api' ? 'write' : ''),
    issueDetail: async (n) => ({ number: n, state: 'OPEN', body: 'Do the thing', comments: [], viewer: 'office' }),
    repoName: async () => 'me/app',
    repoLabels: async () => [] as GhLabel[],
    setLabels: async (n, add, remove) => {
      labels.set(n, [...(labels.get(n) ?? []).filter((l) => !remove.includes(l)), ...add]);
      // Like GitHub.setLabels: the board is sent again at once, with the new labels on it.
      board(shown.map((i) => (i.number === n ? { ...i, labels: labels.get(n)!.map((name) => ({ name, color: '#fff' })) } : i)));
      return { labels: [] };
    },
    comment: async (n) => (comments.push(n), {}),
    queue: (issue, model, priority) => (queued.push({ n: issue.number, model, priority }), undefined),
    needsDetailComment: () => 'more please',
    emit: (m) => sent.push(m),
    toast() {},
  });
  /** Waits until triage has nothing left to do. */
  const settle = async () => {
    for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
  };
  board = (items: GhIssue[]) => ((shown = items), triage.onIssues({ items, fetchedAt: Date.now(), loading: false }));
  return { dir, triage, classifier, labels, queued, comments, sent, gh, settle, board, close: () => (triage.shutdown(), rmSync(dir, { recursive: true, force: true })) };
}

test('shadow mode classifies and reports, but writes nothing and queues nothing', async (t) => {
  const f = fixture({ writeLabels: false });
  t.after(f.close);
  f.board([gi(1)]);
  await f.settle();
  assert.equal(f.classifier.calls.length, 1);
  assert.equal(f.labels.size, 0);
  assert.equal(f.queued.length, 0);
  const r = f.triage.state().results[0];
  assert.equal(r.decision, 'queued');
  assert.equal(r.shadow, true);
  assert.ok(readFileSync(path.join(f.dir, 'triage.log'), 'utf8').includes('"decision":"queued"'));
});

test('an unchanged issue is never classified twice, even after triage labels it', async (t) => {
  const f = fixture({ writeLabels: true, autoQueue: true });
  t.after(f.close);
  f.board([gi(1)]);
  await f.settle();
  // The board comes back with triage's own labels on it, and a newer updatedAt.
  f.board([gi(1, { labels: (f.labels.get(1) ?? []).map((name) => ({ name, color: '#fff' })), updatedAt: 'later' })]);
  await f.settle();
  assert.equal(f.classifier.calls.length, 1);
  f.board([gi(1, { body: 'Do the thing, and the other thing', labels: (f.labels.get(1) ?? []).map((name) => ({ name, color: '#fff' })) })]);
  await f.settle();
  assert.equal(f.classifier.calls.length, 2);
});

test('auto-queue queues with the size model and priority, and labels it on GitHub', async (t) => {
  const f = fixture({ writeLabels: true, autoQueue: true });
  t.after(f.close);
  f.board([gi(1)]);
  await f.settle();
  assert.deepEqual(f.queued, [{ n: 1, model: { provider: 'claude', model: 'sonnet', effort: 'medium' }, priority: 0 }]);
  assert.deepEqual(f.labels.get(1), ['type:bug', 'size:m', 'prio:p0', 'triage:queued']);
  assert.equal(f.triage.state().stats.queued, 1);
  // Its own labels coming back on the board mid-way never look like a person's.
  assert.deepEqual(f.sent.map((m) => (m.t === 'triage.result' ? m.result.decision : m.t)), ['queued']);
});

test('the daily cap holds the rest', async (t) => {
  const f = fixture({ writeLabels: true, autoQueue: true, dailyCap: 1 });
  t.after(f.close);
  f.board([gi(1), gi(2)]);
  await f.settle();
  assert.equal(f.queued.length, 1);
  assert.equal(f.triage.state().results.find((r) => r.number === 2)?.decision, 'held');
});

test('needs-detail asks once, and its own comment does not count as a change', async (t) => {
  const f = fixture({ writeLabels: true }, () => ({ ...READY, agent_ready: { p: 0.3 } }));
  t.after(f.close);
  f.board([gi(1)]);
  await f.settle();
  assert.deepEqual(f.comments, [1]);
  f.board([gi(1, { comments: 1, labels: (f.labels.get(1) ?? []).map((name) => ({ name, color: '#fff' })) })]);
  await f.settle();
  assert.equal(f.classifier.calls.length, 1);
  assert.deepEqual(f.comments, [1]);
});

test('changing a triage label by hand opts the issue out, until Re-classify', async (t) => {
  const f = fixture({ writeLabels: true }, () => ({ ...READY, agent_ready: { p: 0.3 } }));
  t.after(f.close);
  f.board([gi(1)]);
  await f.settle();
  const relabelled = gi(1, { comments: 1, labels: [{ name: 'type:feature', color: '#fff' }] });
  f.board([relabelled]);
  await f.settle();
  assert.equal(f.triage.state().results[0].decision, 'opted-out');
  f.board([relabelled]);
  await f.settle();
  assert.equal(f.classifier.calls.length, 1);
  assert.equal(f.triage.reclassify(1), undefined);
  await f.settle();
  assert.equal(f.classifier.calls.length, 2);
  assert.equal(f.triage.state().results[0].decision, 'needs-detail');
});

test('an issue labelled by a person before triage saw it is left alone', async (t) => {
  const f = fixture({ writeLabels: true });
  t.after(f.close);
  f.board([gi(1, { labels: [{ name: 'prio:p0', color: '#fff' }] })]);
  await f.settle();
  assert.equal(f.classifier.calls.length, 0);
  assert.equal(f.triage.state().results[0].decision, 'opted-out');
});

test('Queue anyway queues a held issue but never one that needs a human', async (t) => {
  const f = fixture({ writeLabels: true, autoQueue: false }, (n) => (n === 2 ? { ...READY, needs_human: { p: 0.9 } } : READY));
  t.after(f.close);
  f.board([gi(1), gi(2)]);
  await f.settle();
  assert.equal(f.queued.length, 0);
  assert.equal(f.triage.queueAnyway(1), undefined);
  assert.match(f.triage.queueAnyway(2) ?? '', /needs a human/);
  await f.settle();
  assert.deepEqual(f.queued.map((q) => q.n), [1]);
});

test('a classifier failure is recorded and tried again later, not straight away', async (t) => {
  const f = fixture({ writeLabels: false }, () => ({ ...READY, size: { value: 'enormous', p: 1 } }));
  t.after(f.close);
  f.board([gi(1)]);
  await f.settle();
  assert.equal(f.triage.state().results[0].decision, 'error');
  f.board([gi(1)]);
  await f.settle();
  assert.equal(f.classifier.calls.length, 1);
});

test('triage off in triage.json does nothing', async (t) => {
  const f = fixture({ enabled: false });
  t.after(f.close);
  f.board([gi(1)]);
  await f.settle();
  assert.equal(f.classifier.calls.length, 0);
  assert.equal(f.triage.state().enabled, false);
});

test('turning auto-queue on routes held issues again, with no new classifier call', async (t) => {
  const f = fixture({ writeLabels: true, autoQueue: false });
  t.after(f.close);
  f.board([gi(1)]);
  await f.settle();
  assert.equal(f.triage.state().results[0].decision, 'held');
  writeFileSync(path.join(f.dir, 'triage.json'), JSON.stringify({ writeLabels: true, autoQueue: true }));
  f.board([gi(1, { labels: (f.labels.get(1) ?? []).map((name) => ({ name, color: '#fff' })) })]);
  await f.settle();
  assert.equal(f.classifier.calls.length, 1);
  assert.deepEqual(f.queued.map((q) => q.n), [1]);
  assert.ok(f.labels.get(1)!.includes('triage:queued') && !f.labels.get(1)!.includes('triage:ready'));
  // Settled: the next look changes nothing.
  f.board([gi(1, { labels: (f.labels.get(1) ?? []).map((name) => ({ name, color: '#fff' })) })]);
  await f.settle();
  assert.equal(f.queued.length, 1);
});
