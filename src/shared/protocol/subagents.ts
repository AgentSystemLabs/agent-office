// Subagents: the agents a Claude Code session hands part of its work to (the Agent tool, a
// workflow's agents). A worker's come from its hooks (server/subagents.ts); a visitor's are read off
// the files Claude Code keeps for them (server/visitors/).

export interface Subagent {
  /** Claude Code's agent id: its transcript is `subagents/agent-<id>.jsonl` next to the session's. */
  id: string;
  /** Its agent type: "general-purpose", "Explore", a workflow's "workflow-subagent"... */
  type: string;
  /** What it was asked to do (its description), once known. */
  title?: string;
  /** The workflow phase it's in, for a workflow's agent. */
  phase?: string;
  /** Its latest tool call, as "Bash: npm test". */
  activity?: string;
  /** When it started, and when it was last heard from (ms). */
  since: number;
  seenAt: number;
}

/** A subagent nobody has heard from in this long has ended without saying so (its session was stopped mid-turn). */
export const SUBAGENT_STALE_MS = 15 * 60_000;

/** The subagents still running, most recently heard from first. */
export function liveSubagents(list: readonly Subagent[] | undefined, now: number): Subagent[] {
  return (list ?? []).filter((s) => now - s.seenAt < SUBAGENT_STALE_MS).sort((a, b) => b.seenAt - a.seenAt);
}
