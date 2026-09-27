import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredProvider, flagValue, validateWorkerEffort, validateWorkerModel, withoutFlags } from '../src/server/agents.js';
import { isClaudeModel, modelFamily, modelLabel } from '../src/shared/models.js';

test('detects the configured provider from Unix and Windows command paths', () => {
  assert.equal(configuredProvider('claude'), 'claude');
  assert.equal(configuredProvider('/opt/tools/claude'), 'claude');
  assert.equal(configuredProvider('C:\\Users\\me\\bin\\opencode.exe'), 'opencode');
  assert.equal(configuredProvider('/opt/tools/codex'), 'codex');
  assert.equal(configuredProvider('CODEX.EXE'), 'codex');
  assert.equal(configuredProvider('my-agent'), 'custom');
});

test('reads and strips a flag in any of its spellings', () => {
  const args = ['--keep', '--model', 'opus', '-m', 'x/y', '--effort=high', '-mz/w', '--model-extra', 'v'];
  assert.equal(flagValue(['--model', 'opus', '--keep'], ['--model']), 'opus');
  assert.equal(flagValue(['--model=sonnet'], ['--model']), 'sonnet');
  assert.equal(flagValue(['--model', 'opus', '--model', 'haiku'], ['--model']), 'haiku');
  assert.equal(flagValue(['--model', '--keep'], ['--model']), undefined);
  assert.equal(flagValue(args, ['--effort']), 'high');
  assert.equal(flagValue(['-mz/w'], ['--model', '-m']), 'z/w');
  assert.deepEqual(withoutFlags(args, ['--model']), ['--keep', '-m', 'x/y', '--effort=high', '-mz/w', '--model-extra', 'v']);
  assert.deepEqual(withoutFlags(args, ['--model', '-m', '--effort']), ['--keep', '--model-extra', 'v']);
});

test('Claude models and efforts a worker can be hired with', () => {
  for (const ok of ['opus', 'sonnet', 'haiku', 'fable', 'claude-haiku-4-5-20251001', 'opus[1m]']) assert.equal(isClaudeModel(ok), true, ok);
  for (const bad of ['', 'gpt-5', 'openai/gpt-5', 'opus --print', '-p', 'Opus', 'claude-', 42]) assert.equal(isClaudeModel(bad), false, String(bad));
  assert.equal(validateWorkerModel('agent', 'claude', 'haiku'), undefined);
  assert.match(validateWorkerModel('agent', 'codex', 'haiku') ?? '', /model/i);
  assert.equal(validateWorkerEffort('agent', 'claude', 'xhigh'), undefined);
  assert.match(validateWorkerEffort('agent', 'claude', 'huge') ?? '', /effort/i);
  assert.match(validateWorkerEffort('agent', 'opencode', 'low') ?? '', /effort/i);
  assert.match(validateWorkerEffort('shell', undefined, 'low') ?? '', /effort/i);
});

test('model names for people, and their family', () => {
  assert.equal(modelLabel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(modelLabel('claude-sonnet-4-20250514'), 'Sonnet 4');
  assert.equal(modelLabel('claude-3-5-haiku-20241022'), 'Haiku 3.5');
  assert.equal(modelLabel('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(modelLabel('opus'), 'Opus');
  assert.equal(modelLabel('sonnet[1m]'), 'Sonnet 1M');
  assert.equal(modelLabel('anthropic/claude-sonnet-4'), 'Sonnet 4');
  assert.equal(modelLabel('openai/gpt-5'), 'gpt-5');
  assert.equal(modelFamily('claude-haiku-4-5-20251001'), 'haiku');
  assert.equal(modelFamily('openai/gpt-5'), undefined);
  assert.equal(modelFamily(undefined), undefined);
});
