import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTriageConfig, type TriageConfig } from '../src/server/triage/config.js';
import { route, type RouteContext } from '../src/server/triage/route.js';
import type { TriageAnswers } from '../src/shared/protocol.js';

const cfg = (over: Record<string, unknown> = {}): TriageConfig => parseTriageConfig({ writeLabels: true, autoQueue: true, areas: [{ name: 'api', description: 'The HTTP API' }], ...over });

/** An issue that passes every rule; each test changes one thing. */
const ready = (over: Partial<TriageAnswers> = {}): TriageAnswers => ({
  type: { value: 'bug', p: 0.9 },
  area: { value: 'api', p: 0.8 },
  agentReady: { p: 0.95 },
  size: { value: 's', p: 0.8 },
  priority: { value: 'p1', p: 0.7 },
  needsHuman: { p: 0.05 },
  crossRepo: { p: 0.1 },
  ...over,
});

const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({ trustedAuthor: true, queuedToday: 0, ...over });

test('an agent-ready issue is queued with the model for its size and labelled', () => {
  const r = route(ready(), cfg(), ctx());
  assert.equal(r.decision, 'queued');
  assert.deepEqual(r.queue, { model: { provider: 'claude', model: 'sonnet', effort: 'low' }, priority: 1 });
  assert.deepEqual(r.labels, ['type:bug', 'area:api', 'size:s', 'prio:p1', 'triage:queued']);
});

test('size picks the model: m is sonnet medium, l is opus high, xl is split', () => {
  assert.deepEqual(route(ready({ size: { value: 'm', p: 0.9 } }), cfg(), ctx()).queue?.model, { provider: 'claude', model: 'sonnet', effort: 'medium' });
  assert.deepEqual(route(ready({ size: { value: 'l', p: 0.9 } }), cfg(), ctx()).queue?.model, { provider: 'claude', model: 'opus', effort: 'high' });
  const xl = route(ready({ size: { value: 'xl', p: 0.9 } }), cfg(), ctx());
  assert.equal(xl.decision, 'split-me');
  assert.ok(xl.labels.includes('triage:split-me'));
  assert.equal(xl.queue, undefined);
});

test('rule 1: needs-human at exactly the threshold stops it, and Queue anyway cannot get past it', () => {
  assert.equal(route(ready({ needsHuman: { p: 0.5 } }), cfg(), ctx()).decision, 'needs-human');
  assert.equal(route(ready({ needsHuman: { p: 0.4 } }), cfg(), ctx()).decision, 'queued');
  // Just under it isn't needs-human, but it's a coin flip, so it's held as unsure.
  assert.equal(route(ready({ needsHuman: { p: 0.49 } }), cfg(), ctx()).decision, 'held');
  const forced = route(ready({ needsHuman: { p: 0.9 } }), cfg(), ctx({ force: true }));
  assert.equal(forced.decision, 'needs-human');
  assert.equal(forced.queue, undefined);
});

test('rule 2: questions and duplicates are only labelled', () => {
  for (const value of ['question', 'duplicate-or-spam'] as const) {
    const r = route(ready({ type: { value, p: 0.9 } }), cfg(), ctx());
    assert.equal(r.decision, 'label-only');
    assert.equal(r.queue, undefined);
    assert.ok(!r.labels.some((l) => l.startsWith('triage:')));
  }
});

test('rule 3: agent-ready below 0.85 needs detail, and asks once when the floor wants it', () => {
  assert.equal(route(ready({ agentReady: { p: 0.85 } }), cfg(), ctx()).decision, 'queued');
  const r = route(ready({ agentReady: { p: 0.84 } }), cfg(), ctx());
  assert.equal(r.decision, 'needs-detail');
  assert.equal(r.comment, true);
  assert.equal(route(ready({ agentReady: { p: 0.2 } }), cfg({ commentOnNeedsDetail: false }), ctx()).comment, false);
});

test('rule 4: cross-repo waits for a human to pick floors', () => {
  assert.equal(route(ready({ crossRepo: { p: 0.8 } }), cfg(), ctx()).decision, 'cross-repo');
});

test('an answer under 0.6 is not labelled, gets low-confidence, and holds the issue', () => {
  const r = route(ready({ priority: { value: 'p0', p: 0.59 } }), cfg(), ctx());
  assert.ok(!r.labels.includes('prio:p0'));
  assert.ok(r.labels.includes('triage:low-confidence'));
  assert.equal(r.decision, 'held');
  assert.equal(route(ready({ priority: { value: 'p0', p: 0.6 } }), cfg(), ctx()).decision, 'queued');
  // A yes/no that's near a coin flip counts too.
  assert.ok(route(ready({ crossRepo: { p: 0.45 } }), cfg(), ctx()).lowConfidence);
});

test('an area the floor does not list is not labelled', () => {
  assert.ok(!route(ready({ area: { value: 'ui', p: 0.9 } }), cfg(), ctx()).labels.some((l) => l.startsWith('area:')));
});

test('gates: an untrusted author, auto-queue off and the daily cap hold it as ready', () => {
  for (const [c, x] of [
    [cfg(), ctx({ trustedAuthor: false })],
    [cfg({ autoQueue: false }), ctx()],
    [cfg({ dailyCap: 3 }), ctx({ queuedToday: 3 })],
  ] as const) {
    const r = route(ready(), c, x);
    assert.equal(r.decision, 'held');
    assert.ok(r.labels.includes('triage:ready'));
    assert.equal(r.queue, undefined);
  }
  assert.equal(route(ready(), cfg({ dailyCap: 3 }), ctx({ queuedToday: 2 })).decision, 'queued');
});

test('shadow mode says what auto-queue would do', () => {
  assert.equal(route(ready(), cfg({ autoQueue: false, writeLabels: false }), ctx({ shadow: true })).decision, 'queued');
});

test('Queue anyway skips rules 2-5 and the gates, and an xl gets the biggest model there is', () => {
  const r = route(ready({ size: { value: 'xl', p: 0.9 }, agentReady: { p: 0.1 }, type: { value: 'question', p: 0.9 } }), cfg({ autoQueue: false }), ctx({ force: true, trustedAuthor: false }));
  assert.equal(r.decision, 'queued');
  assert.deepEqual(r.queue?.model, { provider: 'claude', model: 'opus', effort: 'high' });
});

test('triage.json falls back to defaults on bad values and warns', () => {
  const warnings: string[] = [];
  const c = parseTriageConfig({ dailyCap: -1, thresholds: { agentReady: 2 }, areas: [{ name: 'Bad Name!' }], sizeMap: { s: { provider: 'nope' }, xl: { provider: 'claude', model: 'opus', effort: 'max' } } }, (w) => warnings.push(w));
  assert.equal(c.dailyCap, 10);
  assert.equal(c.thresholds.agentReady, 0.85);
  assert.deepEqual(c.areas, []);
  assert.deepEqual(c.sizeMap.s, { provider: 'claude', model: 'sonnet', effort: 'low' });
  assert.deepEqual(c.sizeMap.xl, { provider: 'claude', model: 'opus', effort: 'max' });
  assert.equal(warnings.length, 2);
});

test('agreement with hand labels: precision counts only issues triage called ready', async () => {
  const { agreement } = await import('../src/server/triage/eval.js');
  const a = (p: number, type: 'bug' | 'feature' = 'bug') => ready({ agentReady: { p }, type: { value: type, p: 0.9 } });
  const answers = new Map([[1, a(0.9)], [2, a(0.9)], [3, a(0.2, 'feature')], [4, a(0.95)]]);
  const r = agreement([
    { number: 1, agentReady: true, type: 'bug' },
    { number: 2, agentReady: false, type: 'bug' },
    { number: 3, agentReady: true, type: 'bug' },
    { number: 5, agentReady: true },
  ], answers, 0.85);
  assert.equal(r.compared, 3);
  assert.equal(r.agentReady.precision, 0.5);
  assert.equal(r.agentReady.recall, 0.5);
  assert.deepEqual(r.agentReady.falseYes, [2]);
  assert.deepEqual(r.type, { right: 2, of: 3 });
});
