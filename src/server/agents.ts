import path from 'node:path';
import { isAgentEffort, isClaudeModel, type AgentProvider } from '../shared/protocol.js';

export const OPEN_CODE_MODEL_MAX = 256;
export const DROID_MODEL_MAX = 256;

/**
 * Finds the provider represented by the configured executable.  Keep this deliberately based on
 * the final path component: --agent may be an absolute path, and Windows paths can be supplied
 * while the office itself is running under a POSIX shell.
 */
export function configuredProvider(command: string): AgentProvider {
  const base = path
    .basename(command.replaceAll('\\', '/'))
    .toLowerCase()
    .replace(/\.exe$/, '');
  if (base === 'claude') return 'claude';
  if (base === 'opencode') return 'opencode';
  if (base === 'codex') return 'codex';
  if (base === 'droid') return 'droid';
  return 'custom';
}

/** The providers an office started with `configured` can hire: Droid first, and a custom --agent only when that's what it was started with. */
export function agentProviders(configured: AgentProvider): AgentProvider[] {
  return configured === 'custom' ? ['droid', 'claude', 'opencode', 'codex', 'custom'] : ['droid', 'claude', 'opencode', 'codex'];
}

/** OpenCode model ids are argv values, so reject anything that could be ambiguous or unsafe. */
export function isValidOpenCodeModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > OPEN_CODE_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  const parts = value.split('/');
  return parts.length >= 2 && /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(parts[0]) && parts.slice(1).every((part) => part.length > 0);
}

/** Droid model ids are settings values, so reject anything that could be ambiguous or unsafe. */
export function isValidDroidModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > DROID_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  return true;
}

export function validateWorkerModel(kind: 'agent' | 'shell', provider: AgentProvider | undefined, model: unknown): string | undefined {
  if (model === undefined) return undefined;
  if (kind === 'shell') return 'Shell workers do not have an agent model';
  if (provider === 'claude') return isClaudeModel(model) ? undefined : 'Invalid Claude model (expected fable, opus, sonnet or haiku)';
  if (provider === 'droid') return isValidDroidModel(model) ? undefined : 'Invalid Droid model (expected a model id without whitespace)';
  if (provider !== 'opencode') return 'Models can only be selected for Claude Code, OpenCode or Droid workers';
  if (!isValidOpenCodeModel(model)) return 'Invalid OpenCode model (expected provider/model without whitespace)';
  return undefined;
}

/** Claude Code's and Droid's `--effort`/`reasoningEffort` levels; no other provider this office launches supports one yet. */
export function validateWorkerEffort(kind: 'agent' | 'shell', provider: AgentProvider | undefined, effort: unknown): string | undefined {
  if (effort === undefined) return undefined;
  if (kind === 'shell') return 'Shell workers do not have a reasoning effort';
  if (provider !== 'claude' && provider !== 'droid') return 'Reasoning effort can only be selected for Claude Code or Droid workers';
  return isAgentEffort(effort) ? undefined : 'Invalid effort (expected low, medium, high, xhigh or max)';
}
