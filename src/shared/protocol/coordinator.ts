// The coordinator's board: the phase plan a project's coordinator keeps on disk (see the coordinator
// skill), as the office reads it out of the floor's `plans/` folder.

/** Where a subplan stands on the coordinator's board. */
export type SubplanStatus = 'Pending' | 'Ready' | 'Planned' | 'In flight' | 'Blocked' | 'Done';

/** One subplan on the board: its id ("01.1"), its name, its chapter, and where it stands. */
export interface SubplanCard {
  /** The decimal id the master plan gives it ("01.1"). */
  id: string;
  /** Its short, outcome-oriented name ("prove-portfolio-data-access"). */
  name: string;
  /** The chapter it belongs to ("01"); '' while the checklist hasn't named one yet. */
  chapter: string;
  /** Where it stands, one of the six the skill uses. */
  status: SubplanStatus;
  /** The status exactly as the checklist writes it, so a note ("Blocked (…)") is never lost. */
  statusText: string;
  /** Whoever is on it, from "In flight (owner: …)". */
  owner?: string;
  /** Why it's blocked, from "Blocked (awaiting user: …)". */
  note?: string;
}

/** A chapter of the master plan. */
export interface CoordinatorChapter {
  /** The chapter number ("01"). */
  n: string;
  title: string;
  /** The question the chapter exists to answer. */
  question?: string;
}

/** One line of the coordinator's timeline: what happened, and when it says it did. */
export interface TimelineEvent {
  /** YYYY-MM-DD, as written. */
  date: string;
  /** HH:MM, as written. */
  time: string;
  text: string;
}

/** The board's header: the one-line state the checklist opens with. */
export interface CoordinatorSummary {
  inFlight: string;
  planned: string;
  ready: string;
  resume: string;
}

/** A floor's coordinator board: the phase's plan, read from its `plans/` folder. */
export interface CoordinatorState {
  /** The active phase (`plans/current.md`); null when there's no plan here. */
  phase: string | null;
  /** The phase goal (`## Goal` in the master plan). */
  goal: string | null;
  chapters: CoordinatorChapter[];
  cards: SubplanCard[];
  summary: CoordinatorSummary;
  /** Every event `timeline.md` holds; the office shows today's (see todayEvents). */
  timeline: TimelineEvent[];
  /** Why the plan can't be read, when it can't. */
  error?: string;
  at: number;
}

export type CoordinatorClientMsg =
  /** Look at this floor's plan files now, rather than on the office's own schedule. */
  | { t: 'coordinator.refresh' };

export type CoordinatorServerMsg =
  /** The floor's coordinator board: on arriving, and whenever the plan files change. */
  | { t: 'coordinator'; state: CoordinatorState };
