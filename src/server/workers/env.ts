// The environment the workers start with: the office's own, minus a parent agent session's, plus their floor's vault.
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

/** What each floor adds to its workers' environment (its vault, see vault.ts), by its project's folder. */
const floorEnvs = new Map<string, () => Record<string, string>>();

/** Gives the workers of the project in `dir` what `env` returns as well; the function it returns takes it back. */
export function addFloorEnv(dir: string, env: () => Record<string, string>): () => void {
  floorEnvs.set(dir, env);
  return () => {
    if (floorEnvs.get(dir) === env) floorEnvs.delete(dir);
  };
}

/**
 * The office's environment, minus anything that would make a child think it's a nested session,
 * plus, for a worker of the project in `dir`, its floor's (see addFloorEnv).
 */
export function childEnv(dir?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !scrubbed(k)) env[k] = v;
  if (dir) Object.assign(env, floorEnvs.get(dir)?.());
  return env;
}
