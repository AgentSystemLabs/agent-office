import test from 'node:test';
import assert from 'node:assert/strict';
import { goose } from '../src/server/providers/goose.js';

test('Goose starts and resumes a named desk session with the right command', () => {
  const info = { id: 'desk-123', sessionId: undefined as string | undefined };
  const h = { info } as never;
  const base = { h, args: ['--old-agent-arg'], cwd: 'C:\\workspace', setup: undefined };

  const first = goose.launch({ ...base, prompt: 'Start work' });
  assert.deepEqual(first.args, ['run', '--interactive', '--name', 'agent-office-desk-123', '--text', 'Start work']);
  assert.equal(info.sessionId, 'agent-office-desk-123');

  const resumeWithoutPrompt = goose.launch({ ...base, resumeSessionId: info.sessionId });
  assert.deepEqual(resumeWithoutPrompt.args, ['session', '--resume', '--name', 'agent-office-desk-123']);

  const resumeWithPrompt = goose.launch({ ...base, resumeSessionId: info.sessionId, prompt: 'Continue work' });
  assert.deepEqual(resumeWithPrompt.args, ['run', '--interactive', '--name', 'agent-office-desk-123', '--resume', '--text', 'Continue work']);

  const env = { GOOSE_PROVIDER: 'stale', GOOSE_MODEL: 'stale', OTHER: 'keep' };
  resumeWithPrompt.finishEnv?.(env);
  assert.equal(env.GOOSE_PROVIDER, undefined);
  assert.equal(env.GOOSE_MODEL, undefined);
  assert.equal(env.OTHER, 'keep');
  assert.equal(env.GOOSE_THINKING_EFFORT, 'low');
});
