import test from 'node:test';
import assert from 'node:assert/strict';
import { codexAutonomyArgs } from '../src/server/providers/codex-runtime.js';
import { observeCodexScreen } from '../src/server/providers/codex-screen.js';
import { submitPrompt } from '../src/server/workers/prompt.js';
import { codex } from '../src/server/providers/codex.js';
import { normalizeCodexHook } from '../src/server/codex.js';
import { WorkerTasks } from '../src/server/workers/tasks.js';

test('autonomy is opt-in and replaces conflicting CLI modes without changing model/config arguments', () => {
  const input = ['--model', 'gpt-6-sol', '-c', 'model_reasoning_effort="high"', '-a', 'on-request', '--sandbox=read-only', '--full-auto'];
  assert.deepEqual(codexAutonomyArgs(input, false), input);
  assert.deepEqual(codexAutonomyArgs(input, true), [...input.slice(0, 4), '--ask-for-approval', 'never', '--sandbox', 'danger-full-access', '--dangerously-bypass-hook-trust']);
  assert.equal(input.at(-1), '--full-auto');
});

test('a reused worker gets its actual task label even without a naming service', () => {
  const tasks = new WorkerTasks({} as never, null, {});
  const w = { info: { kind: 'agent', provider: 'codex', task: { name: 'Antworte nur mit OK' }, prompt: 'Antworte nur mit OK' }, prompts: [], toolsSinceNamed: 0 };
  const prompt = 'Work on GitHub issue #196: "Fix snapshot positions".';
  tasks.notePrompt(w as never, prompt);
  assert.equal(w.info.prompt, prompt);
  assert.notEqual(w.info.task.name, 'Antworte nur mit OK');
  tasks.notePrompt(w as never, 'yes');
  assert.equal(w.info.prompt, prompt);
});

test('Codex live working footer clears a stale permission alert but history cannot', () => {
  const h = { running: true, info: { status: 'needs_input', activity: 'Wants permission: Bash' },
    setStatus(status: string) { this.info.status = status; } };
  observeCodexScreen(h as never, '• Working (3m 26s • esc to interrupt)\n› Ask Codex to do anything\nGPT-6-Sol');
  assert.equal(h.info.status, 'working');
  assert.equal(h.info.activity, undefined);
  observeCodexScreen(h as never, 'Would you like to run the following command?\n1. Yes, proceed (y)\nPress enter to confirm or esc to cancel');
  assert.equal(h.info.status, 'needs_input');
  observeCodexScreen(h as never, '• Working (1s • esc to interrupt)\n' + 'history\n'.repeat(25) + '› Ask Codex to do anything');
  assert.equal(h.info.status, 'needs_input');
  observeCodexScreen(h as never, 'Worked for 9m 11s • 20:01\n\n› Pending task draft');
  assert.equal(h.info.status, 'needs_input');
  observeCodexScreen(h as never, 'Worked for 9m 11s • 20:01\n\n› Ask Codex to do anything\nGPT-6-Sol');
  assert.equal(h.info.status, 'done');
});

test('a completed PR creation reaches the same ownership tracker used by Claude', () => {
  const command = 'gh pr create --title "fix" --body-file body.md';
  const output = 'https://github.com/owner/repo/pull/23';
  const report = normalizeCodexHook('PostToolUse', { session_id: 'root', pr_command: command, pr_output: output });
  assert.equal(report?.prCommand, command);
  assert.equal(report?.prOutput, output);
  assert.equal(normalizeCodexHook('PostToolUse', { session_id: 'root', pr_command: 'gh pr view 23', pr_output: output })?.prCommand, undefined);
  assert.equal(normalizeCodexHook('PostToolUse', { session_id: 'root', agent_id: 'child', pr_command: command, pr_output: output }), undefined);
});

test('Codex paste settles before a single submit, and restart cancels a pending submit', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes: string[] = [];
  const w = { pty: { write: (text: string) => writes.push(text) } };
  submitPrompt(w as never, 'first\nsecond', codex.promptDelayMs);
  t.mock.timers.tick(999);
  assert.deepEqual(writes, ['\x1b[200~first\nsecond\x1b[201~']);
  t.mock.timers.tick(1);
  assert.equal(writes.at(-1), '\r');
  submitPrompt(w as never, 'next', codex.promptDelayMs);
  w.pty = { write: () => assert.fail('Enter must not go to a replacement terminal') };
  t.mock.timers.tick(1000);
  assert.equal(writes.length, 3);
});
