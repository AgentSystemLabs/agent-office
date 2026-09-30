// The turn-by-turn life of an agent as its hooks tell it: its session starting, prompts, tool calls,
// questions and permission prompts, and the end of each turn. Grok, Muse and Codex report theirs as
// compacted events (see grok.ts, muse.ts and codex.ts) that all run through one reducer here, Codex
// following its tool calls one by one; Claude Code's own hook is built from the same steps (see
// providers/claude.ts). OpenCode's plugin reports statuses instead (see providers/opencode.ts).
import { toolAction } from '../../shared/actions.js';
import type { Worker, WorkerHandle } from './types.js';
import { truncate } from './util.js';

/** A permission prompt this soon after the worker stopped needing input is the late one for what was just answered. */
export const LATE_PROMPT_GRACE_MS = 5000;

/** Tools that ask the person something: the worker needs input until they're answered. */
const ASKS = /(?:^|[._])(?:AskUserQuestion|ask_user_question|request_user_input)$/;

/** In the middle of a turn: working, or asking something (not stuck on a trust or login screen). */
export function midTurn({ info, bootBlocked }: Pick<Worker, 'info' | 'bootBlocked'>): boolean {
  return info.kind === 'agent' && (info.status === 'working' || (info.status === 'needs_input' && !bootBlocked));
}

/** A lifecycle hook event as a provider's normalizer compacts it. */
export interface LifecycleReport {
  sessionId: string;
  event: string;
  source?: string;
  prompt?: string;
  tool?: string;
  toolUseId?: string;
  notificationType?: string;
}

/**
 * Tool calls followed one by one, for a provider whose hooks never say a question was answered
 * (Codex): a call that asked the person something, or wanted permission, keeps the worker needing
 * input until that call is over.
 */
export interface ToolTracker {
  /** A new session or turn, or the turn ended: nothing is pending any more. */
  clear(): void;
  started(tool: string | undefined, toolUseId: string | undefined): void;
  permission(tool: string | undefined): void;
  finished(toolUseId: string | undefined): void;
  /** Some call is waiting on the person. */
  waiting(): boolean;
}

/** Where a provider's lifecycle differs (see reduceLifecycle). */
export interface LifecycleOptions {
  /** Another session replaced the one the worker had, and its task was cleared. */
  onSessionSwitch?(): void;
  /** Each event it takes, once its session is settled. */
  onReport?(): void;
  /** Follow tool calls one by one (see ToolTracker) instead of going by the tool's name alone. */
  tools?: ToolTracker;
}

/** Notification: a permission prompt needs the person (unless it's the late one for what was just answered), the idle prompt ends a turn. */
export function notified(h: WorkerHandle, type: unknown, now = Date.now()) {
  if (type === 'permission_prompt') {
    if (now - h.leftNeedsInputAt > LATE_PROMPT_GRACE_MS) h.setStatus('needs_input');
  } else if (type === 'idle_prompt') {
    if (h.info.status === 'working') h.setStatus('done');
  }
}

/** A tool call ended: if it was waiting on the person, it has its answer and the worker carries on. */
export function answered(h: WorkerHandle, now = Date.now()) {
  if (h.info.status === 'needs_input') {
    h.leftNeedsInputAt = now;
    h.setStatus('working');
  }
}

/** It wants permission for `what`. */
export function wantsPermission(h: WorkerHandle, what: string) {
  h.info.activity = `Wants permission: ${what}`;
  h.setStatus('needs_input');
}

/**
 * One compacted hook event for a worker. An event from another session is only taken when that
 * session starts (a /clear, say), and the worker's task starts over with it. Says whether it was taken.
 */
export function reduceLifecycle(h: WorkerHandle, report: LifecycleReport, o: LifecycleOptions = {}): boolean {
  const { info } = h;
  if (info.sessionId && info.sessionId !== report.sessionId && report.event !== 'SessionStart') return false;
  if (!info.sessionId || info.sessionId !== report.sessionId) {
    if (info.sessionId) {
      h.clearTask();
      o.onSessionSwitch?.();
    }
    info.sessionId = report.sessionId;
    h.persist();
  }
  o.onReport?.();
  h.bootBlocked = false;
  const { tools } = o;
  const busy = () => h.setStatus(tools?.waiting() ? 'needs_input' : 'working');
  switch (report.event) {
    case 'SessionStart':
      tools?.clear();
      if (report.source === 'clear') h.clearTask();
      info.activity = undefined;
      if (info.status === 'starting' || info.status === 'needs_input') h.setStatus('idle');
      // A prompt its start couldn't take on the command line (a Muse resume): now it can.
      if (h.pendingPrompt) {
        const text = h.pendingPrompt;
        h.pendingPrompt = undefined;
        h.prompt(text);
      }
      break;
    case 'UserPromptSubmit':
      tools?.clear();
      info.action = undefined;
      if (report.prompt) {
        info.activity = truncate(report.prompt, 80);
        h.notePrompt(report.prompt);
      }
      h.setStatus('working');
      break;
    case 'PreToolUse':
      info.activity = report.tool ? truncate(report.tool, 80) : 'Using a tool';
      info.action = toolAction(report.tool);
      h.noteTool(info.activity);
      if (tools) {
        tools.started(report.tool, report.toolUseId);
        busy();
      } else if (ASKS.test(report.tool ?? '')) h.setStatus('needs_input');
      else if (info.status !== 'working') h.setStatus('working');
      else h.emit();
      break;
    case 'PermissionRequest':
      tools?.permission(report.tool);
      wantsPermission(h, truncate(report.tool ?? 'tool', 80));
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      if (tools) {
        tools.finished(report.toolUseId);
        busy();
      } else answered(h);
      break;
    case 'Notification':
      notified(h, report.notificationType);
      break;
    case 'Stop':
    case 'StopFailure':
    case 'StopCancelled':
    case 'Interrupt':
      tools?.clear();
      h.setStatus('done');
      break;
  }
  h.emit();
  h.persist();
  return true;
}
