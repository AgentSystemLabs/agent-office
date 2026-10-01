import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  antigravityArgs,
  antigravityHooksConfig,
  ensureAntigravityWorkspace,
  normalizeAntigravityHook,
  writeAntigravityHookScript,
} from '../src/server/antigravity.js';
import { configuredProvider } from '../src/server/agents.js';
import { isValidAntigravityModel, PROVIDER_META } from '../src/shared/providers.js';
import { reduceLifecycle } from '../src/server/workers/lifecycle.js';
import type { WorkerHandle } from '../src/server/workers/types.js';

test('Antigravity provider is configured and recognizes agy binary', () => {
  assert.equal(configuredProvider('agy'), 'antigravity');
  assert.equal(configuredProvider('agy.exe'), 'antigravity');
  assert.equal(configuredProvider('C:\\Users\\maeriksson\\bin\\agy.exe'), 'antigravity');
  assert.equal(PROVIDER_META.antigravity.bin, 'agy');
  assert.equal(PROVIDER_META.antigravity.takesEffort, true);
});

test('Antigravity model validation validates Gemini model names and rejects dangerous chars', () => {
  assert.equal(isValidAntigravityModel('gemini-3.8-flash'), true);
  assert.equal(isValidAntigravityModel('gemini-3.1-pro'), true);
  assert.equal(isValidAntigravityModel('gemini-2.5-flash'), true);
  assert.equal(isValidAntigravityModel('gemini-2.5-pro'), true);
  assert.equal(isValidAntigravityModel('google/gemini-2.5-pro'), true);
  assert.equal(isValidAntigravityModel(''), false);
  assert.equal(isValidAntigravityModel('rm -rf /'), false);
  assert.equal(isValidAntigravityModel('model; reboot'), false);
  assert.equal(isValidAntigravityModel('a'.repeat(200)), false);
});

test('antigravityArgs builds clean command-line arguments', () => {
  const args = antigravityArgs(['--model', 'old-model', '--effort', 'low', '-c'], {
    model: 'gemini-3.8-flash',
    effort: 'high',
    prompt: 'Implement auth feature',
    resumeSessionId: 'conv-12345',
  });
  assert.deepEqual(args, [
    '--conversation',
    'conv-12345',
    '--model',
    'gemini-3.8-flash',
    '--effort',
    'high',
    '-i',
    'Implement auth feature',
  ]);
});

test('normalizeAntigravityHook normalizes lifecycle events and filters malformed payloads', () => {
  assert.equal(normalizeAntigravityHook('PreInvocation', null), undefined);
  assert.equal(normalizeAntigravityHook('PreInvocation', {}), undefined);
  assert.equal(normalizeAntigravityHook('UnknownEvent', { conversationId: 'conv-1' }), undefined);

  // PreInvocation -> UserPromptSubmit
  const preInv = normalizeAntigravityHook('PreInvocation', {
    conversationId: 'conv-123',
    workspacePaths: ['/workspace'],
  });
  assert.deepEqual(preInv, {
    sessionId: 'conv-123',
    event: 'UserPromptSubmit',
  });

  // PreToolUse with regular tool
  const preTool = normalizeAntigravityHook('PreToolUse', {
    conversationId: 'conv-123',
    toolCall: { name: 'run_command', args: { CommandLine: 'npm test' } },
  });
  assert.deepEqual(preTool, {
    sessionId: 'conv-123',
    event: 'PreToolUse',
    tool: 'run_command',
  });

  // PreToolUse with ask_question
  const askTool = normalizeAntigravityHook('PreToolUse', {
    conversationId: 'conv-123',
    toolCall: { name: 'ask_question', args: { question: 'Proceed?' } },
  });
  assert.deepEqual(askTool, {
    sessionId: 'conv-123',
    event: 'PreToolUse',
    tool: 'ask_question',
  });

  // PostToolUse
  const postTool = normalizeAntigravityHook('PostToolUse', {
    conversationId: 'conv-123',
  });
  assert.deepEqual(postTool, {
    sessionId: 'conv-123',
    event: 'PostToolUse',
  });

  // Stop
  const stop = normalizeAntigravityHook('Stop', {
    conversationId: 'conv-123',
  });
  assert.deepEqual(stop, {
    sessionId: 'conv-123',
    event: 'Stop',
  });
});

test('ensureAntigravityWorkspace creates .agents/hooks.json, .agents/mcp_config.json, .agents/rules, and configures git exclude', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'antigravity-workspace-'));
  try {
    const gitDir = path.join(tmp, '.git', 'info');
    mkdirSync(gitDir, { recursive: true });
    const excludeFile = path.join(gitDir, 'exclude');
    writeFileSync(excludeFile, '# Git exclude\n');

    const hookScript = path.join(tmp, 'hook.cjs');
    writeFileSync(hookScript, '// dummy hook');
    const mcpScript = path.join(tmp, 'office-workers.js');
    writeFileSync(mcpScript, '// dummy mcp script');

    ensureAntigravityWorkspace(tmp, hookScript, mcpScript);

    // 1. Hooks JSON
    const hooksJsonPath = path.join(tmp, '.agents', 'hooks.json');
    const hooksJson = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
    assert.ok(hooksJson['agent-office-bridge']);
    assert.ok(hooksJson['agent-office-bridge'].PreToolUse);
    assert.ok(hooksJson['agent-office-bridge'].Stop);

    // 2. MCP Config JSON (Summer Engine and Agent Office)
    const mcpConfigPath = path.join(tmp, '.agents', 'mcp_config.json');
    const mcpConfig = JSON.parse(readFileSync(mcpConfigPath, 'utf8'));
    assert.ok(mcpConfig.mcpServers['summer-engine']);
    assert.ok(mcpConfig.mcpServers['summer-engine'].command.startsWith('npx'));
    assert.deepEqual(mcpConfig.mcpServers['summer-engine'].args, ['-y', 'summer-engine@latest', 'mcp']);
    assert.ok(mcpConfig.mcpServers['agent-office']);
    assert.equal(mcpConfig.mcpServers['agent-office'].command, process.execPath);
    assert.deepEqual(mcpConfig.mcpServers['agent-office'].args, [mcpScript, 'mcp']);

    // 3. Studio rules
    const rulesPath = path.join(tmp, '.agents', 'rules', 'summer_engine.md');
    const rulesContent = readFileSync(rulesPath, 'utf8');
    assert.ok(rulesContent.includes('Summer Engine'));
    assert.ok(rulesContent.includes('Art (Art Lead)'));
    assert.ok(rulesContent.includes('Code (Gameplay Engineer)'));
    assert.ok(rulesContent.includes('Design (Game Designer)'));
    assert.ok(rulesContent.includes('Director (Lead / Producer)'));

    // 4. Git exclude
    const excludeContent = readFileSync(excludeFile, 'utf8');
    assert.ok(excludeContent.includes('.agents/'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('Antigravity lifecycle transitions update worker status correctly', () => {
  let status: string = 'starting';
  const info: any = { id: 'w1', kind: 'agent', status: 'starting' };
  const h: Partial<WorkerHandle> = {
    info,
    state: {},
    running: true,
    bootBlocked: false,
    leftNeedsInputAt: 0,
    failStreak: 0,
    setStatus(s) {
      status = s;
      info.status = s;
    },
    emit() {},
    persist() {},
    clearTask() {},
    notePrompt() {},
    noteTool() {},
    scheduleScan() {},
  };

  // 1. PreInvocation fires: worker starts working
  const startTurn = normalizeAntigravityHook('PreInvocation', { conversationId: 'conv-1' });
  assert.ok(startTurn);
  reduceLifecycle(h as WorkerHandle, startTurn);
  assert.equal(info.sessionId, 'conv-1');
  assert.equal(status, 'working');

  // 2. PreToolUse with normal tool: stays working
  const toolStep = normalizeAntigravityHook('PreToolUse', {
    conversationId: 'conv-1',
    toolCall: { name: 'run_command' },
  });
  assert.ok(toolStep);
  reduceLifecycle(h as WorkerHandle, toolStep);
  assert.equal(status, 'working');

  // 3. PreToolUse with ask_question: transitions to needs_input (desk jumps up!)
  const askStep = normalizeAntigravityHook('PreToolUse', {
    conversationId: 'conv-1',
    toolCall: { name: 'ask_question' },
  });
  assert.ok(askStep);
  reduceLifecycle(h as WorkerHandle, askStep);
  assert.equal(status, 'needs_input');

  // 4. PostToolUse after question answered: transitions back to working
  const postAsk = normalizeAntigravityHook('PostToolUse', { conversationId: 'conv-1' });
  assert.ok(postAsk);
  reduceLifecycle(h as WorkerHandle, postAsk);
  assert.equal(status, 'working');

  // 5. Stop: transitions to done
  const stopTurn = normalizeAntigravityHook('Stop', { conversationId: 'conv-1' });
  assert.ok(stopTurn);
  reduceLifecycle(h as WorkerHandle, stopTurn);
  assert.equal(status, 'done');
});
