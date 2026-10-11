import test from 'node:test';
import assert from 'node:assert/strict';
import { providerHook } from '../src/server/providers/index.js';
import { restoreTesting, saveTesting, testingIdle, testingStatus, testCommand } from '../src/server/workers/testing.js';
import { isBusy } from '../src/shared/status.js';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import type { WorkerHandle } from '../src/server/workers/types.js';

function fixture() {
  const info = { id: 'w', kind: 'agent', provider: 'claude', status: 'working' } as WorkerInfo;
  const h = {
    info, tracker: {}, leftNeedsInputAt: 0, failStreak: 0,
    setStatus(status: WorkerStatus) { info.status = testingStatus(info, status); },
    emit() {}, persist() {}, scheduleScan() {}, notePrompt() {}, noteTool() {}, notePr() {}, clearTask() {},
  } as unknown as WorkerHandle;
  const hook = providerHook('claude')!;
  return { info, status: h.setStatus, event(event: string, p: object = {}) {
    hook.handle(h, event, { session_id: 's', ...p });
  } };
}
const run = (id: string, command = 'npm test') => ({ id, type: 'shell', status: 'running', command });

test('Stop with a queued Unity test stays testing across OSC idle and unrelated tool calls', () => {
  const f = fixture();
  f.event('Stop', { background_tasks: [run('b1', 'pwsh -File Tools/Build-Quest.ps1 -TestsOnly')] });
  assert.equal(f.info.status, 'testing');
  assert.equal(isBusy(f.info.status), true);
  f.status('done'); // Late OSC 9;4 idle used to overwrite the Stop hook.
  assert.equal(f.info.status, 'testing');
  f.event('PreToolUse', { tool_name: 'Read', tool_use_id: 'read' });
  assert.equal(f.info.status, 'testing');
  f.event('Stop', { session_id: 'stale-session', background_tasks: [] });
  assert.equal(f.info.status, 'testing');
  f.event('Stop', { background_tasks: [] });
  assert.equal(f.info.status, 'done');
});

test('foreground and background test lifetimes, multiple jobs, and legacy Stop without a snapshot', () => {
  const f = fixture();
  f.event('PreToolUse', { tool_name: 'PowerShell', tool_use_id: 't', tool_input: { command: '& ./run-tests.ps1' } });
  assert.equal(f.info.status, 'testing');
  f.event('PostToolUse', { tool_name: 'PowerShell', tool_use_id: 't', tool_response: { backgroundTaskId: 'a' } });
  f.event('Stop');
  assert.equal(f.info.status, 'testing');
  f.event('Stop', { background_tasks: [run('a'), run('b')] });
  f.event('PostToolUse', { tool_name: 'TaskStop', tool_input: { task_id: 'a' }, tool_response: {} });
  f.status('done');
  assert.equal(f.info.status, 'testing');
  f.event('PostToolUse', { tool_name: 'TaskOutput', tool_input: { task_id: 'b' }, tool_response: { task: { status: 'failed' } } });
  assert.equal(f.info.status, 'working'); // Result inspection, not an automatic pass.
});

test('a finished foreground test, permission prompts, failures and process exit do not get stuck testing', () => {
  const f = fixture();
  const p = { tool_name: 'Bash', tool_use_id: 'a', tool_input: { command: 'npm test' } };
  f.event('PreToolUse', p);
  f.event('PermissionRequest', p);
  assert.equal(f.info.status, 'needs_input');
  f.event('PostToolUseFailure', p);
  assert.equal(f.info.status, 'working');
  f.event('Stop', { background_tasks: [run('b')] });
  f.event('StopFailure');
  assert.equal(f.info.status, 'needs_input');
  f.event('Stop', { background_tasks: [run('b')] });
  f.status('exited');
  assert.equal(f.info.status, 'exited');
  f.status('idle');
  assert.equal(f.info.status, 'idle');
});

test('new sessions and empty snapshots clear old tests; other workers and non-test jobs stay independent', () => {
  const a = fixture(), b = fixture();
  a.event('Stop', { background_tasks: [run('t')] });
  b.event('Stop', { background_tasks: [run('server', 'npm run dev'), { ...run('ended', 'cat test.log'), description: 'Read test results' }] });
  assert.equal(b.info.status, 'done');
  a.event('SessionStart', { session_id: 'next' });
  a.event('Stop', { session_id: 'next', background_tasks: [] });
  assert.equal(a.info.status, 'done');
});

test('test command detection includes PowerShell wrappers but excludes read-only references', () => {
  for (const cmd of ['npm test', 'npm run build', 'pwsh -File Tools/Build-Quest.ps1 -TestsOnly', '& "C:/tmp/run-filter.ps1" -Ref abc'])
    assert.equal(testCommand(cmd), true, cmd);
  for (const cmd of ['git status', 'npm run dev', 'Get-Content run-tests.ps1', 'echo "npm test"', 'cat tests/result.log'])
    assert.equal(testCommand(cmd), false, cmd);
});

test('an idle terminal cancels foreground tests while retained background IDs survive office restore', () => {
  const f = fixture();
  f.event('PreToolUse', { tool_name: 'Bash', tool_use_id: 'foreground', tool_input: { command: 'npm test' } });
  testingIdle(f.info); f.status('done');
  assert.equal(f.info.status, 'done');
  f.event('Stop', { background_tasks: [run('background')] });
  const saved = JSON.parse(JSON.stringify(saveTesting(f.info)));
  const restored = { ...f.info };
  restoreTesting(restored, saved);
  testingIdle(restored);
  assert.equal(testingStatus(restored, 'done'), 'testing');
  assert.equal(saved.background[0], 'background');
  assert.equal(JSON.stringify(saved).includes('npm test'), false);
  testingStatus(restored, 'starting');
  assert.equal(testingStatus(restored, 'idle'), 'idle');
});

test('queued tests show WAITING and become TESTING only when the snapshot reports execution', () => {
  const f = fixture();
  f.event('Stop', { background_tasks: [{ ...run('t'), status: 'queued' }] });
  assert.equal(f.info.status, 'waiting');
  f.status('done'); assert.equal(f.info.status, 'waiting');
  f.event('Stop', { background_tasks: [run('t')] }); assert.equal(f.info.status, 'testing');
  f.event('Stop', { background_tasks: [] }); assert.equal(f.info.status, 'done');
});

test('native helper classifications track background sessions without carrying commands', () => {
  const f = fixture();
  f.event('PreToolUse', { tool_name: 'exec_command', tool_use_id: 'native', office_test: true });
  assert.equal(f.info.status, 'testing');
  f.event('PostToolUse', { tool_use_id: 'native', office_test_job: '123', office_test_waiting: true });
  f.event('Stop'); assert.equal(f.info.status, 'waiting');
  f.event('PostToolUse', { office_test_poll: '123', office_test_exit: 0 });
  assert.equal(f.info.status, 'working');
});
