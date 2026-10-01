// Pi: its command line (a session folder per desk, the office's extension) and the extension that
// reports its lifecycle on /hooks/pi, in the same statuses as OpenCode's plugin (see providers/pi.ts).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentEffort } from '../shared/protocol.js';
import type { OpenCodeStatusEvent } from './opencode.js';

/** A Pi session id, as Pi itself accepts one for --session-id. */
const PI_SESSION_ID = /^[A-Za-z0-9._-]{1,160}$/;

/** Keep sessions per desk; do not resume another worker's most recent conversation. */
export function piArgs(extra: string[], options: { extension: string; sessionDir: string; sessionId?: string; model?: string; effort?: AgentEffort; prompt?: string }): string[] {
  const values = new Set(['--mode', '--session', '--session-dir', '--session-id', '--fork', '--export']);
  const flags = new Set(['--print', '-p', '--continue', '-c', '--resume', '-r', '--no-session']);
  if (options.model) values.add('--model');
  // A provider-qualified selection must override the configured CLI provider too.
  if (options.model?.includes('/')) values.add('--provider');
  if (options.effort) values.add('--thinking');
  const args: string[] = [];
  for (let i = 0; i < extra.length; i++) {
    const arg = extra[i];
    if (arg === '--') break;
    if (flags.has(arg)) continue;
    if (values.has(arg)) { i++; continue; }
    if ([...values].some((name) => arg.startsWith(`${name}=`))) continue;
    args.push(arg);
  }
  args.push('--session-dir', options.sessionDir, '--extension', options.extension);
  // Pi doesn't write a session file until the first assistant reply. --session-id
  // resumes persisted history and also reopens an unused desk with the same id.
  if (options.sessionId) args.push('--session-id', options.sessionId);
  if (options.model) args.push('--model', options.model);
  if (options.effort) args.push('--thinking', options.effort);
  // Pi reads an argument starting with '@' as a file to include, even after --: a prompt is only ever text.
  if (options.prompt) args.push('--', options.prompt.startsWith('@') ? ` ${options.prompt}` : options.prompt);
  return args;
}

/** Accept only bounded lifecycle fields, never assistant text, tool arguments, or credentials. */
export function normalizePiHook(value: unknown): OpenCodeStatusEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const bounded = (text: unknown, max: number): text is string => typeof text === 'string' && text.length > 0 && text.length <= max && !/[\p{Cc}\p{Cf}]/u.test(text);
  if (typeof v.sessionId !== 'string' || !PI_SESSION_ID.test(v.sessionId)) return;
  if (!['session', 'prompt', 'tool', 'question', 'error'].includes(v.type as string)) return;
  if (!['starting', 'working', 'needs_input', 'done'].includes(v.status as string)) return;
  if (v.prompt !== undefined && (typeof v.prompt !== 'string' || v.prompt.length > 20_000)) return;
  if (v.tool !== undefined && !bounded(v.tool, 160)) return;
  return {
    type: v.type as OpenCodeStatusEvent['type'], sessionId: v.sessionId,
    status: v.status as OpenCodeStatusEvent['status'],
    ...(typeof v.prompt === 'string' ? { prompt: v.prompt } : {}),
    ...(typeof v.tool === 'string' ? { tool: v.tool } : {}),
  };
}

/** A CLI-loaded extension preserves the user's Pi config, auth, packages, and extensions. */
export function writePiExtension(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'agent-office-pi-extension.mjs');
  writeFileSync(file, PI_EXTENSION_SOURCE, { mode: 0o600 });
  return file;
}

export const PI_EXTENSION_SOURCE = String.raw`export default function (pi) {
  const worker = process.env.AGENT_OFFICE_WORKER_ID;
  const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
  const hook = process.env.AGENT_OFFICE_HOOK_URL;
  if (!worker || !token || !hook) return;
  let url;
  try {
    url = new URL('/hooks/pi', hook);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') return;
    url.searchParams.set('worker', worker);
  } catch { return; }
  // Serialize requests so a slow working event cannot overwrite a later done event.
  let pending = Promise.resolve();
  const send = (ctx, type, status, fields = {}) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const body = JSON.stringify({ sessionId, type, status, ...fields });
    pending = pending.then(async () => {
      try {
        await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body, signal: AbortSignal.timeout(1500) });
      } catch { /* Office connectivity never interrupts Pi. */ }
    });
    return pending;
  };
  pi.on('session_start', (_event, ctx) => send(ctx, 'session', 'starting'));
  pi.on('before_agent_start', (event, ctx) => send(ctx, 'prompt', 'working', { prompt: event.prompt.slice(0, 20000) }));
  pi.on('agent_start', (_event, ctx) => send(ctx, 'session', 'working'));
  pi.on('tool_execution_start', (event, ctx) => send(ctx, 'tool', 'working', { tool: event.toolName.slice(0, 160) }));
  pi.on('tool_execution_end', (event, ctx) => {
    if (event.isError) return send(ctx, 'tool', 'working', { tool: event.toolName.slice(0, 160) });
  });
  pi.on('message_end', (event, ctx) => {
    if (event.message.role === 'assistant' && event.message.stopReason === 'error') return send(ctx, 'error', 'working');
  });
  pi.on('ui_prompt_start', (_event, ctx) => send(ctx, 'question', 'needs_input'));
  pi.on('ui_prompt_end', (_event, ctx) => send(ctx, 'session', ctx.isIdle() ? 'done' : 'working'));
  // agent_end can precede retries/compaction; settled is the actual end of the task.
  pi.on('agent_settled', (_event, ctx) => send(ctx, 'session', 'done'));
  pi.on('session_shutdown', () => pending);
}
`;
