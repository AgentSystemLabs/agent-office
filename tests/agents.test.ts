import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredProvider } from '../src/server/agents.js';

test('detects the configured provider from Unix and Windows command paths', () => {
  assert.equal(configuredProvider('claude'), 'claude');
  assert.equal(configuredProvider('/opt/tools/claude'), 'claude');
  assert.equal(configuredProvider('C:\\Users\\me\\bin\\opencode.exe'), 'opencode');
  assert.equal(configuredProvider('/opt/tools/codex'), 'codex');
  assert.equal(configuredProvider('CODEX.EXE'), 'codex');
  assert.equal(configuredProvider('my-agent'), 'custom');
});
