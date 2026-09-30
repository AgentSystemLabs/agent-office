// The agents a worker can run: providers, Claude models and reasoning efforts (see ../providers.ts,
// which holds them with the rest of what the office knows about each provider).

import type { AgentEffort, AgentProvider } from '../providers.js';

export { AGENT_EFFORTS, CLAUDE_MODELS, isAgentEffort, isAgentProvider, isClaudeModel, type AgentEffort, type AgentProvider, type ClaudeModel } from '../providers.js';

/** Which agent a worker runs: its provider, and optionally the model and (Claude/Grok/Muse) the reasoning effort. */
export interface AgentChoice {
  provider: AgentProvider;
  /** An OpenCode provider/model id, a Claude model alias, or a Grok/Muse model id; unset for the provider's own default. */
  model?: string;
  effort?: AgentEffort;
}
