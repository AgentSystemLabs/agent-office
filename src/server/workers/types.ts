// The shapes the workers' modules and the provider adapters (server/providers/) share.
import type serialize from '@xterm/addon-serialize';
import type { Run, WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import type { DshSession } from '../dsh.js';
import type { PromptSource } from '../prompts.js';
import type { Pty } from '../ptys.js';
import type { UsageTracker } from '../usage.js';
import type { Worktrees } from '../worktrees.js';
import type { HeadlessTerminal } from './terminal.js';

export type Worktree = NonNullable<WorkerInfo['worktree']>;

export interface HookEnv {
  url: string;
  token: string;
}

/** Another floor's repository for a worker to work in too (see WorkerInfo.repos). */
export interface RepoSource {
  floor: string;
  /** The floor's name, for messages. */
  name: string;
  /** owner/name on GitHub, when known. */
  repo?: string;
  /** Its checkout. */
  dir: string;
}

/** A pull request 'worker.pr' opened, or found already open, for a worker's branch. */
export interface OpenedPr {
  /** For a worker across repositories: which of its repositories (the folder in its workspace). */
  repo?: string;
  number: number;
  url: string;
  /** The branch already had it. */
  existed: boolean;
  /** The worktree still has uncommitted changes, which aren't in it. */
  dirty: boolean;
}

/**
 * Runs a worker as the account that hired it, on that account's own Claude and GitHub sign-ins
 * (see signins.ts). Workers hired without an account run as the office, as they always have.
 */
export interface RunAs {
  /** Whether the account has a Claude sign-in its workers can start on. */
  claudeReady(owner: string): boolean;
  /** What to tell the account when it hasn't. */
  why(which: 'claude'): string;
  /** Puts the account's sign-ins in place of the office's in `env`; `dirs` are where the worker starts. */
  apply(owner: string, env: Record<string, string>, dirs: string[]): Record<string, string>;
}

export interface Worker {
  info: WorkerInfo;
  /** The account that hired it, whose sign-ins it runs on. None: the office's own. */
  owner?: string;
  pty?: Pty;
  /**
   * A DeepSeek Harness worker's ACP connection. It has no PTY: ACP updates are rendered into the
   * same headless terminal the other providers mirror a process into (see dsh.ts).
   */
  dsh?: DshSession;
  term?: HeadlessTerminal;
  ser?: InstanceType<typeof serialize.SerializeAddon>;
  /** The screen so far, for a browser opening the terminal (see screen.ts). */
  snapshot?: () => string;
  viewers: Map<string, string>; // clientId -> name
  screenDirty: boolean;
  lastLines: string[];
  leftNeedsInputAt: number;
  keyframeAt: number;
  hookToken: string;
  /** Claude never reported SessionStart: it's stuck on a trust/login/onboarding screen. */
  bootBlocked?: boolean;
  /** Its provider's own state on it (see ProviderAdapter.createState). */
  state: unknown;
  /** What its provider's adapter is handed of it (see WorkerHandle), once asked for. */
  handle?: WorkerHandle;
  /** Test runs and builds that have failed in a row (see FAILS_TO_DESPAIR). */
  failStreak: number;
  /** Its latest prompts and tool calls, for naming its task. */
  prompts: string[];
  tools: string[];
  toolsSinceNamed: number;
  namedAt: number;
  /** Bumped by /clear: a new conversation, so a new task. */
  taskEpoch: number;
  /** Where the session's tokens and cost are read from (see usage.ts). */
  tracker: UsageTracker;
  scanTimer?: NodeJS.Timeout;
  /** Its terminal in the host as of the last save, and how it was doing, to pick back up after a restart. */
  saved?: { ptyId: string; status: WorkerStatus; acked: boolean; waitingSince?: number };
  /** Its process went away mid-turn with the office or the terminal host: its next start carries on (CARRY_ON_PROMPT). */
  interrupted?: boolean;
  /** A prompt its start couldn't pass on the command line (a Muse resume): typed into its session after SessionStart. */
  pendingPrompt?: string;
  /** Output since its scrollback was last saved to disk. */
  unsaved?: boolean;
  /** Where this run's own output starts, below the scrollback carried over from before. */
  fresh?: { readonly line: number };
  /** Its lost worktree is being put back (see rebuild): the folder coming back mustn't wake it before that's done. */
  rebuilding?: boolean;
}

export interface WorkerEvents {
  update(info: WorkerInfo): void;
  /** It's gone (sent home), and what it was as it went. */
  remove(workerId: string, info?: WorkerInfo): void;
  data(workerId: string, data: string, viewers: string[]): void;
  screen(workerId: string, frame: { cols: number; rows: number; lines: Record<number, Run[]>; full: boolean; cursor: [number, number] }): void;
  toast(text: string, level: 'info' | 'warn' | 'error'): void;
}

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

/**
 * What the workers' modules (worktree.ts, pr.ts, tasks.ts, acp.ts) share of the manager: the floor's
 * project, its workers, and what they all do to one. Narrow on purpose: they never import the manager.
 */
export interface WorkerContext {
  /** The floor's project checkout. */
  readonly dir: string;
  /** Git plumbing for it. */
  readonly trees: Worktrees;
  readonly workers: Map<string, Worker>;
  readonly events: WorkerEvents;
  /** The office's prompts, as set in ⚙️ Settings (see prompts.ts). */
  readonly prompts?: PromptSource;
  /** The office is shutting down: workers exiting now are being stopped, not failing. */
  readonly closing: boolean;
  /** Tells everyone how `w` is doing now. */
  emit(w: Worker): void;
  /** Saves every worker (workers.json). */
  persist(): void;
  setStatus(w: Worker, status: WorkerStatus): void;
  /** Starts a worker that isn't running again (see WorkerManager.resume). */
  resume(id: string, prompt?: string): string | undefined;
  /** Where a worker works: its worktree, its workspace across repositories, or the project itself. */
  cwd(info: WorkerInfo): string;
  /** What a worker's terminal runs. */
  command(info: WorkerInfo): string;
  notePrompt(w: Worker, prompt: string): void;
  /** Keeps `worktree.branch` on the branch its worktree is on (see WorkerTrees.sync). */
  syncBranch(w: Worker): Promise<void>;
}
