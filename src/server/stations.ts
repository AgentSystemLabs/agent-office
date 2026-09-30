// What the board agents are told when they're hired: the agents standing by the Issues board, the PR
// board and the task queue (STATIONS in shared/layout.ts). Whoever walks up types them a request; the
// first one follows this brief in the same prompt. The briefs themselves are prompts the office can
// rewrite in ⚙️ Settings (shared/prompts.ts).

import { FORGE_LABEL, type ForgeKind } from '../shared/protocol.js';
import { forgeNote } from '../shared/forgeweb.js';
import type { StationKind } from '../shared/layout.js';
import { officePrompt, type PromptSource } from './prompts.js';

/**
 * The brief a station's agent is hired with. `forge` is the code host this floor is on: the briefs
 * are written for GitHub, so on Bitbucket a line is put on top saying which CLI to use instead, and
 * that there is no issues board — rather than editing the text, which whoever rewrote the brief in
 * ⚙️ Settings chose word for word (see forgeNote, which the prompts the PR window sends share).
 */
export function stationBrief(kind: StationKind, prompts?: PromptSource, forge: ForgeKind = 'github'): string {
  const brief = officePrompt(prompts, `station.${kind}`);
  const note = forgeNote(forge, 'this brief');
  return note ? `${note} There is no issues board here — ${FORGE_LABEL.bitbucket} keeps its issues for a whole workspace, not per repository.\n\n${brief}` : brief;
}

/** Claude Code tools the queue agent is launched without, so it can't edit the checkout even by mistake. */
export const QUEUE_AGENT_DISALLOWED_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
