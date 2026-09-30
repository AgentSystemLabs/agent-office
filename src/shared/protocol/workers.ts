// Workers at their desks: what they are, their worktrees and their terminals.

import type { AgentEffort, AgentProvider } from './agents.js';
import type { Usage } from './usage.js';

export type WorkerStatus =
  | 'starting' // PTY launched, agent booting
  | 'idle' // waiting for a first prompt
  | 'working' // agent is busy
  | 'needs_input' // permission prompt / question open
  | 'done' // finished its turn
  | 'exited' // process ended (can be resumed if it had a session)
  | 'offline'; // restored from disk after a server restart; resumable

export type WorkerKind = 'agent' | 'shell';

/**
 * What a working agent's latest tool call looks like from across the room (see shared/actions.ts):
 * reading files, editing them, running tests or a build, on the web, or tests failing again and again.
 */
export type WorkerAction = 'read' | 'edit' | 'test' | 'web' | 'failing';

/** What a worker is on, for the card above its head: "Fix Login Redirect" + what it's doing now. */
export interface WorkerTask {
  name: string;
  summary: string;
}

export interface WorkerInfo {
  id: string;
  /** 'agent' runs the selected provider; 'shell' is a plain shared login shell. */
  kind: WorkerKind;
  provider?: AgentProvider;
  /** Model requested for this worker, instead of the office's configured default: an OpenCode provider/model id, a Claude model alias, a Grok/Muse model id, or an opaque DeepSeek Harness catalog id. */
  model?: string;
  /** Reasoning effort requested for this worker, when one was chosen (Claude, Grok, Muse or DeepSeek Harness). */
  effort?: AgentEffort;
  deskId: string;
  name: string;
  color: string;
  status: WorkerStatus;
  /** True once someone opened the terminal after the last done / needs_input. */
  acked: boolean;
  /** When it last went to done or needs_input (ms), so N goes to whoever has waited longest first. */
  waitingSince?: number;
  createdBy: string;
  createdAt: number;
  prompt?: string;
  /**
   * Set when the worker runs in its own git worktree (path relative to the office dir). `from` is
   * the branch the office was on when the worktree was cut, which its pull request targets.
   * `branch` is the branch the worktree is on: the office's own office/<name>-<id> until the worker
   * switches to one of its own (`git checkout -b fix-x`), which `made` then remembers.
   */
  worktree?: { path: string; branch: string; base: string; from?: string; made?: string };
  /**
   * Set while the folder it works in (its worktree, or its workspace across repositories) is gone:
   * deleted outside the office, so it can't start there until it's rebuilt ('worker.rebuild') or sent
   * home. `branch` says where its branch still is: in the project, only on origin, or nowhere.
   */
  lost?: { branch: LostBranch };
  /** The pull request opened from this desk for the worktree branch (see 'worker.pr'). */
  pr?: { number: number; url: string };
  /**
   * Other floors' repositories it works in too, for a task that spans them. It then starts in a
   * workspace folder with a worktree of each repository in it, its own floor's (`worktree`) and
   * these, all on the same branch, and each repository gets a pull request of its own.
   */
  repos?: WorkerRepo[];
  /** True while the branch is being pushed and its pull request opened. */
  prOpening?: boolean;
  title?: string;
  sessionId?: string;
  exitCode?: number;
  cols: number;
  rows: number;
  /** Names of people currently viewing the terminal. */
  viewers: string[];
  /** Who is viewing it, by connection (PeerInfo.id): one per open window, so a name can be here twice. */
  viewerIds: string[];
  /** Latest line of meaningful activity (e.g. last prompt or tool). */
  activity?: string;
  /** What its latest tool call is, for the worker to act out while it works. */
  action?: WorkerAction;
  /** Written by a small model from its prompts and recent tool calls (see server/tasks.ts). */
  task?: WorkerTask;
  /** Reported session tokens and cost, when the provider supplies them (agents only). */
  usage?: Usage;
  /** Who last typed into its terminal (or sent it a prompt), and when. */
  lastInput?: { by: string; at: number };
  /** The meeting it was called to, for a worker at the meeting room's table (see Meeting). */
  meeting?: string;
  /**
   * How long it has spent working (ms), over the stretches that have ended, and when the one it's in
   * now started (while it's working): on the castle map, the longer it has worked, the more worn out it looks.
   */
  workedMs?: number;
  workingSince?: number;
  /** Sent out by a map's herald (the castle's Hand of the King), so every browser has it run to its seat from beside them. */
  via?: 'herald';
}

/** Where the branch of a worker whose worktree was deleted still is (see WorkerInfo.lost). */
export type LostBranch = 'here' | 'origin' | 'gone';

/** Another floor's repository a worker also works in (see WorkerInfo.repos): a worktree of it in the worker's workspace. */
export interface WorkerRepo {
  /** The floor whose project it is. */
  floor: string;
  /** Its folder in the workspace, named after its checkout ("api"). */
  name: string;
  /** owner/name on GitHub, when known. */
  repo?: string;
  /** The checkout the worktree was cut from, on the office's machine. */
  dir: string;
  /** The worktree, relative to the worker's own floor's dir, like WorkerInfo.worktree. */
  path: string;
  branch: string;
  /** The commit it was branched from. */
  base: string;
  /** The branch that checkout was on, which its pull request targets. */
  from?: string;
  /** Its pull request, once opened from the desk. */
  pr?: { number: number; url: string };
}

/** What becomes of a worker's git worktree when it is sent home. */
export type WorktreeCleanup = 'keep' | 'worktree' | 'all';

/** What a worker's worktree holds, so whoever sends it home knows what deleting it would lose. */
export interface WorktreeState {
  /** The worktree folder is still there. */
  exists: boolean;
  /** Files with uncommitted changes, new ones included. */
  dirty: number;
  /** Commits on its branch since it was made. */
  ahead: number;
  /** Commits only its branch has: on no remote, and not in the office's own checkout. */
  unpushed: number;
  /** Set when git couldn't tell, e.g. the branch is gone. */
  error?: string;
  /** A worker across repositories: each worktree's own state, its own floor's first. The fields above add them up. */
  repos?: { name: string; state: WorktreeState }[];
}

/** A styled run of text on a terminal row: [text, fg, bg, flags]. */
export type Run = [string, number, number, number];
/** Color encoding: -1 default, 0..255 palette, >= 0x1000000 means 0x1000000 | rgb. */
export const RGB_FLAG = 0x1000000;
export const FLAG_BOLD = 1;
export const FLAG_INVERSE = 2;
export const FLAG_DIM = 4;

/**
 * A worker sent home on a map that locks them up (see MapPlan.sendHome): who it was, and when it was
 * locked up, which is how far it has wasted away since.
 */
export interface Prisoner {
  id: string;
  name: string;
  color: string;
  /** When it was locked up (ms). */
  at: number;
  /** How long it had worked, for how worn out it looks (see MapConfig.agents.ageMinutes). */
  workedMs?: number;
}

/** A floor's dungeon: everyone locked up in it, first to last, and how many from before them are only bones on the heap now. */
export interface JailState {
  prisoners: Prisoner[];
  bones: number;
}

export type WorkerClientMsg =
  /** With `issue`, the worker is there for that GitHub issue: it's assigned on GitHub (so it moves to In progress) and taken off the queue. */
  /** With `repos` (other floors' ids), the worker works in their repositories too, each in a worktree of its own (see WorkerInfo.repos). */
  | { t: 'worker.spawn'; deskId: string; prompt?: string; worktree?: boolean; kind?: WorkerKind; provider?: AgentProvider; model?: string; effort?: AgentEffort; issue?: number; repos?: string[]; via?: 'herald' }
  | { t: 'worker.resume'; workerId: string }
  | { t: 'worker.kill'; workerId: string; cleanup?: WorktreeCleanup }
  /** Asks what the worker's worktree holds; answered with a `worker.worktree` message. */
  | { t: 'worker.worktree'; workerId: string }
  /** Puts a lost worker's worktree back and starts it again (see WorkerInfo.lost); `all`: every lost worker on the floor. */
  | { t: 'worker.rebuild'; workerId: string; all?: boolean }
  | { t: 'worker.attach'; workerId: string }
  | { t: 'worker.detach'; workerId: string }
  /** With `issue`, the prompt hands the worker that GitHub issue, which is taken as for worker.spawn. */
  | { t: 'worker.prompt'; workerId: string; prompt: string; issue?: number }
  /**
   * A prompt for the agent standing by a board (`deskId` is its kiosk, see STATIONS in layout). It's
   * typed into its session, which is woken up first if it's asleep, or hired there when nobody is.
   */
  | { t: 'station.prompt'; deskId: string; prompt: string }
  /** Push a worktree worker's branch and open a pull request for it, drafted from its task. */
  | { t: 'worker.pr'; workerId: string }
  | { t: 'term.input'; workerId: string; data: string }
  /** You're typing into that terminal (a keystroke or a paste, not the terminal answering itself); sent about once a second. */
  | { t: 'term.typing'; workerId: string }
  | { t: 'term.resize'; workerId: string; cols: number; rows: number };

export type WorkerServerMsg =
  | { t: 'worker.update'; worker: WorkerInfo }
  /** A worker's gone; `jail`, when it was sent home on a map that locks workers up (MapPlan.sendHome), with it in there now. */
  | { t: 'worker.remove'; workerId: string; jail?: JailState }
  | { t: 'worker.worktree'; workerId: string; state: WorktreeState }
  | { t: 'screen'; workerId: string; cols: number; rows: number; lines: Record<number, Run[]>; full: boolean; cursor: [number, number] }
  | { t: 'term.snapshot'; workerId: string; data: string; cols: number; rows: number }
  | { t: 'term.data'; workerId: string; data: string }
  /** Someone else in that terminal (`id`, a PeerInfo id) is typing; only its other viewers get these. */
  | { t: 'term.typing'; workerId: string; id: string };
