import test from 'node:test';
import assert from 'node:assert/strict';
import { agentProviders, configuredProvider, providerCommand, validateWorkerEffort, validateWorkerModel } from '../src/server/agents.js';
import { AGENT_PROVIDERS, CLAUDE_MODELS, CLAUDE_MODEL_NAMES, PROVIDER_META, claudeModelName, isValidCodexModel, isValidDshModel } from '../src/shared/providers.js';
import { isAgentProvider } from '../src/shared/protocol.js';

test('detects the configured provider from Unix and Windows command paths', () => {
  assert.equal(configuredProvider('claude'), 'claude');
  assert.equal(configuredProvider('/opt/tools/claude'), 'claude');
  assert.equal(configuredProvider('C:\\Users\\me\\bin\\opencode.exe'), 'opencode');
  assert.equal(configuredProvider('/opt/tools/codex'), 'codex');
  assert.equal(configuredProvider('CODEX.EXE'), 'codex');
  assert.equal(configuredProvider('/home/me/.local/bin/grok'), 'grok');
  assert.equal(configuredProvider('GROK.EXE'), 'grok');
  assert.equal(configuredProvider('/home/me/.local/bin/muse'), 'muse');
  assert.equal(configuredProvider('MUSE.EXE'), 'muse');
  // DeepSeek Harness: its own provider now that the office can drive it over ACP.
  assert.equal(configuredProvider('dsh'), 'dsh');
  assert.equal(configuredProvider('/opt/tools/dsh'), 'dsh');
  assert.equal(configuredProvider('DSH.EXE'), 'dsh');
  assert.equal(configuredProvider('pi'), 'pi');
  assert.equal(configuredProvider('C:\\Users\\me\\AppData\\Roaming\\npm\\pi.cmd'), 'pi');
  assert.equal(configuredProvider('/usr/local/bin/pi'), 'pi');
  assert.equal(configuredProvider('cursor-agent'), 'cursor');
  assert.equal(configuredProvider('/home/me/.local/bin/cursor-agent'), 'cursor');
  assert.equal(configuredProvider('cursor-agent.cmd'), 'cursor');
  // `cursor` is the editor's launcher, not the agent.
  assert.equal(configuredProvider('cursor'), 'custom');
  assert.equal(configuredProvider('my-agent'), 'custom');
});

test('dsh is a provider the wire accepts, and the others still are', () => {
  assert.equal(isAgentProvider('dsh'), true);
  assert.equal(isAgentProvider('pi'), true);
  for (const provider of ['claude', 'opencode', 'codex', 'custom']) assert.equal(isAgentProvider(provider), true);
  assert.equal(isAgentProvider('deepseek'), false);
  assert.equal(isAgentProvider(undefined), false);
});

test('Pi can be selected with model patterns and thinking levels', () => {
  assert.ok(agentProviders('claude').includes('pi'));
  assert.ok(agentProviders('custom').includes('pi'));
  assert.equal(validateWorkerModel('agent', 'pi', 'anthropic/claude-sonnet-4'), undefined);
  assert.equal(validateWorkerModel('agent', 'pi', 'sonnet'), undefined);
  assert.match(validateWorkerModel('agent', 'pi', '--print') ?? '', /Invalid Pi model/);
  assert.match(validateWorkerModel('agent', 'pi', 'bad\u0000model') ?? '', /Invalid Pi model/);
  assert.equal(validateWorkerEffort('agent', 'pi', 'high'), undefined);
  assert.match(validateWorkerEffort('agent', 'pi', 'invalid') ?? '', /Invalid effort/);
});

test('Cursor can be selected with a model, runs as cursor-agent, and takes no effort', () => {
  assert.ok(agentProviders('claude').includes('cursor'));
  assert.equal(isAgentProvider('cursor'), true);
  assert.equal(PROVIDER_META.cursor.label, 'Cursor');
  assert.equal(providerCommand('cursor', 'claude'), 'cursor-agent');
  assert.equal(providerCommand('cursor', '/opt/bin/cursor-agent'), '/opt/bin/cursor-agent');
  assert.equal(providerCommand('claude', '/opt/bin/cursor-agent'), 'claude');
  assert.equal(validateWorkerModel('agent', 'cursor', undefined), undefined);
  assert.equal(validateWorkerModel('agent', 'cursor', 'gpt-5'), undefined);
  assert.equal(validateWorkerModel('agent', 'cursor', 'claude-opus-4-8[context=1m,effort=high]'), undefined);
  assert.match(validateWorkerModel('agent', 'cursor', '--yolo') ?? '', /Invalid Cursor model/);
  assert.match(validateWorkerModel('agent', 'cursor', 'gpt 5') ?? '', /Invalid Cursor model/);
  assert.match(validateWorkerEffort('agent', 'cursor', 'high') ?? '', /Reasoning effort can only be selected/);
});

test('a DeepSeek Harness model is bounded by length and control characters only', () => {
  // Catalog ids are opaque: no provider/model shape is imposed on them.
  assert.equal(isValidDshModel('deepseek-v4-pro'), true);
  assert.equal(isValidDshModel('Some Vendor/Model-2.1'), true);
  assert.equal(isValidDshModel('x'.repeat(256)), true);
  assert.equal(isValidDshModel('x'.repeat(257)), false);
  assert.equal(isValidDshModel(''), false);
  assert.equal(isValidDshModel('pro\u0000'), false);
  assert.equal(isValidDshModel('pro\u200b'), false, 'format characters are rejected too');
  assert.equal(isValidDshModel(42), false);
  assert.equal(isValidDshModel(undefined), false);
});

test('model validation follows the provider', () => {
  assert.equal(validateWorkerModel('agent', 'dsh', undefined), undefined);
  assert.equal(validateWorkerModel('agent', 'dsh', 'deepseek-v4-pro'), undefined);
  assert.match(validateWorkerModel('agent', 'dsh', 'bad\u0001') ?? '', /DeepSeek Harness/);
  assert.match(validateWorkerModel('shell', 'dsh', 'deepseek-v4-pro') ?? '', /Shell workers/);
  // Claude and OpenCode keep their own rules.
  assert.equal(validateWorkerModel('agent', 'claude', 'opus'), undefined);
  assert.match(validateWorkerModel('agent', 'claude', 'gpt-5') ?? '', /Claude/);
  assert.equal(validateWorkerModel('agent', 'opencode', 'vendor/model'), undefined);
  assert.match(validateWorkerModel('agent', 'opencode', 'gpt-5') ?? '', /OpenCode/);
  // Codex takes its own model ids, and a local provider's.
  assert.equal(validateWorkerModel('agent', 'codex', 'gpt-5.5'), undefined);
  assert.equal(validateWorkerModel('agent', 'codex', 'gpt-oss:20b'), undefined);
  assert.match(validateWorkerModel('agent', 'codex', '--yolo') ?? '', /Invalid Codex model/);
  assert.match(validateWorkerModel('agent', 'codex', 'gpt 5.5') ?? '', /Invalid Codex model/);
  // Custom still takes none.
  assert.match(validateWorkerModel('agent', 'custom', 'anything') ?? '', /Claude Code, OpenCode, Codex, Grok, Muse, DeepSeek Harness, Pi or Cursor/);
});

test('reasoning effort joins Claude for DeepSeek Harness', () => {
  assert.equal(validateWorkerEffort('agent', 'dsh', undefined), undefined);
  assert.equal(validateWorkerEffort('agent', 'dsh', 'high'), undefined);
  assert.match(validateWorkerEffort('agent', 'dsh', 'enormous') ?? '', /Invalid effort/);
  assert.match(validateWorkerEffort('shell', 'dsh', 'high') ?? '', /Shell workers/);
  assert.equal(validateWorkerEffort('agent', 'claude', 'xhigh'), undefined);
  assert.equal(validateWorkerEffort('agent', 'codex', 'high'), undefined);
  assert.equal(validateWorkerEffort('agent', 'opencode', 'high'), undefined);
  assert.match(validateWorkerEffort('agent', 'opencode', 'enormous') ?? '', /Invalid effort/);
  assert.match(validateWorkerEffort('agent', 'custom', 'high') ?? '', /Claude Code, OpenCode, Codex, Grok, Muse, DeepSeek Harness or Pi/);
});

test('every provider the office knows the CLI of takes a model and (but for Cursor) an effort, with the fields to pick them', () => {
  for (const provider of AGENT_PROVIDERS) {
    const meta = PROVIDER_META[provider];
    if (provider === 'custom') {
      // A custom --agent is run as it is: the hire dialog says where its model comes from instead.
      assert.equal(meta.validModel, undefined);
      assert.equal(meta.takesEffort, undefined);
      assert.ok(meta.unpicked);
      continue;
    }
    assert.ok(meta.validModel && meta.invalidModel, `${provider} takes a model`);
    // Cursor's effort is part of its model id (`model[effort=high]`), so it has no effort field of its own.
    if (provider === 'cursor') assert.equal(meta.takesEffort, undefined);
    else assert.ok(meta.takesEffort, `${provider} takes an effort`);
    assert.ok(meta.models?.unset && meta.models.hint, `${provider} has its model field`);
    // A model picked from a list has one to pick from; a typed one says what's wrong with a bad one.
    if (meta.models.pick === 'list') assert.ok(meta.models.fixed?.length || meta.models.catalog, `${provider} has models to list`);
    if (meta.models.pick === 'typed' || meta.models.catalog) assert.ok(meta.models.invalid && meta.models.max, `${provider} checks a typed model`);
    for (const m of meta.models.fixed ?? []) assert.equal(meta.validModel(m.id), true, `${provider} takes its own ${m.id}`);
  }
});

test('Codex model ids are argv-safe', () => {
  assert.equal(isValidCodexModel('gpt-5.5'), true);
  assert.equal(isValidCodexModel('openai/gpt-oss-20b'), true);
  assert.equal(isValidCodexModel('-m'), false);
  assert.equal(isValidCodexModel('gpt-5.5 --yolo'), false);
  assert.equal(isValidCodexModel('gpt"5'), false);
  assert.equal(isValidCodexModel('x'.repeat(129)), false);
  assert.equal(isValidCodexModel(''), false);
});

test('Claude models go by the name of the model, not only its family', () => {
  // Every alias says which model it stands for.
  for (const alias of CLAUDE_MODELS) assert.match(CLAUDE_MODEL_NAMES[alias], /^[A-Z][a-z]+ \d+(\.\d+)?$/);
  assert.deepEqual(PROVIDER_META.claude.models?.fixed?.map((m) => m.name), CLAUDE_MODELS.map((m) => CLAUDE_MODEL_NAMES[m]));
  // And so does the id a session reports.
  assert.equal(claudeModelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(claudeModelName('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(claudeModelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(claudeModelName('claude-sonnet-5'), 'Sonnet 5');
  assert.equal(claudeModelName('claude-sonnet-4-20250514'), 'Sonnet 4');
  assert.equal(claudeModelName('claude-opus-4-1-20250805'), 'Opus 4.1');
  assert.equal(claudeModelName('claude-3-5-sonnet-20241022'), 'Sonnet 3.5');
  assert.equal(claudeModelName('claude-opus-5-5[1m]'), 'Opus 5.5');
  assert.equal(claudeModelName('us.anthropic.claude-opus-5-5-v1:0'), 'Opus 5.5');
  assert.equal(claudeModelName('gpt-5.5'), undefined);
  assert.equal(claudeModelName('<synthetic>'), undefined);
});
