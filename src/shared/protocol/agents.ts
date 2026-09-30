// The agents a worker can run: providers, Claude models and reasoning efforts.

export type AgentProvider = 'claude' | 'opencode' | 'codex' | 'grok' | 'muse' | 'dsh' | 'custom';

export function isAgentProvider(value: unknown): value is AgentProvider {
  return value === 'claude' || value === 'opencode' || value === 'codex' || value === 'grok' || value === 'muse' || value === 'dsh' || value === 'custom';
}

/** A Claude model alias the hire dialog and queue can request explicitly (see server/agents.ts). */
export type ClaudeModel = 'fable' | 'opus' | 'sonnet' | 'haiku';
export const CLAUDE_MODELS: readonly ClaudeModel[] = ['fable', 'opus', 'sonnet', 'haiku'];
export function isClaudeModel(value: unknown): value is ClaudeModel {
  return value === 'fable' || value === 'opus' || value === 'sonnet' || value === 'haiku';
}

/** Claude Code's `--effort` levels, from fastest/cheapest to most thorough. */
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const AGENT_EFFORTS: readonly AgentEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export function isAgentEffort(value: unknown): value is AgentEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max';
}

/** Which agent a worker runs: its provider, and optionally the model and (Claude/Grok/Muse) the reasoning effort. */
export interface AgentChoice {
  provider: AgentProvider;
  /** An OpenCode provider/model id, a Claude model alias, or a Grok/Muse model id; unset for the provider's own default. */
  model?: string;
  effort?: AgentEffort;
}
