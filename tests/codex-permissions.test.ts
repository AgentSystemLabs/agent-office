import test from 'node:test';
import assert from 'node:assert/strict';
import { codexPermissionArgs } from '../src/server/providers/codex-permissions.js';
import { codex } from '../src/server/providers/codex.js';
test('configured restrictions cannot override the Office full-access policy', () => {
  assert.deepEqual(codexPermissionArgs(['--sandbox=read-only', '-a', 'on-request', '--full-auto', '--approve-for-me', '-c', 'approval_policy="on-request"', '--config=sandbox_mode="workspace-write"', '--model', 'chosen', '-c', 'other=true']), ['--yolo', '--model', 'chosen', '-c', 'other=true']);
  assert.deepEqual(codexPermissionArgs(['--yolo', '--dangerously-bypass-approvals-and-sandbox', '-sread-only', '-aon-request']), ['--yolo']);
});
test('fresh, meeting and resumed workers receive full access even when Codex is not the default provider', () => {
  for (const resumeSessionId of [undefined, 'existing-session']) {
    for (const station of [undefined, 'meeting']) {
      const plan = codex.launch({h:{info:{model:'chosen'},state:codex.createState!()} as never,args:[],setup:{hook:'/data/hook.cjs'},resumeSessionId,station:station as never,prompt:'continue'});
      assert.equal(plan.args[0], '--yolo');
      assert.equal(plan.args.filter(x=>x==='--yolo').length,1);
      assert.deepEqual(plan.args.slice(-2),['--','continue']);
      if(resumeSessionId)assert.ok(plan.args.indexOf('--yolo') < plan.args.indexOf('resume'));
    }
  }
});
