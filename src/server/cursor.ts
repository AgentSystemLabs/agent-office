// Cursor CLI (`cursor-agent`): its command line, and the hooks that report its lifecycle on
// /hooks/cursor (see providers/cursor.ts).
//
// Cursor reads hooks from ~/.cursor/hooks.json, the project's .cursor/hooks.json and any plugin it
// loads. The office never touches either file: its hooks come in a plugin of its own, a folder in
// the floor's data dir that each worker loads with --plugin-dir. Only hooks that observe are
// registered. Cursor blocks a tool when one of its gating hooks (beforeShellExecution, preToolUse
// and the like) fails, and a gating hook's answer could approve something in the person's place,
// so the office registers none of them.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LifecycleReport } from './workers/lifecycle.js';

/** Cursor's hook events the office follows, and what each one is to the office's lifecycle (see reduceLifecycle). */
export const CURSOR_HOOK_EVENTS = {
  sessionStart: 'SessionStart',
  beforeSubmitPrompt: 'UserPromptSubmit',
  postToolUse: 'PreToolUse',
  postToolUseFailure: 'PreToolUse',
  stop: 'Stop',
} as const;

export type CursorHookEventName = keyof typeof CURSOR_HOOK_EVENTS;

const MAX_ID = 160;
const MAX_TEXT = 20_000;

function bounded(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= max && !/[\p{Cc}\p{Cf}]/u.test(text) ? text : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isEvent(event: string): event is CursorHookEventName {
  return Object.hasOwn(CURSOR_HOOK_EVENTS, event);
}

/**
 * Validate and compact a Cursor hook payload into a lifecycle report. A subagent's events are
 * ignored, so they can't overwrite the desk's own status, and only the person's prompt and a tool's
 * name are kept: no assistant text, tool input or output, file contents or transcript path.
 */
export function normalizeCursorHook(event: string, payload: unknown): LifecycleReport | undefined {
  if (!isEvent(event) || !isRecord(payload)) return undefined;
  if (payload.parent_conversation_id !== undefined || payload.subagent_id !== undefined || payload.subagent_type !== undefined) return undefined;
  const sessionId = bounded(payload.conversation_id, MAX_ID);
  if (!sessionId) return undefined;
  const report: LifecycleReport = { sessionId, event: CURSOR_HOOK_EVENTS[event] };
  if (event === 'beforeSubmitPrompt') {
    const prompt = typeof payload.prompt === 'string' && payload.prompt.trim() && payload.prompt.length <= MAX_TEXT ? payload.prompt.trim() : undefined;
    if (prompt) report.prompt = prompt;
  } else if (report.event === 'PreToolUse') {
    const tool = bounded(payload.tool_name, MAX_ID);
    if (tool) report.tool = tool;
  }
  return report;
}

function shellQuote(value: string): string {
  if (process.platform === 'win32') return `"${value.replaceAll('"', '\\"')}"`;
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/** Write the self-contained helper Cursor's command hooks run. */
export function writeCursorHook(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'agent-office-cursor-hook.cjs');
  writeFileSync(file, CURSOR_HOOK_SOURCE, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/** The plugin's hooks/hooks.json: every event the office follows, through its helper. */
export function cursorHooksJson(helper: string): string {
  const hooks: Record<string, unknown[]> = {};
  for (const event of Object.keys(CURSOR_HOOK_EVENTS)) {
    hooks[event] = [{ command: [process.execPath, helper, event].map(shellQuote).join(' '), timeout: 5 }];
  }
  return `${JSON.stringify({ version: 1, hooks }, null, 2)}\n`;
}

/**
 * The office's Cursor plugin, in the floor's data dir: its manifest and its hooks, nothing else.
 * Workers load it with --plugin-dir, so neither ~/.cursor nor the project's .cursor is written.
 */
export function writeCursorPlugin(dataDir: string): string {
  const helper = writeCursorHook(dataDir);
  const dir = path.join(dataDir, 'cursor-plugin');
  mkdirSync(path.join(dir, '.cursor-plugin'), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(dir, 'hooks'), { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, '.cursor-plugin', 'plugin.json'), `${JSON.stringify({ name: 'agent-office', description: 'Reports this worker\'s status to Agent Office.' }, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(path.join(dir, 'hooks', 'hooks.json'), cursorHooksJson(helper), { mode: 0o600 });
  return dir;
}

/**
 * The command line for one run: the configured args without the flags the office sets itself, or
 * that would skip Cursor's own approval prompts (--force, --yolo, --auto-review), run it headless
 * (--print) or make a worktree of Cursor's own (the office already gave it one). --trust only skips
 * the folder-trust question for the desk's own folder; approval prompts still come up.
 */
export function cursorArgs(extra: string[], options: { plugin: string; sessionId?: string; model?: string; prompt?: string }): string[] {
  const values = new Set(['--model', '-m', '--workspace', '--output-format', '--worktree-base']);
  const optional = new Set(['--resume', '--worktree', '-w']);
  const flags = new Set(['--continue', '--force', '-f', '--yolo', '--auto-review', '--print', '-p', '--trust']);
  const args: string[] = [];
  for (let i = 0; i < extra.length; i++) {
    const arg = extra[i];
    if (arg === '--') break;
    if (flags.has(arg)) continue;
    if (values.has(arg)) { i++; continue; }
    // These may stand alone: only skip a value that is one.
    if (optional.has(arg)) {
      if (extra[i + 1] !== undefined && !extra[i + 1].startsWith('-')) i++;
      continue;
    }
    if ([...values, ...optional].some((name) => arg.startsWith(`${name}=`))) continue;
    args.push(arg);
  }
  args.push('--trust', '--plugin-dir', options.plugin);
  if (options.sessionId) args.push('--resume', options.sessionId);
  else if (options.model) args.push('--model', options.model);
  if (options.prompt) args.push('--', options.prompt);
  return args;
}

/**
 * The helper only reads bounded hook stdin and the worker's office variables. It always answers
 * Cursor with an empty reply and exit 0, so the office being down never blocks a prompt.
 */
export const CURSOR_HOOK_SOURCE = String.raw`'use strict';
const MAX = 256 * 1024;
const EVENTS = new Set(${JSON.stringify(Object.keys(CURSOR_HOOK_EVENTS))});
const MAX_ID = 160;
const MAX_TEXT = 20000;
const event = process.argv[2];
const reply = () => {
  process.stdout.write('{}');
  process.exit(0);
};
const allowed = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : undefined;
let size = 0;
let overflow = false;
const chunks = [];
setTimeout(reply, 4000).unref();
process.stdin.on('data', (chunk) => {
  if (overflow) return;
  size += chunk.length;
  if (size > MAX) { overflow = true; return; }
  chunks.push(chunk);
});
process.stdin.on('error', reply);
process.stdin.on('end', async () => {
  const base = process.env.AGENT_OFFICE_HOOK_URL;
  const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
  const worker = process.env.AGENT_OFFICE_WORKER_ID;
  // Not one of the office's workers (someone opened the worktree in Cursor themselves): nothing to say.
  if (overflow || !EVENTS.has(event) || !base || !token || !worker) return reply();
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reply();
  if (input.parent_conversation_id !== undefined || input.subagent_id !== undefined || input.subagent_type !== undefined) return reply();
  const conversation = allowed(input.conversation_id, MAX_ID);
  if (!conversation) return reply();
  const body = { conversation_id: conversation };
  if (event === 'beforeSubmitPrompt') {
    const prompt = allowed(input.prompt, MAX_TEXT);
    if (prompt) body.prompt = prompt;
  }
  const tool = allowed(input.tool_name, MAX_ID);
  if (tool && (event === 'postToolUse' || event === 'postToolUseFailure')) body.tool_name = tool;
  try {
    const url = new URL('/hooks/cursor', base);
    url.searchParams.set('worker', worker);
    url.searchParams.set('event', event);
    await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
  } catch {}
  reply();
});
`;
