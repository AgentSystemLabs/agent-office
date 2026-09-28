// Wire protocol between browser and server. Every WebSocket frame is one JSON object.

import type { Look } from './avatar.js';
import type { CabinetFrame, CabinetState, CabinetView } from './cabinet.js';
import type { DecorPlacement, Decoration } from './decor.js';
import type { DogState } from './dog.js';
import type { EmoteId } from './emotes.js';
import type { BallState } from './hoop.js';
import type { JukeboxState } from './jukebox.js';
import type { PromptId } from './prompts.js';
import type { DrinkId } from './rooftop.js';
import type { WbElement, WbPointer, WhiteboardView } from './whiteboard.js';

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

export type AgentProvider = 'claude' | 'opencode' | 'codex' | 'custom';

export function isAgentProvider(value: unknown): value is AgentProvider {
  return value === 'claude' || value === 'opencode' || value === 'codex' || value === 'custom';
}

/** A Claude model alias the hire dialog and queue can request explicitly (see server/agents.ts). */
export type ClaudeModel = 'fable' | 'opus' | 'sonnet' | 'haiku';
export const CLAUDE_MODELS: readonly ClaudeModel[] = ['fable', 'opus', 'sonnet', 'haiku'];
export function isClaudeModel(value: unknown): value is ClaudeModel {
  return value === 'fable' || value === 'opus' || value === 'sonnet' || value === 'haiku';
}

/** Claude Code's `--effort` levels, from fastest/cheapest to most thorough. */
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const AGENT_EFFORTS: readonly AgentEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export function isAgentEffort(value: unknown): value is AgentEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max';
}

/** Which agent a worker runs: its provider, and optionally the model and (Claude only) the reasoning effort. */
export interface AgentChoice {
  provider: AgentProvider;
  /** An OpenCode provider/model id, or a Claude model alias; unset for the provider's own default. */
  model?: string;
  effort?: AgentEffort;
}

/**
 * The prompts the office writes for workers by itself (shared/prompts.ts) and the worker everyone
 * starts on, as set in ⚙️ Settings: the same on every floor.
 */
export interface PromptsState {
  /** Prompts someone rewrote, by id; the rest are the defaults. */
  custom: Partial<Record<PromptId, { text: string; by: string; at: number }>>;
  /**
   * What a worker starts on unless whoever starts it picks another. Unset: the agent the office was
   * started with (--agent), on its own default model.
   */
  agent?: AgentChoice & { by: string; at: number };
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
  /** Model requested for this worker, instead of the office's configured default: an OpenCode provider/model id, or a Claude model alias. */
  model?: string;
  /** Reasoning effort requested for this worker, when one was chosen (Claude only). */
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

/** Every token a session used, cache reads and writes included: what the office shows and budgets meetings by. */
export function tokensOf(u: Usage): number {
  return u.totalTokens ?? u.input + u.output + (u.reasoning ?? 0) + u.cacheWrite + u.cacheRead;
}

/** e.g. 950, 12k, 1.25M */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(n < 10e6 ? 2 : 1)}M`;
}

export function fmtCost(usd: number): string {
  if (usd > 0 && usd < 0.005) return '<$0.01';
  return `$${usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

/** One of the Claude plan's usage windows: the 5-hour session, the week, or a model's week. */
export interface PlanWindow {
  /** e.g. "5h session", "Week", "Fable week". */
  label: string;
  /** Percent of the window used, 0-100. */
  pct: number;
  /** When it starts over (ms since epoch), when known. */
  resetsAt?: number;
}

/**
 * The Claude plan limits of the account the office's Claude workers run on, as Claude Code's
 * /usage shows them (see server/limits.ts). One account for the whole building.
 */
export interface PlanLimits {
  /** 'pro', 'max', 'team', 'enterprise'…, when known. */
  plan?: string;
  /** The 5-hour session first, then the week, then per-model weeks. Empty until first read, or when there is no plan. */
  windows: PlanWindow[];
  /** When the numbers were read (ms since epoch); 0 before the first read. */
  at: number;
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

/** The issue on a card someone carries around the floor (see PeerInfo.carrying). */
export interface CarriedIssue {
  issue: number;
  title: string;
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
  /** On a smoke break, cigarette in hand. */
  smoking?: boolean;
  /** At the golf tee on the balcony, club in hand. */
  golfing?: boolean;
  /** Sitting down: the place they're in (see seatAt in layout), like "couch:1". */
  seat?: string;
  /** An issue card they took off the issues board, on its way to a desk or the queue. */
  carrying?: CarriedIssue;
  /** A drink from the rooftop bar in their hand. */
  drink?: DrinkId;
  /** Signed in with their own account, so `name` is theirs and nobody else can take it. */
  account?: boolean;
  /** The floor they're on (see FloorInfo); none while the building has no floors yet. */
  floor?: string;
  /** What they have open, in their own words: "in Pixel's terminal", "reading PR #12". */
  doing?: string;
  /** Reading something off the bookshelf: an open book in their hands, its pages turning. */
  reading?: boolean;
}

/** A styled run of text on a terminal row: [text, fg, bg, flags]. */
export type Run = [string, number, number, number];
/** Color encoding: -1 default, 0..255 palette, >= 0x1000000 means 0x1000000 | rgb. */
export const RGB_FLAG = 0x1000000;
export const FLAG_BOLD = 1;
export const FLAG_INVERSE = 2;
export const FLAG_DIM = 4;

/** A GitHub label; `color` is a CSS color ("#d73a4a"). */
export interface GhLabel {
  name: string;
  color: string;
  /** What it's for, in the repo's list of labels (the label picker's /api/gh/labels). */
  description?: string;
}

export interface GhIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  author: string;
  labels: GhLabel[];
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
  labels: GhLabel[];
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
  /** Model requested for this task, instead of the office's configured default: an OpenCode provider/model id, or a Claude model alias. */
  model?: string;
  /** Reasoning effort requested for this task, when one was chosen (Claude only). */
  effort?: AgentEffort;
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

/** How the workers at the meeting table work together (see shared/meetings.ts). */
export type MeetingPattern = 'debate' | 'lead' | 'mapreduce' | 'redblue' | 'review';

/** A worker's place at a meeting. */
export interface MeetingSeat {
  /** Its part in the meeting, e.g. "Skeptic", "Red team" or "Security". */
  role: string;
  /** Its chair (see MEETING_SEATS in layout). */
  deskId: string;
  workerId?: string;
  workerName?: string;
  /** What its worker has used, kept after it goes home. `cost` is missing when its provider doesn't say. */
  tokens?: number;
  cost?: number;
}

/** One worker's part in a round: what it's doing, and the file that says it has done it. */
export interface MeetingTurn {
  /** Which of the meeting's seats. */
  seat: number;
  /** e.g. "proposing", "critiquing", "writing the decision". */
  doing: string;
  /** Relative to the meeting's checkout. */
  file: string;
  /** waiting: not handed over yet; sent: handed over, not started on; working: on it; done: its file is written. */
  state: 'waiting' | 'sent' | 'working' | 'done';
  sentAt?: number;
  /** It was reminded once already: it ended its turn without writing the file, or never started. */
  retried?: boolean;
}

export type MeetingStatus = 'running' | 'done' | 'stopped';

/**
 * A meeting in the meeting room: 2–5 workers on one question or task, in rounds, following a pattern.
 * It ends when its output file is written, or stops at its round limit or token budget and says why.
 */
export interface Meeting {
  id: string;
  pattern: MeetingPattern;
  title: string;
  /** The question or task, as whoever called the meeting put it. */
  prompt: string;
  /** The file the meeting writes, relative to its checkout, declared up front. */
  output: string;
  /** The head of the table first. */
  seats: MeetingSeat[];
  /** Map-reduce: what the task runs over, a part per line. */
  parts?: string[];
  /** Review panel: the pull request under review. */
  pr?: number;
  /** The GitHub issue it's about, when it was called from one. */
  issue?: number;
  provider?: AgentProvider;
  model?: string;
  effort?: AgentEffort;
  /** The round limit. */
  rounds: number;
  /** The round it's on (from 1), and the step within it (red / blue take turns inside a round). */
  round: number;
  step: number;
  /** Red / blue: the red team found nothing more in this round, so it's the last. */
  lastRound?: number;
  /** The current step's parts. */
  turns: MeetingTurn[];
  /** Tokens every worker in the meeting may use between them, and how many they have. */
  budget: number;
  tokens: number;
  /** USD, where the providers report it. */
  cost: number;
  /** False when a worker's provider reports no cost, so `cost` leaves it out. */
  costKnown: boolean;
  status: MeetingStatus;
  /** Why it stopped short. */
  reason?: string;
  calledBy: string;
  startedAt: number;
  finishedAt?: number;
  /** The meeting's own git worktree, relative to the project, which everyone at the table shares. */
  worktree?: { path: string; branch: string; base: string; from?: string };
  /** Where the round notes go, relative to the checkout. */
  notes: string;
  /** The commit on the meeting's branch that holds the output. */
  commit?: string;
  /** Review panel: the review the office posted on the pull request, or why it couldn't. */
  review?: { url?: string; error?: string };
  /** The start of the output file as it gets written, for the board in the room. */
  preview?: string;
  /** Its workers have gone home and its worktree was tidied away. */
  cleared?: boolean;
}

/** A meeting that's over, in a line. */
export interface MeetingRecord {
  id: string;
  pattern: MeetingPattern;
  title: string;
  status: MeetingStatus;
  /** The line on the room's door: pattern, rounds, tokens, cost, and the output (or why it stopped). */
  summary: string;
  calledBy: string;
  finishedAt: number;
  branch?: string;
  output: string;
}

export interface MeetingState {
  /** The meeting in the room: the one running, or the last one until the room is cleared or the next is called. */
  current: Meeting | null;
  /** Earlier meetings on the floor, newest first. */
  past: MeetingRecord[];
}

/** What calling a meeting asks for (see shared/meetings.ts for each pattern's defaults and limits). */
export interface MeetingRequest {
  pattern: MeetingPattern;
  prompt: string;
  title?: string;
  /** The output file, relative to the checkout; the pattern's default when missing. */
  output?: string;
  /** A role per worker, the head of the table first. */
  roles: string[];
  parts?: string[];
  pr?: number;
  issue?: number;
  rounds?: number;
  budget?: number;
  provider?: AgentProvider;
  model?: string;
  effort?: AgentEffort;
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

/**
 * The office's machine (see server/machine.ts): how busy it is, for the wall monitor and a warning
 * before hiring, and the most workers the office runs at once, across every floor.
 */
export interface MachineState {
  /** Percent of every core busy, 0-100, over the last few seconds. */
  cpu: number;
  cores: number;
  /** Memory in use and in all, bytes. */
  memUsed: number;
  memTotal: number;
  /** The last few minutes, oldest first: [cpu %, memory %] a few seconds apart. */
  history: [number, number][];
  /** What makes another worker a strain right now, e.g. "memory is 93% used"; missing when nothing does. */
  pressure?: string;
  /** Workers in the office now: every floor's, shells and board agents too. */
  workers: number;
  /** The most workers the office takes; missing when there's no limit. */
  limit?: number;
  /** --max-workers: the limit can't be set any higher from the office. */
  ceiling?: number;
  /** The limit someone set in ⚙️ Settings, when there is one. */
  set?: { limit: number; by: string; at: number };
}

export interface GhState<T> {
  items: T[];
  error?: string;
  fetchedAt: number;
  loading: boolean;
}

export type GhMergeMethod = 'squash' | 'merge' | 'rebase';

/** Why an issue was closed, as GitHub records it. */
export type GhCloseReason = 'completed' | 'not planned';

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
  /** Who gh is signed in as on the server, and so who comments from the office appear from ('' if unknown). */
  viewer: string;
}

/** GET /api/gh/issue?number=N */
export interface GhIssueDetail {
  number: number;
  /** OPEN or CLOSED. */
  state: string;
  body: string;
  comments: GhComment[];
  /** See GhPullDetail.viewer. */
  viewer: string;
}

/** GitHub turns away comments longer than this. */
export const GH_COMMENT_MAX = 65536;
/** Longer than any label name: GitHub stops at 50 characters, and JS counts an emoji as two. */
export const GH_LABEL_MAX = 100;

export interface ProjectInfo {
  name: string;
  dir: string;
  branch?: string;
  remote?: string;
  agentCmd: string;
  defaultProvider: AgentProvider;
  agentProviders: AgentProvider[];
}

/**
 * One floor of the building: a project in its own checkout, with its own desks, workers, boards
 * and queue. You go between them in the elevator.
 */
export interface FloorInfo {
  id: string;
  /** The repository's name, or the folder's when it isn't on GitHub. */
  name: string;
  /** owner/name on GitHub. */
  repo?: string;
  /** Its checkout on the office's machine. */
  dir: string;
  /** Which of FLOOR_PALETTES it's painted in. */
  palette: number;
  /** Being cloned: on the elevator panel, but nobody can go there yet. */
  cloning?: boolean;
  /** The project the office was started in (`agent-office <dir>`), which keeps its data: always a floor. */
  local?: boolean;
  addedBy: string;
  addedAt: number;
  /**
   * For the elevator panel: who's there and what they're up to. `workers` counts the ones hired onto
   * desks, bean bags and the meeting room's table, not the board agents at their kiosks.
   */
  workers: number;
  busy: number;
  /** Workers waiting on someone: a question, a permission, or a finished turn nobody looked at. */
  waiting: number;
  people: number;
}

/** Where the elevator's "add a project" clones to: <dir>/<owner>/<repo> on the office's machine. */
export interface ProjectsDirState {
  /** For showing people: under the home folder it's ~/…. */
  dir: string;
  /** Set from ⚙️ Settings or --projects, rather than the office's default. */
  custom: boolean;
  by?: string;
  at?: number;
}

/** A repository the office's `gh` login can clone, for the elevator's "add a project". */
export interface RepoChoice {
  /** owner/name */
  name: string;
  description?: string;
  private: boolean;
  /** ISO time of the last push. */
  pushedAt?: string;
}

/** Everything that belongs to the floor you're on: sent when you walk in, and when you change floors. */
export interface FloorView {
  /** The floor you're on; null while the building has none. */
  floor: string | null;
  project: ProjectInfo | null;
  workers: WorkerInfo[];
  issues: GhState<GhIssue>;
  pulls: GhState<GhPull>;
  queue: QueueState;
  /** Pictures on this floor's walls. */
  decor: Decoration[];
  services: ServicesState;
  /** The floor's dog; null in a building with no floors yet. */
  dog: DogState | null;
  /** What the lounge jukebox is playing. */
  jukebox: JukeboxState;
  /** Who's at the arcade cabinet, what's on its screen, and the building's high scores. */
  cabinet: CabinetView;
  /** What's drawn on this floor's whiteboard, and who's drawing. */
  whiteboard: WhiteboardView;
  /** The meeting room: who's meeting about what, and the meetings before. */
  meeting: MeetingState;
  /** The basketball by the hoop: who has it, or how it was last thrown. */
  ball: BallState;
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
  /** Its working directory relative to its floor's checkout ('' is the project root). */
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

/** Changed files the Changes window can show as a picture (GET /api/changes/file), by extension. */
const CHANGED_IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

/** The content type of a changed picture, or undefined when the file isn't one. */
export function changedImageType(filePath: string): string | undefined {
  const name = filePath.slice(filePath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return undefined;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(CHANGED_IMAGE_TYPES, ext) ? CHANGED_IMAGE_TYPES[ext] : undefined;
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

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'fog';
export const WEATHERS: readonly Weather[] = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'];

/** What it's like outside the windows. The server decides it, so everyone sees the same sky. */
export interface SkyState {
  /** Where the office is, for the sun: a configured city, or a guess from the host's time zone. */
  lat: number;
  lon: number;
  /** The office's clock, in minutes east of UTC. */
  utcOffset: number;
  weather: Weather;
  /** 0–1: a drizzle to a downpour, a few flakes to a blizzard, haze to pea soup. */
  intensity: number;
  /** The city whose live forecast this is. Unset when the weather is made up or pinned. */
  city?: string;
  /** °C, from the forecast. */
  temp?: number;
}

/** A holiday the whole building dresses up for (see shared/theme.ts). */
export type Theme = 'halloween' | 'christmas';
/** What someone picked in ⚙️ Settings: a holiday, none, or whichever the calendar says. */
export type ThemePick = Theme | 'auto' | 'off';

/** The building's holiday theme: the same on every floor, for everyone. */
export interface ThemeState {
  pick: ThemePick;
  /** What's up right now: the pick, or for 'auto' the holiday it is at the office. Null for none. */
  active: Theme | null;
  /** Who picked it, and when. Unset for the default (auto). */
  by?: string;
  at?: number;
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

/** Why the gong rang. */
export type GongWhy = 'hit' | 'merged' | 'queue';

export type ClientMsg =
  | { t: 'move'; x: number; y: number; z: number; rotY: number; moving: boolean }
  /**
   * You reached out to use something; everyone else sees your character's arm do it. With `smoke`,
   * you lit a cigarette (or put it out) on the balcony instead; with `golf`, you took a club out at
   * the tee (or put it back); with `drink`, you took a drink from the rooftop bar (or finished it, null).
   */
  | { t: 'act'; smoke?: boolean; golf?: boolean; drink?: DrinkId | null }
  /**
   * You hit a golf ball off the tee: its heading (0 is south, toward +x from there), loft (radians)
   * and power (0–1). Everyone on your floor works out where it goes the same way (world/golf.ts fly).
   */
  | { t: 'golf'; yaw: number; loft: number; power: number }
  /** You sat down in a place on a couch, a beanbag, a chair or the bench (see seatAt in layout), or got up again (no seat). */
  | { t: 'sit'; seat?: string }
  /** You picked an issue card up off the board (or put it down again, no issue): everyone sees it in your hands. */
  | { t: 'carry'; issue?: number; title?: string }
  /** An emote (hold G, or 1–6): everyone else on your floor sees your character do it. Rate limited, see EmoteBucket. */
  | { t: 'emote'; emote: EmoteId }
  | { t: 'profile'; name: string; color: string; look: Look }
  /** With `issue`, the worker is there for that GitHub issue: it's assigned on GitHub (so it moves to In progress) and taken off the queue. */
  | { t: 'worker.spawn'; deskId: string; prompt?: string; worktree?: boolean; kind?: WorkerKind; provider?: AgentProvider; model?: string; effort?: AgentEffort; issue?: number }
  | { t: 'worker.resume'; workerId: string }
  | { t: 'worker.kill'; workerId: string; cleanup?: WorktreeCleanup }
  /** Asks what the worker's worktree holds; answered with a `worker.worktree` message. */
  | { t: 'worker.worktree'; workerId: string }
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
  | { t: 'term.resize'; workerId: string; cols: number; rows: number }
  /** What you have open now (see PeerInfo.doing and PeerInfo.reading); none when you're back in the office. */
  | { t: 'doing'; what?: string; reading?: boolean }
  | { t: 'gh.refresh' }
  /** Merge a pull request; the answer comes back as gh.merged. */
  | { t: 'gh.merge'; number: number; method: GhMergeMethod; deleteBranch: boolean; auto?: boolean }
  /** Comment on an issue or a PR's conversation, as the server's gh account; answered with gh.commented. */
  | { t: 'gh.comment'; kind: 'issue' | 'pull'; number: number; body: string }
  /** Hit the office gong (E at the gong); everyone on the floor hears it. */
  | { t: 'gong' }
  /** Blow the DJ's air horn on the roof; everyone up there hears it. */
  | { t: 'horn' }
  /** Close an issue, or a pull request without merging it; the answer comes back as gh.closed. */
  | { t: 'gh.close'; kind: 'issue' | 'pull'; number: number; comment?: string; reason?: GhCloseReason; deleteBranch?: boolean }
  /** Put labels on an issue or PR and take others off, as the server's gh account; answered with gh.labeled. */
  | { t: 'gh.labels'; kind: 'issue' | 'pull'; number: number; add: string[]; remove: string[] }
  | { t: 'queue.add'; prompt: string; title?: string; issue?: number; provider?: AgentProvider; model?: string; effort?: AgentEffort }
  | { t: 'queue.remove'; taskId: string }
  /** Move a queued task up (-1) or down (+1) the queue. */
  | { t: 'queue.move'; taskId: string; delta: number }
  /** Put a finished task back on the queue. */
  | { t: 'queue.retry'; taskId: string }
  /** Forget the finished tasks. */
  | { t: 'queue.clear' }
  | { t: 'queue.limit'; maxWorkers: number }
  /** Call a meeting: workers sit down round the meeting room's table and work through it in rounds. */
  | ({ t: 'meeting.start' } & MeetingRequest)
  /** Stop the meeting that's running; its workers stay at the table. */
  | { t: 'meeting.stop' }
  /** Send the last meeting's workers home and clear the table. */
  | { t: 'meeting.clear' }
  /** Set the office's Slack / Discord webhook; '' removes it. */
  | { t: 'notify.webhook'; url: string }
  /** Post a test message through the webhook; the outcome comes back as a toast. */
  | { t: 'notify.test' }
  /** Admins: the most workers the office runs at once, across every floor; null takes the limit off. */
  | { t: 'machine.limit'; limit: number | null }
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
  /** Read the Claude plan limits again now, instead of at the next poll. */
  | { t: 'limits.refresh' }
  /** Hang a picture on a wall. */
  | { t: 'decor.add'; decor: DecorPlacement }
  /** Move, resize, re-frame or swap the image of a picture. */
  | { t: 'decor.update'; id: string; decor: Partial<DecorPlacement> }
  | { t: 'decor.remove'; id: string }
  /** Put a tune on the jukebox (a JUKEBOX_TUNES id), or a stream; with neither, turn it back on. */
  | { t: 'jukebox.play'; track?: string; url?: string }
  /** On to the next tune. */
  | { t: 'jukebox.skip' }
  | { t: 'jukebox.stop' }
  /**
   * Step up to the arcade cabinet on your floor to carry on with `game` (one the office started for
   * you), or to start a new game, even while you're at it; the office answers with `cabinet`, naming
   * who got it and their game.
   */
  | { t: 'cabinet.play'; game?: string }
  | { t: 'cabinet.leave' }
  /**
   * Your game as it looks now, for everyone else on the floor to watch over your shoulder. It's also
   * how your score gets on the high-score table: the office follows the game frame by frame.
   */
  | { t: 'cabinet.frame'; frame: CabinetFrame }
  /** You opened the whiteboard (or closed it): everyone on the floor sees who's drawing. */
  | { t: 'wb.open' }
  | { t: 'wb.close' }
  /** Elements you added or changed on the whiteboard; pictures go first, by POST /api/whiteboard/file. */
  | { t: 'wb.update'; elements: WbElement[] }
  /** Where your mouse is on the whiteboard, and what you have selected there. */
  | ({ t: 'wb.pointer'; selected?: string[] } & WbPointer)
  /**
   * Go to another floor; the server answers with `floor.enter`. By elevator you arrive in the car;
   * `at` is where you arrive instead: the same spot on the other floor (switching floors from the
   * floor list), or the ladder or fire pole you came by.
   */
  | { t: 'floor.go'; floor: string; at?: { x: number; y: number; z: number; rotY: number } }
  /** The repositories that could become a floor; answered with `floor.repos`. */
  | { t: 'floor.repos'; refresh?: boolean }
  /** Clone a repository and make it a new floor; answered with `floor.added` once it's there. */
  | { t: 'floor.add'; repo: string }
  /** Take a floor off the building (admins only). Its checkout stays on disk; everyone on it rides to another floor. */
  | { t: 'floor.remove'; floor: string }
  /** Dress the building up for a holiday, take the decorations down ('off'), or follow the calendar ('auto'). */
  | { t: 'theme.set'; pick: ThemePick }
  /** Where new floors are cloned from now on (admins only); '' goes back to the default. */
  | { t: 'floor.projectsDir'; dir: string }
  /** Rewrite one of the office's prompts (admins only); null puts the default back. */
  | { t: 'prompts.set'; id: PromptId; text: string | null }
  /** Pick the worker everyone starts on (admins only); null goes back to the office's --agent. */
  | { t: 'prompts.agent'; choice: AgentChoice | null }
  /** Pick up the floor's basketball (or catch it): yours if nobody else has it. */
  | { t: 'ball.take' }
  /** Throw the basketball in your hands from (x, y, z) at (vx, vy, vz) m/s, or drop it; everyone on the floor sees it fly. */
  | { t: 'ball.throw'; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  /** Give the dog on your floor a pat; it has to be within reach. */
  | { t: 'dog.pet' }
  /** Name the dog on your floor ('' gives it back its first name). */
  | { t: 'dog.name'; name: string }
  | { t: 'ping'; at: number };

export type ServerMsg =
  | ({
      t: 'welcome';
      you: string;
      peers: PeerInfo[];
      /** Every floor of the building, for the elevator. */
      floors: FloorInfo[];
      /** Where new projects are cloned to, on the office's machine. */
      projectsDir: ProjectsDirState;
      ice: { urls: string | string[]; username?: string; credential?: string }[];
      chat: ChatLine[];
      /** Whether teammates can be invited from the office (see TeamState). */
      invites: boolean;
      /** The running server's version; a change after a reconnect means the office was upgraded. */
      version: string;
      upgrade: UpgradeState;
      usage: UsageState;
      limits: PlanLimits;
      me: Me;
      notify: NotifyState;
      machine: MachineState;
      /** Outside the windows: the same on every floor. */
      sky: SkyState;
      /** Halloween or Christmas decorations, all over the building, or none. */
      theme: ThemeState;
      /** The office's prompts and the worker everyone starts on. */
      prompts: PromptsState;
    } & FloorView)
  /** You arrived on another floor: everything on it, replacing the last one's, and where everyone is now. */
  | ({ t: 'floor.enter'; peers: PeerInfo[] } & FloorView)
  | { t: 'floors'; floors: FloorInfo[] }
  /** Sent to whoever asked. */
  | { t: 'floor.repos'; repos: RepoChoice[]; error?: string }
  /** Sent to whoever asked for the floor, once it's cloned (or couldn't be). */
  | { t: 'floor.added'; repo: string; floor?: string; error?: string }
  /** The projects folder moved (see floor.projectsDir). */
  | { t: 'projectsDir'; state: ProjectsDirState }
  | { t: 'peer.join'; peer: PeerInfo }
  | { t: 'peer.update'; peer: PeerInfo }
  | { t: 'peer.move'; id: string; x: number; y: number; z: number; rotY: number; moving: boolean }
  | { t: 'peer.leave'; id: string }
  | { t: 'peer.act'; id: string; smoke?: boolean; golf?: boolean; drink?: DrinkId | null }
  /** Someone on your floor hit a golf ball off the tee (see the client's 'golf'). */
  | { t: 'golf'; id: string; yaw: number; loft: number; power: number }
  | { t: 'peer.emote'; id: string; emote: EmoteId }
  | { t: 'worker.update'; worker: WorkerInfo }
  | { t: 'worker.remove'; workerId: string }
  | { t: 'worker.worktree'; workerId: string; state: WorktreeState }
  | { t: 'screen'; workerId: string; cols: number; rows: number; lines: Record<number, Run[]>; full: boolean; cursor: [number, number] }
  | { t: 'term.snapshot'; workerId: string; data: string; cols: number; rows: number }
  | { t: 'term.data'; workerId: string; data: string }
  /** Someone else in that terminal (`id`, a PeerInfo id) is typing; only its other viewers get these. */
  | { t: 'term.typing'; workerId: string; id: string }
  | { t: 'gh.issues'; state: GhState<GhIssue> }
  | { t: 'gh.pulls'; state: GhState<GhPull> }
  /** Sent to whoever asked for the merge. */
  | { t: 'gh.merged'; number: number; error?: string }
  /** Sent to whoever commented: the comment as GitHub saved it, or why it wasn't. */
  | { t: 'gh.commented'; kind: 'issue' | 'pull'; number: number; comment?: GhComment; error?: string }
  /**
   * The gong rings, for everyone on the floor: someone hit it, pull request `pr` merged (confetti
   * over the desk it came from), or the last task on the queue just finished (a bigger party).
   */
  | { t: 'gong'; why: GongWhy; by?: string; pr?: number }
  /** Someone on the roof blew the DJ's air horn (sent to everyone up there, them too). */
  | { t: 'horn'; by: string }
  /** Sent to whoever asked to close it. */
  | { t: 'gh.closed'; kind: 'issue' | 'pull'; number: number; error?: string }
  /** Sent to whoever changed them: the labels it has now, or why they didn't change. */
  | { t: 'gh.labeled'; kind: 'issue' | 'pull'; number: number; labels?: GhLabel[]; error?: string }
  | { t: 'rtc'; from: string; data: unknown }
  | ({ t: 'chat' } & ChatLine)
  | { t: 'toast'; text: string; level: 'info' | 'warn' | 'error' }
  | { t: 'team'; state: TeamState }
  | { t: 'upgrade'; state: UpgradeState }
  | { t: 'services'; state: ServicesState }
  | { t: 'decor'; items: Decoration[] }
  /** What the dog on your floor is up to now: sent at the start of each leg of its day. */
  | { t: 'dog'; dog: DogState }
  /** The basketball on your floor was picked up, thrown, or put back under the hoop. */
  | { t: 'ball'; ball: BallState }
  | { t: 'jukebox'; state: JukeboxState }
  /** Who's at the arcade cabinet on your floor now, and the building's high scores. */
  | { t: 'cabinet'; state: CabinetState }
  /** The game on your floor's cabinet, as its player sees it (sent to everyone else on the floor). */
  | { t: 'cabinet.frame'; frame: CabinetFrame }
  /** Someone changed these elements on the floor's whiteboard (sent to everyone else on the floor). */
  | { t: 'wb.update'; elements: WbElement[] }
  /** Who has the floor's whiteboard open now. */
  | { t: 'wb.people'; people: string[] }
  /** Someone's mouse on the whiteboard; only people who have it open get these. */
  | ({ t: 'wb.pointer'; id: string; selected?: string[] } & WbPointer)
  | { t: 'usage'; state: UsageState }
  | { t: 'limits'; state: PlanLimits }
  | { t: 'queue'; state: QueueState }
  | { t: 'meeting'; state: MeetingState }
  | { t: 'notify'; state: NotifyState }
  | { t: 'machine'; state: MachineState }
  | { t: 'sky'; state: SkyState }
  | { t: 'theme'; state: ThemeState }
  | { t: 'prompts'; state: PromptsState }
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
  /** `now` is the office's clock as it answered, which the jukebox keeps time by. */
  | { t: 'pong'; at: number; now: number };
