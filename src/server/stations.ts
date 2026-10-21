// What the board agents are told when they're hired: the agents standing by the Issues board, the PR
// board and the task queue (STATIONS in shared/layout.ts). Whoever walks up types them a request; the
// first one follows this brief in the same prompt. The briefs themselves are prompts the office can
// rewrite in ⚙️ Settings (shared/prompts.ts).

import type { ConfigurableStation, StationKind } from '../shared/layout.js';
import type { AgentChoice, AgentEffort, AgentProvider } from '../shared/protocol.js';
import { officePrompt, type PromptSource } from './prompts.js';

export function stationBrief(kind: StationKind, prompts?: PromptSource): string {
  return officePrompt(prompts, `station.${kind}`);
}

/**
 * What the agent at a board starts on: what an admin picked for the Issues or PR agent, else the
 * office's default worker (the Queue agent's always).
 */
export function stationChoice(
  kind: StationKind | undefined,
  prompts: { station(kind: ConfigurableStation): AgentChoice | undefined } | undefined,
  officeDefault: AgentChoice,
): [AgentProvider, string | undefined, AgentEffort | undefined] {
  const picked = kind && kind !== 'queue' ? prompts?.station(kind) : undefined;
  const c = picked ?? officeDefault;
  return [c.provider, c.model, c.effort];
}

/** Claude Code tools the queue agent is launched without, so it can't edit the checkout even by mistake. */
export const QUEUE_AGENT_DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
