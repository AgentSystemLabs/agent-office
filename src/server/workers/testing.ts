// Test lifetime is independent of the agent's response lifetime. No process polling: use the
// provider's own tool results and in-flight task snapshot, scoped to this worker and session.
import { commandAction } from '../../shared/actions.js';
import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import type { SomeAdapter } from '../providers/types.js';
import type { WorkerHandle } from './types.js';

type Run = { session?: string; foreground: Set<string>; background: Set<string> };
const runs = new WeakMap<WorkerInfo, Run>();
const ACTIVE = new Set(['running', 'pending', 'queued', 'waiting']);
const SHELL = /^(?:Bash|PowerShell|bash|powershell|exec_command|shell_command)$/;

/** An idle terminal cancels any foreground tool, but says nothing about background jobs. */
export function testingIdle(info: WorkerInfo) { runs.get(info)?.foreground.clear(); }

/** Preserve IDs, not commands or output, when a terminal survives an office restart. */
export function saveTesting(info: WorkerInfo) {
  const run = runs.get(info);
  return run && (run.foreground.size || run.background.size)
    ? { session: run.session, foreground: [...run.foreground], background: [...run.background] } : undefined;
}

export function restoreTesting(info: WorkerInfo, saved: unknown) {
  const s = saved as Partial<ReturnType<typeof saveTesting>>;
  if (!s || s.session !== info.sessionId) return;
  const ids = (a: unknown) => new Set(Array.isArray(a) ? a.filter((id): id is string => typeof id === 'string').slice(0, 1000) : []);
  runs.set(info, { session: s.session, foreground: ids(s.foreground), background: ids(s.background) });
}

/** Classification of commands that actually run checks, not an arbitrary mention of tests. */
export function testCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  if (commandAction(command) === 'test') return true;
  if (/^\s*(?:echo|Write-Output|cat|Get-Content|rg|grep)\b/i.test(command)) return false;
  return /(?:^|[\s/\\"'])\w*(?:run-tests|run-filter|Build-Quest)\.ps1\b/i.test(command)
    || /(?:^|\s)-(?:runTests|TestsOnly|testPlatform)\b/.test(command);
}

/** One small seam in the status setter also covers late OSC idle/progress events. */
export function testingStatus(info: WorkerInfo, next: WorkerStatus): WorkerStatus {
  if (next === 'exited' || next === 'offline' || next === 'starting') runs.delete(info);
  const run = runs.get(info);
  return (next === 'done' || next === 'idle' || next === 'working') &&
    !!run && (run.foreground.size > 0 || run.background.size > 0) ? 'testing' : next;
}

/** Stop.background_tasks is authoritative when present (Claude Code >= 2.1.145).
 * Missing snapshots on older CLIs must not erase a known running test. */
export function testingHook(h: WorkerHandle, event: string, p: any) {
  let run = runs.get(h.info);
  const session = typeof p?.session_id === 'string' ? p.session_id : undefined;
  if (session && run?.session && session !== run.session && event !== 'SessionStart') return;
  if (event === 'SessionStart') {
    runs.delete(h.info);
    run = undefined;
  }
  if (event === 'StopFailure' || event === 'StopCancelled' || event === 'Interrupt') {
    runs.delete(h.info);
    return;
  }
  if (!run) { run = { session, foreground: new Set(), background: new Set() }; runs.set(h.info, run); }
  if (event === 'UserPromptSubmit') run.foreground.clear();
  const id = typeof p?.tool_use_id === 'string' ? p.tool_use_id : p?.tool_name;
  if (event === 'PreToolUse' && SHELL.test(p?.tool_name ?? '') && testCommand(p?.tool_input?.command)) {
    run.foreground.add(id);
  }
  if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
    const testing = run.foreground.delete(id);
    const result = p?.tool_response;
    if (testing && typeof result?.backgroundTaskId === 'string') run.background.add(result.backgroundTaskId);
    // An explicit TaskOutput/TaskStop result can settle a known task even on older CLIs.
    const taskId = p?.tool_input?.task_id;
    if (event === 'PostToolUse' && typeof taskId === 'string' &&
      (p.tool_name === 'TaskStop' || (p.tool_name === 'TaskOutput' &&
        ['completed', 'failed', 'killed', 'stopped'].includes(result?.task?.status)))) run.background.delete(taskId);
  }
  if (event === 'Stop') run.foreground.clear();
  if (event === 'Stop' && Array.isArray(p?.background_tasks)) {
    const known = run.background;
    run.background = new Set(p.background_tasks.filter((t: any) =>
      typeof t?.id === 'string' && ACTIVE.has(t.status) &&
      (known.has(t.id) || (t.type === 'shell' && (testCommand(t.command) ||
        (!t.command && /\b(?:tests?|PlayMode|EditMode|typecheck|test lock)\b/i.test(t.description ?? ''))))))
      .map((t: any) => t.id));
  }
}

/** Install through the provider registry; keep test tracking out of the provider implementation. */
export function withTesting(adapter: SomeAdapter): SomeAdapter {
  const hook = adapter.hook;
  if (!hook) return adapter;
  return { ...adapter, hook: { ...hook, handle(h, event, payload) {
    const session = (payload as { session_id?: unknown } | null)?.session_id;
    if (typeof session === 'string' && h.info.sessionId &&
      session !== h.info.sessionId && event !== 'SessionStart') return false;
    testingHook(h, event, payload);
    const accepted = hook.handle(h, event, payload);
    if (event === 'StopFailure') {
      h.info.activity = 'Agent stopped with an error; open the terminal';
      h.setStatus('needs_input');
      return accepted;
    }
    const status = testingStatus(h.info, h.info.status);
    if (status !== h.info.status) h.setStatus(status);
    // A completed foreground check hands control back to the agent to inspect its result.
    else if (h.info.status === 'testing' && testingStatus(h.info, 'working') === 'working') h.setStatus('working');
    return accepted;
  } } };
}
