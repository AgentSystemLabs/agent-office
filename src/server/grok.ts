import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const GROK_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'StopFailure',
  'StopCancelled',
] as const;

export type GrokHookEventName = (typeof GROK_HOOK_EVENTS)[number];

/** The bounded event shape forwarded to the worker bridge. */
export interface GrokHookEvent {
  sessionId: string;
  event: GrokHookEventName;
  source?: string;
  prompt?: string;
  tool?: string;
  toolUseId?: string;
  notificationType?: string;
  reason?: string;
}

const MAX_ID = 160;
const MAX_TEXT = 20_000;
const EVENT_SET = new Set<string>(GROK_HOOK_EVENTS);

function bounded(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function field(payload: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (payload[key] !== undefined) return payload[key];
  }
  return undefined;
}

/**
 * Validate and compact a Grok hook payload. Child-session events (a subagent's own turn) are
 * ignored so they cannot overwrite the desk's root status. Message bodies and tool inputs are
 * discarded.
 */
export function normalizeGrokHook(event: string, payload: unknown): GrokHookEvent | undefined {
  if (!EVENT_SET.has(event) || !isRecord(payload)) return undefined;
  if (hasText(field(payload, 'subagentType', 'subagent_type', 'agent_id', 'agent_type'))) return undefined;

  const sessionId = bounded(field(payload, 'sessionId', 'session_id'), MAX_ID);
  if (!sessionId) return undefined;
  const result: GrokHookEvent = { sessionId, event: event as GrokHookEventName };

  const source = event === 'SessionStart' ? bounded(field(payload, 'source'), MAX_ID) : undefined;
  if (source) result.source = source;
  if (event === 'UserPromptSubmit') {
    const prompt = bounded(field(payload, 'prompt'), MAX_TEXT);
    if (prompt) result.prompt = prompt;
  } else if (event === 'PreToolUse' || event === 'PostToolUse') {
    const tool = bounded(field(payload, 'toolName', 'tool_name'), MAX_ID);
    if (tool) result.tool = tool;
    const toolUseId = bounded(field(payload, 'toolUseId', 'tool_use_id'), MAX_ID);
    if (toolUseId) result.toolUseId = toolUseId;
  } else if (event === 'Notification') {
    const notificationType = bounded(field(payload, 'notificationType', 'notification_type'), MAX_ID);
    if (notificationType) result.notificationType = notificationType;
  } else if (event === 'Stop' || event === 'StopFailure' || event === 'StopCancelled') {
    const reason = bounded(field(payload, 'reason'), MAX_ID);
    if (reason) result.reason = reason;
  }
  return result;
}

export function validateGrokHook(event: string, payload: unknown): boolean {
  return !!normalizeGrokHook(event, payload);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/** Write the self-contained helper invoked by Grok's command hooks. */
export function writeGrokHook(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'agent-office-grok-hook.cjs');
  writeFileSync(file, GROK_HOOK_SOURCE, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/**
 * An isolated GROK_HOME that carries only the office's hooks, so a worker never writes into the
 * user's ~/.grok/hooks. Auth still comes from GROK_AUTH_PATH when the office sets it.
 */
export function writeGrokHome(dataDir: string): { home: string; hook: string; socket: string } {
  const home = path.join(dataDir, 'grok-home');
  const hooksDir = path.join(home, 'hooks');
  mkdirSync(hooksDir, { recursive: true, mode: 0o700 });
  const hook = writeGrokHook(dataDir);
  const hooks: Record<string, unknown[]> = {};
  for (const event of GROK_HOOK_EVENTS) {
    const command = [process.execPath, hook, event].map(shellQuote).join(' ');
    hooks[event] = [{ hooks: [{ type: 'command', command, timeout: 3 }] }];
  }
  writeFileSync(path.join(hooksDir, 'agent-office.json'), JSON.stringify({ hooks }, null, 2), { mode: 0o600 });
  return { home, hook, socket: path.join(dataDir, 'grok-leader.sock') };
}

/** Drop launch flags the office always sets itself, plus model/effort/session flags it may replace. */
export function withoutGrokLaunchArgs(args: string[]): string[] {
  const skipValue = new Set([
    '--model', '-m', '--effort', '--reasoning-effort', '--session-id', '-s',
    '--resume', '-r', '--leader-socket',
  ]);
  const skipFlag = new Set(['--no-alt-screen', '--trust', '--continue', '-c', '--fullscreen', '--minimal']);
  const clean: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (skipFlag.has(arg)) continue;
    if (skipValue.has(arg)) {
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if (arg.startsWith('--model=') || arg.startsWith('--effort=') || arg.startsWith('--reasoning-effort=')
      || arg.startsWith('--session-id=') || arg.startsWith('--resume=') || arg.startsWith('--leader-socket=')
      || (arg.startsWith('-m') && arg.length > 2 && arg !== '-minimal')) continue;
    clean.push(arg);
  }
  return clean;
}

/** The helper only reads bounded hook stdin and the worker bridge environment. */
export const GROK_HOOK_SOURCE = String.raw`'use strict';
const MAX = 64 * 1024;
const EVENTS = new Set(${JSON.stringify(GROK_HOOK_EVENTS)});
const MAX_ID = 160;
const MAX_TEXT = 20000;
const allowed = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : undefined;
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const pick = (input, keys) => {
  for (const key of keys) if (input[key] !== undefined) return input[key];
};
const finish = (ok) => { if (ok) process.stdout.write('{}'); };
const event = process.argv[2];
let size = 0;
let overflow = false;
const chunks = [];
process.stdin.on('data', (chunk) => {
  if (overflow) return;
  size += chunk.length;
  if (size > MAX) { overflow = true; return; }
  chunks.push(chunk);
});
process.stdin.on('error', () => finish(false));
process.stdin.on('end', async () => {
  if (overflow || !EVENTS.has(event)) return finish(false);
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return finish(false); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return finish(false);
  if (hasText(pick(input, ['subagentType', 'subagent_type', 'agent_id', 'agent_type']))) return finish(false);
  const session = allowed(pick(input, ['sessionId', 'session_id']), MAX_ID);
  if (!session) return finish(false);
  const body = { session_id: session, hook_event_name: event };
  const source = event === 'SessionStart' ? allowed(pick(input, ['source']), MAX_ID) : undefined;
  const prompt = event === 'UserPromptSubmit' ? allowed(pick(input, ['prompt']), MAX_TEXT) : undefined;
  const tool = event === 'PreToolUse' || event === 'PostToolUse' ? allowed(pick(input, ['toolName', 'tool_name']), MAX_ID) : undefined;
  const toolUseId = event === 'PreToolUse' || event === 'PostToolUse' ? allowed(pick(input, ['toolUseId', 'tool_use_id']), MAX_ID) : undefined;
  const notification = event === 'Notification' ? allowed(pick(input, ['notificationType', 'notification_type']), MAX_ID) : undefined;
  const reason = event === 'Stop' || event === 'StopFailure' || event === 'StopCancelled' ? allowed(pick(input, ['reason']), MAX_ID) : undefined;
  if (source) body.source = source;
  if (prompt) body.prompt = prompt;
  if (tool) body.tool_name = tool;
  if (toolUseId) body.tool_use_id = toolUseId;
  if (notification) body.notification_type = notification;
  if (reason) body.reason = reason;
  const base = process.env.AGENT_OFFICE_HOOK_URL;
  const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
  const worker = process.env.AGENT_OFFICE_WORKER_ID;
  if (!base || !token || !worker) return finish(false);
  try {
    const url = new URL('/hooks/grok', base);
    url.searchParams.set('worker', worker);
    url.searchParams.set('event', event);
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
    finish(response.ok);
  } catch { finish(false); }
});
`;
