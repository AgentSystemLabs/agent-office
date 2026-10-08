// What the coordinator is told when it's hired: the one agent standing by the boards (STATIONS in
// shared/layout.ts). Whoever walks up types it a request; the brief follows it in the same prompt.
// The brief itself is a prompt the office can rewrite in ⚙️ Settings (shared/prompts.ts).

import type { StationKind } from '../shared/layout.js';
import { officePrompt, type PromptSource } from './prompts.js';

export function stationBrief(kind: StationKind, prompts?: PromptSource): string {
  return officePrompt(prompts, `station.${kind}`);
}
