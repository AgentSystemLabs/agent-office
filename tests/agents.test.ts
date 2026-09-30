import test from 'node:test';
import assert from 'node:assert/strict';
import { agentProviders, configuredProvider, validateWorkerEffort, validateWorkerModel } from '../src/server/agents.js';
import { isValidDshModel } from '../src/shared/providers.js';
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
  // Custom still takes none.
  assert.match(validateWorkerModel('agent', 'custom', 'anything') ?? '', /Claude Code, OpenCode, Grok, Muse, DeepSeek Harness or Pi/);
});

test('reasoning effort joins Claude for DeepSeek Harness', () => {
  assert.equal(validateWorkerEffort('agent', 'dsh', undefined), undefined);
  assert.equal(validateWorkerEffort('agent', 'dsh', 'high'), undefined);
  assert.match(validateWorkerEffort('agent', 'dsh', 'enormous') ?? '', /Invalid effort/);
  assert.match(validateWorkerEffort('shell', 'dsh', 'high') ?? '', /Shell workers/);
  assert.equal(validateWorkerEffort('agent', 'claude', 'xhigh'), undefined);
  assert.match(validateWorkerEffort('agent', 'opencode', 'high') ?? '', /Claude Code, Grok, Muse, DeepSeek Harness or Pi/);
  assert.match(validateWorkerEffort('agent', 'codex', 'high') ?? '', /Claude Code, Grok, Muse, DeepSeek Harness or Pi/);
});
