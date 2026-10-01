import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidGrokModel, isValidMuseModel, isValidOpenCodeModel } from '../src/shared/providers.js';
import { createCursorModelCatalogue, createGrokModelCatalogue, createOpenCodeModelCatalogue, fetchCursorModels, fetchGrokModels, fetchOpenCodeModels, type ModelCommandRunner } from '../src/server/models.js';

test('OpenCode model ids require provider/model and reject whitespace or control characters', () => {
  assert.equal(isValidOpenCodeModel('openai/gpt-5'), true);
  assert.equal(isValidOpenCodeModel('openrouter/deepseek/deepseek-r1'), true);
  assert.equal(isValidOpenCodeModel('gpt-5'), false);
  assert.equal(isValidOpenCodeModel('openai/gpt 5'), false);
  assert.equal(isValidOpenCodeModel('openai/gpt\n5'), false);
  assert.equal(isValidOpenCodeModel(`openai/${'x'.repeat(256)}`), false);
});

test('OpenCode catalogue invokes only the configured executable with bounded execFile options', async () => {
  let call: { file: string; args: string[]; options: Record<string, unknown> } | undefined;
  const runner: ModelCommandRunner = async (file, args, options) => {
    call = { file, args, options };
    return { stdout: 'openai/gpt-5\nopenrouter/deepseek/deepseek-r1\nopenai/gpt-5\n', stderr: 'private detail' };
  };
  assert.deepEqual(await fetchOpenCodeModels('/custom/opencode', '/project', runner), ['openai/gpt-5', 'openrouter/deepseek/deepseek-r1']);
  assert.deepEqual(call, {
    file: '/custom/opencode',
    args: ['models'],
    options: { cwd: '/project', timeout: 10_000, maxBuffer: 1024 * 1024 },
  });
});

test('OpenCode catalogue coalesces requests and caches successful results briefly', async () => {
  let calls = 0;
  let now = 1000;
  const runner: ModelCommandRunner = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { stdout: 'anthropic/claude-sonnet-4\n', stderr: '' };
  };
  const catalogue = createOpenCodeModelCatalogue('/opencode', '/project', runner, () => now);
  const [a, b] = await Promise.all([catalogue.get(), catalogue.get()]);
  assert.deepEqual(a, ['anthropic/claude-sonnet-4']);
  assert.deepEqual(b, a);
  assert.equal(calls, 1);
  now += 59_999;
  await catalogue.get();
  assert.equal(calls, 1);
  now += 2;
  await catalogue.get();
  assert.equal(calls, 2);
});

test('Grok model ids are argv-safe tokens without a provider prefix', () => {
  assert.equal(isValidGrokModel('grok-4.6'), true);
  assert.equal(isValidGrokModel('grok-4.7-build-fast'), true);
  assert.equal(isValidGrokModel('openai/gpt-5'), false);
  assert.equal(isValidGrokModel('grok 4.6'), false);
  assert.equal(isValidGrokModel('x'.repeat(65)), false);
});

test('Muse model ids are argv-safe tokens without a provider prefix', () => {
  assert.equal(isValidMuseModel('muse-spark-1.3-contributor'), true);
  assert.equal(isValidMuseModel('openai/gpt-5'), false);
  assert.equal(isValidMuseModel('muse spark'), false);
  assert.equal(isValidMuseModel('x'.repeat(129)), false);
});

test('Grok catalogue parses `grok models` lines and ignores login chrome', async () => {
  let call: { file: string; args: string[]; options: Record<string, unknown> } | undefined;
  const runner: ModelCommandRunner = async (file, args, options) => {
    call = { file, args, options };
    return {
      stdout: 'You are logged in with grok.com.\n\nDefault model: grok-4.6\n\nAvailable models:\n  - grok-4.7\n  * grok-4.6 (default)\n  - grok-4.5\n',
      stderr: 'private detail',
    };
  };
  assert.deepEqual(await fetchGrokModels('/custom/grok', '/project', runner), ['grok-4.7', 'grok-4.6', 'grok-4.5']);
  assert.deepEqual(call, {
    file: '/custom/grok',
    args: ['models'],
    options: { cwd: '/project', timeout: 10_000, maxBuffer: 1024 * 1024 },
  });
});

test('Grok catalogue coalesces requests and caches successful results briefly', async () => {
  let calls = 0;
  let now = 1000;
  const runner: ModelCommandRunner = async () => {
    calls++;
    return { stdout: '  - grok-4.6\n', stderr: '' };
  };
  const catalogue = createGrokModelCatalogue('/grok', '/project', runner, () => now);
  const [a, b] = await Promise.all([catalogue.get(), catalogue.get()]);
  assert.deepEqual(a, ['grok-4.6']);
  assert.deepEqual(b, a);
  assert.equal(calls, 1);
  now += 59_999;
  await catalogue.get();
  assert.equal(calls, 1);
  now += 2;
  await catalogue.get();
  assert.equal(calls, 2);
});

test('OpenCode catalogue errors do not expose command output', async () => {
  const runner: ModelCommandRunner = async () => {
    throw new Error('secret-token from stderr');
  };
  await assert.rejects(fetchOpenCodeModels('opencode', '/project', runner), /unavailable/i);
  await assert.rejects(createOpenCodeModelCatalogue('opencode', '/project', runner).get(), (error: unknown) => {
    return error instanceof Error && /unavailable/i.test(error.message) && !error.message.includes('secret-token');
  });
});

test('Cursor catalogue takes each line\'s model id and skips headings, tips and duplicates', async () => {
  let call: { file: string; args: string[]; options: Record<string, unknown> } | undefined;
  const runner: ModelCommandRunner = async (file, args, options) => {
    call = { file, args, options };
    return {
      stdout: '\x1b[1mAvailable models\x1b[0m\n\nauto - Auto\ngpt-5 - GPT-5 (current, default)\nsonnet-4.5-thinking - Claude 4.5 Sonnet (Thinking)\nclaude-opus-4-8[context=1m,effort=high] - Opus 4.8 (1M, High)\n  - composer-1\ngpt-5 - again\n\nTip: use --model <id> to switch.\nCurrent model: gpt-5\n',
      stderr: 'private detail',
    };
  };
  assert.deepEqual(await fetchCursorModels('/custom/cursor-agent', '/project', runner), ['auto', 'gpt-5', 'sonnet-4.5-thinking', 'claude-opus-4-8[context=1m,effort=high]', 'composer-1']);
  assert.deepEqual(call, { file: '/custom/cursor-agent', args: ['models'], options: { cwd: '/project', timeout: 10_000, maxBuffer: 1024 * 1024 } });
  await assert.rejects(fetchCursorModels('/x', '/project', async () => { throw new Error('not signed in'); }), /Cursor model catalogue unavailable/);
});

test('Cursor catalogue coalesces requests and caches successful results briefly', async () => {
  let calls = 0;
  let now = 1000;
  const catalogue = createCursorModelCatalogue('/cursor-agent', '/project', async () => {
    calls++;
    return { stdout: 'gpt-5 - GPT-5\n', stderr: '' };
  }, () => now);
  const [a, b] = await Promise.all([catalogue.get(), catalogue.get()]);
  assert.deepEqual(a, ['gpt-5']);
  assert.deepEqual(b, a);
  assert.equal(calls, 1);
  now += 60_001;
  await catalogue.get();
  assert.equal(calls, 2);
});
