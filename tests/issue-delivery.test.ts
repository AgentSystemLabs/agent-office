import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { completeDelivery, IssueDeliveries, validateDelivery, type DeliveryDeps, type DeliveryRequest } from '../src/server/issue-delivery.js';
import { Playtests, readPlaytest } from '../src/server/playtests.js';
import type { QueueTask } from '../src/shared/protocol.js';
import { withIssueDeliveryPolicy, ISSUE_DELIVERY_POLICY } from '../src/shared/issue-delivery.js';

test('follow-up messages teach existing coordinators the workflow, without altering worker requests or blank input', () => {
  assert.equal(withIssueDeliveryPolicy('desk-1', 'Fix assigned task'), 'Fix assigned task');
  assert.equal(withIssueDeliveryPolicy('station-pulls', ' '), ' ');
  const prompt = withIssueDeliveryPolicy('station-pulls', 'Review the authorized PR');
  assert.ok(prompt.startsWith('Review the authorized PR'));
  assert.ok(prompt.includes(ISSUE_DELIVERY_POLICY));
  assert.equal(withIssueDeliveryPolicy('station-pulls', prompt), prompt);
  assert.ok(withIssueDeliveryPolicy('station-issues', 'Reconcile completed issues').includes('office-deliver'));
});

function fixture(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-delivery-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Playtests(dir);
  const log: string[] = [];
  const issue = { state: 'OPEN', body: '- [ ] Implement pose\n- [ ] Check on headset', url: 'https://github.com/owner/repo/issues/286' };
  const pr = { state: 'MERGED', head: 'a'.repeat(40), base: 'main', defaultBranch: 'main', url: 'https://github.com/owner/repo/pull/297', title: 'Fix pose', mergedAt: '2026-10-10T12:00:00Z', references: true, failedChecks: false };
  const request: DeliveryRequest = { issue: 286, pr: 297, head: pr.head, summary: 'Pose implemented', technicalEvidence: 'Exact head: 9 pose tests passed', implementationComplete: true, remainingImplementation: [], criteria: [
    { text: 'Implement pose', kind: 'implemented', evidence: 'GripPose plus automated pose tests' },
    { text: 'Check on headset', kind: 'manual', test: { title: 'Pistol pose', category: 'Rift', steps: 'Join with two headsets', expected: 'Pistol follows hand', source: '' } },
  ] };
  const deps: DeliveryDeps = {
    issue: async () => ({ ...issue }), pull: async () => ({ ...pr }), validateTest: readPlaytest,
    saveTest: input => { log.push('save'); return store.add(input, 'PR agent'); },
    findTest: id => store.state().items.find(i => i.id === id),
    close: async comment => { assert.match(comment, /remain unperformed/); log.push('close'); issue.state = 'CLOSED'; },
    record: receipt => { log.push('record'); new IssueDeliveries(dir).record(receipt); },
  };
  return { dir, store, log, issue, pr, request, deps };
}

test('manual checks are durably saved before closure; receipt completes only pre-merge tasks across restart', async t => {
  const f = fixture(t);
  await completeDelivery(f.request, f.deps);
  assert.deepEqual(f.log, ['save', 'close', 'record']);
  assert.equal(new Playtests(f.dir).state().items[0].done, false);
  const before = Date.parse(f.pr.mergedAt) - 1000;
  const tasks = [
    { issue: 286, addedAt: before, status: 'done', outcome: 'failed', error: 'old exit', waitingReason: 'partial PR' },
    { issue: 286, addedAt: before, status: 'running' },
    { issue: 286, addedAt: before + 2000, status: 'queued' },
    { issue: 285, addedAt: before, status: 'queued' },
  ] as unknown as QueueTask[];
  const receipts = new IssueDeliveries(f.dir);
  assert.equal(receipts.reconcile(tasks), true);
  assert.deepEqual(tasks.map(x => x.status), ['done', 'done', 'queued', 'queued']);
  assert.equal(tasks[0].error, undefined);
  assert.equal(tasks[0].pr?.number, 297);
  assert.equal(receipts.reconcile(tasks), false);
});

test('checklist failure never closes an issue or records delivery', async t => {
  const f = fixture(t);
  f.deps.saveTest = () => { throw Error('disk full'); };
  await assert.rejects(completeDelivery(f.request, f.deps), /disk full/);
  assert.equal(f.issue.state, 'OPEN'); assert.deepEqual(f.log, []);
});

test('missing criteria, missing evidence and real unfinished implementation are rejected before mutation', async t => {
  const f = fixture(t);
  for (const payload of [
    { ...f.request, criteria: [] },
    { ...f.request, remainingImplementation: ['still needs code'] },
    { ...f.request, criteria: [{ ...f.request.criteria[0], evidence: '' }, f.request.criteria[1]] },
  ]) assert.throws(() => validateDelivery(payload, f.issue.body));
  assert.deepEqual(f.log, []);
});

test('unmerged, unrelated, wrong-head, wrong-base and failing PRs cannot close issues', async t => {
  const f = fixture(t);
  const original = { ...f.pr };
  for (const patch of [{ state: 'OPEN' }, { references: false }, { head: 'b'.repeat(40) }, { base: 'release' }, { failedChecks: true }]) {
    Object.assign(f.pr, original, patch);
    await assert.rejects(completeDelivery(f.request, f.deps), /PR must/);
  }
  assert.deepEqual(f.log, []);
});

test('reuse existing PR checklist IDs without duplicating or resetting human checks and notes', async t => {
  const f = fixture(t);
  const saved = f.store.add({ ...f.request.criteria[1].test!, source: f.pr.url }, 'Byte');
  f.store.update({ id: saved.id, revision: saved.revision, done: true, notes: 'tested by owner' }, 'Owner');
  f.request.criteria[1] = { text: 'Check on headset', kind: 'manual', testId: saved.id };
  const receipt = await completeDelivery(f.request, f.deps);
  assert.deepEqual(receipt.tests, [saved.id]);
  assert.equal(f.store.state().items.length, 1);
  assert.equal(f.store.state().items[0].done, true);
  assert.equal(f.store.state().items[0].notes, 'tested by owner');
});

test('unrelated existing test cannot satisfy a manual criterion', async t => {
  const f = fixture(t);
  const saved = f.store.add({ ...f.request.criteria[1].test!, source: 'https://github.com/owner/repo/issues/1' }, 'Byte');
  f.request.criteria[1] = { text: 'Check on headset', kind: 'manual', testId: saved.id };
  await assert.rejects(completeDelivery(f.request, f.deps), /must belong/);
  assert.deepEqual(f.log, []);
});

test('retry after receipt failure repairs closed issue without a duplicate close or checklist entry', async t => {
  const f = fixture(t);
  const record = f.deps.record;
  f.deps.record = () => { throw Error('receipt disk failure'); };
  await assert.rejects(completeDelivery(f.request, f.deps), /receipt disk/);
  f.deps.record = record;
  await completeDelivery(f.request, f.deps);
  assert.equal(f.store.state().items.length, 1);
  assert.equal(f.log.filter(x => x === 'close').length, 1);
  assert.equal(f.log.at(-1), 'record');
});

test('changed requirements and unconfirmed GitHub close never record completion', async t => {
  const f = fixture(t);
  let reads = 0;
  f.deps.issue = async () => ({ ...f.issue, body: ++reads > 1 ? f.issue.body + '\n- [ ] New requirement' : f.issue.body });
  await assert.rejects(completeDelivery(f.request, f.deps), /requirements changed/);
  f.deps.issue = async () => ({ ...f.issue });
  f.deps.close = async () => {};
  await assert.rejects(completeDelivery(f.request, f.deps), /closure was not confirmed/);
  assert.ok(!f.log.includes('record'));
});
