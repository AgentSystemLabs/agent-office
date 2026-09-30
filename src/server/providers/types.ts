// What the office needs from each agent provider: one adapter per provider (see index.ts), so the
// worker manager never asks which provider a worker runs. What the windows show about each (names,
// models, efforts, spend) is the shared table in shared/providers.ts.
import type { AgentProvider } from '../../shared/providers.js';
import type { StationKind } from '../../shared/layout.js';
import type { WorkerHandle } from '../workers/types.js';

/** What a provider is set up with on one floor (see ProviderAdapter.prepare). */
export interface ProviderFloor {
  /** The floor's data dir, where hook helpers, homes and plugins go. */
  dataDir: string;
  /** bin/office-workers.js, the office's MCP server, for the agents that take one (see office-workers.ts). */
  mcpScript?: string;
  /** The DSH profile a DeepSeek Harness worker boots (`--dsh-profile`). */
  dshProfile: string;
}

/** One run of a worker, for its adapter to turn into a command line. */
export interface LaunchInput<S, P> {
  h: WorkerHandle<S>;
  /**
   * The command line so far: the office's --agent-args when it runs the office's --agent, nothing
   * otherwise. A fresh copy, its own to change.
   */
  args: string[];
  /** Its first message. */
  prompt?: string;
  /** The session it carries on, when it's resumed. */
  resumeSessionId?: string;
  /** The board it stands by, for a board agent. */
  station?: StationKind;
  /** What prepare set up on this floor. */
  setup: P;
}

export interface LaunchPlan {
  args: string[];
  /** Its own environment, put in ahead of the hiring account's sign-ins (see RunAs). */
  env?: Record<string, string>;
  /** Its hooks get a new token for this run. */
  rotateToken?: boolean;
  /** Last changes to its environment just before it starts, which can fail the start with a message (a malformed setting). */
  finishEnv?(env: Record<string, string>): void;
}

/** The hook route its workers report on, /hooks/<id> on the office's loopback hook server. */
export interface ProviderHook<S> {
  /** A body that isn't JSON is turned away (400); otherwise it still counts as the event, with nothing in it. */
  strictJson: boolean;
  /** One event from one of its workers (running, with the right token). Says whether it was taken. */
  handle(h: WorkerHandle<S>, event: string, payload: unknown): boolean;
}

export interface ProviderUsage<S> {
  /** The office reads its session's transcript itself (WorkerHandle.tracker) and books it in the budget (see usage.ts). */
  transcript?: boolean;
  /** Its numbers are what it last reported: kept in workers.json. */
  persisted?: boolean;
  /** Reads its numbers afresh. */
  scan?(h: WorkerHandle<S>): void;
  /** Its process ended: read its numbers once more, for the end of its last turn. */
  scanOnExit?: boolean;
  /** Where its sessions are logged, looked up as it starts (or is picked back up) in `cwd` with `env`. */
  locate?(h: WorkerHandle<S>, cwd: string, env: NodeJS.ProcessEnv): void;
  /** What of its state workers.json keeps, and taking that back. */
  save?(state: S): Record<string, unknown>;
  restore?(state: S, saved: Record<string, unknown>): void;
}

export interface ProviderAdapter<S = undefined, P = undefined> {
  readonly id: AgentProvider;
  /** Env vars its own sessions set that would make a worker think it's one of their children: no worker gets them (see childEnv). */
  scrubEnv?: readonly string[];
  scrubPrefixes?: readonly string[];
  /** Its own state on each of its workers. */
  createState?(): S;
  /** Once per floor, as its workers' manager starts: writes its hook helpers, homes and plugins. What it returns goes to launch. */
  prepare?(floor: ProviderFloor): P;
  /** Its command line and environment for one run. */
  launch(input: LaunchInput<S, P>): LaunchPlan;
  /** How it runs: in a terminal (the default), or over ACP with the office drawing its terminal (see dsh.ts). */
  transport?: 'pty' | 'acp';
  /** The sign-in a worker hired by an account needs on that account (see RunAs). */
  signIn?: 'claude';
  /**
   * It says itself when it's up (a SessionStart hook): until then it's 'starting', and still silent
   * 12s in, its desk shows this and needs a human. Without it, it's idle as soon as it runs.
   */
  bootHint?: string;
  /** A terminal title that's only its own name, not worth showing on its card. */
  titleNoise?: RegExp;
  /** Resuming a conversation it no longer has exits before it ever starts: a fresh one is started instead. */
  freshIfResumeFails?: boolean;
  /** Its hook route, /hooks/<id>. */
  hook?: ProviderHook<S>;
  /** The provider whose hook route its workers report on, when not their own (a custom --agent speaks Claude Code's). */
  hooksAs?: AgentProvider;
  screen?: {
    /** It reports progress with OSC 9;4 (0 = idle): that catches a turn ending without a hook (Esc). */
    progress?: boolean;
    /**
     * What its desk says when its screen shows it can't be used yet (a first-run screen, not signed
     * in), or undefined when it can. `early`: it hasn't started, or was already found blocked.
     */
    blocked?(text: string, early: boolean): string | undefined;
  };
  usage?: ProviderUsage<S>;
  /** The office names its workers' tasks (see TaskNamer); the others keep the task their first prompt gives. */
  namesTasks?: boolean;
}

/** Any provider's adapter, whatever its state: the registry holds them side by side, and each is typed in its own file. */
export type SomeAdapter = ProviderAdapter<any, any>;
