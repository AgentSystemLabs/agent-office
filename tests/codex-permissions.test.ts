import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { codexPermissionArgs } from '../src/server/providers/codex-permissions.js';
import { codex } from '../src/server/providers/codex.js';

const bypass = '--dangerously-bypass-approvals-and-sandbox';
function fixture(t: test.TestContext) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-codex-permissions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, set: (text: string) => writeFileSync(path.join(dir, 'codex-permissions.json'), text) };
}
test('native by default, explicit per-floor opt-in, and removing/reverting it takes effect next launch', t => {
  const { dir, set } = fixture(t), args = ['--model', 'example'];
  assert.deepEqual(codexPermissionArgs(args, dir), args);
  set('{"mode":"full-access"}');
  assert.deepEqual(codexPermissionArgs(args, dir), [...args, bypass]);
  assert.deepEqual(args, ['--model', 'example']);
  set('{"mode":"native"}'); assert.deepEqual(codexPermissionArgs(args, dir), args);
  for (const invalid of ['{', 'null', '{}', '{"mode":"full"}', '{"mode":["full-access"]}', '[]']) {
    set(invalid); assert.throws(() => codexPermissionArgs(args, dir));
  }
});
test('explicit CLI policies are never weakened, replaced or duplicated', t => {
  const { dir, set } = fixture(t); set('{"mode":"full-access"}');
  for (const args of [['--sandbox', 'read-only'], ['--sandbox=workspace-write'], ['-sread-only'], ['-a', 'on-request'], ['--ask-for-approval=never'], ['--approve-for-me'], ['--yolo'], [bypass], ['-c', 'sandbox_mode="read-only"'], ['--config=approval_policy="on-request"'], ['-cpermissions.network.enabled=false'], ['--permission-profile', 'restricted']]) {
    assert.deepEqual(codexPermissionArgs(args, dir), args);
  }
});
test('fresh and resumed workers use the floor choice before the subcommand without bypassing hook trust', t => {
  const { dir, set } = fixture(t); set('{"mode":"full-access"}');
  for (const resumeSessionId of [undefined, 'same-session']) {
    const plan = codex.launch({ h: { info: { model: 'gpt-6.1-sol' }, state: codex.createState!() } as never, args: [], setup: { hook: path.join(dir, 'hook.cjs') }, cwd: '/some-worktree', prompt: 'continue existing task', resumeSessionId });
    assert.equal(plan.args.filter(a => a === bypass).length, 1);
    assert.ok(plan.args.indexOf(bypass) < plan.args.indexOf('--'));
    if (resumeSessionId) assert.ok(plan.args.indexOf(bypass) < plan.args.indexOf('resume'));
    assert.equal(plan.args.includes('--dangerously-bypass-hook-trust'), false);
    assert.deepEqual(plan.args.slice(-2), ['--', 'continue existing task']);
  }
});
