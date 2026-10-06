// Issue triage: each open issue on a floor's board is classified (see server/triage/), labelled, and
// the ones an agent can take on by itself are put on the floor's task queue.

import type { AgentEffort, AgentProvider } from './agents.js';

export const TRIAGE_TYPES = ['bug', 'feature', 'docs', 'chore', 'question', 'duplicate-or-spam'] as const;
export const TRIAGE_SIZES = ['xs', 's', 'm', 'l', 'xl'] as const;
export const TRIAGE_PRIORITIES = ['p0', 'p1', 'p2', 'p3'] as const;
export type TriageType = (typeof TRIAGE_TYPES)[number];
export type TriageSize = (typeof TRIAGE_SIZES)[number];
export type TriagePriority = (typeof TRIAGE_PRIORITIES)[number];

/** One of a set of options, and how sure the classifier is of it (0 to 1). */
export interface TriageChoice<T extends string = string> {
  value: T;
  p: number;
}

/** A yes/no question: `p` is the probability of yes. */
export interface TriageYesNo {
  p: number;
}

/** The classifier's seven answers about one issue. */
export interface TriageAnswers {
  type: TriageChoice<TriageType>;
  /** One of the floor's areas (triage.json), or '' when it has none. */
  area: TriageChoice;
  /** Clear goal, enough detail to act on without asking. */
  agentReady: TriageYesNo;
  size: TriageChoice<TriageSize>;
  priority: TriageChoice<TriagePriority>;
  /** Touches secrets, billing, data deletion, security or a product decision. */
  needsHuman: TriageYesNo;
  /** Likely needs changes in another of the office's repos. */
  crossRepo: TriageYesNo;
}

/**
 * What triage did with an issue, the first rule that matched (see server/triage/route.ts):
 * - queued: on the task queue (or would be, in shadow mode)
 * - held: would be queued, but a gate stopped it (auto-queue off, the daily cap, an author who isn't a collaborator)
 * - needs-human, label-only (a question, duplicate or spam), needs-detail, cross-repo, split-me (xl)
 * - opted-out: someone changed its triage labels, so triage leaves it alone until Re-classify
 * - error: the classifier or GitHub failed; it's tried again on the next look at the board
 */
export type TriageDecision = 'queued' | 'held' | 'needs-human' | 'label-only' | 'needs-detail' | 'cross-repo' | 'split-me' | 'opted-out' | 'error';

/** The worker a queued issue gets, by its size. */
export interface TriageModel {
  provider: AgentProvider;
  model?: string;
  effort?: AgentEffort;
}

export interface TriageResult {
  number: number;
  /** When it was classified (ms since the epoch). */
  at: number;
  decision: TriageDecision;
  /** Why, in a few words, for the badge and the queue card. */
  reason: string;
  answers?: TriageAnswers;
  /** Some answer was too unsure to be written as a label (see TriageConfig.thresholds.label). */
  lowConfidence?: boolean;
  /** The labels triage gives it. */
  labels: string[];
  model?: TriageModel;
  /** Nothing was written to GitHub (the floor's triage.json has writeLabels off). */
  shadow: boolean;
  error?: string;
}

/** What triage did on a floor today (the office's local day). */
export interface TriageStats {
  day: string;
  triaged: number;
  queued: number;
  /** The floor's daily cap on auto-queued tasks. */
  cap: number;
  /** What the classifier cost today, in US dollars, as far as it says. */
  spend: number;
}

export interface TriageState {
  /** Triage is on for this floor: the office runs with --triage and the floor hasn't turned it off. */
  enabled: boolean;
  results: TriageResult[];
  stats: TriageStats;
}

/** Why a task was put on the queue by triage, for its card. */
export interface QueueTriage {
  reason: string;
  size?: TriageSize;
  priority?: TriagePriority;
  area?: string;
  /** How sure the classifier was that an agent can take it on (agentReady). */
  confidence?: number;
}

export type TriageClientMsg =
  /** Classify it again, even if someone changed its labels. */
  | { t: 'triage.reclassify'; number: number }
  /** Put it on the queue though triage held it back (never one that needs a human). */
  | { t: 'triage.queueAnyway'; number: number };

export type TriageServerMsg =
  | { t: 'triage'; state: TriageState }
  | { t: 'triage.result'; result: TriageResult; stats: TriageStats };
