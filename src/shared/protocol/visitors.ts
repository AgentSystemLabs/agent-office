// Visitors: Claude Code sessions the office didn't start (the Claude desktop app, a terminal, an
// IDE), seen through the transcripts Claude Code writes under ~/.claude/projects (see
// server/visitors/). The office only ever reads those; a visitor can be looked at, never driven.

import type { Subagent } from './subagents.js';

/** How a visitor is getting on, from the latest entries of its transcript. */
export type VisitorStatus = 'working' | 'needs_input' | 'done';

/** Where a visitor's session runs. */
export type VisitorApp = 'desktop' | 'cli' | 'ide' | 'other';

export interface Visitor {
  /** Its session id. */
  id: string;
  /** Its title in the app, else its first prompt, else its folder. */
  title: string;
  app: VisitorApp;
  /** The folder it runs in, as its last two parts ("Programer/my-site"). */
  folder: string;
  branch?: string;
  status: VisitorStatus;
  /** Its latest tool call, or what it last said. */
  activity?: string;
  /** The model its latest message came from. */
  model?: string;
  /** When its transcript (or one of its subagents') was last written (ms). */
  seenAt: number;
  /** Its folder's repository is no floor's, so it waits in the lobby (the building's first floor). */
  lobby: boolean;
  /** The subagents it has running, most recent first, at most VISITOR_SUBAGENTS of them. */
  subagents: Subagent[];
  /** How many it has running in all. */
  subagentCount: number;
}

/** A visitor shows at most this many of its subagents round it; the rest are a count on its card. */
export const VISITOR_SUBAGENTS = 8;

/** The visitors on one floor. `off`: the office was started with --no-visitors. */
export interface VisitorsState {
  visitors: Visitor[];
  off?: boolean;
}

export type VisitorsServerMsg = { t: 'visitors'; state: VisitorsState };
