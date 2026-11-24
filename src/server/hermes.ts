// Hermes Agent: its command line (one session per desk, resumed by id) and the plugin that reports
// its lifecycle on /hooks/hermes, in the same statuses as OpenCode's plugin (see providers/hermes.ts).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AgentEffort } from '../shared/protocol.js';
import type { OpenCodeStatusEvent } from './opencode.js';

/** A Hermes session id, as `hermes chat --resume` takes one (`20261124_104347_b76354`, `local-<hex>`). */
const HERMES_SESSION_ID = /^[A-Za-z0-9._:-]{1,160}$/;

/**
 * The person's Hermes home: `HERMES_HOME` when the office has one, else ~/.hermes. Its config,
 * login and plugins are the person's own; the office only adds a plugin of its own.
 */
export function hermesHome(): string {
  return process.env.HERMES_HOME?.trim() || path.join(homedir(), '.hermes');
}

/**
 * Its command line: `hermes chat`, the person's `--agent-args` minus the flags the office owns (the
 * query, resumption, and the model and effort it picked), then the office's own. On a TTY `-q` seeds
 * an interactive session and submits the prompt as its first turn; `--resume` carries on a session.
 */
export function hermesArgs(extra: string[], options: { sessionId?: string; model?: string; effort?: AgentEffort; prompt?: string }): string[] {
  const takesValue = new Set(['--query', '--query-file', '--resume', '--continue']);
  const shortValue = new Set(['-q', '-r', '-c']);
  const optionalValue = new Set(['--continue', '-c']);
  if (options.model) {
    takesValue.add('--model');
    shortValue.add('-m');
  }
  if (options.effort) takesValue.add('--reasoning');
  const args: string[] = ['chat'];
  for (let i = 0; i < extra.length; i++) {
    const arg = extra[i];
    if (arg === '--') break;
    if (arg === '--oneshot') continue;
    if (optionalValue.has(arg)) {
      if (extra[i + 1] !== undefined && !extra[i + 1].startsWith('-')) i++;
      continue;
    }
    if (takesValue.has(arg) || shortValue.has(arg)) {
      i++;
      continue;
    }
    if ([...takesValue].some((name) => arg.startsWith(`${name}=`))) continue;
    if ([...shortValue].some((name) => arg.startsWith(name) && arg.length > name.length)) continue;
    args.push(arg);
  }
  if (options.model) args.push('-m', options.model);
  if (options.effort) args.push('--reasoning', options.effort);
  if (options.sessionId) args.push('--resume', options.sessionId);
  if (options.prompt) args.push('-q', options.prompt);
  return args;
}

/** Accept only bounded lifecycle fields, never assistant text, tool arguments, or credentials. */
export function normalizeHermesHook(value: unknown): OpenCodeStatusEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const bounded = (text: unknown, max: number): text is string => typeof text === 'string' && text.length > 0 && text.length <= max && !/[\p{Cc}\p{Cf}]/u.test(text);
  if (typeof v.sessionId !== 'string' || !HERMES_SESSION_ID.test(v.sessionId)) return;
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

/**
 * Writes the office's plugin into the Hermes home's plugins directory, when Hermes is installed
 * there. The office never edits the person's Hermes config: the plugin is enabled once with
 * `hermes plugins enable agent-office`, and it does nothing in a run the office did not start.
 */
export function writeHermesPlugin(home: string): string | undefined {
  if (!existsSync(home)) return undefined;
  const dir = path.join(home, 'plugins', 'agent-office');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, 'plugin.yaml'), HERMES_PLUGIN_MANIFEST, { mode: 0o600 });
  writeFileSync(path.join(dir, '__init__.py'), HERMES_PLUGIN_SOURCE, { mode: 0o600 });
  return dir;
}

/**
 * One run's hook file: Hermes runs plugin hooks in its own gateway, so the endpoint reaches the
 * plugin as a file whose path travels as the session's client environment (see the plugin source).
 * The token stays in this file, readable only by the office's user, because Hermes drops
 * credential-looking names from that environment.
 */
export function hermesHookFile(dataDir: string, workerId: string): string {
  return path.join(dataDir, `hermes-hook-${workerId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

/** Writes that file with the token the office rotated for this run: just before the spawn. */
export function writeHermesHookFile(file: string, env: NodeJS.ProcessEnv): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const hook = { url: env.AGENT_OFFICE_HOOK_URL, token: env.AGENT_OFFICE_HOOK_TOKEN, workerId: env.AGENT_OFFICE_WORKER_ID };
  writeFileSync(file, JSON.stringify(hook), { mode: 0o600 });
}

export const HERMES_PLUGIN_MANIFEST = `name: agent-office
version: "1.0.0"
description: "Report a worker's lifecycle to the local agent-office desk that started it (no-op otherwise)."
author: "agent-office"

hooks:
  - on_session_start
  - pre_llm_call
  - pre_tool_call
  - post_llm_call
  - on_session_end
  - on_session_finalize
  - on_session_reset
`;

export const HERMES_PLUGIN_SOURCE = String.raw`"""Agent Office: report this Hermes run to the desk that started it.

Written and installed by agent-office. It is stdlib-only, and does nothing in a
Hermes run the office did not start: without the hook file the office wrote for
that run it returns before touching anything, and it never raises out of a hook.

Hermes runs plugin hooks inside its long-lived gateway, which never inherits the
environment of the "hermes chat" process the office launched. The office
therefore writes this run's endpoint to a file of its own, and lets Hermes carry
that file's path to the gateway as the session's client environment (the name is
allowlisted under terminal.client_env_passthrough); a run inside the office's own
process finds the same path in its environment.
"""

from __future__ import annotations

import json
import os
import threading
from urllib import parse, request

MAX_PROMPT = 20000
MAX_TOOL = 160
TIMEOUT_SECONDS = 0.75

MAX_REMEMBERED = 256

# The office listens on loopback only: go there directly, past any HTTP proxy.
_OPENER = request.build_opener(request.ProxyHandler({}))
_lock = threading.Lock()
_active_session = ""
# Endpoints read while the session's client environment was bound: a hook that runs after the turn
# (a session ending) still reports to the desk that started it.
_endpoints = {}

HOOKS = (
    "on_session_start",
    "pre_llm_call",
    "pre_tool_call",
    "post_llm_call",
    "on_session_end",
    "on_session_finalize",
    "on_session_reset",
)
_TURN_HOOKS = frozenset(HOOKS) - {"pre_tool_call"}


def _text(value) -> str:
    return value if isinstance(value, str) else ""


def _url(worker, base, token):
    """The loopback hook URL for one worker, or None when it isn't loopback."""
    if not worker or not token or not base:
        return None
    try:
        parts = parse.urlsplit(base)
        port = parts.port or 80
    except ValueError:
        return None
    if parts.scheme != "http" or parts.hostname != "127.0.0.1":
        return None
    return "http://127.0.0.1:%d/hooks/hermes?worker=%s" % (port, parse.quote(worker, safe="")), token


def _setting(name) -> str:
    """What the office sent for this session: its client environment while Hermes has it bound,
    else our own."""
    try:
        from agent.session_client_env import session_env

        bound = _text(session_env(name))
    except Exception:
        bound = ""
    return bound or _text(os.environ.get(name))


def _from_file(path):
    """The endpoint the office wrote for this run, or None."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    return _url(_text(data.get("workerId")), _text(data.get("url")), _text(data.get("token")))


def _endpoint(session=""):
    """This session's loopback URL and token, or (None, "")."""
    path = _setting("AGENT_OFFICE_HOOK_FILE")
    found = _from_file(path) if path else None
    if found is None:
        # A gateway that started before the file existed, or a run inside the office's own process.
        found = _url(
            _text(os.environ.get("AGENT_OFFICE_WORKER_ID")),
            _text(os.environ.get("AGENT_OFFICE_HOOK_URL")),
            _text(os.environ.get("AGENT_OFFICE_HOOK_TOKEN")),
        )
    if found is not None:
        if session:
            with _lock:
                _endpoints[session] = found
                while len(_endpoints) > MAX_REMEMBERED:
                    _endpoints.pop(next(iter(_endpoints)))
        return found
    if session:
        with _lock:
            remembered = _endpoints.get(session)
        if remembered is not None:
            return remembered
    return None, ""


def _session_id(kwargs) -> str:
    explicit = _text(kwargs.get("session_id")) or _text(kwargs.get("session_key"))
    if explicit:
        return explicit
    # A tool hook can come without a session id: the turn it runs in is the one that was last named.
    return _active_session


def _body(event, kwargs, session):
    if event == "on_session_start":
        return {"sessionId": session, "type": "session", "status": "starting"}
    if event == "pre_llm_call":
        prompt = _text(kwargs.get("user_message"))[:MAX_PROMPT]
        return {"sessionId": session, "type": "prompt", "status": "working", "prompt": prompt}
    if event == "pre_tool_call":
        tool = _text(kwargs.get("tool_name"))[:MAX_TOOL]
        if not tool:
            return None
        return {"sessionId": session, "type": "tool", "status": "working", "tool": tool}
    if event == "post_llm_call":
        return {"sessionId": session, "type": "session", "status": "done"}
    if event == "on_session_end":
        if kwargs.get("failed"):
            return {"sessionId": session, "type": "error", "status": "working"}
        if kwargs.get("interrupted"):
            return {"sessionId": session, "type": "session", "status": "starting"}
        return {"sessionId": session, "type": "session", "status": "done"}
    if event == "on_session_finalize":
        return {"sessionId": session, "type": "session", "status": "done"}
    if event == "on_session_reset":
        return {"sessionId": session, "type": "session", "status": "starting"}
    return None


def _report(event, kwargs) -> None:
    global _active_session
    try:
        # A subagent's turn is internal work: it must not speak for this desk.
        if _text(kwargs.get("parent_session_id")):
            return
        session = _session_id(kwargs)
        if not session:
            return
        if event in _TURN_HOOKS:
            _active_session = session
        body = _body(event, kwargs, session)
        url, token = _endpoint(session)
        if body is None or url is None:
            return
        data = json.dumps(body).encode("utf-8")
        req = request.Request(
            url,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
        )
        with _lock:
            try:
                with _OPENER.open(req, timeout=TIMEOUT_SECONDS) as response:
                    response.read(1024)
            except Exception:
                pass
    except Exception:
        pass


def _callback(event):
    def callback(**kwargs) -> None:
        _report(event, kwargs)
    callback.__name__ = "agent_office_" + event
    return callback


def register(ctx) -> None:
    for event in HOOKS:
        ctx.register_hook(event, _callback(event))
`;
