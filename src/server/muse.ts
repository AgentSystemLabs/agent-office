import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MUSE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'PermissionRequest',
  'Stop',
  'StopFailure',
] as const;

export type MuseHookEventName = (typeof MUSE_HOOK_EVENTS)[number];

/** The bounded event shape forwarded to the worker bridge. */
export interface MuseHookEvent {
  sessionId: string;
  event: MuseHookEventName;
  source?: string;
  prompt?: string;
  tool?: string;
  toolUseId?: string;
  notificationType?: string;
  reason?: string;
}

const MAX_ID = 160;
const MAX_TEXT = 20_000;
const EVENT_SET = new Set<string>(MUSE_HOOK_EVENTS);

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
 * Validate and compact a Muse hook payload. Child-session events are ignored so they cannot
 * overwrite the desk's root status. Transcript paths and assistant message bodies are discarded.
 */
export function normalizeMuseHook(event: string, payload: unknown): MuseHookEvent | undefined {
  if (!isRecord(payload)) return undefined;
  const name = EVENT_SET.has(event) ? event : bounded(field(payload, 'hook_event_name', 'hookEventName'), MAX_ID);
  if (!name || !EVENT_SET.has(name)) return undefined;
  if (hasText(field(payload, 'subagentType', 'subagent_type', 'agent_id', 'agent_type', 'parent_session_id', 'parent_session'))) return undefined;

  const sessionId = bounded(field(payload, 'sessionId', 'session_id'), MAX_ID);
  if (!sessionId) return undefined;
  const result: MuseHookEvent = { sessionId, event: name as MuseHookEventName };

  const source = name === 'SessionStart' ? bounded(field(payload, 'source'), MAX_ID) : undefined;
  if (source) result.source = source;
  if (name === 'UserPromptSubmit') {
    const prompt = bounded(field(payload, 'prompt'), MAX_TEXT);
    if (prompt) result.prompt = prompt;
  } else if (name === 'PreToolUse' || name === 'PostToolUse' || name === 'PostToolUseFailure' || name === 'PermissionRequest') {
    const tool = bounded(field(payload, 'toolName', 'tool_name', 'tool'), MAX_ID);
    if (tool) result.tool = tool;
    const toolUseId = bounded(field(payload, 'toolUseId', 'tool_use_id'), MAX_ID);
    if (toolUseId) result.toolUseId = toolUseId;
  } else if (name === 'Notification') {
    const notificationType = bounded(field(payload, 'notificationType', 'notification_type'), MAX_ID);
    if (notificationType) result.notificationType = notificationType;
  } else if (name === 'Stop' || name === 'StopFailure') {
    const reason = bounded(field(payload, 'reason'), MAX_ID);
    if (reason) result.reason = reason;
  }
  return result;
}

export function validateMuseHook(event: string, payload: unknown): boolean {
  return !!normalizeMuseHook(event, payload);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function safeMuseId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return undefined;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) ? value : undefined;
}

function userMuseDefaults(userMuseDir: string | undefined): { provider?: string; model?: string } {
  if (!userMuseDir) return {};
  try {
    const raw = JSON.parse(readFileSync(path.join(userMuseDir, 'settings.json'), 'utf8')) as unknown;
    if (!isRecord(raw)) return {};
    const provider = raw.provider === 'meta' || raw.provider === 'echo' || raw.provider === 'local' ? raw.provider : undefined;
    const model = safeMuseId(raw.model);
    return { ...(provider ? { provider } : {}), ...(model ? { model } : {}) };
  } catch {
    return {};
  }
}

function linkAuth(src: string, dest: string) {
  if (existsSync(dest)) return;
  try {
    symlinkSync(src, dest);
  } catch {
    try {
      copyFileSync(src, dest);
    } catch {
      // Login still happens in the TUI when auth is missing.
    }
  }
}

/** Write the self-contained helper invoked by Muse's command hooks. */
export function writeMuseHook(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'agent-office-muse-hook.cjs');
  writeFileSync(file, MUSE_HOOK_SOURCE, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

export interface MuseHome {
  home: string;
  configHome: string;
  dataHome: string;
  stateHome: string;
  hook: string;
}

/**
 * An isolated XDG tree that carries only the office's Muse settings and hooks, so a worker never
 * writes into the user's ~/.config/muse. Auth is linked from the user's muse dir when present.
 */
export function writeMuseHome(dataDir: string, userMuseDir?: string): MuseHome {
  const home = path.join(dataDir, 'muse-home');
  const configHome = path.join(home, 'config');
  const dataHome = path.join(home, 'share');
  const stateHome = path.join(home, 'state');
  const configDir = path.join(configHome, 'muse');
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  mkdirSync(dataHome, { recursive: true, mode: 0o700 });
  mkdirSync(stateHome, { recursive: true, mode: 0o700 });
  const hook = writeMuseHook(dataDir);
  const hooks: Record<string, unknown[]> = {};
  for (const event of MUSE_HOOK_EVENTS) {
    const command = [process.execPath, hook, event].map(shellQuote).join(' ');
    hooks[event] = [{ hooks: [{ type: 'command', command, timeout: 3 }] }];
  }
  const defaults = userMuseDefaults(userMuseDir);
  const settings = {
    schema_version: 1,
    provider: defaults.provider ?? 'meta',
    ...(defaults.model ? { model: defaults.model } : {}),
    hooks,
  };
  writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify(settings, null, 2), { mode: 0o600 });
  if (userMuseDir) {
    const auth = path.join(userMuseDir, 'auth.json');
    if (existsSync(auth)) linkAuth(auth, path.join(configDir, 'auth.json'));
  }
  return { home, configHome, dataHome, stateHome, hook };
}

/** Drop launch flags the office always sets itself, plus model/effort/session flags it may replace. */
export function withoutMuseLaunchArgs(args: string[]): string[] {
  const skipValue = new Set([
    '--model', '--reasoning-effort', '--provider', '--workspace', '--worktree',
    '--worktree-base', '--worktree-existing', '--approval-mode', '--permission-profile',
    '--sandbox-network',
  ]);
  const skipFlag = new Set([
    '--trust-workspace', '--yolo', '--disable-approval', '--disable-sandbox',
    '--disable-write', '--disable-shell', '--last', '-w',
  ]);
  const skipCommand = new Set(['resume', 'exec', 'serve']);
  const clean: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    if (skipFlag.has(arg) || skipCommand.has(arg)) {
      if (skipCommand.has(arg) && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if (skipValue.has(arg)) {
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if (arg.startsWith('--model=') || arg.startsWith('--reasoning-effort=') || arg.startsWith('--provider=')
      || arg.startsWith('--workspace=') || arg.startsWith('--worktree=') || arg.startsWith('--approval-mode=')) continue;
    clean.push(arg);
  }
  return clean;
}

/** The helper only reads bounded hook stdin and the worker bridge environment. */
export const MUSE_HOOK_SOURCE = String.raw`'use strict';
const MAX = 64 * 1024;
const EVENTS = new Set(${JSON.stringify(MUSE_HOOK_EVENTS)});
const MAX_ID = 160;
const MAX_TEXT = 20000;
const allowed = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : undefined;
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const pick = (input, keys) => {
  for (const key of keys) if (input[key] !== undefined) return input[key];
};
const finish = (ok) => { if (ok) process.stdout.write('{}'); };
const eventArg = process.argv[2];
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
  if (overflow) return finish(false);
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return finish(false); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return finish(false);
  const event = EVENTS.has(eventArg) ? eventArg : allowed(pick(input, ['hook_event_name', 'hookEventName']), MAX_ID);
  if (!EVENTS.has(event)) return finish(false);
  if (hasText(pick(input, ['subagentType', 'subagent_type', 'agent_id', 'agent_type', 'parent_session_id', 'parent_session']))) return finish(false);
  const session = allowed(pick(input, ['sessionId', 'session_id']), MAX_ID);
  if (!session) return finish(false);
  const body = { session_id: session, hook_event_name: event };
  const source = event === 'SessionStart' ? allowed(pick(input, ['source']), MAX_ID) : undefined;
  const prompt = event === 'UserPromptSubmit' ? allowed(pick(input, ['prompt']), MAX_TEXT) : undefined;
  const tool = event === 'PreToolUse' || event === 'PostToolUse' || event === 'PostToolUseFailure' || event === 'PermissionRequest' ? allowed(pick(input, ['toolName', 'tool_name', 'tool']), MAX_ID) : undefined;
  const toolUseId = event === 'PreToolUse' || event === 'PostToolUse' || event === 'PostToolUseFailure' || event === 'PermissionRequest' ? allowed(pick(input, ['toolUseId', 'tool_use_id']), MAX_ID) : undefined;
  const notification = event === 'Notification' ? allowed(pick(input, ['notificationType', 'notification_type']), MAX_ID) : undefined;
  const reason = event === 'Stop' || event === 'StopFailure' ? allowed(pick(input, ['reason']), MAX_ID) : undefined;
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
    const url = new URL('/hooks/muse', base);
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
