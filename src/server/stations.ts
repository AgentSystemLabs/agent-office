// What the board agents are told when they're hired: the agents standing by the Issues board, the PR
// board and the task queue (STATIONS in shared/layout.ts). Whoever walks up types them a request; the
// first one follows this brief in the same prompt. The briefs themselves are prompts the office can
// rewrite in ⚙️ Settings (shared/prompts.ts).

import type { StationKind } from '../shared/layout.js';
import { stationVarsFor, type IssueTracker } from '../shared/issues.js';
import { officePrompt, type PromptSource } from './prompts.js';

/** The brief, filled in for the tracker the floor's issues live in (GitHub unless told otherwise). */
export function stationBrief(kind: StationKind, prompts?: PromptSource, tracker: IssueTracker = 'github'): string {
  return officePrompt(prompts, `station.${kind}`, stationVarsFor(tracker));
}

/** Claude Code tools the queue agent is launched without, so it can't edit the checkout even by mistake. */
export const QUEUE_AGENT_DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
