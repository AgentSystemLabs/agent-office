import type { AgentChoice, AgentEffort, AgentProvider, Meeting, MeetingState, WorkerInfo } from '../shared/protocol.js';
import type { WorktreeRef, WorktreeState } from './worktrees.js';
import type { PromptId } from '../shared/prompts.js';

/** What the meeting room needs from the worker manager. Narrow on purpose, so a test can fake it. */
export interface MeetingWorkers {
  readonly defaultProvider: AgentProvider;
  /** What a meeting seats when whoever calls it doesn't pick (⚙️ Settings); the default provider without it. */
  readonly officeDefault?: AgentChoice;
  list(): WorkerInfo[];
  /** Seats an agent at a chair of the meeting table, for meeting `meeting`, in its worktree when it has one. */
  seat(deskId: string, by: string, prompt: string, provider: AgentProvider, model: string | undefined, effort: AgentEffort | undefined, meeting: { id: string; worktree?: Meeting['worktree'] }, owner?: string): WorkerInfo | string;
  prompt(id: string, text: string, by?: string): string | undefined;
  /** Keys into its terminal: Esc, to stop what it's doing. */
  write(id: string, data: string, by: string): void;
  kill(id: string): Promise<{ note?: string; error?: string }>;
}

/** Git for the meeting's own worktree: made when it starts, tidied away once everyone has gone home. */
export interface MeetingTrees {
  /** `note` says when commits the project has were left out of it (see Worktrees.create). */
  createAsync(slug: string, signal?: AbortSignal): Promise<(Required<Omit<WorktreeRef, 'made'>> & { from?: string; note?: string }) | string>;
  inspect(wt: WorktreeRef): Promise<WorktreeState>;
  remove(wt: WorktreeRef, cleanup: 'worktree' | 'all'): Promise<string | undefined>;
}

export interface MeetingEvents {
  update(state: MeetingState): void;
  toast(text: string, level: 'info' | 'warn' | 'error'): void;
  /** Why nobody may be hired right now (today's budget is spent), if that's so. */
  hiringPaused(): string | undefined;
  /** Posts the review panel's review on its pull request. Resolves to the review's URL. */
  postReview(pr: number, file: string, owner?: string): Promise<string>;
  /** One of the office's prompts as it has it now (rewritten in ⚙️ Settings, or the default). */
  prompt?(id: PromptId): string;
}
