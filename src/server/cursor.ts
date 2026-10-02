// Cursor CLI (cursor-agent): its hooks, the helper they run, and its command line.
//
// The CLI reads hooks from ~/.cursor/hooks.json, which is the person's own and the office never
// touches, and from <folder>/.cursor/hooks.json. Nothing moves either (CURSOR_CONFIG_DIR only moves
// its settings and chats), and its terminal only fires the prompt and stop hooks when one of those
// two files has them, so a plugin's hooks (--plugin-dir) aren't enough. So each worker's own entries
// go into the hooks.json of the folder it works in as it starts, and come out again when it ends.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { excludeFromGit } from './config.js';

/** Cursor's hook events the office listens to, and the lifecycle event each one is (see workers/lifecycle.ts). */
export const CURSOR_HOOK_EVENTS = {
  sessionStart: 'SessionStart',
  beforeSubmitPrompt: 'UserPromptSubmit',
  preToolUse: 'PreToolUse',
  postToolUse: 'PostToolUse',
  postToolUseFailure: 'PostToolUseFailure',
  stop: 'Stop',
} as const;

export type CursorHookName = keyof typeof CURSOR_HOOK_EVENTS;

/** The bounded event shape forwarded to the worker bridge. */
export interface CursorHookEvent {
  sessionId: string;
  event: (typeof CURSOR_HOOK_EVENTS)[CursorHookName];
  prompt?: string;
  tool?: string;
  toolUseId?: string;
}

const MAX_ID = 160;
const MAX_TEXT = 20_000;
/** A chat id goes back on the command line (`--resume=<id>`), so it's never taken as anything but an id. */
const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/** What marks a payload as a subagent's or a cloud agent's rather than the desk's own session. */
const CHILD_FIELDS = ['subagent_id', 'subagent_type', 'parent_conversation_id', 'agent_id', 'agent_type'];
const HOOK_FILE = 'agent-office-cursor-hook.cjs';
const HOOK_TIMEOUT_S = 5;

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

/**
 * Validate and compact a Cursor hook payload. A subagent's events are ignored so they cannot
 * overwrite the desk's root status. Tool inputs and outputs, the assistant's messages and the
 * transcript path are discarded.
 */
export function normalizeCursorHook(event: string, payload: unknown): CursorHookEvent | undefined {
  if (!Object.hasOwn(CURSOR_HOOK_EVENTS, event) || !isRecord(payload)) return undefined;
  if (CHILD_FIELDS.some((key) => hasText(payload[key])) || payload.is_background_agent === true) return undefined;
  const sessionId = payload.conversation_id ?? payload.session_id;
  if (typeof sessionId !== 'string' || !CHAT_ID.test(sessionId)) return undefined;
  const name = event as CursorHookName;
  const result: CursorHookEvent = { sessionId, event: CURSOR_HOOK_EVENTS[name] };
  if (name === 'beforeSubmitPrompt') {
    const prompt = bounded(payload.prompt, MAX_TEXT);
    if (prompt) result.prompt = prompt;
  } else if (name === 'preToolUse' || name === 'postToolUse' || name === 'postToolUseFailure') {
    const tool = bounded(payload.tool_name, MAX_ID);
    if (tool) result.tool = tool;
    const toolUseId = bounded(payload.tool_use_id, MAX_ID);
    if (toolUseId) result.toolUseId = toolUseId;
  }
  return result;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/** Write the self-contained helper invoked by Cursor's command hooks. */
export function writeCursorHook(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, HOOK_FILE);
  writeFileSync(file, CURSOR_HOOK_SOURCE, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

interface HooksConfig {
  hooks: Record<string, unknown>;
  [key: string]: unknown;
}

/** The folder's hooks.json as it is, 'none' when there isn't one, or undefined for one the office can't read (it's left alone). */
function readHooks(file: string): { config: HooksConfig; text: string } | 'none' | undefined {
  if (!existsSync(file)) return 'none';
  try {
    const text = readFileSync(file, 'utf8');
    const config = JSON.parse(text) as unknown;
    return isRecord(config) && isRecord(config.hooks) ? { config: config as HooksConfig, text } : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a hook entry is the office's, and `workerId`'s when one is named. */
function isOffice(entry: unknown, workerId?: string): boolean {
  const command = isRecord(entry) ? entry.command : undefined;
  return typeof command === 'string' && command.includes(HOOK_FILE) && (!workerId || command.endsWith(` ${shellQuote(workerId)}`));
}

/** Takes `workerId`'s entries out of `config`. */
function strip(config: HooksConfig, workerId: string) {
  for (const [event, entries] of Object.entries(config.hooks)) {
    if (!Array.isArray(entries) || !entries.some((e) => isOffice(e, workerId))) continue;
    const kept = entries.filter((e) => !isOffice(e, workerId));
    if (kept.length) config.hooks[event] = kept;
    else delete config.hooks[event];
  }
}

/** A project's own hooks.json as it was before the office's first entry went in, to put back exactly. */
const originals = new Map<string, string>();

function sameJson(text: string, config: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(config);
  } catch {
    return false;
  }
}

/** `config` as text, laid out the way `like` was. */
function format(config: unknown, like?: string): string {
  const indent = (like && /^([ \t]+)\S/m.exec(like)?.[1]) || '  ';
  return JSON.stringify(config, null, indent) + (like && !like.endsWith('\n') ? '' : '\n');
}

function hooksPath(cwd: string): string {
  return path.join(cwd, '.cursor', 'hooks.json');
}

/**
 * Puts a worker's hook entries in the hooks.json of the folder it works in, next to whatever the
 * project has there. Each entry names its worker, and the helper only speaks for that one, so
 * workers sharing a folder (the board agents, in the project itself) don't report for each other.
 * Says whether they're in: a hooks.json the office can't read is left as it is.
 */
export function addCursorHooks(cwd: string, hook: string, workerId: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(workerId)) return false;
  const file = hooksPath(cwd);
  const found = readHooks(file);
  if (!found) return false;
  const config: HooksConfig = found === 'none' ? { version: 1, hooks: {} } : found.config;
  const before = found === 'none' ? undefined : found.text;
  // The project's own file, untouched until now: kept to put back as it was (see removeCursorHooks).
  if (before !== undefined && !before.includes(HOOK_FILE)) originals.set(file, before);
  // Left behind by a run that was cut off.
  strip(config, workerId);
  for (const event of Object.keys(CURSOR_HOOK_EVENTS)) {
    const entries = Array.isArray(config.hooks[event]) ? (config.hooks[event] as unknown[]) : [];
    const command = [process.execPath, hook, event, workerId].map(shellQuote).join(' ');
    config.hooks[event] = [...entries, { command, timeout: HOOK_TIMEOUT_S }];
  }
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, format(config, before));
  } catch {
    return false;
  }
  // A file the office made is no change of the worker's: git doesn't list it.
  if (before === undefined) excludeFromGit(cwd, '.cursor/hooks.json');
  return true;
}

/** Takes a worker's hook entries out again, and the file with them when nothing else is in it. */
export function removeCursorHooks(cwd: string, workerId: string) {
  const file = hooksPath(cwd);
  const found = readHooks(file);
  if (!found || found === 'none' || !found.text.includes(HOOK_FILE)) return;
  const { config, text } = found;
  strip(config, workerId);
  const shared = Object.values(config.hooks).some((entries) => Array.isArray(entries) && entries.some((e) => isOffice(e)));
  const original = shared ? undefined : originals.get(file);
  if (!shared) originals.delete(file);
  try {
    if (original !== undefined && sameJson(original, config)) {
      writeFileSync(file, original);
    } else if (!Object.keys(config.hooks).length && Object.keys(config).every((key) => key === 'version' || key === 'hooks')) {
      unlinkSync(file);
      try {
        rmdirSync(path.dirname(file)); // only when the office's file was all it held
      } catch {
        // the project has other things in .cursor
      }
    } else {
      writeFileSync(file, format(config, text));
    }
  } catch {
    // The folder is gone (a worktree that was deleted), or can't be written: nothing to take out.
  }
}

/**
 * Drop launch flags the office sets itself, the ones that would take a worker out of its terminal or
 * its folder, and the ones that skip Cursor's permission prompts (the office never passes those).
 */
export function withoutCursorLaunchArgs(args: string[]): string[] {
  const skipValue = new Set(['--model', '--workspace', '--worktree-base', '--output-format', '--new-session-id']);
  // These take a value only when one follows.
  const skipOptional = new Set(['--resume', '--worktree', '-w']);
  const skipFlag = new Set([
    '--force', '-f', '--yolo', '--trust', '--continue', '--print', '-p', '--list-models',
    '--stream-partial-output', '--skip-worktree-setup',
  ]);
  const clean: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    if (skipFlag.has(arg)) continue;
    if (skipValue.has(arg) || skipOptional.has(arg)) {
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if ([...skipValue, ...skipOptional].some((flag) => flag.startsWith('--') && arg.startsWith(`${flag}=`))) continue;
    clean.push(arg);
  }
  return clean;
}

/** What a Cursor worker's desk says when its screen shows it can't be used yet. */
export function cursorBlocked(text: string): string | undefined {
  return /Press any key to log in/i.test(text) ? "Cursor isn't signed in on this machine — open the terminal and log in" : undefined;
}

/**
 * The helper reads the hook's stdin and the worker bridge environment, and forwards only the
 * session id, the event, the prompt and the tool's name. It always answers `{}`: no decision of its
 * own, so Cursor's permission prompts are as they'd be without it.
 */
export const CURSOR_HOOK_SOURCE = String.raw`'use strict';
const MAX = 16 * 1024 * 1024;
const EVENTS = new Set(${JSON.stringify(Object.keys(CURSOR_HOOK_EVENTS))});
const CHILD = ${JSON.stringify(CHILD_FIELDS)};
const MAX_ID = 160;
const MAX_TEXT = 20000;
const allowed = (value, max) => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : undefined;
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
let answered = false;
const finish = () => { if (!answered) process.stdout.write('{}'); answered = true; };
const event = process.argv[2];
const worker = process.argv[3];
let size = 0;
let overflow = false;
const chunks = [];
process.stdin.on('data', (chunk) => {
  if (overflow) return;
  size += chunk.length;
  if (size > MAX) { overflow = true; chunks.length = 0; return; }
  chunks.push(chunk);
});
process.stdin.on('error', finish);
process.stdin.on('end', async () => {
  const base = process.env.AGENT_OFFICE_HOOK_URL;
  const token = process.env.AGENT_OFFICE_HOOK_TOKEN;
  // Every Cursor session in this folder runs this: only the worker it was written for reports.
  if (overflow || !EVENTS.has(event) || !base || !token || !worker || process.env.AGENT_OFFICE_WORKER_ID !== worker) return finish();
  let input;
  try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return finish(); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return finish();
  if (CHILD.some((key) => hasText(input[key])) || input.is_background_agent === true) return finish();
  const session = allowed(input.conversation_id !== undefined ? input.conversation_id : input.session_id, MAX_ID);
  if (!session) return finish();
  const body = { conversation_id: session, hook_event_name: event };
  if (event === 'beforeSubmitPrompt' && typeof input.prompt === 'string' && input.prompt.trim()) body.prompt = input.prompt.trim().slice(0, MAX_TEXT);
  if (event === 'preToolUse' || event === 'postToolUse' || event === 'postToolUseFailure') {
    const tool = allowed(input.tool_name, MAX_ID);
    const toolUseId = allowed(input.tool_use_id, MAX_ID);
    if (tool) body.tool_name = tool;
    if (toolUseId) body.tool_use_id = toolUseId;
  }
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
  finish();
});
`;
