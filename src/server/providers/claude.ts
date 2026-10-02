// Claude Code: hooks from a settings file the office writes (its own hook route, /hooks/claude),
// usage read off the session transcript and booked in the budget, and tasks the office names.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { FAILS_TO_DESPAIR, outputFailed, toolAction } from '../../shared/actions.js';
import { MCP_READ_ONLY, writeClaudeMcpConfig } from '../office-workers.js';
import { QUEUE_AGENT_DISALLOWED_TOOLS } from '../stations.js';
import { answered, notified, wantsPermission } from '../workers/lifecycle.js';
import { shq } from '../workers/process.js';
import type { WorkerHandle } from '../workers/types.js';
import { truncate } from '../workers/util.js';
import type { ProviderAdapter } from './types.js';

/**
 * A hook finding the office restarting (its workers keep running through that) retries, once a
 * second, this many times in all: long enough for a dev-server reload.
 */
const HOOK_TRIES = 6;

/** First-run screens Claude shows before it can take a prompt. */
const SETUP_PROMPT = /trust this folder|Do you trust the files|Select login method|Choose the text style|Press Enter to continue|Bypass Permissions mode/i;
const NOT_LOGGED_IN = /Not logged in\s*·\s*Run \/login|Invalid API key|Please run \/login/i;

interface ClaudeSetup {
  /** Its --settings: the office's hooks. */
  settings: string;
  /** Its --mcp-config: the office's MCP server. */
  mcp?: string;
}

/** Claude Code's --settings for every worker: each hook event posted to the office, with curl or else the office's own node. */
function writeHookSettings(dataDir: string): string {
  const settingsPath = path.join(dataDir, 'claude-hooks.json');
  const events: [string, string | undefined][] = [
    ['SessionStart', undefined],
    ['UserPromptSubmit', undefined],
    ['Stop', undefined],
    ['Notification', undefined],
    ['PermissionRequest', undefined],
    ['PreToolUse', undefined],
    ['PostToolUse', undefined],
    ['PostToolUseFailure', undefined],
  ];
  // Minimal VPS images sometimes lack curl; the office's own node binary is always there.
  const nodeHook = path.join(dataDir, 'hook.cjs');
  writeFileSync(
    nodeHook,
    `const http = require('http');
const [event] = process.argv.slice(2);
let body = '';
process.stdin.on('data', (c) => (body += c));
process.stdin.on('end', () => {
  const url = new URL(process.env.AGENT_OFFICE_HOOK_URL + '/hooks/claude');
  url.searchParams.set('worker', process.env.AGENT_OFFICE_WORKER_ID);
  url.searchParams.set('event', event);
  const send = (tries) => {
    const req = http.request(url, { method: 'POST', timeout: 3000, headers: { authorization: 'Bearer ' + process.env.AGENT_OFFICE_HOOK_TOKEN, 'content-type': 'application/json' } }, (res) => res.resume());
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED' && tries > 1) setTimeout(() => send(tries - 1), 1000);
    });
    req.on('timeout', () => req.destroy());
    req.end(body);
  };
  send(${HOOK_TRIES});
});
`,
    { mode: 0o600 },
  );
  const hooks: Record<string, unknown[]> = {};
  for (const [event, matcher] of events) {
    const curl =
      `curl -sS -m 3 --retry ${HOOK_TRIES - 1} --retry-delay 1 --retry-connrefused -X POST -H "Authorization: Bearer $AGENT_OFFICE_HOOK_TOKEN" -H "Content-Type: application/json" ` +
      `--data-binary @- "$AGENT_OFFICE_HOOK_URL/hooks/claude?worker=$AGENT_OFFICE_WORKER_ID&event=${event}"`;
    const command =
      `if [ -z "$AGENT_OFFICE_WORKER_ID" ] || [ -z "$AGENT_OFFICE_HOOK_URL" ]; then exit 0; fi; ` +
      `if command -v curl >/dev/null 2>&1; then ${curl} >/dev/null 2>&1; ` +
      `else ${shq(process.execPath)} ${shq(nodeHook)} ${event} >/dev/null 2>&1; fi; true`;
    hooks[event] = [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] }];
  }
  // Looking at the office's workers doesn't need anyone's say-so; hiring and sending home still asks.
  const permissions = { allow: MCP_READ_ONLY };
  writeFileSync(settingsPath, JSON.stringify({ hooks, permissions }, null, 2), { mode: 0o600 });
  return settingsPath;
}

function describeTool(payload: any): string {
  const name = payload?.tool_name ?? 'tool';
  const input = payload?.tool_input ?? {};
  const detail = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.description ?? '';
  return truncate(detail ? `${name}: ${detail}` : String(name), 80);
}

/** What a finished tool call printed, and why it failed when it did. */
function toolOutput(payload: any): string {
  const res = payload?.tool_response;
  return [payload?.error, res, res?.stdout, res?.stderr].filter((s) => typeof s === 'string').join('\n');
}

/**
 * A tool call finished. Tests or a build that failed again (by exit code, or by the summary it
 * printed when the exit code was piped away) and the worker puts its head in its hands, until its
 * next tool call; a passing run ends the streak.
 */
function noteOutcome(h: WorkerHandle, payload: any, failed: boolean) {
  if (payload?.is_interrupt || toolAction(payload?.tool_name, payload?.tool_input) !== 'test') return;
  if (!failed && !outputFailed(toolOutput(payload))) {
    h.failStreak = 0;
    return;
  }
  if (++h.failStreak < FAILS_TO_DESPAIR || h.info.action === 'failing') return;
  h.info.action = 'failing';
  h.emit();
}

/**
 * Claude Code hook callback. Any session id or transcript it names is the worker's now, and a
 * malformed payload still counts as the event. The trust and login screens are also read off its
 * screen (see blocked), so only a prompt or its session starting clears bootBlocked here.
 */
function claudeHook(h: WorkerHandle, event: string, payload: any): boolean {
  const { info } = h;
  const now = Date.now();
  if (payload?.session_id && typeof payload.session_id === 'string' && payload.session_id !== info.sessionId) {
    info.sessionId = payload.session_id;
    h.persist();
  }
  if (typeof payload?.transcript_path === 'string' && payload.transcript_path !== h.tracker.transcript) {
    h.tracker.transcript = payload.transcript_path;
    h.persist();
  }
  h.scheduleScan();
  switch (event) {
    case 'SessionStart':
      if (payload?.source === 'clear') {
        h.clearTask();
        h.failStreak = 0;
      }
      if (info.status === 'starting' || (h.bootBlocked && info.status === 'needs_input')) {
        h.bootBlocked = false;
        h.setStatus('idle');
      }
      break;
    case 'UserPromptSubmit':
      h.bootBlocked = false;
      info.action = undefined;
      if (typeof payload?.prompt === 'string') {
        info.activity = truncate(payload.prompt, 80);
        h.notePrompt(payload.prompt);
      }
      if (info.status !== 'working') h.setStatus('working');
      else h.emit();
      break;
    case 'PreToolUse':
      if (payload?.tool_name === 'AskUserQuestion') h.setStatus('needs_input');
      else {
        info.activity = describeTool(payload);
        info.action = toolAction(payload?.tool_name, payload?.tool_input);
        h.noteTool(info.activity);
        if (info.status !== 'working') h.setStatus('working');
        else h.emit();
      }
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      noteOutcome(h, payload, event === 'PostToolUseFailure');
      // It opened a pull request itself (`gh pr create`): that one is its own.
      h.notePr(payload?.tool_input?.command, toolOutput(payload));
      answered(h, now);
      break;
    case 'PermissionRequest':
      wantsPermission(h, describeTool(payload));
      break;
    case 'Notification':
      notified(h, payload?.notification_type, now);
      break;
    case 'Stop':
      h.setStatus('done');
      break;
  }
  return true;
}

/**
 * Claude can sit at its prompt without being usable: stuck on a first-run screen, or not signed in
 * on this machine. That needs a human, until the screen moves on.
 */
export function claudeBlocked(text: string, early: boolean): string | undefined {
  if (NOT_LOGGED_IN.test(text)) return "Claude isn't signed in on this machine — open the terminal and type /login";
  if (SETUP_PROMPT.test(text) && early) return 'Waiting on a setup prompt (trust / login) — open the terminal';
  return undefined;
}

export const claude: ProviderAdapter<undefined, ClaudeSetup> = {
  id: 'claude',
  scrubEnv: ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_PID', 'CLAUDE_EFFORT'],
  scrubPrefixes: ['CLAUDE_CODE_SESSION', 'CLAUDE_CODE_CHILD', 'CLAUDE_CODE_MESSAGING'],
  prepare: ({ dataDir, mcpScript }) => ({
    settings: writeHookSettings(dataDir),
    mcp: mcpScript ? writeClaudeMcpConfig(dataDir, mcpScript) : undefined,
  }),
  launch({ h: { info }, args, prompt, resumeSessionId, station, setup }) {
    args.unshift('--settings', setup.settings);
    // The office's MCP server: its workers, to list, hire, send home and tell (see office-workers.ts).
    // Ahead of --settings, which ends the list --mcp-config takes.
    if (setup.mcp) args.unshift('--mcp-config', setup.mcp);
    // A model/effort chosen for this worker overrides whatever --agent-args set office-wide.
    if (info.model) args.push('--model', info.model);
    if (info.effort) args.push('--effort', info.effort);
    // The queue agent only ever adds to the queue: without these it can't touch the checkout's files.
    if (station === 'queue') args.push('--disallowedTools', ...QUEUE_AGENT_DISALLOWED_TOOLS);
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    // `--` so a prompt like "- fix login" is never parsed as a CLI option.
    if (prompt) args.push('--', prompt);
    return { args };
  },
  signIn: 'claude',
  // SessionStart fires as soon as Claude can take input: still silent, it's blocked on a human.
  bootHint: 'Waiting on a setup prompt (trust / login) — open the terminal',
  titleNoise: /^claude( code)?$/i,
  // Resuming a conversation Claude no longer has ("No conversation found") exits before Claude ever starts.
  freshIfResumeFails: true,
  hook: { strictJson: false, handle: claudeHook },
  // OSC 9;4 progress (Claude Code emits it): 0 = idle, anything else = busy. Catches Esc-cancel,
  // which fires no Stop hook.
  screen: { progress: true, blocked: claudeBlocked },
  usage: { transcript: true },
  namesTasks: true,
};
