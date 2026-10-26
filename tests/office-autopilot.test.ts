import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates, decisionsOf, fingerprint, gate } from '../bin/autopilot/policy.mjs';
import { loadAutopilotStatus } from '../src/server/worker-profiles.js';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { workerProfileRoutes } from '../src/server/http/routes/worker-profiles.js';
import { mkdirSync } from 'node:fs';

const issue = (number: number, changes = {}) => ({ number, title: 'A task', author: { login: 'owner' }, updatedAt: '2026-10-26', labels: [], body: '', assignees: [], ...changes });
test('autopilot rejects holds, assigned work, foreign owners, prior inspections and completed native stages', () => {
  const inspected = issue(5);
  const list = [issue(1), issue(2, { labels: [{ name: 'execution:held' }] }), issue(3, { assignees: [{ login: 'writer' }] }), issue(4, { author: { login: 'other' } }), inspected, issue(6, { body: '<!-- fox-runtime-run:completed-stage-123 -->' }), issue(7), issue(8, { labels: [{ name: 'status:in-progress' }] })];
  const result = candidates(list, { owner: 'owner', reserved: [7], completed: ['completed-stage-123'], inspected: { 5: fingerprint(inspected) } });
  assert.deepEqual(result.map((row: any) => row.number), [1]);
  assert.equal(result[0].mode, 'prepare-contract-only');
});
test('historical source-ready is preparation only; explicit ready still requires contract validation', () => {
  const rows = candidates([issue(1, { labels: [{ name: 'source-status:ready' }] }), issue(2, { labels: [{ name: 'execution:ready' }] })], { owner: 'owner' });
  assert.deepEqual(rows.map((row: any) => row.mode), ['prepare-contract-only', 'validate-ready-contract']);
});
test('budgets, active writers, pending reconciliation and uncertain delivery prevent another cycle', () => {
  const config = { enabled: true, expiresAt: 100, maxRounds: 2 };
  const base = { now: 50, config, state: { rounds: [] }, workers: [] };
  assert.equal(gate(base), 'ready');
  assert.equal(gate({ ...base, now: 100 }), 'budget-finished');
  assert.equal(gate({ ...base, state: { rounds: [{}, {}] } }), 'budget-finished');
  for (const status of ['starting', 'working', 'needs_input']) assert.equal(gate({ ...base, workers: [{ status }] }), 'waiting-for-team');
  assert.equal(gate({ ...base, externalPending: ['unknown'] }), 'external-reconciliation');
  assert.equal(gate({ ...base, state: { rounds: [{ state: 'uncertain' }] } }), 'needs-reconciliation');
  assert.equal(gate({ ...base, config: { ...config, enabled: false } }), 'disabled');
});
test('only decisions for the exact round and its issue set can consume an inspection', () => {
  const round = { id: 'round-1', issues: [{ number: 1 }] };
  const valid = { cycle_id: 'round-1', decisions: [{ issue: 1, action: 'needs-contract', reason: 'Missing acceptance criteria' }] };
  assert.equal(decisionsOf(valid, round)[0].issue, 1);
  assert.throws(() => decisionsOf({ ...valid, cycle_id: 'old' }, round));
  assert.throws(() => decisionsOf({ ...valid, decisions: [{ issue: 2, action: 'completed', reason: 'wrong issue' }] }, round));
  assert.throws(() => decisionsOf({ ...valid, decisions: [...valid.decisions, ...valid.decisions] }, round));
});
test('autopilot status cannot expose private fields or follow a symlink', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'office-autopilot-'));
  try {
    const file = path.join(root, 'autopilot-status.json');
    writeFileSync(file, JSON.stringify({ state: 'waiting', summary: 'Existing writer is active', secret: 'private-marker' }));
    assert.deepEqual(loadAutopilotStatus(root), { state: 'waiting', summary: 'Existing writer is active' });
    rmSync(file); writeFileSync(path.join(root, 'private.json'), '{"state":"private","summary":"private"}');
    symlinkSync(path.join(root, 'private.json'), file);
    assert.equal(loadAutopilotStatus(root), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('idle profile reuse resumes the exact worker and rejects busy, changed or held routes', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'office-reuse-'));
  const profile = { id: 'coordinator', name: 'Coordinator', description: 'Coordinates tasks', provider: 'codex', model: 'gpt-6-luna', effort: 'max', enabled: true, holds: [] };
  const data = path.join(root, '.agent-office'); mkdirSync(data);
  const file = path.join(data, 'worker-profiles.json'); writeFileSync(file, JSON.stringify([profile]));
  let current: any = { id: 'existing', name: profile.name, provider: profile.provider, model: profile.model, effort: profile.effort, status: 'offline' };
  const calls: string[] = [];
  const ctx: any = { cfg: {}, floors: new Map([['floor', { dir: root, workers: {
    list: () => [current],
    prompt: (id: string) => { calls.push('prompt:' + id); return 'Worker is not running'; },
    resume: (id: string) => { calls.push('resume:' + id); },
  } }]]) };
  const run = async (reuseIdle = true) => {
    const req: any = Readable.from([Buffer.from(JSON.stringify({ id: profile.id, prompt: 'Choose an eligible task', reuseIdle }))]);
    req.headers = { host: 'office.test', origin: 'https://office.test' }; req.method = 'POST';
    let status = 0; let body: any;
    const res: any = { writeHead: (code: number) => { status = code; }, end: (text: string) => { body = JSON.parse(text); } };
    await workerProfileRoutes.profiles.handle(ctx, { req, res, url: new URL('https://office.test/api/worker-profiles?floor=floor'), session: {} } as any);
    return { status, body };
  };
  try {
    assert.equal((await run()).status, 200);
    assert.deepEqual(calls, ['prompt:existing', 'resume:existing']); calls.length = 0;
    current.status = 'working'; assert.equal((await run()).status, 409); assert.deepEqual(calls, []);
    current.status = 'needs_input'; assert.equal((await run()).status, 409); assert.deepEqual(calls, []);
    current.status = 'idle'; current.model = 'gpt-6.1-sol'; assert.equal((await run()).status, 409); assert.deepEqual(calls, []);
    current.model = profile.model; assert.equal((await run(false)).status, 409); assert.deepEqual(calls, []);
    writeFileSync(file, JSON.stringify([{ ...profile, enabled: false, holds: ['Source STOP'] }]));
    assert.equal((await run()).status, 409); assert.deepEqual(calls, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
