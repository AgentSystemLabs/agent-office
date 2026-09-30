// The environment the workers start with: the office's own, minus a parent agent session's.
import { PROVIDERS } from '../providers/index.js';

// Env vars from a parent agent session (e.g. starting the office from inside Claude Code) that
// would make a worker think it is a child session — that silently turns off transcript saving,
// which breaks resume. Each provider names its own (see ProviderAdapter.scrubEnv).
const SCRUB_ENV = new Set([
  ...Object.values(PROVIDERS).flatMap((p) => p.scrubEnv ?? []),
  'NO_COLOR', 'FORCE_COLOR', 'VSCODE_INJECTION', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION',
]);
const SCRUB_PREFIXES = [...Object.values(PROVIDERS).flatMap((p) => p.scrubPrefixes ?? []), 'NEBULA_', 'AGENT_OFFICE_'];
const scrubbed = (k: string) => SCRUB_ENV.has(k) || SCRUB_PREFIXES.some((p) => k.startsWith(p));

/** The office's environment, minus anything that would make a child think it's a nested session. */
export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !scrubbed(k)) env[k] = v;
  return env;
}
