import path from 'node:path';
import { isAgentEffort, isClaudeModel, type AgentProvider } from '../shared/protocol.js';

export const OPEN_CODE_MODEL_MAX = 256;
export const GROK_MODEL_MAX = 64;
export const MUSE_MODEL_MAX = 128;

/**
 * DeepSeek Harness model ids are opaque option ids from its live catalog (the `session/new`
 * configuration-option state), so the office cannot validate them syntactically the way it does
 * Claude aliases or OpenCode `provider/model` ids: it only bounds length and rejects control
 * characters. A stale saved id degrades at `session/new` instead of failing the launch.
 */
export const DSH_MODEL_MAX = 256;

/**
 * Finds the provider represented by the configured executable.  Keep this deliberately based on
 * the final path component: --agent may be an absolute path, and Windows paths can be supplied
 * while the office itself is running under a POSIX shell.
 */
export function configuredProvider(command: string): AgentProvider {
  const base = path.basename(command.replaceAll('\\', '/')).toLowerCase().replace(/\.exe$/, '');
  if (base === 'claude') return 'claude';
  if (base === 'opencode') return 'opencode';
  if (base === 'codex') return 'codex';
  if (base === 'grok') return 'grok';
  if (base === 'muse') return 'muse';
  if (base === 'dsh') return 'dsh';
  return 'custom';
}

/** The providers an office started with `configured` can hire: the ones it knows, and a custom --agent only when that's what it was started with. */
export function agentProviders(configured: AgentProvider): AgentProvider[] {
  return configured === 'custom' ? ['claude', 'opencode', 'codex', 'grok', 'muse', 'dsh', 'custom'] : ['claude', 'opencode', 'codex', 'grok', 'muse', 'dsh'];
}

/** OpenCode model ids are argv values, so reject anything that could be ambiguous or unsafe. */
export function isValidOpenCodeModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > OPEN_CODE_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  const parts = value.split('/');
  return parts.length >= 2 && /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(parts[0]) && parts.slice(1).every((part) => part.length > 0);
}

/** Grok model ids are argv values (`grok-4.6`), so reject anything that could be ambiguous or unsafe. */
export function isValidGrokModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > GROK_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

/** Muse model ids are argv values (`muse-spark-1.3-contributor`), so reject anything ambiguous or unsafe. */
export function isValidMuseModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MUSE_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

/** DSH catalog ids are opaque, so only their length and control characters can be checked here. */
export function isValidDshModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > DSH_MODEL_MAX) return false;
  return !/[\p{Cc}\p{Cf}]/u.test(value);
}

export function validateWorkerModel(kind: 'agent' | 'shell', provider: AgentProvider | undefined, model: unknown): string | undefined {
  if (model === undefined) return undefined;
  if (kind === 'shell') return 'Shell workers do not have an agent model';
  if (provider === 'claude') return isClaudeModel(model) ? undefined : 'Invalid Claude model (expected fable, opus, sonnet or haiku)';
  if (provider === 'grok') return isValidGrokModel(model) ? undefined : 'Invalid Grok model';
  if (provider === 'muse') return isValidMuseModel(model) ? undefined : 'Invalid Muse model';
  if (provider === 'dsh') return isValidDshModel(model) ? undefined : 'Invalid DeepSeek Harness model (expected a catalog model id of up to 256 characters)';
  if (provider !== 'opencode') return 'Models can only be selected for Claude Code, OpenCode, Grok, Muse or DeepSeek Harness workers';
  if (!isValidOpenCodeModel(model)) return 'Invalid OpenCode model (expected provider/model without whitespace)';
  return undefined;
}

/** Claude Code, Grok and Muse reasoning-effort flags; DSH advertises a reasoning_effort configuration option. */
export function validateWorkerEffort(kind: 'agent' | 'shell', provider: AgentProvider | undefined, effort: unknown): string | undefined {
  if (effort === undefined) return undefined;
  if (kind === 'shell') return 'Shell workers do not have a reasoning effort';
  if (provider !== 'claude' && provider !== 'grok' && provider !== 'muse' && provider !== 'dsh') return 'Reasoning effort can only be selected for Claude Code, Grok, Muse or DeepSeek Harness workers';
  return isAgentEffort(effort) ? undefined : 'Invalid effort (expected low, medium, high, xhigh or max)';
}
