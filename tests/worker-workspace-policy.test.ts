import test from 'node:test';
import assert from 'node:assert/strict';
import { workspacePrompt } from '../src/server/workers/workspace-policy.js';
import { WorkerManager } from '../src/server/workers/manager.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

function worker(worktree?: WorkerInfo['worktree']): WorkerInfo {
  return { id: 'test', kind: 'agent', provider: 'claude', deskId: 'desk-1', name: 'Test',
    status: 'idle', color: '#fff', acked: true, createdBy: 'Tester', createdAt: 1,
    cols: 80, rows: 24, viewers: [], viewerIds: [], worktree };
}

test('unchecked and checked hiring choices survive saved worker round trips', () => {
  for (const worktree of [undefined, { path: '/project/worktree', branch: 'office/test', base: 'abc' }]) {
    const info: WorkerInfo = JSON.parse(JSON.stringify(worker(worktree)));
    const result = workspacePrompt(info, worktree?.path ?? '/project', 'Old template: Create a new branch')!;
    assert.match(result, /takes precedence over generic branch\/worktree boilerplate/);
    assert.match(result, /does not change Workers at once/);
    if (worktree) {
      assert.match(result, /user selected/);
      assert.match(result, /"office\/test"/);
      assert.match(result, /do not create an additional worktree/);
    } else {
      assert.match(result, /unchecked/);
      assert.match(result, /Do not create or switch to a private branch or worktree/);
      assert.match(result, /Independent work may proceed in parallel/);
    }
  }
});

test('empty hires, terminal commands and board agents do not receive a synthetic task', () => {
  assert.equal(workspacePrompt(worker(), '/p', undefined), undefined);
  assert.equal(workspacePrompt(worker(), '/p', '/model'), '/model');
  assert.equal(workspacePrompt({ ...worker(), kind: 'shell' }, '/p', 'echo hi'), 'echo hi');
  assert.equal(workspacePrompt({ ...worker(), deskId: 'station-pulls' }, '/p', 'Review PR'), 'Review PR');
  assert.match(workspacePrompt({ ...worker(), meeting: 'meeting' }, '/m', 'Implement')!, /meeting workspace/);
});

test('actual PTY and ACP follow-up dispatch apply the saved choice without rewriting task metadata', () => {
  for (const acp of [false, true]) {
    const info = worker();
    const delivered: string[] = [];
    const noted: string[] = [];
    const w = { info, ...(acp ? { dsh: { prompt: (text: string) => delivered.push(text) } }
      : { pty: { write: (text: string) => delivered.push(text) } }) };
    const context = { workers: new Map([[info.id, w]]), cwd: () => '/shared',
      tasks: { notePrompt: (_w: unknown, text: string) => noted.push(text) }, emitUpdate: () => {} };
    assert.equal(WorkerManager.prototype.prompt.call(context as unknown as WorkerManager, info.id, 'Fix queued task', 'Tester'), undefined);
    assert.match(delivered[0], /unchecked/);
    assert.match(delivered[0], /"\/shared"/);
    assert.deepEqual(noted, ['Fix queued task']);
    assert.equal(info.lastInput?.by, 'Tester');
  }
});
