import test from 'node:test';
import assert from 'node:assert/strict';
import { restartPrompt, CARRY_ON_PROMPT } from '../src/server/workers/tasks.js';

test('OpenHands reconnects without a new prompt while terminal agents retain carry-on recovery', () => {
  assert.equal(restartPrompt('openhands', 'existing-conversation', true), undefined);
  assert.equal(restartPrompt('goose', 'named-session', true), CARRY_ON_PROMPT);
  assert.equal(restartPrompt('cline', 'session', true), CARRY_ON_PROMPT);
  assert.equal(restartPrompt('goose', 'session', false), undefined);
  assert.equal(restartPrompt('goose', undefined, true), undefined);
});
