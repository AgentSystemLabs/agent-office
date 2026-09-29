// One-shot, non-interactive runs of the `claude` CLI that answer with JSON: the sign-writer that
// names each worker's task (tasks.ts), and the Linear issue board, which reads and writes Linear
// through the user's Linear MCP connector (linear.ts). Nothing here streams or keeps a session.

import { spawn } from 'node:child_process';
import os from 'node:os';

export interface HeadlessOpts {
  /** The `claude` binary. */
  claude: string;
  /** Its environment: the office's own, minus anything that marks a child session (see childEnv in workers.ts). */
  env: Record<string, string>;
  /** What it's asked, on stdin. */
  prompt: string;
  /** The JSON Schema its answer must fit (--json-schema). */
  schema: object;
  system?: string;
  /** A model alias; haiku unless said otherwise. */
  model?: string;
  /**
   * Alone with no tools, none of the user's settings, no MCP servers and no hooks: for calls that
   * only need to think. Otherwise the user's own settings load, so their MCP connectors are there.
   */
  isolated?: boolean;
  /** The tools it may use without asking, e.g. mcp__claude_ai_Linear__list_issues. */
  allowedTools?: string[];
  /** Built-in tools it must not reach for (Bash, say), so it stays on the tools it was given. */
  disallowedTools?: string[];
  maxTurns?: number;
  timeoutMs?: number;
}

/** Runs a headless call; null when it failed, timed out, or answered with something that isn't the schema's JSON. */
export type HeadlessRunner = (opts: HeadlessOpts) => Promise<unknown | null>;

const DEFAULT_TIMEOUT_MS = 45_000;

/** The CLI arguments for a call, apart from the prompt (which goes on stdin). */
export function headlessArgs(o: HeadlessOpts): string[] {
  const args = ['-p', '--model', o.model ?? 'haiku', '--output-format', 'json', '--json-schema', JSON.stringify(o.schema)];
  if (o.system) args.push('--system-prompt', o.system);
  if (o.maxTurns) args.push('--max-turns', String(o.maxTurns));
  if (o.isolated) {
    // Not the user's or the project's settings: no hooks, no MCP servers, no plugins, no transcript.
    args.push('--tools', '', '--setting-sources', '', '--strict-mcp-config');
  } else {
    // The user's settings, where their claude.ai connectors (MCP servers) come from; not the project's.
    args.push('--setting-sources', 'user');
    if (o.allowedTools?.length) args.push('--allowedTools', ...o.allowedTools);
    if (o.disallowedTools?.length) args.push('--disallowedTools', ...o.disallowedTools);
  }
  args.push('--disable-slash-commands', '--no-session-persistence');
  return args;
}

/**
 * What a `--output-format json` answer says: its `structured_output`, or the JSON in `result` (with
 * or without a code fence). Null for an error, or anything that doesn't parse.
 */
export function parseHeadless(out: string): unknown | null {
  try {
    const res = JSON.parse(out);
    if (!res || res.is_error) return null;
    if (res.structured_output !== undefined && res.structured_output !== null) return res.structured_output;
    if (typeof res.result === 'string') return JSON.parse(res.result.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    return null;
  } catch {
    return null;
  }
}

export const runHeadless: HeadlessRunner = (o) =>
  new Promise((resolve) => {
    let out = '';
    let settled = false;
    const finish = (v: unknown | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const child = spawn(o.claude, headlessArgs(o), {
      // A neutral directory, so it doesn't pick up the project's CLAUDE.md.
      cwd: os.tmpdir(),
      env: { ...o.env, MAX_THINKING_TOKENS: '0' },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(null);
    }, o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (out += d));
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? parseHeadless(out) : null));
    child.stdin.on('error', () => {});
    child.stdin.end(o.prompt);
  });
