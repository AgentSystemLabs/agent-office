import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredProvider, isValidDroidModel, validateWorkerEffort, validateWorkerModel } from '../src/server/agents.js';

test('detects the configured provider from Unix and Windows command paths', () => {
  assert.equal(configuredProvider('claude'), 'claude');
  assert.equal(configuredProvider('/opt/tools/claude'), 'claude');
  assert.equal(configuredProvider('C:\\Users\\me\\bin\\opencode.exe'), 'opencode');
  assert.equal(configuredProvider('/opt/tools/codex'), 'codex');
  assert.equal(configuredProvider('CODEX.EXE'), 'codex');
  assert.equal(configuredProvider('droid'), 'droid');
  assert.equal(configuredProvider('C:\\Users\\me\\bin\\DROID.EXE'), 'droid');
  assert.equal(configuredProvider('my-agent'), 'custom');
});

test('Droid model ids accept settings ids and reject whitespace or control characters', () => {
  assert.equal(isValidDroidModel('custom:droidproxy:gpt-6-sol'), true);
  assert.equal(isValidDroidModel('glm-5.3-flash'), true);
  assert.equal(isValidDroidModel('custom:droidproxy:gpt 6'), false);
  assert.equal(isValidDroidModel('custom:droidproxy:gpt\n6'), false);
  assert.equal(isValidDroidModel(''), false);
  assert.equal(isValidDroidModel(`custom:${'x'.repeat(256)}`), false);
});

test('models can be selected for Claude, OpenCode and Droid workers', () => {
  assert.equal(validateWorkerModel('agent', 'droid', 'custom:droidproxy:gpt-6-sol'), undefined);
  assert.match(validateWorkerModel('agent', 'droid', 'has a space') ?? '', /Droid model/);
  assert.equal(validateWorkerModel('agent', 'claude', 'haiku'), undefined);
  assert.match(validateWorkerModel('agent', 'codex', 'gpt-5') ?? '', /only be selected/);
  assert.match(validateWorkerModel('shell', 'droid', 'glm-5.3-flash') ?? '', /Shell workers/);
});

test('reasoning effort can be selected for Claude and Droid workers', () => {
  assert.equal(validateWorkerEffort('agent', 'droid', 'high'), undefined);
  assert.equal(validateWorkerEffort('agent', 'claude', 'max'), undefined);
  assert.match(validateWorkerEffort('agent', 'opencode', 'high') ?? '', /Claude Code or Droid/);
  assert.match(validateWorkerEffort('agent', 'droid', 'overdrive') ?? '', /effort/);
  assert.match(validateWorkerEffort('shell', 'droid', 'high') ?? '', /Shell workers/);
});
