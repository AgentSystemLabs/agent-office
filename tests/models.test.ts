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

test('Cursor catalogue parses `cursor-agent models` lines and ignores the heading and tip', async () => {
  let call: { file: string; args: string[]; options: Record<string, unknown> } | undefined;
  const runner: ModelCommandRunner = async (file, args, options) => {
    call = { file, args, options };
    return {
      stdout: [
        '\x1b[2mAvailable models\x1b[22m',
        '',
        '\x1b[36mauto\x1b[39m \x1b[2m- Auto\x1b[22m',
        '\x1b[32mcomposer-2.5\x1b[39m \x1b[2m- Composer 2.5\x1b[22m\x1b[2m (current, default)\x1b[22m',
        'gpt-5 - GPT-5',
        'sonnet-4-thinking',
        'gpt-5 - GPT-5',
        'bad/model - Not a Cursor id',
        '',
        "Tip: use --model <id> (or /model <id> in interactive mode) to switch. Parameterized models also accept quoted overrides, e.g. --model 'claude-opus-4-8[context=1m,effort=high,fast=false]'.",
      ].join('\n'),
      stderr: 'private detail',
    };
  };
  assert.deepEqual(await fetchCursorModels('/custom/cursor-agent', '/project', runner), ['auto', 'composer-2.5', 'gpt-5', 'sonnet-4-thinking']);
  assert.deepEqual(call, {
    file: '/custom/cursor-agent',
    args: ['models'],
    options: { cwd: '/project', timeout: 10_000, maxBuffer: 1024 * 1024 },
  });
  assert.deepEqual(await fetchCursorModels('cursor-agent', '/project', async () => ({ stdout: 'No models available for this account.\n', stderr: '' })), []);
});

test('Cursor catalogue caches briefly and hides why it failed (not signed in)', async () => {
  let calls = 0;
  let now = 1000;
  const catalogue = createCursorModelCatalogue('/cursor-agent', '/project', async () => {
    calls++;
    return { stdout: 'gpt-5 - GPT-5\n', stderr: '' };
  }, () => now);
  const [a, b] = await Promise.all([catalogue.get(), catalogue.get()]);
  assert.deepEqual([a, b], [['gpt-5'], ['gpt-5']]);
  now += 60_001;
  await catalogue.get();
  assert.equal(calls, 2);
  await assert.rejects(createCursorModelCatalogue('cursor-agent', '/project', async () => {
    throw new Error("Authentication required. Run 'agent login'");
  }).get(), (error: unknown) => error instanceof Error && /unavailable/i.test(error.message) && !error.message.includes('Authentication'));
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
