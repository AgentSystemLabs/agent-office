// Wire protocol between browser and server. Every WebSocket frame is one JSON object.

export type WorkerStatus =
  | 'starting' // PTY launched, agent booting
  | 'idle' // waiting for a first prompt
  | 'working' // agent is busy
  | 'needs_input' // permission prompt / question open
  | 'done' // finished its turn
  | 'exited' // process ended (can be resumed if it had a session)
  | 'offline'; // restored from disk after a server restart; resumable

export type WorkerKind = 'agent' | 'shell';

export interface WorkerInfo {
  id: string;
  /** 'agent' runs Claude Code (or --agent); 'shell' is a plain shared login shell. */
  kind: WorkerKind;
  deskId: string;
  name: string;
  color: string;
  status: WorkerStatus;
  /** True once someone opened the terminal after the last done / needs_input. */
  acked: boolean;
  createdBy: string;
  createdAt: number;
  prompt?: string;
  /** Set when the worker runs in its own git worktree (path relative to the office dir). */
  worktree?: { path: string; branch: string; base: string };
  title?: string;
  sessionId?: string;
  exitCode?: number;
  cols: number;
  rows: number;
  /** Names of people currently viewing the terminal. */
  viewers: string[];
  /** Latest line of meaningful activity (e.g. last prompt or tool). */
  activity?: string;
  /** Tokens and cost of its Claude session so far, subagents included (agents only). */
  usage?: Usage;
}

/** Tokens and what they cost, summed over a Claude Code session or the whole office. */
export interface Usage {
  /** Input tokens that missed the prompt cache. */
  input: number;
  output: number;
  /** Tokens written to the prompt cache. */
  cacheWrite: number;
  /** Tokens read from the prompt cache. */
  cacheRead: number;
  /** USD: estimated from the office's price list while a session runs, Claude Code's own figure once it has ended. */
  cost: number;
  /** API calls (assistant messages) counted. */
  calls: number;
}

/** Spend across the whole office, kept on disk (see server/usage.ts). */
export interface UsageState {
  /** Every worker the office ever ran, including ones sent home. */
  total: Usage;
  /** Since midnight on the office's machine. */
  today: Usage;
  /** The day `today` covers, YYYY-MM-DD on the office's machine. */
  day: string;
  /** Daily budget in USD (--budget), when one is set. */
  budget?: number;
  /** New hires are refused for the rest of the day once the budget is spent (--budget-pause). */
  pauseHiring: boolean;
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
}

export interface PeerInfo {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  moving: boolean;
  voice: boolean;
  muted: boolean;
  sharing: boolean;
}

/** A styled run of text on a terminal row: [text, fg, bg, flags]. */
export type Run = [string, number, number, number];
/** Color encoding: -1 default, 0..255 palette, >= 0x1000000 means 0x1000000 | rgb. */
export const RGB_FLAG = 0x1000000;
export const FLAG_BOLD = 1;
export const FLAG_INVERSE = 2;
export const FLAG_DIM = 4;

export interface GhIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string;
  labels: { name: string; color: string }[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  body: string;
  comments: number;
}

export interface GhPull {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  url: string;
  author: string;
  labels: { name: string; color: string }[];
  reviewDecision: string;
  headRefName: string;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  checks: 'pass' | 'fail' | 'pending' | 'none';
  body: string;
}

export interface GhState<T> {
  items: T[];
  error?: string;
  fetchedAt: number;
  loading: boolean;
}

export interface ProjectInfo {
  name: string;
  dir: string;
  branch?: string;
  remote?: string;
  agentCmd: string;
}

export interface TeamMember {
  /** GitHub username (or the name deploy/aws.sh invited a key file under). */
  name: string;
  keys: number;
}

/** Who may SSH-tunnel into the office. Only offices deployed with deploy/aws.sh manage this. */
export interface TeamState {
  /** Why invites can't be managed from the office, when they can't. */
  unavailable?: string;
  error?: string;
  /** user@host teammates tunnel to, e.g. office@203.0.113.7 */
  ssh?: string;
  /** The office's port on the box (tunnel destination). */
  port: number;
  /** SHA256 fingerprint of the box's ED25519 host key, to check on first connect. */
  fingerprint?: string;
  members: TeamMember[];
}

/** A web server a worker started (a dev server, a preview), found by the ports it listens on. */
export interface ServiceInfo {
  port: number;
  /** The address the office reaches it on, on its own machine. */
  host: string;
  pid: number;
  /** Its command line, shortened, e.g. "vite --port 5173". */
  command: string;
  /** The worker whose terminal started it. */
  workerId: string;
  /** Its working directory relative to the office dir ('' is the project root). */
  cwd?: string;
  /** The <title> of its front page. */
  title?: string;
  since: number;
}

export interface ServicesState {
  items: ServiceInfo[];
  /** The office's port on its machine. Service tunnels end there and the office relays them. */
  port: number;
  /** user@host teammates tunnel to (offices deployed with deploy/aws.sh), e.g. office@203.0.113.7 */
  ssh?: string;
}

export interface VersionInfo {
  sha: string;
  subject: string;
  /** ISO commit date */
  date: string;
}

/** Self-upgrade of an office installed from git by deploy/aws.sh (see server/upgrade.ts). */
export interface UpgradeState {
  /** False when the office can't upgrade itself (not installed by deploy/aws.sh). */
  available: boolean;
  current?: VersionInfo;
  /** Newest commit upstream, when it differs from current. */
  latest?: VersionInfo;
  /** New commits since current, newest first (at most 15). */
  changes?: { sha: string; subject: string }[];
  /** How many new commits there are in all ("50" means 50 or more). */
  behind?: number;
  checking?: boolean;
  checkedAt?: number;
  phase: 'idle' | 'building' | 'restarting' | 'failed';
  /** Who started the upgrade. */
  by?: string;
  error?: string;
}

export interface ChatLine {
  from: string;
  name: string;
  color: string;
  text: string;
  at: number;
}

export type ClientMsg =
  | { t: 'move'; x: number; y: number; z: number; rotY: number; moving: boolean }
  /** You reached out to use something; everyone else sees your character's arm do it. */
  | { t: 'act' }
  | { t: 'profile'; name: string; color: string }
  | { t: 'worker.spawn'; deskId: string; prompt?: string; worktree?: boolean; kind?: WorkerKind }
  | { t: 'worker.resume'; workerId: string }
  | { t: 'worker.kill'; workerId: string; cleanup?: WorktreeCleanup }
  /** Asks what the worker's worktree holds; answered with a `worker.worktree` message. */
  | { t: 'worker.worktree'; workerId: string }
  | { t: 'worker.attach'; workerId: string }
  | { t: 'worker.detach'; workerId: string }
  | { t: 'worker.prompt'; workerId: string; prompt: string }
  | { t: 'term.input'; workerId: string; data: string }
  | { t: 'term.resize'; workerId: string; cols: number; rows: number }
  | { t: 'gh.refresh' }
  | { t: 'voice'; voice: boolean; muted: boolean; sharing: boolean }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'chat'; text: string }
  | { t: 'team.get' }
  | { t: 'team.invite'; github: string }
  | { t: 'team.remove'; name: string }
  | { t: 'upgrade.check' }
  | { t: 'upgrade.start' }
  | { t: 'ping'; at: number };

export type ServerMsg =
  | {
      t: 'welcome';
      you: string;
      peers: PeerInfo[];
      workers: WorkerInfo[];
      project: ProjectInfo;
      issues: GhState<GhIssue>;
      pulls: GhState<GhPull>;
      ice: { urls: string | string[]; username?: string; credential?: string }[];
      chat: ChatLine[];
      /** Whether teammates can be invited from the office (see TeamState). */
      invites: boolean;
      /** The running server's version; a change after a reconnect means the office was upgraded. */
      version: string;
      upgrade: UpgradeState;
      services: ServicesState;
      usage: UsageState;
    }
  | { t: 'peer.join'; peer: PeerInfo }
  | { t: 'peer.update'; peer: PeerInfo }
  | { t: 'peer.move'; id: string; x: number; y: number; z: number; rotY: number; moving: boolean }
  | { t: 'peer.leave'; id: string }
  | { t: 'peer.act'; id: string }
  | { t: 'worker.update'; worker: WorkerInfo }
  | { t: 'worker.remove'; workerId: string }
  | { t: 'worker.worktree'; workerId: string; state: WorktreeState }
  | { t: 'screen'; workerId: string; cols: number; rows: number; lines: Record<number, Run[]>; full: boolean; cursor: [number, number] }
  | { t: 'term.snapshot'; workerId: string; data: string; cols: number; rows: number }
  | { t: 'term.data'; workerId: string; data: string }
  | { t: 'gh.issues'; state: GhState<GhIssue> }
  | { t: 'gh.pulls'; state: GhState<GhPull> }
  | { t: 'rtc'; from: string; data: unknown }
  | ({ t: 'chat' } & ChatLine)
  | { t: 'toast'; text: string; level: 'info' | 'warn' | 'error' }
  | { t: 'team'; state: TeamState }
  | { t: 'upgrade'; state: UpgradeState }
  | { t: 'services'; state: ServicesState }
  | { t: 'usage'; state: UsageState }
  /** Sent to whoever asked for the invite. */
  | { t: 'team.invited'; github: string; name?: string; keys?: number; error?: string }
  | { t: 'pong'; at: number };
