import path from 'node:path';
import type { AgentProvider } from '../shared/protocol.js';
import { CLAUDE_MODELS, EFFORTS, isClaudeModel, isEffort } from '../shared/models.js';

export const OPEN_CODE_MODEL_MAX = 256;

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
  return 'custom';
}

/** OpenCode model ids are argv values, so reject anything that could be ambiguous or unsafe. */
export function isValidOpenCodeModel(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > OPEN_CODE_MODEL_MAX) return false;
  if (/[\s\p{Cc}\p{Cf}]/u.test(value)) return false;
  const parts = value.split('/');
  return parts.length >= 2 && /^[A-Za-z0-9_.][A-Za-z0-9_.-]*$/.test(parts[0]) && parts.slice(1).every((part) => part.length > 0);
}

export function validateWorkerModel(kind: 'agent' | 'shell', provider: AgentProvider | undefined, model: unknown): string | undefined {
  if (model === undefined) return undefined;
  if (kind === 'shell') return 'Shell workers do not have a model';
  if (provider === 'claude') return isClaudeModel(model) ? undefined : `Unknown Claude model (expected ${CLAUDE_MODELS.join(', ')})`;
  if (provider !== 'opencode') return 'Models can only be selected for Claude Code and OpenCode workers';
  if (!isValidOpenCodeModel(model)) return 'Invalid OpenCode model (expected provider/model without whitespace)';
  return undefined;
}

export function validateWorkerEffort(kind: 'agent' | 'shell', provider: AgentProvider | undefined, effort: unknown): string | undefined {
  if (effort === undefined) return undefined;
  if (kind === 'shell' || provider !== 'claude') return 'Effort can only be selected for Claude Code workers';
  if (!isEffort(effort)) return `Unknown effort (expected ${EFFORTS.join(', ')})`;
  return undefined;
}

/** Whether `arg` is `flag` with its value attached: `--model=x`, or `-mx` for a one-letter flag. */
const attached = (arg: string, flag: string) => arg.startsWith(`${flag}=`) || (!flag.startsWith('--') && arg.startsWith(flag) && arg.length > flag.length);

/** The value an argv gives one of `flags` (the last one wins, as in the CLIs), e.g. the model in --agent-args. */
export function flagValue(args: string[], flags: string[]): string | undefined {
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    for (const flag of flags) {
      if (args[i] === flag && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) value = args[++i];
      else if (attached(args[i], flag)) value = args[i].slice(flag.length + (args[i][flag.length] === '=' ? 1 : 0));
      else continue;
      break;
    }
  }
  return value || undefined;
}

/** The argv without `flags` and their values, for a worker hired with its own instead. */
export function withoutFlags(args: string[], flags: string[]): string[] {
  const clean: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (flags.includes(arg)) {
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if (flags.some((flag) => attached(arg, flag))) continue;
    clean.push(arg);
  }
  return clean;
}
