// The environment the workers start with: the office's own, minus a parent agent session's.

// Env vars from a parent agent session (e.g. starting the office from inside Claude Code) that
// would make a worker think it is a child session — that silently turns off transcript saving,
// which breaks resume.
const SCRUB_ENV = new Set([
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_PID', 'CLAUDE_EFFORT',
  'CODEX_THREAD_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
  'GROK_SESSION_ID', 'GROK_AGENT_ID', 'GROK_HOOK_EVENT', 'GROK_HOOK_NAME', 'GROK_WORKSPACE_ROOT',
  'GROK_PLUGIN_ROOT', 'GROK_PLUGIN_DATA', 'GROK_AUTH', 'GROK_AUTH_PATH',
  'MUSE_BIN', 'MUSE_AGENTS_THREAD', 'MUSE_AGENTS_ROLE', 'MUSE_PROJECTS_HOME',
  'NO_COLOR', 'FORCE_COLOR', 'VSCODE_INJECTION', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION',
]);
const SCRUB_PREFIXES = ['CLAUDE_CODE_SESSION', 'CLAUDE_CODE_CHILD', 'CLAUDE_CODE_MESSAGING', 'NEBULA_', 'AGENT_OFFICE_'];
const scrubbed = (k: string) => SCRUB_ENV.has(k) || SCRUB_PREFIXES.some((p) => k.startsWith(p));

/** The office's environment, minus anything that would make a child think it's a nested session. */
export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !scrubbed(k)) env[k] = v;
  return env;
}
