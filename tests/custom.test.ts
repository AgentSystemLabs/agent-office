import test from 'node:test';
import assert from 'node:assert/strict';
import { custom } from '../src/server/providers/custom.js';

test('a custom worker is given its task, and it is never read as an option', () => {
  const launch = (prompt?: string, resumeSessionId?: string) =>
    custom.launch({
      h: { info: {} } as never,
      args: [],
      prompt,
      resumeSessionId,
      cwd: '/project',
      setup: undefined,
    }).args;

  // Without this the task was silently dropped: every provider but `custom`
  // puts its own CLI's prompt flag in launch, and a custom one ran untouched.
  assert.deepEqual(launch('fix the login redirect'), ['--', 'fix the login redirect']);
  assert.deepEqual(launch('- fix login'), ['--', '- fix login']);

  // A worker hired with no task waits at its prompt for someone to type one.
  assert.deepEqual(launch(), []);

  // A custom agent that knows sessions resumes them rather than starting over.
  assert.deepEqual(launch('carry on', 'session-1'), ['--resume', 'session-1', '--', 'carry on']);
});

test('a custom worker reports on the office as Claude Code does', () => {
  assert.equal(custom.hooksAs, 'claude');
});