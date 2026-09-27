// Wire protocol between browser and server. Every WebSocket frame is one JSON object.

import type { Look } from './avatar.js';
import type { DecorPlacement, Decoration } from './decor.js';

export type WorkerStatus =
  | 'starting' // PTY launched, agent booting
  | 'idle' // waiting for a first prompt
  | 'working' // agent is busy
  | 'needs_input' // permission prompt / question open
  | 'done' // finished its turn
  | 'exited' // process ended (can be resumed if it had a session)
  | 'offline'; // restored from disk after a server restart; resumable

export type WorkerKind = 'agent' | 'shell';

export type AgentProvider = 'claude' | 'opencode' | 'codex' | 'custom';

export function isAgentProvider(value: unknown): value is AgentProvider {
  return value === 'claude' || value === 'opencode' || value === 'codex' || value === 'custom';
}

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
  /** Initial OpenCode model selected for this worker, when one was requested. */
  model?: string;
  deskId: string;
  name: string;
  color: string;
  status: WorkerStatus;
  /** True once someone opened the terminal after the last done / needs_input. */
  acked: boolean;
  createdBy: string;
  createdAt: number;
  prompt?: string;
  /**
   * Set when the worker runs in its own git worktree (path relative to the office dir). `from` is
   * the branch the office was on when the worktree was cut, which its pull request targets.
   */
  worktree?: { path: string; branch: string; base: string; from?: string };
  /** The pull request opened from this desk for the worktree branch (see 'worker.pr'). */
  pr?: { number: number; url: string };
  /** True while the branch is being pushed and its pull request opened. */
  prOpening?: boolean;
  title?: string;
  sessionId?: string;
  exitCode?: number;
  cols: number;
  rows: number;
  /** Names of people currently viewing the terminal. */
  viewers: string[];
  /** Latest line of meaningful activity (e.g. last prompt or tool). */
  activity?: string;
  /** Written by a small model from its prompts and recent tool calls (see server/tasks.ts). */
  task?: WorkerTask;
  /** Reported session tokens and cost, when the provider supplies them (agents only). */
  usage?: Usage;
  /** Who last typed into its terminal (or sent it a prompt), and when. */
  lastInput?: { by: string; at: number };
}

/** Session usage. The persistent office ledger continues to cover Claude Code only. */
export interface Usage {
  /** Input tokens that missed the prompt cache. */
  input: number;
  output: number;
  /** Reasoning tokens reported separately from output, when available. */
  reasoning?: number;
  /** False when the provider supplies tokens without usable pricing. Omitted for legacy Claude usage. */
  costKnown?: boolean;
  /** Provider history is still loading, failed to load, or reached a traversal limit. */
  incomplete?: boolean;
  /** Tokens written to the prompt cache. */
  cacheWrite: number;
  /** Tokens read from the prompt cache. */
  cacheRead: number;
  /** USD: estimated from the office's price list while a session runs, Claude Code's own figure once it has ended. */
  cost: number;
  /** API calls (assistant messages) counted. */
  calls: number;
  /** False when the provider reports cumulative tokens without a reliable call count. */
  callsKnown?: boolean;
  /** Authoritative provider total when it cannot be reconstructed from the displayed buckets. */
  totalTokens?: number;
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
  /** Skin tone and hair, picked on the character select screen. */
  look: Look;
  x: number;
  y: number;
  z: number;
  rotY: number;
  moving: boolean;
  voice: boolean;
  muted: boolean;
  sharing: boolean;
  /** Signed in with their own account, so `name` is theirs and nobody else can take it. */
  account?: boolean;
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
  /** Issues it closes ("closes #12" in its description), as GitHub links them. */
  closes: number[];
}

export type TaskStatus = 'queued' | 'running' | 'done';

/** A task on the 📋 queue whiteboard: a GitHub issue or free text, seated to a worker by itself. */
export interface QueueTask {
  id: string;
  provider?: AgentProvider;
  /** Initial OpenCode model selected for this task, when one was requested. */
  model?: string;
  /** The GitHub issue it came from, when it did. */
  issue?: number;
  title: string;
  prompt: string;
  addedBy: string;
  addedAt: number;
  status: TaskStatus;
  /** The worker seated for it (it may have gone home since). */
  workerId?: string;
  workerName?: string;
  /** The worker's own branch, when it got a worktree. */
  branch?: string;
  startedAt?: number;
  finishedAt?: number;
  /** How it ended: the worker finished its turn, stopped or fell asleep, was sent home, or never started. */
  outcome?: 'done' | 'exited' | 'killed' | 'failed';
  error?: string;
  /** The pull request that closes the issue, or was opened from the worker's branch. */
  pr?: { number: number; url: string; state: string; title: string };
}

export interface QueueState {
  tasks: QueueTask[];
  /** How many workers the queue may keep busy at once; 0 pauses it. */
  maxWorkers: number;
}

/** Where a team webhook posts: Slack and Discord get their own message format, anything else plain JSON. */
export type WebhookKind = 'slack' | 'discord' | 'other';

/** The office's Slack / Discord webhook, pinged when a worker needs input or finishes (see server/webhook.ts). */
export interface NotifyState {
  /** Never the URL itself (it lets anyone post to the channel): just where it goes. */
  webhook?: { kind: WebhookKind; hint: string; by: string; at: number };
  /** Why the last post failed, until one gets through. */
  error?: string;
  lastSentAt?: number;
}

export interface GhState<T> {
  items: T[];
  error?: string;
  fetchedAt: number;
  loading: boolean;
}

export type GhMergeMethod = 'squash' | 'merge' | 'rebase';

/** How the repository lets pull requests be merged. */
export interface GhRepoInfo {
  nameWithOwner: string;
  methods: GhMergeMethod[];
}

/** A comment on an issue or on a PR's conversation, or a submitted review. */
export interface GhComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  /** Reviews only: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED. */
  state?: string;
}

/** A comment on a line of a PR's diff. */
export interface GhReviewComment {
  id: number;
  /** The first comment of the thread this one answers. */
  replyTo?: number;
  author: string;
  body: string;
  createdAt: string;
  url: string;
  path: string;
  /** The line it's on now, or null when the code under it changed since (outdated). */
  line: number | null;
  /** LEFT is the old file's line numbers, RIGHT the new file's. */
  side: 'LEFT' | 'RIGHT';
}

export interface GhCheck {
  name: string;
  state: 'pass' | 'fail' | 'pending' | 'skip';
  url?: string;
}

/** Everything the PR window shows beyond the board card: GET /api/gh/pull?number=N */
export interface GhPullDetail {
  number: number;
  body: string;
  state: string;
  isDraft: boolean;
  reviewDecision: string;
  headRefName: string;
  baseRefName: string;
  /** MERGEABLE, CONFLICTING or UNKNOWN (GitHub still working it out). */
  mergeable: string;
  /** CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, DRAFT, HAS_HOOKS or UNKNOWN. */
  mergeStateStatus: string;
  commits: number;
  comments: GhComment[];
  reviews: GhComment[];
  reviewComments: GhReviewComment[];
  checks: GhCheck[];
  repo: GhRepoInfo;
}

/** GET /api/gh/issue?number=N */
export interface GhIssueDetail {
  number: number;
  body: string;
  comments: GhComment[];
}

export interface ProjectInfo {
  name: string;
  dir: string;
  branch?: string;
  remote?: string;
  agentCmd: string;
  defaultProvider: AgentProvider;
  agentProviders: AgentProvider[];
}

export type AccountRole = 'admin' | 'member';

/** Who this browser is signed in as. */
export interface Me {
  /** Your own account; missing when you came in with the shared office password. */
  account?: { name: string; role: AccountRole };
  /** May invite, list and revoke accounts. */
  admin: boolean;
}

export interface AccountInfo {
  id: string;
  name: string;
  role: AccountRole;
  createdAt: number;
  createdBy: string;
  lastSeenAt?: number;
  /** In the office right now. */
  online: boolean;
}

/** A single-use link that makes a named account: /join#<token>. */
export interface AccountInvite {
  id: string;
  token: string;
  /** The name the account gets; when missing, whoever opens the link picks one. */
  name?: string;
  role: AccountRole;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
}

/** Per-person accounts, for admins (see server/accounts.ts). */
export interface AccountsState {
  accounts: AccountInfo[];
  invites: AccountInvite[];
  /** Whether the shared office password still lets people in. */
  sharedPassword: boolean;
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

export type ChangeStatus = 'M' | 'A' | 'D' | 'R' | 'T' | '?';

/** One file a worker changed, against the base of its branch. */
export interface ChangedFile {
  path: string;
  /** The old path, when the file was renamed. */
  from?: string;
  /** M modified, A added, D deleted, R renamed, T type changed, ? untracked (new, never committed). */
  status: ChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  /** Not committed yet: staged, unstaged or untracked. */
  uncommitted: boolean;
  /** Fingerprint of the working copy (size and mtime); a new value means the diff changed. */
  sig: string;
}

/** What a worker changed in its checkout, against the branch the office was opened on. */
export interface ChangesState {
  workerId: string;
  /** The checkout, relative to the office dir ('' is the project folder itself, shared by everyone). */
  dir: string;
  /** Current branch of that checkout ('HEAD' when detached). */
  branch?: string;
  /** What the diff is against: the base branch, an upstream, or 'HEAD' (uncommitted changes only). */
  base: string;
  /** Commits on the branch since the base. */
  ahead: number;
  /** Subject of the newest commit, when ahead > 0. */
  subject?: string;
  files: ChangedFile[];
  /** Files left out because there were more than the office lists. */
  more: number;
  /** The branch a pull request would target, when this checkout is on a branch of its own. */
  prBase?: string;
  /** An open pull request for the branch. */
  pr?: { number: number; url: string };
  /** A commit, discard or pull request in progress. */
  busy?: string;
  error?: string;
  at: number;
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
  /** Said by someone signed in with their own account. */
  account?: boolean;
}

/** A line of a worker's terminal that matched a search. */
export interface TerminalHit {
  workerId: string;
  /** The line, cut down around the match. */
  text: string;
  /** Where it is: its row in the worker's terminal, and how many rows that terminal had. */
  row: number;
  rows: number;
}

/** What GET /api/search answers: matching chat and terminal lines, newest first. */
export interface SearchResults {
  q: string;
  chat: ChatLine[];
  terminals: TerminalHit[];
  /** More lines matched than these. */
  more: boolean;
}

export type ClientMsg =
  | { t: 'move'; x: number; y: number; z: number; rotY: number; moving: boolean }
  /** You reached out to use something; everyone else sees your character's arm do it. */
  | { t: 'act' }
  | { t: 'profile'; name: string; color: string; look: Look }
  | { t: 'worker.spawn'; deskId: string; prompt?: string; worktree?: boolean; kind?: WorkerKind; provider?: AgentProvider; model?: string }
  | { t: 'worker.resume'; workerId: string }
  | { t: 'worker.kill'; workerId: string; cleanup?: WorktreeCleanup }
  /** Asks what the worker's worktree holds; answered with a `worker.worktree` message. */
  | { t: 'worker.worktree'; workerId: string }
  | { t: 'worker.attach'; workerId: string }
  | { t: 'worker.detach'; workerId: string }
  | { t: 'worker.prompt'; workerId: string; prompt: string }
  /** Push a worktree worker's branch and open a pull request for it, drafted from its task. */
  | { t: 'worker.pr'; workerId: string }
  | { t: 'term.input'; workerId: string; data: string }
  | { t: 'term.resize'; workerId: string; cols: number; rows: number }
  | { t: 'gh.refresh' }
  /** Merge a pull request; the answer comes back as gh.merged. */
  | { t: 'gh.merge'; number: number; method: GhMergeMethod; deleteBranch: boolean; auto?: boolean }
  | { t: 'queue.add'; prompt: string; title?: string; issue?: number; provider?: AgentProvider; model?: string }
  | { t: 'queue.remove'; taskId: string }
  /** Move a queued task up (-1) or down (+1) the queue. */
  | { t: 'queue.move'; taskId: string; delta: number }
  /** Put a finished task back on the queue. */
  | { t: 'queue.retry'; taskId: string }
  /** Forget the finished tasks. */
  | { t: 'queue.clear' }
  | { t: 'queue.limit'; maxWorkers: number }
  /** Set the office's Slack / Discord webhook; '' removes it. */
  | { t: 'notify.webhook'; url: string }
  /** Post a test message through the webhook; the outcome comes back as a toast. */
  | { t: 'notify.test' }
  | { t: 'voice'; voice: boolean; muted: boolean; sharing: boolean }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'chat'; text: string }
  | { t: 'team.get' }
  | { t: 'team.invite'; github: string }
  | { t: 'team.remove'; name: string }
  /** The rest of the accounts messages are for admins only. */
  | { t: 'accounts.get' }
  | { t: 'accounts.invite'; name?: string; role: AccountRole }
  | { t: 'accounts.cancel'; inviteId: string }
  | { t: 'accounts.revoke'; accountId: string }
  | { t: 'accounts.role'; accountId: string; role: AccountRole }
  /** Let the shared office password sign people in, or stop it. */
  | { t: 'accounts.shared'; on: boolean }
  /** Follow what a worker changed (the office polls its checkout while anyone watches). */
  | { t: 'changes.watch'; workerId: string }
  | { t: 'changes.unwatch'; workerId: string }
  | { t: 'changes.diff'; workerId: string; path: string }
  | { t: 'changes.commit'; workerId: string; message: string }
  /** Without a path, throws away every uncommitted change in that checkout. */
  | { t: 'changes.discard'; workerId: string; path?: string }
  | { t: 'changes.pr'; workerId: string; title: string; body: string }
  | { t: 'upgrade.check' }
  | { t: 'upgrade.start' }
  /** Hang a picture on a wall. */
  | { t: 'decor.add'; decor: DecorPlacement }
  /** Move, resize, re-frame or swap the image of a picture. */
  | { t: 'decor.update'; id: string; decor: Partial<DecorPlacement> }
  | { t: 'decor.remove'; id: string }
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
      /** Pictures on the walls. */
      decor: Decoration[];
      usage: UsageState;
      queue: QueueState;
      me: Me;
      notify: NotifyState;
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
  /** Sent to whoever asked for the merge. */
  | { t: 'gh.merged'; number: number; error?: string }
  | { t: 'rtc'; from: string; data: unknown }
  | ({ t: 'chat' } & ChatLine)
  | { t: 'toast'; text: string; level: 'info' | 'warn' | 'error' }
  | { t: 'team'; state: TeamState }
  | { t: 'upgrade'; state: UpgradeState }
  | { t: 'services'; state: ServicesState }
  | { t: 'decor'; items: Decoration[] }
  | { t: 'usage'; state: UsageState }
  | { t: 'queue'; state: QueueState }
  | { t: 'notify'; state: NotifyState }
  /** Sent to whoever watches that worker's changes, whenever they change. */
  | { t: 'changes'; state: ChangesState }
  | { t: 'changes.diff'; workerId: string; path: string; diff: string; truncated: boolean; error?: string }
  /** Sent to whoever asked for the invite. */
  | { t: 'team.invited'; github: string; name?: string; keys?: number; error?: string }
  /** Sent to admins, when asked and whenever accounts change. */
  | { t: 'accounts'; state: AccountsState }
  /** Sent to whoever made the invite. */
  | { t: 'accounts.invited'; invite?: AccountInvite; error?: string }
  /** Your role changed. */
  | { t: 'me'; me: Me }
  | { t: 'pong'; at: number };
