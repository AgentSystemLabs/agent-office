import type { AgentEffort, AgentProvider } from './protocol/agents.js';

/** Locally managed named workers; credentials never belong in this file. */
export interface WorkerProfile {
  id: string;
  name: string;
  description: string;
  provider?: AgentProvider;
  model?: string;
  effort?: AgentEffort;
  enabled: boolean;
  holds: string[];
  source?: string;
}
