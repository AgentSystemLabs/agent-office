import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LifecycleReport } from './workers/lifecycle.js';
import { shq } from './workers/process.js';

export const ANTIGRAVITY_HOOK_SCRIPT = `const http = require('http');
const [event] = process.argv.slice(2);
let size = 0;
let overflow = false;
const chunks = [];
const MAX = 1024 * 1024;

process.stdin.on('data', (c) => {
  if (overflow) return;
  size += c.length;
  if (size > MAX) { overflow = true; return; }
  chunks.push(c);
});

process.stdin.on('end', () => {
  if (event === 'PreToolUse') {
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
  } else {
    process.stdout.write('{}');
  }

  if (overflow) return;
  let raw = '';
  try {
    raw = Buffer.concat(chunks).toString('utf8');
  } catch {
    return;
  }

  const base = process.env.AGENT_OFFICE_HOOK_URL;
  const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
  const worker = process.env.AGENT_OFFICE_WORKER_ID;
  if (!base || !token || !worker) return;

  try {
    const url = new URL('/hooks/antigravity', base);
    url.searchParams.set('worker', worker);
    url.searchParams.set('event', event);

    const req = http.request(
      url,
      {
        method: 'POST',
        timeout: 2000,
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'application/json',
        },
      },
      (res) => res.resume()
    );
    req.on('error', () => {});
    req.on('timeout', () => req.destroy());
    req.end(raw);
  } catch {}
});
`;

const MAX_ID = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function bounded(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

/** Formats arguments for launching the agy CLI. */
export function antigravityArgs(
  extra: string[],
  options: { model?: string; effort?: string; prompt?: string; resumeSessionId?: string } = {},
): string[] {
  const flags = new Set(['--continue', '-c']);
  const values = new Set(['--model', '--effort', '--conversation', '-i', '--prompt-interactive', '-p', '--print']);
  const args: string[] = [];

  for (let i = 0; i < extra.length; i++) {
    const arg = extra[i];
    if (flags.has(arg)) continue;
    if (values.has(arg)) {
      if (extra[i + 1] !== undefined && !extra[i + 1].startsWith('-')) i++;
      continue;
    }
    if ([...values].some((name) => arg.startsWith(`${name}=`))) continue;
    args.push(arg);
  }

  if (options.resumeSessionId) {
    args.push('--conversation', options.resumeSessionId);
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.effort) {
    args.push('--effort', options.effort);
  }
  if (options.prompt) {
    args.push('-i', options.prompt);
  }

  return args;
}

/** Normalize Antigravity hooks.json lifecycle payload into an Agent Office LifecycleReport. */
export function normalizeAntigravityHook(event: string, payload: unknown): LifecycleReport | undefined {
  if (!isRecord(payload)) return undefined;
  const sessionId = bounded(payload.conversationId, MAX_ID);
  if (!sessionId) return undefined;

  switch (event) {
    case 'PreInvocation':
      return {
        sessionId,
        event: 'UserPromptSubmit',
      };
    case 'PreToolUse': {
      const toolCall = isRecord(payload.toolCall) ? payload.toolCall : undefined;
      const tool = toolCall ? bounded(toolCall.name, MAX_ID) : undefined;
      return {
        sessionId,
        event: 'PreToolUse',
        tool: tool ?? 'tool',
      };
    }
    case 'PostToolUse':
      return {
        sessionId,
        event: 'PostToolUse',
      };
    case 'Stop':
      return {
        sessionId,
        event: 'Stop',
      };
    default:
      return undefined;
  }
}

/** Writes the standalone bridge script to dataDir. */
export function writeAntigravityHookScript(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'agent-office-antigravity-hook.cjs');
  writeFileSync(file, ANTIGRAVITY_HOOK_SCRIPT, { mode: 0o700 });
  return file;
}

/** Constructs the hooks.json definition for Antigravity. */
export function antigravityHooksConfig(hookScriptPath: string): Record<string, unknown> {
  const isWin = process.platform === 'win32';
  const nodeBin = process.execPath;
  const cmd = (event: string) =>
    isWin
      ? `"${nodeBin}" "${hookScriptPath}" ${event}`
      : `${shq(nodeBin)} ${shq(hookScriptPath)} ${event}`;

  return {
    'agent-office-bridge': {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: cmd('PreToolUse'), timeout: 5 }],
        },
      ],
      PostToolUse: [
        {
          matcher: '*',
          hooks: [{ type: 'command', command: cmd('PostToolUse'), timeout: 5 }],
        },
      ],
      PreInvocation: [
        {
          type: 'command',
          command: cmd('PreInvocation'),
          timeout: 5,
        },
      ],
      Stop: [
        {
          type: 'command',
          command: cmd('Stop'),
          timeout: 5,
        },
      ],
    },
  };
}

/** Sets up .agents/hooks.json in cwd and ensures it is git-ignored via .git/info/exclude. */
export function ensureAntigravityWorkspace(cwd: string, hookScriptPath: string): void {
  try {
    const agentsDir = path.join(cwd, '.agents');
    mkdirSync(agentsDir, { recursive: true, mode: 0o700 });
    const hooksPath = path.join(agentsDir, 'hooks.json');

    let currentConfig: Record<string, unknown> = {};
    if (existsSync(hooksPath)) {
      try {
        currentConfig = JSON.parse(readFileSync(hooksPath, 'utf8'));
      } catch {}
    }

    const bridgeConfig = antigravityHooksConfig(hookScriptPath);
    Object.assign(currentConfig, bridgeConfig);
    writeFileSync(hooksPath, JSON.stringify(currentConfig, null, 2), { mode: 0o600 });

    const gitExclude = path.join(cwd, '.git', 'info', 'exclude');
    if (existsSync(gitExclude)) {
      try {
        const content = readFileSync(gitExclude, 'utf8');
        if (!content.includes('.agents')) {
          writeFileSync(gitExclude, `${content.trimEnd()}\n.agents/\n`, 'utf8');
        }
      } catch {}
    }
  } catch {}
}
