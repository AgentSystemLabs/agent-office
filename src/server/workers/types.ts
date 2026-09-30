// The shapes the workers' modules and the provider adapters (server/providers/) share.
import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import type { UsageTracker } from '../usage.js';

/**
 * One worker, as its provider's adapter sees it: what it is and how it's doing, its provider's own
 * state, and what the adapter may do with it. Narrow on purpose (like QueueWorkers), so an adapter
 * never reaches into the manager.
 */
export interface WorkerHandle<S = unknown> {
  readonly info: WorkerInfo;
  /** Its provider's own state on it (see ProviderAdapter.createState). */
  readonly state: S;
  /** Its process is running in a terminal. */
  readonly running: boolean;
  /** Stuck on a trust, login or first-run screen, rather than asking anything. */
  bootBlocked: boolean;
  /** When it last stopped needing input: a permission prompt right after that is a late one for what was just answered. */
  leftNeedsInputAt: number;
  /** Test runs and builds that have failed in a row (see FAILS_TO_DESPAIR). */
  failStreak: number;
  /** Where its session's tokens and cost are read from (see usage.ts). */
  readonly tracker: UsageTracker;
  /** A prompt its start couldn't pass on the command line: typed into its session once that's up. */
  pendingPrompt?: string;
  /** Moves it to `status`, raising its flag and bringing its branch up to date as that goes. */
  setStatus(status: WorkerStatus): void;
  /** Tells everyone how it's doing now. */
  emit(): void;
  /** Saves every worker (workers.json). */
  persist(): void;
  /** A new message for it: shown right away, and its task (re)named. */
  notePrompt(prompt: string): void;
  /** A tool call it made, for naming its task. */
  noteTool(tool: string): void;
  /** A new conversation, so a new task. */
  clearTask(): void;
  /** Reads its usage again in a moment (hooks come in bursts). */
  scheduleScan(): void;
  /** Types a prompt into its session; says what went wrong, if anything. */
  prompt(text: string): string | undefined;
}
