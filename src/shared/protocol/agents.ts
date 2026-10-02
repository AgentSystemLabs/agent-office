// The agents a worker can run: providers, Claude models and reasoning efforts (see ../providers.ts,
// which holds them with the rest of what the office knows about each provider).

import type { AgentEffort, AgentProvider } from '../providers.js';

export { AGENT_EFFORTS, CLAUDE_MODELS, isAgentEffort, isAgentProvider, isClaudeModel, type AgentEffort, type AgentProvider, type ClaudeModel } from '../providers.js';

/** Which agent a worker runs: its provider, and optionally the model and the reasoning effort (see PROVIDER_META for which each takes). */
export interface AgentChoice {
  provider: AgentProvider;
  /** A model id its provider takes (a Claude model alias, an OpenCode provider/model, a Codex model id…); unset for the provider's own default. */
  model?: string;
  effort?: AgentEffort;
}
