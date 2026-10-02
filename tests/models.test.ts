import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidGrokModel, isValidMuseModel, isValidOpenCodeModel } from '../src/shared/providers.js';
import { MODEL_LISTERS, createModelCatalogue, fetchCodexModels, fetchCursorModels, fetchGrokModels, fetchOpenCodeModels, type ModelCommandRunner } from '../src/server/models.js';
import { AGENT_PROVIDERS, PROVIDER_META } from '../src/shared/providers.js';

test('OpenCode model ids require provider/model and reject whitespace or control characters', () => {
  assert.equal(isValidOpenCodeModel('openai/gpt-5'), true);
  assert.equal(isValidOpenCodeModel('openrouter/deepseek/deepseek-r1'), true);
  assert.equal(isValidOpenCodeModel('gpt-5'), false);
  assert.equal(isValidOpenCodeModel('openai/gpt 5'), false);
  assert.equal(isValidOpenCodeModel('openai/gpt\n5'), false);
  assert.equal(isValidOpenCodeModel(`openai/${'x'.repeat(256)}`), false);
});

const ids = (models: { id: string }[]) => models.map((m) => m.id);

test('OpenCode catalogue invokes only the configured executable with bounded execFile options', async () => {
  const calls: { file: string; args: string[]; options: Record<string, unknown> }[] = [];
  const runner: ModelCommandRunner = async (file, args, options) => {
    calls.push({ file, args, options });
    // An OpenCode without --verbose: it's turned down, and the plain list is asked for.
    if (args.includes('--verbose')) throw new Error('Unknown argument: verbose');
    return { stdout: 'openai/gpt-5\nopenrouter/deepseek/deepseek-r1\nopenai/gpt-5\n', stderr: 'private detail' };
  };
  assert.deepEqual(await fetchOpenCodeModels('/custom/opencode', '/project', runner), [{ id: 'openai/gpt-5' }, { id: 'openrouter/deepseek/deepseek-r1' }]);
  assert.deepEqual(calls, [
    { file: '/custom/opencode', args: ['models', '--verbose'], options: { cwd: '/project', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 } },
    { file: '/custom/opencode', args: ['models'], options: { cwd: '/project', timeout: 30_000, maxBuffer: 1024 * 1024 } },
  ]);
});

test('OpenCode catalogue takes each model\'s name and its variants as the efforts it can run at', async () => {
  // As `opencode models --verbose` prints them: the id on a line, then its details as JSON.
  const stdout = [
    'opencode/big-pickle',
    JSON.stringify({ id: 'big-pickle', providerID: 'opencode', name: 'Big Pickle', options: {}, variants: {} }, null, 2),
    'amazon-bedrock/anthropic.claude-opus-5-5',
    JSON.stringify({ id: 'anthropic.claude-opus-5-5', name: 'Claude Opus 5.5', limit: { context: 200000 }, variants: { low: { a: 1 }, medium: {}, high: {}, max: {} } }, null, 2),
    'openai/gpt-5',
    JSON.stringify({ id: 'gpt-5', name: 'GPT-5', variants: { minimal: {}, low: {}, medium: {}, high: {} } }, null, 2),
    'local/plain',
    'local/odd',
    '{ not json',
    '}',
    'local/unnamed',
    JSON.stringify({ id: 'unnamed', name: 'local/unnamed' }, null, 2),
    '',
  ].join('\n');
  const models = await fetchOpenCodeModels('opencode', '/project', async () => ({ stdout, stderr: '' }));
  assert.deepEqual(models, [
    { id: 'opencode/big-pickle', name: 'Big Pickle', efforts: [] },
    { id: 'amazon-bedrock/anthropic.claude-opus-5-5', name: 'Claude Opus 5.5', efforts: ['low', 'medium', 'high', 'max'] },
    // Variants the office has no effort for ("minimal") are left out.
    { id: 'openai/gpt-5', name: 'GPT-5', efforts: ['low', 'medium', 'high'] },
    // No details, or ones that don't parse: still a model, with any effort.
    { id: 'local/plain' },
    { id: 'local/odd' },
    // A name that only repeats the id says nothing.
    { id: 'local/unnamed' },
  ]);
});

test('Codex catalogue lists the models its own picker shows, by name, with the efforts each supports', async () => {
  let call: { file: string; args: string[]; options: Record<string, unknown> } | undefined;
  const levels = (...efforts: string[]) => efforts.map((effort) => ({ effort, description: 'x' }));
  const stdout = JSON.stringify({
    models: [
      { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list', supported_reasoning_levels: levels('low', 'medium', 'high', 'xhigh', 'max', 'ultra'), base_instructions: 'x'.repeat(4000) },
      { slug: 'gpt-reserve', display_name: 'GPT-Reserve', visibility: 'hide', supported_reasoning_levels: levels('low') },
      { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', supported_reasoning_levels: levels('low', 'medium', 'high', 'xhigh') },
      { slug: 'bad slug', display_name: 'Nope', visibility: 'list' },
      { slug: 'gpt-oss:20b', display_name: 'gpt-oss:20b' },
      { slug: 'gpt-6-astra', display_name: 'Again', visibility: 'list' },
      'junk',
    ],
  });
  const runner: ModelCommandRunner = async (file, args, options) => {
    call = { file, args, options };
    return { stdout, stderr: '' };
  };
  assert.deepEqual(await fetchCodexModels('/custom/codex', '/project', runner), [
    { id: 'gpt-6-astra', name: 'GPT-6-Astra', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'gpt-5.5', name: 'GPT-5.5', efforts: ['low', 'medium', 'high', 'xhigh'] },
    { id: 'gpt-oss:20b' },
  ]);
  assert.deepEqual(call, { file: '/custom/codex', args: ['debug', 'models'], options: { cwd: '/project', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 } });
});

test('Codex catalogue errors do not expose command output', async () => {
  await assert.rejects(fetchCodexModels('codex', '/project', async () => ({ stdout: 'error: unrecognized subcommand', stderr: 'secret-token' })), (error: unknown) => {
    return error instanceof Error && /unavailable/i.test(error.message) && !error.message.includes('secret-token');
  });
  await assert.rejects(fetchCodexModels('codex', '/project', async () => ({ stdout: '{"models":"none"}', stderr: '' })), /unavailable/i);
});

test('every provider that says its CLI lists its models has a lister, and only those', () => {
  const listed = AGENT_PROVIDERS.filter((p) => PROVIDER_META[p].models?.catalog);
  assert.deepEqual(Object.keys(MODEL_LISTERS).sort(), [...listed].sort());
});

test('OpenCode catalogue coalesces requests and caches successful results briefly', async () => {
  let calls = 0;
  let now = 1000;
  const runner: ModelCommandRunner = async () => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { stdout: 'anthropic/claude-sonnet-4\n', stderr: '' };
  };
  const catalogue = createModelCatalogue(() => fetchOpenCodeModels('/opencode', '/project', runner), () => now);
  const [a, b] = await Promise.all([catalogue.get(), catalogue.get()]);
  assert.deepEqual(a, [{ id: 'anthropic/claude-sonnet-4' }]);
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
  assert.deepEqual(ids(await fetchGrokModels('/custom/grok', '/project', runner)), ['grok-4.7', 'grok-4.6', 'grok-4.5']);
  assert.deepEqual(call, {
    file: '/custom/grok',
    args: ['models'],
    options: { cwd: '/project', timeout: 30_000, maxBuffer: 1024 * 1024 },
  });
});

test('Grok catalogue coalesces requests and caches successful results briefly', async () => {
  let calls = 0;
  let now = 1000;
  const runner: ModelCommandRunner = async () => {
    calls++;
    return { stdout: '  - grok-4.6\n', stderr: '' };
  };
  const catalogue = createModelCatalogue(() => fetchGrokModels('/grok', '/project', runner), () => now);
  const [a, b] = await Promise.all([catalogue.get(), catalogue.get()]);
  assert.deepEqual(a, [{ id: 'grok-4.6' }]);
  assert.deepEqual(b, a);
  assert.equal(calls, 1);
  now += 59_999;
  await catalogue.get();
  assert.equal(calls, 1);
  now += 2;
  await catalogue.get();
  assert.equal(calls, 2);
});

test('Cursor catalogue parses `cursor-agent models` lines, with each model\'s name, and ignores the heading and tip', async () => {
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
  assert.deepEqual(await fetchCursorModels('/custom/cursor-agent', '/project', runner), [{ id: 'auto', name: 'Auto' }, { id: 'composer-2.5', name: 'Composer 2.5' }, { id: 'gpt-5', name: 'GPT-5' }, { id: 'sonnet-4-thinking' }]);
  assert.deepEqual(call, {
    file: '/custom/cursor-agent',
    args: ['models'],
    options: { cwd: '/project', timeout: 30_000, maxBuffer: 1024 * 1024 },
  });
  assert.deepEqual(await fetchCursorModels('cursor-agent', '/project', async () => ({ stdout: 'No models available for this account.\n', stderr: '' })), []);
});

test('Cursor catalogue caches briefly and hides why it failed (not signed in)', async () => {
  let calls = 0;
  const catalogue = createModelCatalogue(() => fetchCursorModels('/cursor-agent', '/project', async () => {
    calls++;
    return { stdout: 'gpt-5 - GPT-5\n', stderr: '' };
  }));
  const [a, b] = await Promise.all([catalogue.get(), catalogue.get()]);
  assert.deepEqual([a, b], [[{ id: 'gpt-5', name: 'GPT-5' }], [{ id: 'gpt-5', name: 'GPT-5' }]]);
  await catalogue.get();
  assert.equal(calls, 1);
  await assert.rejects(createModelCatalogue(() => fetchCursorModels('cursor-agent', '/project', async () => {
    throw new Error("Authentication required. Run 'agent login'");
  })).get(), (error: unknown) => error instanceof Error && /unavailable/i.test(error.message) && !error.message.includes('Authentication'));
});

test('a catalogue past its minute still answers at once with the last list, and asks again for the next', async () => {
  let now = 1000;
  let calls = 0;
  let fail = false;
  const catalogue = createModelCatalogue(async () => {
    calls++;
    if (fail) throw new Error('gone');
    return [{ id: `model-${calls}` }];
  }, () => now);
  assert.deepEqual(await catalogue.get(), [{ id: 'model-1' }]);
  now += 60_001;
  assert.deepEqual(await catalogue.get(), [{ id: 'model-1' }]);
  assert.equal(calls, 2);
  assert.deepEqual(await catalogue.get(), [{ id: 'model-2' }]);
  // A CLI that can't list them any more leaves the last list standing.
  fail = true;
  now += 60_001;
  assert.deepEqual(await catalogue.get(), [{ id: 'model-2' }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await catalogue.get(), [{ id: 'model-2' }]);
  // One that never could says so.
  await assert.rejects(createModelCatalogue(async () => Promise.reject(new Error('gone'))).get(), /gone/);
});

test('OpenCode catalogue errors do not expose command output', async () => {
  const runner: ModelCommandRunner = async () => {
    throw new Error('secret-token from stderr');
  };
  await assert.rejects(fetchOpenCodeModels('opencode', '/project', runner), /unavailable/i);
  await assert.rejects(createModelCatalogue(() => fetchOpenCodeModels('opencode', '/project', runner)).get(), (error: unknown) => {
    return error instanceof Error && /unavailable/i.test(error.message) && !error.message.includes('secret-token');
  });
});
