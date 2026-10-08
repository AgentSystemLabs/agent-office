// OMP (Oh My Pi): its command line (a session folder per desk, the office's extension) and the
// extension that reports its lifecycle on /hooks/omp, in the same statuses as OpenCode's plugin (see
// providers/omp.ts). OMP is Pi's lineage but not Pi's event set: it has no `agent_settled` and no
// `ui_prompt_*`, so this extension reads its own (verified against omp 18.1.21) — `agent_end` with
// `willContinue`, `tool_approval_requested`/`tool_approval_resolved`, and the `ask` tool.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentEffort } from '../shared/protocol.js';
import type { OpenCodeStatusEvent } from './opencode.js';

/** An OMP session id, as OMP reports one and takes it back for `--resume`. */
const OMP_SESSION_ID = /^[A-Za-z0-9._-]{1,160}$/;

/**
 * A desk's OMP command line. Sessions are OMP's own, in the person's OMP store, so a conversation
 * the office starts is the one a terminal `omp` resumes and the numbers `omp stats` shows (see
 * providers/omp.ts). `sessionDir` is only for a desk that still holds a folder of its own, from
 * before: nothing on this command line ever names another desk's conversation, and `--continue`
 * (which would pick the newest one in the folder) is never passed.
 */
export function ompArgs(extra: string[], options: { extension: string; sessionDir?: string; sessionId?: string; model?: string; effort?: AgentEffort; prompt?: string }): string[] {
  const values = new Set(['--session-dir', '--resume', '-r', '--mode', '--profile', '--cwd', '--export']);
  const flags = new Set(['--print', '-p', '--continue', '-c', '--no-session']);
  if (options.model) values.add('--model');
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
  if (options.sessionDir) args.push('--session-dir', options.sessionDir);
  args.push('--extension', options.extension);
  // OMP writes a session file the moment it starts, so --resume finds the desk's own conversation by
  // its id prefix, whatever its folder holds.
  if (options.sessionId) args.push('--resume', options.sessionId);
  if (options.model) args.push('--model', options.model);
  if (options.effort) args.push('--thinking', options.effort);
  // OMP reads an argument starting with '@' as a file to include, even after --: a prompt is only ever text.
  if (options.prompt) args.push('--', options.prompt.startsWith('@') ? ` ${options.prompt}` : options.prompt);
  return args;
}

/** Accept only bounded lifecycle fields, never assistant text, tool arguments, or credentials. */
export function normalizeOmpHook(value: unknown): OpenCodeStatusEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const bounded = (text: unknown, max: number): text is string => typeof text === 'string' && text.length > 0 && text.length <= max && !/[\p{Cc}\p{Cf}]/u.test(text);
  if (typeof v.sessionId !== 'string' || !OMP_SESSION_ID.test(v.sessionId)) return;
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

/** A CLI-loaded extension preserves the user's OMP config, auth, packages, and extensions. */
export function writeOmpExtension(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'agent-office-omp-extension.mjs');
  writeFileSync(file, OMP_EXTENSION_SOURCE, { mode: 0o600 });
  return file;
}

export const OMP_EXTENSION_SOURCE = String.raw`export default function (pi) {
  const worker = process.env.AGENT_OFFICE_WORKER_ID;
  const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
  const hook = process.env.AGENT_OFFICE_HOOK_URL;
  if (!worker || !token || !hook) return;
  let url;
  try {
    url = new URL('/hooks/omp', hook);
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
      } catch { /* Office connectivity never interrupts OMP. */ }
    });
    return pending;
  };
  pi.on('session_start', (_event, ctx) => send(ctx, 'session', 'starting'));
  pi.on('before_agent_start', (event, ctx) => send(ctx, 'prompt', 'working', { prompt: String(event.prompt ?? '').slice(0, 20000) }));
  pi.on('agent_start', (_event, ctx) => send(ctx, 'session', 'working'));
  // The ask tool is OMP stopping to ask a question; a tool approval is the same kind of wait.
  pi.on('tool_execution_start', (event, ctx) => {
    if (event.toolName === 'ask') return send(ctx, 'question', 'needs_input');
    send(ctx, 'tool', 'working', { tool: String(event.toolName ?? '').slice(0, 160) });
  });
  pi.on('tool_execution_end', (event, ctx) => {
    if (event.toolName === 'ask') return send(ctx, 'session', 'working');
    if (event.isError) send(ctx, 'tool', 'working', { tool: String(event.toolName ?? '').slice(0, 160) });
  });
  pi.on('tool_approval_requested', (_event, ctx) => send(ctx, 'question', 'needs_input'));
  pi.on('tool_approval_resolved', (_event, ctx) => send(ctx, 'session', 'working'));
  pi.on('message_end', (event, ctx) => {
    if (event.message.role === 'assistant' && event.message.stopReason === 'error') return send(ctx, 'error', 'working');
  });
  // OMP has no settled event: agent_end with willContinue is a retry, a compaction or a tool
  // continuation still to come, so only its end is the end of the task.
  pi.on('agent_end', (event, ctx) => send(ctx, 'session', event.willContinue === true ? 'working' : 'done'));
  pi.on('session_shutdown', () => pending);
}
`;
