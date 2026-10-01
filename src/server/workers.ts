import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, accessSync, chmodSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, constants } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CodexUsageReader } from './codex-usage.js';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import { safeEq } from './secrets.js';
import type { AgentChoice, AgentEffort, AgentProvider, ForgeKind, Run, TerminalHit, WorkerInfo, WorkerKind, WorkerRepo, WorkerStatus, WorkerTask } from '../shared/protocol.js';
import { FAILS_TO_DESPAIR, outputFailed, toolAction } from '../shared/actions.js';
import { FLAG_BOLD, FLAG_DIM, FLAG_INVERSE, RGB_FLAG, isAgentEffort, isClaudeModel } from '../shared/protocol.js';
import { WORKSPACE_FILES, WORKTREES_DIR, Worktrees, describeWork, workspaceOf, type WorktreeCleanup, type WorktreeRef, type WorktreeState } from './worktrees.js';
import { DESK_BY_ID, STATION_AGENT, deskBuilt, type DeskDef } from '../shared/layout.js';
import { FINDING_LINES, helperDesk, helperId, isHelperId, plainText } from '../shared/helper.js';
import { QUEUE_AGENT_DISALLOWED_TOOLS, stationBrief } from './stations.js';
import { officePrompt, type PromptSource } from './prompts.js';
import { isBusy } from '../shared/status.js';
import { findPull, forgeOfDir, openPull, originRepo, prRef, pullBody, setPullBody, workRepo } from './forge.js';
import type { ForgeAs } from './signins.js';
import type { ServiceOwner } from './services.js';
import { TaskNamer, fallbackTask } from './tasks.js';
import { addUsage, newTracker, restoreTracker, scanTracker, trackerUsage, zeroUsage, type Ledger, type UsageTracker } from './usage.js';
import { PtyHost, SCROLLBACK, type Adopted, type Pty } from './ptys.js';
import { codexHookArgs, normalizeCodexHook, writeCodexHook } from './codex.js';
import { normalizeGrokHook, withoutGrokLaunchArgs, writeGrokHome } from './grok.js';
import { normalizeMuseHook, withoutMuseLaunchArgs, writeMuseHome } from './muse.js';
import { reportedUsage } from './reported-usage.js';
import { configuredProvider, isValidDshModel, isValidGrokModel, isValidMuseModel, isValidOpenCodeModel, validateWorkerEffort, validateWorkerModel } from './agents.js';
import { mergeOpenCodeConfigContent, openCodePluginSpecifier, writeOpenCodePlugin, type OpenCodeStatusEvent } from './opencode.js';
import { MCP_READ_ONLY, codexMcpArgs, openCodeMcp, writeClaudeMcpConfig } from './office-workers.js';
import { ScrollbackStore, searchTerminal, terminalTail } from './history.js';
import { DSH_PROFILE_DEFAULT, DshSession, dshArgs, terminalSafe, writeDshPatch } from './dsh.js';
import { DropStore } from './drops.js';
import { screenSnapshot } from './screen.js';
import type { Capacity } from './machine.js';

type HeadlessTerminal = InstanceType<typeof headless.Terminal>;
type Worktree = NonNullable<WorkerInfo['worktree']>;

const NAMES = [
  'Pixel', 'Byte', 'Nibble', 'Sprocket', 'Widget', 'Gizmo', 'Bolt', 'Cosmo', 'Dot', 'Echo',
  'Fizz', 'Glitch', 'Hopper', 'Jinx', 'Kilo', 'Lumen', 'Mochi', 'Noodle', 'Orbit', 'Pip',
  'Quark', 'Rivet', 'Sparky', 'Tofu', 'Uno', 'Volt', 'Waffle', 'Zippy',
];
const COLORS = ['#ff8a5b', '#5bc0eb', '#9bc53d', '#fde74c', '#c3423f', '#b388eb', '#f7aef8', '#72ddf7', '#ffb400', '#00a6a6'];

// Env vars from a parent agent session (e.g. starting the office from inside Claude Code) that
// would make a worker think it is a child session — that silently turns off transcript saving,
// which breaks resume.
const SCRUB_ENV = new Set([
  'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_PID', 'CLAUDE_EFFORT',
  'CODEX_THREAD_ID', 'CODEX_INTERNAL_ORIGINATOR_OVERRIDE',
  'GROK_SESSION_ID', 'GROK_AGENT_ID', 'GROK_HOOK_EVENT', 'GROK_HOOK_NAME', 'GROK_WORKSPACE_ROOT',
  'GROK_PLUGIN_ROOT', 'GROK_PLUGIN_DATA', 'GROK_AUTH', 'GROK_AUTH_PATH',
  'MUSE_BIN', 'MUSE_AGENTS_THREAD', 'MUSE_AGENTS_ROLE', 'MUSE_PROJECTS_HOME',
  'NO_COLOR', 'FORCE_COLOR', 'VSCODE_INJECTION', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION',
]);
const SCRUB_PREFIXES = ['CLAUDE_CODE_SESSION', 'CLAUDE_CODE_CHILD', 'CLAUDE_CODE_MESSAGING', 'NEBULA_', 'AGENT_OFFICE_'];
const scrubbed = (k: string) => SCRUB_ENV.has(k) || SCRUB_PREFIXES.some((p) => k.startsWith(p));

const SCREEN_INTERVAL_MS = 250;
/** What a worker with a live terminal can be doing. */
const RUNNING = new Set<unknown>(['starting', 'idle', 'working', 'done', 'needs_input'] satisfies WorkerStatus[]);
const LATE_PROMPT_GRACE_MS = 5000;
const KEYFRAME_MS = 8000;
/** How often a steady typist's "last typed" time is refreshed for everyone. */
const TYPED_REFRESH_MS = 15_000;
/** How many of a worker's latest prompts and tool calls the task namer sees. */
const TASK_PROMPTS = 5;
const TASK_TOOLS = 10;
/** While a worker works, refresh its task summary after this many tool calls, at most this often. */
const TASK_REFRESH_TOOLS = 8;
const TASK_REFRESH_MS = 90_000;
const PR_TITLE_MAX = 72;
const PR_TASK_MAX = 2500;
/** The most other repositories one worker can take on (see WorkerInfo.repos). */
export const MAX_REPOS = 8;
/** Around the list of a change's pull requests in each of their descriptions, so it can be brought up to date. */
const RELATED_START = '<!-- agent-office:related -->';
const RELATED_END = '<!-- /agent-office:related -->';
/**
 * A hook finding the office restarting (its workers keep running through that) retries, once a
 * second, this many times in all: long enough for a dev-server reload.
 */
const HOOK_TRIES = 6;
/** How often every worker's transcript is checked for new spend, on top of the hook-driven checks. */
const USAGE_SCAN_MS = 10_000;
/** How often a terminal with new output is saved to disk, so even a crash loses at most this much. */
const SAVE_SCROLLBACK_MS = 15_000;
/** Between a worker's saved scrollback and what it prints after the office restarted. */
const RESTORED_NOTE = '\x1b[2m──── the office restarted · earlier output above ────\x1b[0m\r\n';
/**
 * What a worker whose terminal didn't make it through a restart (the machine rebooted, the terminal
 * host was replaced or died) is resumed with when it was in the middle of something, so it carries on
 * by itself instead of waiting at every desk for someone to type "continue".
 */
export const CARRY_ON_PROMPT = 'continue — the office restarted and interrupted you. Pick up where you left off; if you were waiting on an answer or a permission, ask again.';

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

interface Worker {
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
  /** OpenCode errors keep the desk visibly actionable until a new turn starts. */
  openCodeError?: boolean;
  codexUsage: CodexUsageReader;
  codexHome?: string;
  codexTranscript?: string;
  codexTools: Map<string, string>;
  codexPending: Set<string>;
  codexPermissionUnknown?: boolean;
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
  /** Muse resume cannot take a prompt on argv; paste this into the TUI after SessionStart. */
  pendingPrompt?: string;
  /** Output since its scrollback was last saved to disk. */
  unsaved?: boolean;
  /**
   * When its terminal last produced output. The one sign of work every provider gives, even the
   * ones that never report a status (see WorkerManager.activeSince).
   */
  outputAt?: number;
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

export class WorkerManager {
  private workers = new Map<string, Worker>();
  private statePath: string;
  private settingsPath: string;
  private trees: Worktrees;
  private agentPath: string | null = null;
  readonly defaultProvider: AgentProvider;
  private openCodePlugin: string;
  private codexHook: string;
  private grokHome: string;
  private grokSocket: string;
  private grokAuthPath?: string;
  private museConfigHome: string;
  private museDataHome: string;
  private museStateHome: string;
  /** Where the office-queue and office-workers commands are, for the workers' PATH (see writeOfficeCommands). */
  private officeBin: string | undefined;
  /** bin/office-workers.js, which is also the office's MCP server for the agents that take one. */
  private mcpScript: string | undefined;
  /** Claude Code's --mcp-config file for it. */
  private claudeMcp: string | undefined;
  private screenTimer: NodeJS.Timeout;
  /** The office is shutting down: workers exiting now are being stopped, not failing to resume. */
  private closing = false;
  /** Closing for good (Ctrl+C), not restarting: whatever the workers were doing is stopped on purpose. */
  private stopping = false;
  private namer: TaskNamer;
  private usageTimer: NodeJS.Timeout;
  /** Runs the workers' terminals outside the office, so they outlive a restart of it (see ptys.ts). */
  private host: PtyHost;
  /** Each worker's terminal on disk, so a restart doesn't wipe it (see history.ts). */
  private scrollback: ScrollbackStore;
  private drops: DropStore;
  private saveTimer: NodeJS.Timeout;
  /** How many rows the floor's back office is built out: its desks past that aren't there to hire at (see WING). */
  wing: () => number = () => 0;
  /** Where this floor's code is hosted, from its origin (see forge.ts). Set by the floor. */
  forge: ForgeKind = 'github';

  constructor(
    private dir: string,
    private dataDir: string,
    private agentCmd: string,
    private agentArgs: string[],
    private hook: HookEnv,
    private events: WorkerEvents,
    private ledger: Ledger,
    /** The office's worker limit, across every floor (see machine.ts). */
    private capacity?: Capacity,
    /** The office's prompts and the worker everyone starts on, as set in ⚙️ Settings (see prompts.ts). */
    private prompts?: PromptSource,
    /** Everyone's own sign-ins, for workers hired by an account. */
    private runAs?: RunAs,
    /** The DSH profile a DeepSeek Harness worker boots (default "acp"). */
    private dshProfile: string = DSH_PROFILE_DEFAULT,
  ) {
    this.defaultProvider = configuredProvider(agentCmd);
    this.trees = new Worktrees(dir);
    this.statePath = path.join(dataDir, 'workers.json');
    this.settingsPath = path.join(dataDir, 'claude-hooks.json');
    this.writeHookSettings();
    this.openCodePlugin = writeOpenCodePlugin(dataDir);
    this.codexHook = writeCodexHook(dataDir);
    const grok = writeGrokHome(dataDir);
    this.grokHome = grok.home;
    this.grokSocket = grok.socket;
    const userGrok = process.env.GROK_HOME || path.join(homedir(), '.grok');
    const auth = path.join(userGrok, 'auth.json');
    this.grokAuthPath = existsSync(auth) ? auth : undefined;
    const userMuse = path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'muse');
    const muse = writeMuseHome(dataDir, existsSync(userMuse) ? userMuse : undefined);
    this.museConfigHome = muse.configHome;
    this.museDataHome = muse.dataHome;
    this.museStateHome = muse.stateHome;
    this.mcpScript = binScript('office-workers.js');
    this.officeBin = this.writeOfficeCommands();
    this.claudeMcp = this.mcpScript ? writeClaudeMcpConfig(dataDir, this.mcpScript) : undefined;
    this.agentPath = resolveCommand(agentCmd);
    const claude = this.defaultProvider === 'claude' ? this.agentPath : resolveCommand('claude');
    this.namer = new TaskNamer(claude, childEnv(), () => officePrompt(this.prompts, 'office.namer'), (id, task, ctx) => {
      const w = this.workers.get(id);
      if (!w || w.taskEpoch !== ctx.epoch) return;
      w.info.task = task;
      this.emitUpdate(w);
      this.persist();
    });
    this.host = new PtyHost(dataDir, () => this.events.toast("The workers' terminal host stopped — resuming them", 'warn'));
    this.scrollback = new ScrollbackStore(dataDir);
    this.drops = new DropStore(dataDir);
    this.restore();
    this.scrollback.prune(new Set(this.workers.keys()));
    this.drops.prune(new Set(this.workers.keys()));
    // A session may have ended (and written its final tally) while the office was down.
    for (const w of this.workers.values()) this.scanUsage(w);
    this.screenTimer = setInterval(() => this.flushScreens(), SCREEN_INTERVAL_MS);
    this.usageTimer = setInterval(() => {
      for (const w of this.workers.values()) {
        this.scanUsage(w);
        this.watchFolder(w);
      }
    }, USAGE_SCAN_MS);
    this.saveTimer = setInterval(() => {
      for (const w of this.workers.values()) if (w.unsaved) this.saveScrollback(w);
    }, SAVE_SCROLLBACK_MS);
  }

  /**
   * Picks every worker whose terminal outlived the last office (a dev-server reload, an upgrade)
   * back up where it is, mid-turn or not. Whoever else was at a desk when the office stopped (a
   * restart, a crash) gets straight back to work, carrying on with whatever it was in the middle of.
   * Call once, before anyone can walk in.
   */
  async start() {
    await this.host.connect();
    await Promise.all(
      [...this.workers.values()].map(async (w) => {
        const saved = w.saved;
        w.saved = undefined;
        const adopted = saved && (await this.host.attach(saved.ptyId));
        if (adopted) this.adopt(w, adopted, saved);
      }),
    );
    // Terminals nobody saved a claim on (their worker was sent home as the office went down).
    this.host.killUnclaimed();
    // Whoever's worktree was deleted while the office was down stays asleep, marked lost, rather than failing to start.
    for (const w of this.workers.values()) this.checkLost(w);
    this.wakeAll();
    // It may have switched branches while the office was down, its terminal still going.
    void this.syncBranches();
  }

  get resolvedAgent(): string | null {
    return this.agentPath;
  }

  /** What an agent starts on when whoever starts it doesn't pick: the one set in ⚙️ Settings, or the office's --agent. */
  get officeDefault(): AgentChoice {
    const picked = this.prompts?.agent();
    if (picked && (picked.provider !== 'custom' || this.defaultProvider === 'custom')) return picked;
    return { provider: this.defaultProvider };
  }

  list(): WorkerInfo[] {
    return [...this.workers.values()].map((w) => w.info);
  }

  get(id: string): WorkerInfo | undefined {
    return this.workers.get(id)?.info;
  }

  /**
   * Whether a worker has written to its terminal since `at`: work the office can see even when a
   * provider reports no status (the meetings use it so a panel isn't cut off as "never started").
   */
  activeSince(id: string, at: number): boolean {
    const w = this.workers.get(id);
    return !!w && w.outputAt !== undefined && w.outputAt >= at;
  }

  /** The account a worker runs as (see RunAs), if not the office. */
  ownerOf(id: string): string | undefined {
    return this.workers.get(id)?.owner;
  }

  /** Each worker's terminal process and directory, to tell whose servers are whose. */
  owners(): ServiceOwner[] {
    return [...this.workers.values()].map((w) => ({
      workerId: w.info.id,
      pid: w.pty?.pid,
      agent: w.info.kind === 'agent',
      cwd: this.cwd(w.info),
      root: this.dir,
    }));
  }

  /**
   * Fetches the branch the project is on, so a worktree made next starts from what's on GitHub now
   * (see Worktrees.fetch). Undefined when there's nothing to wait for.
   */
  fetchBase(): Promise<void> | undefined {
    return this.trees.fetch();
  }

  deskOccupied(deskId: string): boolean {
    for (const w of this.workers.values()) if (w.info.deskId === deskId) return true;
    return false;
  }

  /**
   * The standing desk a helper at `hostId`'s works from: its host's desk moved beside it, with no
   * chair and no places, so everything that looks a seat up (launch(), the client) finds one and
   * nothing tries to sit anyone in it (see shared/helper.ts).
   */
  private helperDesk(hostId: string): DeskDef | undefined {
    const host = this.get(hostId);
    const desk = host && DESK_BY_ID.get(host.deskId);
    return host && desk ? helperDesk(desk, `🆘 helping ${host.name}`) : undefined;
  }

  /** The worker a helper is helping, if that is what this one is. */
  hostOf(id: string): WorkerInfo | undefined {
    const helper = this.get(id);
    return helper?.helper ? this.get(helper.helper.hostId) : undefined;
  }

  /**
   * Hires a helper to walk over to the worker at `hostId` (see server/helpers.ts). It works in that
   * worker's own checkout, so it needs a brief of its own and then nothing: no worktree of its own,
   * no queue task and no say over the work. It is seated at a standing desk beside the host's, built
   * from the host's, so everything that looks a seat up finds one and nothing sits anyone in it.
   */
  sendHelper(hostId: string, by: string, provider?: AgentProvider, model?: string, effort?: AgentEffort, owner?: string): WorkerInfo | string {
    const host = this.get(hostId);
    if (!host) return 'No such worker';
    if (host.kind !== 'agent') return `${host.name} is a shell, not an agent`;
    // A helper helps a worker, not another helper: that would make a chain nobody asked for.
    if (isHelperId(host.deskId)) return `${host.name} is itself a helper`;
    // It reads the host's checkout, so there has to be one: a worker in the floor's own checkout would
    // have the helper reading the same files the whole floor shares.
    if (!host.worktree) return `${host.name} isn't in a worktree of its own: a helper needs one to read`;
    const desk = DESK_BY_ID.get(host.deskId);
    if (!desk) return 'Unknown desk';
    const brief = officePrompt(this.prompts, 'helper.brief', { host: host.name, task: host.task?.name || host.prompt || 'the task on its card', branch: host.worktree.branch });
    return this.spawn(helperId(host.deskId), by, brief, false, 'agent', provider, model, effort, undefined, owner, [], undefined, { hostId: host.id, hostName: host.name, worktree: host.worktree });
  }

  /**
   * What a helper worked out, for sending on to the worker it is helping: the tail of its own
   * terminal, which is the last thing it said. Plain text, since it goes into a prompt.
   */
  finding(id: string): string {
    const w = this.workers.get(id);
    if (!w) return '';
    const text = w.term && w.ser ? terminalTail(w.term, w.ser, FINDING_LINES) : this.scrollback.load(id);
    return plainText(text ?? '');
  }

  /**
   * Hires a worker at a desk. `meeting` seats one at the meeting room's table instead, for that meeting
   * (see meetings.ts), in the meeting's own worktree, which everyone at the table shares. `repos` are
   * other floors' repositories a worker in its own worktree works in too (see makeWorkspace).
   */
  spawn(deskId: string, by: string, prompt?: string, worktree = false, kind: WorkerKind = 'agent', provider?: AgentProvider, model?: string, effort?: AgentEffort, meeting?: { id: string; worktree?: WorkerInfo['worktree'] }, owner?: string, repos: RepoSource[] = [], via?: 'herald', helper?: { hostId: string; hostName: string; worktree?: WorkerInfo['worktree'] }): WorkerInfo | string {
    // Nobody picked (a board agent, say): the office's default worker, model and effort included.
    if (kind === 'agent' && provider === undefined) ({ provider, model, effort } = this.officeDefault);
    const selectedProvider = kind === 'agent' ? provider : undefined;
    const modelError = validateWorkerModel(kind, selectedProvider, model);
    if (modelError) return modelError;
    const effortError = validateWorkerEffort(kind, selectedProvider, effort);
    if (effortError) return effortError;
    // A helper's id isn't a seat's: the Floor puts a standing desk at it (see server/helpers.ts).
    const seat = helper ? this.helperDesk(helper.hostId) : DESK_BY_ID.get(deskId);
    if (!seat) return 'Unknown desk';
    if (!deskBuilt(seat, this.wing())) return `${seat.label} isn't built yet: expand the back office first`;
    // A helper stands at a desk somebody is already sitting at, so only the host's desk being taken
    // is a problem, and only for anything that isn't a helper.
    if (this.deskOccupied(deskId) && !(helper && isHelperId(deskId))) return seat.station ? `The ${STATION_AGENT[seat.station].name} is already there` : `That ${seat.beanbag ? 'bean bag' : 'desk'} is taken`;
    if (kind === 'shell' && seat.station) return 'A board agent is always an agent, not a shell';
    if (seat.station && !prompt?.trim()) return 'Tell the board agent what to do';
    if (!seat.room !== !meeting) return seat.room ? 'Only a meeting seats workers at the meeting table: call one in the meeting room' : 'A meeting seats its workers at the meeting table';
    if (meeting && (kind !== 'agent' || worktree)) return 'A meeting seats agents, in its own worktree';
    if (repos.length && (kind !== 'agent' || !worktree || seat.station || meeting)) return 'Only a worker in its own worktree can work in other repositories too';
    if (repos.length > MAX_REPOS) return `A worker can take on at most ${MAX_REPOS} other repositories`;
    if (kind === 'shell' && provider !== undefined) return 'Shell workers do not have an agent provider';
    if (kind === 'agent' && selectedProvider === 'custom' && this.defaultProvider !== 'custom') return 'Custom is not the configured agent provider';
    // A helper is an agent, always: it reads and reports, and it never edits anything.
    if (helper && kind !== 'agent') return 'A helper is an agent, not a shell';
    if (helper && meeting) return 'A helper works at a desk, not at the meeting table';
    if (helper && repos.length) return 'A helper works in the checkout it is helping in';
    if (kind === 'agent') {
      const paused = this.ledger.hiringPaused;
      if (paused) return paused;
    }
    if (owner && selectedProvider === 'claude' && this.runAs && !this.runAs.claudeReady(owner)) return this.runAs.why('claude');
    // A helper is a real agent and takes a worker's slot, so a full office is still a full office.
    const full = this.capacity?.full();
    if (full) return full;
    const used = new Set([...this.workers.values()].map((w) => w.info.name.replace(/ 🐚$/, '')));
    const agent = seat.station && STATION_AGENT[seat.station];
    const name = agent ? agent.name : (NAMES.find((n) => !used.has(n)) ?? `Worker ${this.workers.size + 1}`);
    const id = randomBytes(6).toString('hex');
    // A helper works in its host's checkout, on its host's branch: it never cuts a worktree of its
    // own, because it doesn't own the work. A meeting's workers share the meeting's, the same way.
    let wt: WorkerInfo['worktree'] = meeting?.worktree ?? helper?.worktree;
    let others: WorkerRepo[] | undefined;
    if (worktree) {
      const slug = `${name.toLowerCase()}-${id.slice(0, 4)}`;
      const made = repos.length ? this.makeWorkspace(slug, repos) : this.trees.create(slug);
      if (typeof made === 'string') return made;
      if ('repos' in made) {
        ({ worktree: wt, repos: others } = made);
        for (const note of made.notes) this.events.toast(`🌿 ${name}'s worktree of ${note}`, 'info');
      } else {
        const { note, ...ref } = made;
        wt = ref;
        if (note) this.events.toast(`🌿 ${name}'s worktree ${note}`, 'info');
      }
    }
    const info: WorkerInfo = {
      id,
      kind,
      provider: selectedProvider,
      model: selectedProvider === 'opencode' || selectedProvider === 'claude' || selectedProvider === 'grok' || selectedProvider === 'muse' || selectedProvider === 'dsh' ? model : undefined,
      effort: selectedProvider === 'claude' || selectedProvider === 'grok' || selectedProvider === 'muse' || selectedProvider === 'dsh' ? effort : undefined,
      deskId,
      name: kind === 'shell' ? `${name} 🐚` : name,
      color: kind === 'shell' ? '#8d99ae' : agent ? agent.color : COLORS[Math.floor(Math.random() * COLORS.length)],
      status: 'starting',
      acked: true,
      createdBy: by,
      createdAt: Date.now(),
      ...(via ? { via } : {}),
      prompt: kind === 'shell' ? undefined : prompt?.trim() || undefined,
      worktree: wt,
      repos: others,
      cols: 100,
      rows: 30,
      viewers: [],
      viewerIds: [],
      activity: prompt ? truncate(prompt, 80) : undefined,
      meeting: meeting?.id,
      ...(helper ? { helper: { hostId: helper.hostId, hostName: helper.hostName } } : {}),
    };
    const w = newWorker(info, newTracker());
    w.owner = owner;
    this.workers.set(id, w);
    if (info.prompt) this.notePrompt(w, info.prompt);
    // A board agent is told what it's there for ahead of its first request (which is what shows).
    this.launch(w, seat.station && info.prompt ? `${stationBrief(seat.station, this.prompts, this.forge)}\n\n${info.prompt}` : info.prompt, undefined);
    this.persist();
    return info;
  }

  /**
   * The workspace of a worker across repositories: `.agent-office/worktrees/<slug>`, with a worktree of
   * this floor's project and of each of `repos` in it, all on office/<slug>, and a brief for the agent
   * (the 'worker.repos' prompt, as CLAUDE.md and AGENTS.md). All or nothing: when one repository
   * can't have its worktree, the ones already made are taken out again.
   */
  private makeWorkspace(slug: string, repos: RepoSource[]): { worktree: NonNullable<WorkerInfo['worktree']>; repos: WorkerRepo[]; notes: string[] } | string {
    // A branch can only be checked out once per repository, and two floors can be checkouts of the same one.
    const seen = new Map<string, string>();
    const own = this.trees.commonDir();
    if (!own) return "This floor's project isn't a git checkout";
    seen.set(own, "this floor's project");
    for (const r of repos) {
      const common = new Worktrees(r.dir).commonDir();
      if (!common) return `${r.name} isn't a git checkout`;
      const twin = seen.get(common);
      if (twin) return `${r.name} is the same repository as ${twin}`;
      seen.set(common, r.name);
    }
    const names = workspaceNames([this.dir, ...repos.map((r) => r.dir)]);
    const made: { trees: Worktrees; ref: WorktreeRef }[] = [];
    const fail = (why: string) => {
      // Fresh branches with nothing on them: nothing is lost taking them out again.
      void (async () => {
        for (const m of made.reverse()) await m.trees.remove(m.ref, 'all');
        clearWorkspace(path.join(this.dir, WORKTREES_DIR, slug));
      })();
      return why;
    };
    const first = this.trees.create(slug, names[0]);
    if (typeof first === 'string') return fail(first);
    const { note, ...primary } = first;
    const notes = note ? [`${names[0]} ${note}`] : [];
    made.push({ trees: this.trees, ref: primary });
    const others: WorkerRepo[] = [];
    for (const [i, r] of repos.entries()) {
      const trees = new Worktrees(r.dir);
      const wt = trees.create(slug, names[i + 1], this.dir);
      if (typeof wt === 'string') return fail(`${r.name}: ${wt}`);
      if (wt.note) notes.push(`${names[i + 1]} ${wt.note}`);
      made.push({ trees, ref: { ...wt, path: path.relative(r.dir, path.join(this.dir, wt.path)) } });
      others.push({ floor: r.floor, name: names[i + 1], repo: r.repo, dir: r.dir, path: wt.path, branch: wt.branch, base: wt.base, from: wt.from });
    }
    try {
      this.writeBrief(primary, repos.map((r, i) => ({ name: names[i + 1], project: r.repo ?? r.name, from: others[i].from })));
    } catch (err) {
      return fail(`Could not write the workspace's brief: ${(err as Error).message}`);
    }
    return { worktree: primary, repos: others, notes };
  }

  /**
   * The brief in the workspace of a worker across repositories, which folder is which project (the
   * 'worker.repos' prompt), as CLAUDE.md and AGENTS.md. `primary` is its own floor's worktree, in the
   * workspace like `others`. Throws when it can't be written.
   */
  private writeBrief(primary: { path: string; branch: string; from?: string }, others: { name: string; project: string; from?: string }[]) {
    const home = originRepo(this.dir) ?? path.basename(this.dir);
    const line = (name: string, project: string, from?: string, note = '') => `- \`${name}/\`: ${project}${from ? `, cut from ${from}` : ''}${note}`;
    const brief = officePrompt(this.prompts, 'worker.repos', {
      branch: primary.branch,
      home,
      repos: [line(path.basename(primary.path), home, primary.from, " (this floor's project)"), ...others.map((o) => line(o.name, o.project, o.from))].join('\n'),
    });
    for (const file of WORKSPACE_FILES) writeFileSync(path.join(this.dir, path.dirname(primary.path), file), `${brief.trim()}\n`);
  }

  /** Starts a worker that isn't running again, carrying on its session, with `prompt` as its next message. */
  resume(id: string, prompt?: string): string | undefined {
    const w = this.workers.get(id);
    if (!w) return 'No such worker';
    if (w.pty || w.dsh) return 'Worker is already running';
    if (this.checkLost(w, true)) return lostMessage(w.info);
    clockWork(w.info, 'starting');
    w.info.status = 'starting';
    w.info.exitCode = undefined;
    const station = DESK_BY_ID.get(w.info.deskId)?.station;
    // A board agent with no session to carry on starts over, so it needs telling what it's for again.
    const first = prompt && station && !w.info.sessionId ? `${stationBrief(station, this.prompts, this.forge)}\n\n${prompt}` : prompt;
    if (prompt) {
      w.info.activity = truncate(prompt, 80);
      this.notePrompt(w, prompt);
    }
    // Cut off mid-turn by a restart: it gets on with it, as whoever was watching would have told it to.
    const carryOn = !prompt && w.interrupted && w.info.kind === 'agent' && !!w.info.sessionId;
    w.interrupted = false;
    this.launch(w, carryOn ? CARRY_ON_PROMPT : first, w.info.sessionId);
    return undefined;
  }

  /**
   * A request for the agent standing by a board (see STATIONS): typed into its session, which is woken
   * up with it if it's asleep, or it's hired there with it when nobody is. Returns what went wrong, or
   * the agent and whether it was just hired.
   */
  station(deskId: string, by: string, text: string, owner?: string): { info: WorkerInfo; hired: boolean } | string {
    if (!DESK_BY_ID.get(deskId)?.station) return 'There is no agent to ask there';
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (!clean) return 'Empty prompt';
    const w = [...this.workers.values()].find((x) => x.info.deskId === deskId);
    if (!w) {
      const info = this.spawn(deskId, by, clean, false, 'agent', undefined, undefined, undefined, undefined, owner);
      return typeof info === 'string' ? info : { info, hired: true };
    }
    // Typed into the question it's asking, the prompt would answer it.
    if (w.info.status === 'needs_input') return `The ${w.info.name} is waiting on an answer in its terminal`;
    const running = !!(w.pty || w.dsh);
    if (!running) w.info.lastInput = { by, at: Date.now() };
    const err = running ? this.prompt(w.info.id, clean, by) : this.resume(w.info.id, clean);
    return err ?? { info: w.info, hired: false };
  }

  /** The worker whose terminal holds this hook token: how a worker proves it's asking for itself. */
  authenticate(id: string, token: string): WorkerInfo | undefined {
    const w = this.workers.get(id);
    return (w?.pty || w?.dsh) && token && safeEq(token, w.hookToken) ? w.info : undefined;
  }

  /**
   * Holds a worker `offline` because the machine running its floor went away, rather than relaunching
   * it. The terminal keeps the last screen, so whoever is watching sees what stopped, and **R** resumes
   * it once the floor's host is back. Deliberately does not set an exit code: nothing exited.
   */
  private holdOffline(w: Worker, why: string, term: HeadlessTerminal) {
    const info = w.info;
    clockWork(info, 'exited');
    info.status = 'offline';
    info.exitCode = undefined;
    const hint = info.kind === 'shell' ? ' — press R to restart' : info.sessionId ? ' — press R to resume' : '';
    const msg = `\r\n\x1b[2m[${why}${hint}]\x1b[0m\r\n`;
    term.write(msg);
    if (w.viewers.size) this.events.data(info.id, msg, [...w.viewers.keys()]);
    w.screenDirty = true;
    w.unsaved = true;
    this.emitUpdate(w);
    this.persist();
    this.events.toast(`${info.name}: ${why}${hint}`, 'warn');
  }

  /** Starts every worker that isn't running: nobody should be found asleep at their desk. */
  wakeAll() {
    // A DeepSeek Harness worker has no PTY but is still running: only the ones that are gone wake up.
    // A worker on a floor whose host is away stays asleep too, or the boot relaunches it and it
    // refuses to seat, exits, and is relaunched again.
    for (const w of this.workers.values()) if (!w.pty && !w.dsh && !this.remoteAbsent(w.info)) this.resume(w.info.id);
  }

  /**
   * Whether this worker's floor runs on a machine that is not currently reachable. A no-op for an
   * office-side floor, so the ordinary boot path is unchanged; set on the floor by a hosted one.
   */
  private remoteAbsent(_info: WorkerInfo): boolean {
    return false;
  }

  /**
   * Sends a worker home. For one with its own worktree, `cleanup` says what becomes of it; with no
   * choice given, the worktree and branch go only when they hold no work, where `landed` (its merged
   * pull request's head commit) is work delivered. Resolves once that's done, with a line for the team
   * about the worktree.
   */
  async kill(id: string, cleanup?: WorktreeCleanup, landed?: string, landedRepos?: Record<string, string | undefined>): Promise<{ note?: string; error?: string }> {
    const w = this.workers.get(id);
    if (!w) return {};
    this.workers.delete(id);
    this.namer.forget(id);
    clearTimeout(w.scanTimer);
    const proc = w.pty;
    w.pty = undefined; // so the exit handler knows this worker is gone and stays quiet
    const session = w.dsh;
    w.dsh = undefined;
    try {
      session?.close();
      proc?.kill();
    } catch {
      // already gone
    }
    w.term?.dispose();
    this.scrollback.remove(id);
    this.drops.remove(id);
    this.events.remove(id, w.info);
    this.persist();
    // A meeting's worktree is everyone at the table's: the meeting tidies it away once they've all gone.
    if (!w.info.worktree || w.info.meeting) return {};
    // On the branch its work is on, should it have switched since it last came to rest.
    const wt = await this.current(w.info.worktree);
    const name = w.info.name;
    if (w.info.repos?.length) return this.clearRepos(w.info, cleanup, landed, landedRepos);
    if (!cleanup) {
      const work = describeWork(await this.trees.inspect(wt, landed));
      if (work) return { note: `Kept ${name}'s worktree and branch ${wt.branch} — it has ${work}` };
      cleanup = 'all';
    }
    if (cleanup === 'keep') return { note: `Kept ${name}'s worktree and branch ${wt.branch}` };
    let gone = wt;
    let kept = '';
    if (cleanup === 'all' && wt.made) {
      if (!(await this.trees.hasBranch(wt.made))) {
        // The agent deleted the office's branch (a rename is followed, see current), so git can't say
        // whether the one it's on is its own or was there before it: that one stays.
        cleanup = 'worktree';
      } else {
        // The office's own branch stays while it has commits that no remote, the project's checkout
        // or the branch it's on has.
        const work = await this.trees.wouldLose(wt.made, [wt.branch]);
        if (work) kept = ` and kept branch ${wt.made} — it has ${work}`;
        // A branch it made itself goes with it; one that was there before it (main, say) isn't the office's to delete.
        if (await this.trees.madeSince(wt.branch, wt.made)) gone = work ? { ...wt, made: undefined } : wt;
        else if (work) cleanup = 'worktree';
        else gone = { ...wt, branch: wt.made, made: undefined };
      }
    }
    const error = await this.trees.remove(gone, cleanup);
    if (error) return { error: `Couldn't delete ${name}'s worktree: ${error}` };
    if (cleanup === 'worktree') return { note: `Deleted ${name}'s worktree${kept || ` and kept branch ${wt.branch}`}` };
    return { note: `Deleted ${name}'s worktree and branch ${gone.branch}${kept && `,${kept}`}` };
  }

  /** Sending home a worker across repositories: what `kill` does with a worktree, for each of its worktrees, and then its workspace. */
  private async clearRepos(info: WorkerInfo, cleanup: WorktreeCleanup | undefined, landed?: string, landedRepos?: Record<string, string | undefined>): Promise<{ note?: string; error?: string }> {
    const trees = this.treesOf(info, landed, landedRepos);
    const { name } = info;
    const branch = info.worktree!.branch;
    const where = trees.map((t) => t.name).join(', ');
    if (!cleanup) {
      const held = (await Promise.all(trees.map(async (t) => ({ name: t.name, work: describeWork(await t.trees.inspect(t.ref, t.landed)) })))).filter((t) => t.work);
      if (held.length) return { note: `Kept ${name}'s worktrees and branch ${branch} in ${where} — ${held.map((t) => `${t.name} has ${t.work}`).join('; ')}` };
      cleanup = 'all';
    }
    if (cleanup === 'keep') return { note: `Kept ${name}'s worktrees and branch ${branch} in ${where}` };
    const how = cleanup;
    const errors = (await Promise.all(trees.map(async (t) => {
      const error = await t.trees.remove(t.ref, how);
      return error && `${t.name}: ${error}`;
    }))).filter(Boolean);
    if (errors.length) return { error: `Couldn't delete all of ${name}'s worktrees: ${errors.join('; ')}` };
    clearWorkspace(path.join(this.dir, workspaceOf(info)!));
    return { note: how === 'all' ? `Deleted ${name}'s worktrees and branch ${branch} in ${where}` : `Deleted ${name}'s worktrees in ${where} and kept branch ${branch}` };
  }

  /**
   * Each worktree a worker across repositories has, its own floor's first: its folder in the
   * workspace, git plumbing for its repository, its worktree in that repository's terms, and the
   * commit its merged pull request delivered, when known.
   */
  private treesOf(info: WorkerInfo, landed?: string, landedRepos?: Record<string, string | undefined>): { name: string; dir: string; trees: Worktrees; ref: WorktreeRef; landed?: string }[] {
    const wt = info.worktree!;
    return [
      { name: path.basename(wt.path), dir: this.dir, trees: this.trees, ref: wt, landed },
      ...(info.repos ?? []).map((r) => ({
        name: r.name,
        dir: r.dir,
        trees: new Worktrees(r.dir),
        ref: { path: path.relative(r.dir, path.join(this.dir, r.path)), branch: r.branch, base: r.base },
        landed: landedRepos?.[r.floor],
      })),
    ];
  }

  /**
   * Whether any worktree of a worker across repositories holds work its merged pull requests didn't
   * deliver (`landed` and `landedRepos`, as for kill): then it doesn't go home by itself yet.
   */
  async holdsWork(id: string, landed?: string, landedRepos?: Record<string, string | undefined>): Promise<boolean> {
    const info = this.workers.get(id)?.info;
    if (!info?.worktree) return false;
    const states = await Promise.all(this.treesOf(info, landed, landedRepos).map(async (t) => describeWork(await t.trees.inspect(t.ref, t.landed))));
    return states.some(Boolean);
  }

  /** What a worker's worktree holds, so whoever sends it home knows what deleting it would lose. */
  async inspectWorktree(id: string): Promise<WorktreeState | undefined> {
    const w = this.workers.get(id);
    const info = w?.info;
    if (!w || !info?.worktree) return undefined;
    if (!info.repos?.length) {
      await this.syncBranch(w);
      return this.trees.inspect(w.info.worktree!);
    }
    const repos = await Promise.all(this.treesOf(info).map(async (t) => ({ name: t.name, state: await t.trees.inspect(t.ref) })));
    const sum = (k: 'dirty' | 'ahead' | 'unpushed') => repos.reduce((n, r) => n + r.state[k], 0);
    const errors = repos.filter((r) => r.state.error).map((r) => `${r.name}: ${r.state.error}`);
    return { exists: repos.every((r) => r.state.exists), dirty: sum('dirty'), ahead: sum('ahead'), unpushed: sum('unpushed'), error: errors.length ? errors.join('; ') : undefined, repos };
  }

  /** Every worker's worktree branch, looked at again (see syncBranch): for when new pull requests may have come in. */
  async syncBranches(): Promise<void> {
    await Promise.all([...this.workers.values()].map((w) => this.syncBranch(w)));
  }

  /**
   * Keeps `worktree.branch` on the branch the worktree is actually on. Agents often make their own
   * (`git checkout -b fix-x`, because the task or the repo's CLAUDE.md says to) and open the pull
   * request from there with gh, and the PR badge, O at the desk and sending it home go by it. A
   * meeting's worktree stays the meeting's, and a worker across repositories keeps the branch it was
   * given in each (see openPrs).
   */
  private async syncBranch(w: Worker): Promise<void> {
    const wt = w.info.worktree;
    if (!wt || w.info.meeting || w.info.repos?.length) return;
    const now = await this.current(wt);
    // Sent home meanwhile, or another look got there first.
    if (now === wt || this.workers.get(w.info.id) !== w || w.info.worktree !== wt) return;
    w.info.worktree = now;
    this.emitUpdate(w);
    this.persist();
  }

  /** A worktree on the branch it's on now, with the office's own branch kept in `made`; the same one when nothing moved. */
  private async current(wt: Worktree): Promise<Worktree> {
    const live = await this.trees.branchOf(wt);
    if (!live) return wt;
    let made = wt.made ?? (live === wt.branch ? undefined : wt.branch);
    // Back on it, or renamed it (`git branch -m fix-x`): the branch it's on is the office's own.
    if (made === live || (made && (await this.trees.renamedTo(made, live)))) made = undefined;
    return live === wt.branch && made === wt.made ? wt : { ...wt, branch: live, made };
  }

  /**
   * Whether the folder a worker works in (its worktree, or its workspace across repositories) is gone:
   * deleted outside the office. It's then marked lost (WorkerInfo.lost) for whoever comes to its desk,
   * instead of failing to start over and over; once the folder is back, it isn't any more.
   */
  private checkLost(w: Worker, recheck = false): boolean {
    const { info } = w;
    if (!info.worktree || existsSync(this.cwd(info))) {
      if (info.lost) {
        info.lost = undefined;
        this.emitUpdate(w);
      }
      return false;
    }
    // Where its branch is only changes by hand: looked at again when someone tries to start it.
    if (info.lost && !recheck) return true;
    const branch = this.trees.branchState(info.worktree.branch);
    if (branch !== info.lost?.branch) {
      info.lost = { branch };
      this.emitUpdate(w);
    }
    return true;
  }

  /**
   * Every so often: a worktree deleted under a worker marks it lost, and one put back by hand
   * (`git worktree add` at the same place) sets an asleep worker back to work.
   */
  private watchFolder(w: Worker) {
    if (!w.info.worktree || w.rebuilding) return;
    const was = !!w.info.lost;
    if (!this.checkLost(w) && was && !w.pty && !w.dsh) this.resume(w.info.id);
  }

  /**
   * Puts a lost worker's worktree back where it was (see Worktrees.restore) and starts it again,
   * carrying on its conversation; across repositories, each worktree that's gone and the workspace's
   * brief. Everyone else who worked there (the rest of a meeting's table) gets back to work with it.
   * Resolves to whether it `rebuilt` anything, with a note on where a branch came back from (or why
   * there was nothing to do), or to what went wrong.
   */
  async rebuild(id: string): Promise<{ rebuilt?: boolean; note?: string; error?: string }> {
    const w = this.workers.get(id);
    if (!w) return { error: 'No such worker' };
    const { info } = w;
    if (!info.worktree) return { error: `${info.name} works in the main checkout` };
    if (w.rebuilding) return {};
    const folder = this.cwd(info);
    // Whoever the folder was deleted from under: this worker, and the rest of its meeting's table.
    const stranded = [...this.workers.values()].filter((o) => o.info.worktree && this.cwd(o.info) === folder && (o.info.lost || this.checkLost(o)));
    const froms: string[] = [];
    if (!existsSync(folder)) {
      const across = !!info.repos?.length;
      w.rebuilding = true;
      try {
        for (const t of this.treesOf(info)) {
          if (t.ref.path && existsSync(path.resolve(t.dir, t.ref.path))) continue;
          const r = await t.trees.restore(t.ref);
          const which = across ? `${t.name}'s ` : '';
          if ('error' in r) return { error: `Couldn't rebuild ${info.name}'s worktree${across ? ` of ${t.name}` : ''}: ${r.error}` };
          if (r.from === 'origin') froms.push(`${which}${t.ref.branch} came back from origin`);
          if (r.from === 'gone') froms.push(`${which}${t.ref.branch} was deleted too, so it starts again from where it began`);
        }
        if (across) {
          try {
            this.writeBrief(info.worktree, info.repos!.map((r) => ({ name: r.name, project: r.repo ?? r.name, from: r.from })));
          } catch {
            // The worktrees are what it needs; the brief only says which folder is which.
          }
        }
      } finally {
        w.rebuilding = false;
      }
    }
    for (const o of stranded) if (!this.checkLost(o)) this.restartIn(o);
    if (!stranded.length) {
      if (!w.pty && !w.dsh) this.resume(id);
      return { note: `${info.name}'s worktree is already there` };
    }
    return { rebuilt: true, note: froms.join('; ') || undefined };
  }

  /**
   * Starts a worker in its folder again: an asleep one wakes up, and one whose process was left running
   * in the folder deleted from under it starts over in the new one, carrying on its conversation.
   */
  private restartIn(w: Worker) {
    const proc = w.pty;
    const session = w.dsh;
    if (proc || session) {
      if (midTurn(w)) w.interrupted = true;
      // Gone before it exits, so the exit handler knows it was the office and stays quiet.
      w.pty = undefined;
      w.dsh = undefined;
      try {
        session?.close();
        proc?.kill();
      } catch {
        // already gone
      }
    }
    this.resume(w.info.id);
  }

  attach(id: string, clientId: string, name: string): { data: string; cols: number; rows: number } | undefined {
    const w = this.workers.get(id);
    if (!w) return undefined;
    w.viewers.set(clientId, name);
    let changed = this.syncViewers(w);
    if (!w.info.acked && w.info.status !== 'needs_input') {
      w.info.acked = true;
      changed = true;
    }
    if (changed) this.emitUpdate(w);
    const data = w.snapshot ? w.snapshot() : offlineBanner(w.info);
    return { data, cols: w.info.cols, rows: w.info.rows };
  }

  /** Lines of every worker's terminal holding `needle` (a searchKey), newest first, at most `perWorker` each. */
  search(needle: string, perWorker: number): { hits: TerminalHit[]; more: boolean } {
    const hits: TerminalHit[] = [];
    let more = false;
    for (const w of this.workers.values()) {
      if (!w.term) continue;
      const found = searchTerminal(w.term, needle, perWorker);
      more ||= found.more;
      for (const hit of found.hits) hits.push({ workerId: w.info.id, ...hit });
    }
    return { hits, more };
  }

  detach(id: string, clientId: string) {
    const w = this.workers.get(id);
    if (!w) return;
    if (w.viewers.delete(clientId) && this.syncViewers(w)) this.emitUpdate(w);
  }

  detachAll(clientId: string) {
    for (const w of this.workers.values()) {
      if (w.viewers.delete(clientId) && this.syncViewers(w)) this.emitUpdate(w);
    }
  }

  /** Keystrokes from `by`'s browser. */
  write(id: string, data: string, by: string) {
    const w = this.workers.get(id);
    if (!w) return;
    if (w.dsh) {
      // ACP has no terminal: the session buffers these into a line and submits it on Enter.
      w.dsh.writeInput(data);
      let changed = this.typed(w, by);
      if (w.info.status === 'needs_input' && w.info.acked === false) {
        w.info.acked = true;
        changed = true;
      }
      if (changed) this.emitUpdate(w);
      return;
    }
    if (!w.pty) return;
    w.pty.write(data);
    let changed = this.typed(w, by);
    if (w.info.status === 'needs_input' && w.info.acked === false) {
      w.info.acked = true;
      changed = true;
    }
    if (changed) this.emitUpdate(w);
  }

  /** Keeps a file dropped or pasted into a worker's terminal on this machine; where it is, for the terminal to type. */
  drop(id: string, name: string, type: string, body: Buffer): string | undefined {
    return this.workers.has(id) ? this.drops.save(id, name, type, body) : undefined;
  }

  /**
   * Remembers who typed into the terminal last. Says whether that's news: another person, or the
   * same one after a pause (not every keystroke, or a typist would flood everyone with updates).
   */
  private typed(w: Worker, by: string): boolean {
    const now = Date.now();
    const last = w.info.lastInput;
    if (last?.by === by && now - last.at < TYPED_REFRESH_MS) return false;
    w.info.lastInput = { by, at: now };
    return true;
  }

  /** Types a prompt into the agent's input box and submits it; `by` is the person who sent it, if any. */
  prompt(id: string, text: string, by?: string): string | undefined {
    const w = this.workers.get(id);
    if (!w) return 'No such worker';
    if (w.dsh) {
      const clean = text.replace(/\r\n?/g, '\n').trim();
      if (!clean) return 'Empty prompt';
      w.dsh.prompt(clean);
      w.info.activity = truncate(clean, 80);
      this.notePrompt(w, clean);
      if (by) w.info.lastInput = { by, at: Date.now() };
      this.emitUpdate(w);
      return undefined;
    }
    if (!w.pty) return 'Worker is not running';
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (!clean) return 'Empty prompt';
    // Bracketed paste keeps multi-line prompts in one message, then Enter submits.
    w.pty.write(`\x1b[200~${clean}\x1b[201~`);
    setTimeout(() => w.pty?.write('\r'), 120);
    w.info.activity = truncate(clean, 80);
    this.notePrompt(w, clean);
    if (by) w.info.lastInput = { by, at: Date.now() };
    this.emitUpdate(w);
    return undefined;
  }

  /**
   * Pushes a worktree worker's branch and opens a pull request for it, with a title and body
   * drafted from its task, as `as` (whoever pressed the button) or else the office. Resolves to the
   * PR, or to a message saying why there is none. The branch may already have an open PR (a second
   * press, or one opened by hand): that one is used. A worker across repositories gets one in each
   * repository it committed to (see openPrs).
   */
  async openPr(id: string, by: string, as?: ForgeAs): Promise<{ prs: OpenedPr[]; failed: string[] } | string> {
    const w = this.workers.get(id);
    if (!w) return 'No such worker';
    const { info } = w;
    const wt = info.worktree;
    if (!wt) return `${info.name} works in the main checkout — only workers with their own worktree can open a PR`;
    if (info.prOpening) return `${info.name}'s pull request is already being opened`;
    if (isBusy(info.status)) {
      return `${info.name} is still ${info.status === 'needs_input' ? 'waiting on input' : info.status} — wait until it's done`;
    }
    if (info.repos?.length) return this.openPrs(w, by, as);
    const cwd = path.join(this.dir, wt.path);
    if (!existsSync(cwd)) return `${info.name}'s worktree is gone (${wt.path})`;
    info.prOpening = true;
    this.emitUpdate(w);
    try {
      // The PR comes from the branch its work is on, which may be one it made itself.
      await this.syncBranch(w);
      const branch = info.worktree?.branch ?? wt.branch;
      const commits = (await run('git', ['log', '--reverse', '--format=%h %s', `${wt.base}..${branch}`], cwd)).split('\n').filter(Boolean);
      const dirty = (await run('git', ['status', '--porcelain'], cwd)) !== '';
      if (!commits.length) return dirty ? `${info.name} hasn't committed anything yet — ask it to commit first` : `${info.name} has no commits on ${branch} yet`;
      const open = await findPull(branch, cwd, forgeOfDir(cwd), as?.env);
      if (open) {
        info.pr = open;
        this.persist();
        return { prs: [{ ...open, existed: true, dirty }], failed: [] };
      }
      await run('git', ['push', '-u', 'origin', branch], cwd, 90_000, as?.env);
      const base = await this.pushedBranch([wt.from, this.trees.currentBranch()], branch);
      const { title, body } = draftPr(info, commits, by);
      const { number, url } = await openPull(branch, base, title, body, cwd, forgeOfDir(cwd), as?.env);
      info.pr = { number, url };
      this.persist();
      return { prs: [{ number, url, existed: false, dirty }], failed: [] };
    } catch (err) {
      return `Couldn't open a PR for ${info.name}: ${(err as Error).message}`;
    } finally {
      info.prOpening = false;
      // The worker may have been sent home meanwhile; an update would bring it back as a ghost.
      if (this.workers.get(id) === w) this.emitUpdate(w);
    }
  }

  /**
   * 'worker.pr' for a worker across repositories: a pull request in each repository it committed to
   * (or the one its branch already has there), with every one of them listed in each one's
   * description, so they're reviewed and merged together. The issue its task came from is closed by
   * its own floor's pull request; the others only mention it.
   */
  private async openPrs(w: Worker, by: string, as?: ForgeAs): Promise<{ prs: OpenedPr[]; failed: string[] } | string> {
    const { info } = w;
    const wt = info.worktree!;
    const home = originRepo(this.dir);
    const parts = [
      { name: path.basename(wt.path), dir: this.dir, ...wt, pr: info.pr, own: true, set: (pr: { number: number; url: string }) => (info.pr = pr) },
      ...info.repos!.map((r) => ({ ...r, own: false, set: (pr: { number: number; url: string }) => (r.pr = pr) })),
    ];
    const gone = parts.filter((p) => !existsSync(path.join(this.dir, p.path)));
    if (gone.length) return `${info.name}'s worktree${gone.length > 1 ? 's' : ''} of ${gone.map((p) => p.name).join(', ')} ${gone.length > 1 ? 'are' : 'is'} gone`;
    info.prOpening = true;
    this.emitUpdate(w);
    const prs: (OpenedPr & { cwd: string })[] = [];
    const failed: string[] = [];
    const uncommitted: string[] = [];
    try {
      for (const p of parts) {
        const cwd = path.join(this.dir, p.path);
        try {
          const dirty = (await run('git', ['status', '--porcelain'], cwd)) !== '';
          const known = p.pr ?? (await findPull(p.branch, cwd, forgeOfDir(cwd), as?.env));
          if (known) {
            p.set(known);
            prs.push({ repo: p.name, ...known, existed: true, dirty, cwd });
            continue;
          }
          const commits = (await run('git', ['log', '--reverse', '--format=%h %s', `${p.base}..${p.branch}`], cwd)).split('\n').filter(Boolean);
          if (!commits.length) {
            if (dirty) uncommitted.push(p.name);
            continue;
          }
          await run('git', ['push', '-u', 'origin', p.branch], cwd, 90_000, as?.env);
          const base = await this.pushedBranch([p.from, new Worktrees(p.dir).currentBranch()], p.branch, p.dir);
          const { title, body } = draftPr(info, commits, by, p.own ? undefined : { home });
          const pr = await openPull(p.branch, base, title, body, cwd, forgeOfDir(cwd), as?.env);
          p.set(pr);
          this.persist();
          prs.push({ repo: p.name, ...pr, existed: false, dirty, cwd });
        } catch (err) {
          failed.push(`Couldn't open a PR in ${p.name}: ${(err as Error).message}`);
        }
      }
      if (!prs.length) {
        if (failed.length) return failed.join('; ');
        return uncommitted.length ? `${info.name} hasn't committed anything yet in ${uncommitted.join(', ')} — ask it to commit first` : `${info.name} has no commits on ${wt.branch} yet in any of its repositories`;
      }
      if (prs.length > 1 && prs.some((p) => !p.existed)) {
        for (const p of prs) {
          try {
            const kind = forgeOfDir(p.cwd);
            const body = await pullBody(p.url, p.cwd, kind, as?.env);
            const next = withRelated(body, relatedBlock(prs, p.url, wt.branch));
            if (next !== body) await setPullBody(p.url, next, p.cwd, kind, as?.env);
          } catch (err) {
            failed.push(`Couldn't list the other pull requests on ${p.repo} #${p.number}: ${(err as Error).message}`);
          }
        }
      }
      this.persist();
      return { prs: prs.map(({ cwd: _, ...p }) => p), failed };
    } finally {
      info.prOpening = false;
      if (this.workers.get(info.id) === w) this.emitUpdate(w);
    }
  }

  /** The first of these branches that exists on origin (of `dir`'s repository), for a PR base. None: gh picks the default branch. */
  private async pushedBranch(candidates: (string | undefined)[], not: string, dir = this.dir): Promise<string | undefined> {
    for (const c of candidates) {
      if (!c || c === not) continue;
      try {
        await run('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${c}`], dir);
        return c;
      } catch {
        // not on the remote (or never fetched)
      }
    }
    return undefined;
  }

  resize(id: string, cols: number, rows: number) {
    const w = this.workers.get(id);
    // A DSH worker has no PTY to resize, but its terminal still fits the window it's shown in.
    if (!(w?.pty || w?.dsh) || !w.term) return;
    cols = clamp(Math.floor(cols), 20, 400);
    rows = clamp(Math.floor(rows), 5, 200);
    if (cols === w.info.cols && rows === w.info.rows) return;
    w.info.cols = cols;
    w.info.rows = rows;
    try {
      w.pty?.resize(cols, rows);
      w.term.resize(cols, rows);
    } catch {
      // pty may have exited between checks
    }
    w.screenDirty = true;
    w.lastLines = [];
    this.emitUpdate(w);
  }

  /** Claude Code hook callback. */
  handleHook(workerId: string, token: string, event: string, payload: any): boolean {
    const w = this.workers.get(workerId);
    if (!w || !w.pty || w.info.kind !== 'agent' || (w.info.provider !== 'claude' && w.info.provider !== 'custom') || !safeEq(token, w.hookToken)) return false;
    const now = Date.now();
    if (payload?.session_id && typeof payload.session_id === 'string' && payload.session_id !== w.info.sessionId) {
      w.info.sessionId = payload.session_id;
      this.persist();
    }
    if (typeof payload?.transcript_path === 'string' && payload.transcript_path !== w.tracker.transcript) {
      w.tracker.transcript = payload.transcript_path;
      this.persist();
    }
    this.scheduleScan(w);
    switch (event) {
      case 'SessionStart':
        if (payload?.source === 'clear') {
          this.clearTask(w);
          w.failStreak = 0;
        }
        if (w.info.status === 'starting' || (w.bootBlocked && w.info.status === 'needs_input')) {
          w.bootBlocked = false;
          this.setStatus(w, 'idle');
        }
        break;
      case 'UserPromptSubmit':
        w.bootBlocked = false;
        w.info.action = undefined;
        if (typeof payload?.prompt === 'string') {
          w.info.activity = truncate(payload.prompt, 80);
          this.notePrompt(w, payload.prompt);
        }
        if (w.info.status !== 'working') this.setStatus(w, 'working');
        else this.emitUpdate(w);
        break;
      case 'PreToolUse':
        if (payload?.tool_name === 'AskUserQuestion') this.setStatus(w, 'needs_input');
        else {
          w.info.activity = describeTool(payload);
          w.info.action = toolAction(payload?.tool_name, payload?.tool_input);
          this.noteTool(w, w.info.activity);
          if (w.info.status !== 'working') this.setStatus(w, 'working');
          else this.emitUpdate(w);
        }
        break;
      case 'PostToolUse':
      case 'PostToolUseFailure':
        this.noteOutcome(w, payload, event === 'PostToolUseFailure');
        if (w.info.status === 'needs_input') {
          w.leftNeedsInputAt = now;
          this.setStatus(w, 'working');
        }
        break;
      case 'PermissionRequest':
        w.info.activity = `Wants permission: ${describeTool(payload)}`;
        this.setStatus(w, 'needs_input');
        break;
      case 'Notification':
        if (payload?.notification_type === 'permission_prompt') {
          if (now - w.leftNeedsInputAt > LATE_PROMPT_GRACE_MS) this.setStatus(w, 'needs_input');
        } else if (payload?.notification_type === 'idle_prompt') {
          if (w.info.status === 'working') this.setStatus(w, 'done');
        }
        break;
      case 'Stop':
        this.setStatus(w, 'done');
        break;
    }
    return true;
  }

  /** Native Codex lifecycle hooks register the root rollout for bounded metric reads. */
  handleCodexHook(workerId: string, token: string, event: string, payload: unknown): boolean {
    const w = this.workers.get(workerId);
    if (!w || !w.pty || w.info.kind !== 'agent' || w.info.provider !== 'codex' || !safeEq(token, w.hookToken)) return false;
    const report = normalizeCodexHook(event, payload);
    if (!report) return false;
    if (w.info.sessionId && w.info.sessionId !== report.sessionId && event !== 'SessionStart') return false;
    if (!w.info.sessionId || w.info.sessionId !== report.sessionId) {
      if (w.info.sessionId) {
        this.clearTask(w);
        w.info.usage = undefined;
        w.codexTranscript = undefined;
        w.codexUsage = new CodexUsageReader();
      }
      w.info.sessionId = report.sessionId;
      this.persist();
    }
    if (report.transcriptPath) w.codexTranscript = report.transcriptPath;
    this.scheduleScan(w);
    w.bootBlocked = false;
    const clearPending = () => {
      w.codexTools.clear();
      w.codexPending.clear();
      w.codexPermissionUnknown = false;
    };
    const busy = () => this.setStatus(w, w.codexPending.size || w.codexPermissionUnknown ? 'needs_input' : 'working');
    switch (report.event) {
      case 'SessionStart':
        clearPending();
        if (report.source === 'clear') this.clearTask(w);
        w.info.activity = undefined;
        if (w.info.status === 'starting' || w.info.status === 'needs_input') this.setStatus(w, 'idle');
        break;
      case 'UserPromptSubmit':
        clearPending();
        w.info.action = undefined;
        if (report.prompt) {
          w.info.activity = truncate(report.prompt, 80);
          this.notePrompt(w, report.prompt);
        }
        this.setStatus(w, 'working');
        break;
      case 'PreToolUse':
        w.info.activity = report.tool ? truncate(report.tool, 80) : 'Using a tool';
        w.info.action = toolAction(report.tool);
        if (report.toolUseId && w.codexTools.size < 256) w.codexTools.set(report.toolUseId, report.tool ?? '');
        if (/(?:^|[.])(?:AskUserQuestion|request_user_input)$/.test(report.tool ?? '')) {
          if (report.toolUseId) w.codexPending.add(report.toolUseId);
          else w.codexPermissionUnknown = true;
        }
        busy();
        break;
      case 'PermissionRequest':
        w.info.activity = `Wants permission: ${truncate(report.tool ?? 'tool', 80)}`;
        // PermissionRequest has no tool_use_id in the native schema. Keep every matching
        // active call pending so an unrelated parallel tool cannot dismiss the prompt.
        const candidates = [...w.codexTools].filter(([, tool]) => tool === report.tool);
        if (!candidates.length) w.codexPermissionUnknown = true;
        for (const [id] of candidates) w.codexPending.add(id);
        this.setStatus(w, 'needs_input');
        break;
      case 'PostToolUse':
        if (report.toolUseId) {
          w.codexTools.delete(report.toolUseId);
          w.codexPending.delete(report.toolUseId);
        }
        busy();
        break;
      case 'Stop':
      case 'Interrupt':
        clearPending();
        this.setStatus(w, 'done');
        break;
    }
    this.emitUpdate(w);
    this.persist();
    return true;
  }

  /** Grok lifecycle hooks, isolated under the office's GROK_HOME so they never edit ~/.grok. */
  handleGrokHook(workerId: string, token: string, event: string, payload: unknown): boolean {
    const w = this.workers.get(workerId);
    if (!w || !w.pty || w.info.kind !== 'agent' || w.info.provider !== 'grok' || !safeEq(token, w.hookToken)) return false;
    const report = normalizeGrokHook(event, payload);
    if (!report) return false;
    if (w.info.sessionId && w.info.sessionId !== report.sessionId && event !== 'SessionStart') return false;
    if (!w.info.sessionId || w.info.sessionId !== report.sessionId) {
      if (w.info.sessionId && w.info.sessionId !== report.sessionId) this.clearTask(w);
      w.info.sessionId = report.sessionId;
      this.persist();
    }
    w.bootBlocked = false;
    switch (report.event) {
      case 'SessionStart':
        if (report.source === 'clear') this.clearTask(w);
        w.info.activity = undefined;
        if (w.info.status === 'starting' || w.info.status === 'needs_input') this.setStatus(w, 'idle');
        break;
      case 'UserPromptSubmit':
        w.info.action = undefined;
        if (report.prompt) {
          w.info.activity = truncate(report.prompt, 80);
          this.notePrompt(w, report.prompt);
        }
        this.setStatus(w, 'working');
        break;
      case 'PreToolUse':
        w.info.activity = report.tool ? truncate(report.tool, 80) : 'Using a tool';
        w.info.action = toolAction(report.tool);
        this.noteTool(w, w.info.activity);
        if (/(?:^|[._])(?:AskUserQuestion|ask_user_question|request_user_input)$/.test(report.tool ?? '')) this.setStatus(w, 'needs_input');
        else if (w.info.status !== 'working') this.setStatus(w, 'working');
        else this.emitUpdate(w);
        break;
      case 'PostToolUse':
        if (w.info.status === 'needs_input') {
          w.leftNeedsInputAt = Date.now();
          this.setStatus(w, 'working');
        }
        break;
      case 'Notification':
        if (report.notificationType === 'permission_prompt') {
          if (Date.now() - w.leftNeedsInputAt > LATE_PROMPT_GRACE_MS) this.setStatus(w, 'needs_input');
        } else if (report.notificationType === 'idle_prompt') {
          if (w.info.status === 'working') this.setStatus(w, 'done');
        }
        break;
      case 'Stop':
      case 'StopFailure':
      case 'StopCancelled':
        this.setStatus(w, 'done');
        break;
    }
    this.emitUpdate(w);
    this.persist();
    return true;
  }

  /** Muse lifecycle hooks, isolated under the office's XDG dirs so they never edit ~/.config/muse. */
  handleMuseHook(workerId: string, token: string, event: string, payload: unknown): boolean {
    const w = this.workers.get(workerId);
    if (!w || !w.pty || w.info.kind !== 'agent' || w.info.provider !== 'muse' || !safeEq(token, w.hookToken)) return false;
    const report = normalizeMuseHook(event, payload);
    if (!report) return false;
    if (w.info.sessionId && w.info.sessionId !== report.sessionId && report.event !== 'SessionStart') return false;
    if (!w.info.sessionId || w.info.sessionId !== report.sessionId) {
      if (w.info.sessionId && w.info.sessionId !== report.sessionId) this.clearTask(w);
      w.info.sessionId = report.sessionId;
      this.persist();
    }
    w.bootBlocked = false;
    switch (report.event) {
      case 'SessionStart':
        if (report.source === 'clear') this.clearTask(w);
        w.info.activity = undefined;
        if (w.info.status === 'starting' || w.info.status === 'needs_input') this.setStatus(w, 'idle');
        if (w.pendingPrompt) {
          const text = w.pendingPrompt;
          w.pendingPrompt = undefined;
          this.prompt(w.info.id, text);
        }
        break;
      case 'UserPromptSubmit':
        w.info.action = undefined;
        if (report.prompt) {
          w.info.activity = truncate(report.prompt, 80);
          this.notePrompt(w, report.prompt);
        }
        this.setStatus(w, 'working');
        break;
      case 'PreToolUse':
        w.info.activity = report.tool ? truncate(report.tool, 80) : 'Using a tool';
        w.info.action = toolAction(report.tool);
        this.noteTool(w, w.info.activity);
        if (/(?:^|[._])(?:AskUserQuestion|ask_user_question|request_user_input)$/.test(report.tool ?? '')) this.setStatus(w, 'needs_input');
        else if (w.info.status !== 'working') this.setStatus(w, 'working');
        else this.emitUpdate(w);
        break;
      case 'PermissionRequest':
        w.info.activity = `Wants permission: ${truncate(report.tool ?? 'tool', 80)}`;
        this.setStatus(w, 'needs_input');
        break;
      case 'PostToolUse':
      case 'PostToolUseFailure':
        if (w.info.status === 'needs_input') {
          w.leftNeedsInputAt = Date.now();
          this.setStatus(w, 'working');
        }
        break;
      case 'Notification':
        if (report.notificationType === 'permission_prompt') {
          if (Date.now() - w.leftNeedsInputAt > LATE_PROMPT_GRACE_MS) this.setStatus(w, 'needs_input');
        } else if (report.notificationType === 'idle_prompt') {
          if (w.info.status === 'working') this.setStatus(w, 'done');
        }
        break;
      case 'Stop':
      case 'StopFailure':
        this.setStatus(w, 'done');
        break;
    }
    this.emitUpdate(w);
    this.persist();
    return true;
  }

  /** OpenCode plugin callback. The plugin has already filtered child sessions before this bridge. */
  handleOpenCodeHook(workerId: string, token: string, payload: unknown): boolean {
    const w = this.workers.get(workerId);
    if (!w || !w.pty || w.info.kind !== 'agent' || w.info.provider !== 'opencode' || !safeEq(token, w.hookToken)) return false;
    if (payload && typeof payload === 'object' && 'type' in payload && payload.type === 'usage') {
      const report = payload as { sessionId?: unknown; usage?: unknown };
      const usage = reportedUsage(report.usage);
      if (!usage || !w.info.sessionId || report.sessionId !== w.info.sessionId) return false;
      // Full snapshots replace previous totals. They never advance task status or enter the Claude ledger.
      w.info.usage = usage;
      this.emitUpdate(w);
      this.persist();
      return true;
    }
    if (!isOpenCodeHookEvent(payload)) return false;
    if (w.info.sessionId && w.info.sessionId !== payload.sessionId && !(payload.type === 'session' && payload.status === 'starting')) return false;
    if (!w.info.sessionId || (payload.type === 'session' && payload.status === 'starting' && w.info.sessionId !== payload.sessionId)) {
      const switching = !!w.info.sessionId;
      w.info.sessionId = payload.sessionId;
      if (switching) {
        w.info.usage = undefined;
        this.clearTask(w);
        w.info.activity = undefined;
        this.setStatus(w, 'idle');
      }
      w.openCodeError = false;
      this.persist();
    }
    if (payload.type === 'error') w.openCodeError = true;
    else if (payload.status === 'working' || payload.prompt) w.openCodeError = false;
    if (payload.prompt) {
      w.info.activity = truncate(payload.prompt, 80);
      w.info.action = undefined;
      this.notePrompt(w, payload.prompt);
    } else if (payload.tool) {
      w.info.activity = truncate(payload.tool, 80);
      w.info.action = toolAction(payload.tool);
    } else if (payload.detail) {
      w.info.activity = truncate(payload.detail, 80);
    }
    if (payload.status === 'needs_input') this.setStatus(w, 'needs_input');
    else if (payload.status === 'working') this.setStatus(w, 'working');
    else if (payload.status === 'done' && w.pty) this.setStatus(w, w.openCodeError ? 'needs_input' : 'done');
    else if (payload.status === 'starting' && w.info.status === 'starting') this.setStatus(w, 'idle');
    else this.emitUpdate(w);
    return true;
  }

  /** A new message for the worker: show it right away, and have its task (re)named. */
  private notePrompt(w: Worker, prompt: string) {
    if (w.info.kind !== 'agent') return;
    const clean = prompt.replace(/\s+/g, ' ').trim();
    // Bare slash commands (/model, /compact), repeats and the office's own carry-on aren't new work.
    if (!clean || /^\/\S+$/.test(clean) || w.prompts.at(-1) === clean || clean === CARRY_ON_PROMPT) return;
    w.prompts = [...w.prompts, clean].slice(-TASK_PROMPTS);
    const hadTask = !!w.info.task;
    if (!hadTask) w.info.task = fallbackTask(clean);
    if (w.info.provider !== 'claude' && w.info.provider !== 'custom') return;
    // "yes", "go ahead", "2": a reply within the same task, not worth a new name.
    if (hadTask && clean.length < 16) return;
    this.nameTask(w);
  }

  private noteTool(w: Worker, tool: string) {
    if (w.info.provider !== 'claude' && w.info.provider !== 'custom') return;
    w.tools = [...w.tools, tool].slice(-TASK_TOOLS);
    w.toolsSinceNamed++;
    if (w.info.task && w.toolsSinceNamed >= TASK_REFRESH_TOOLS && Date.now() - w.namedAt > TASK_REFRESH_MS) this.nameTask(w);
  }

  /**
   * A tool call finished. Tests or a build that failed again (by exit code, or by the summary it
   * printed when the exit code was piped away) and the worker puts its head in its hands, until its
   * next tool call; a passing run ends the streak.
   */
  private noteOutcome(w: Worker, payload: any, failed: boolean) {
    if (payload?.is_interrupt || toolAction(payload?.tool_name, payload?.tool_input) !== 'test') return;
    const res = payload?.tool_response;
    const output = [payload?.error, res?.stdout, res?.stderr].filter((s) => typeof s === 'string').join('\n');
    if (!failed && !outputFailed(output)) {
      w.failStreak = 0;
      return;
    }
    if (++w.failStreak < FAILS_TO_DESPAIR || w.info.action === 'failing') return;
    w.info.action = 'failing';
    this.emitUpdate(w);
  }

  private nameTask(w: Worker) {
    if (w.info.provider !== 'claude' && w.info.provider !== 'custom') return;
    w.toolsSinceNamed = 0;
    w.namedAt = Date.now();
    const previous = w.info.task && w.prompts.length > 1 ? w.info.task : undefined;
    this.namer.request(w.info.id, { prompts: w.prompts, tools: w.tools, previous, epoch: w.taskEpoch });
  }

  private clearTask(w: Worker) {
    w.taskEpoch++;
    w.prompts = [];
    w.tools = [];
    w.toolsSinceNamed = 0;
    this.namer.forget(w.info.id);
    if (!w.info.task) return;
    w.info.task = undefined;
    this.emitUpdate(w);
    this.persist();
  }

  /**
   * The office is closing. On a restart (`keep`), terminals in the host keep running for the next
   * office to pick back up; otherwise every worker stops.
   */
  shutdown(keep = false) {
    this.closing = true;
    this.stopping = !keep;
    clearInterval(this.screenTimer);
    clearInterval(this.usageTimer);
    clearInterval(this.saveTimer);
    for (const w of this.workers.values()) {
      clearTimeout(w.scanTimer);
      this.scanUsage(w);
      // Before the process goes, so the next office shows what it was doing, not how it was stopped.
      if (w.unsaved) this.saveScrollback(w);
      // A DSH child cannot outlive the office the way a hosted PTY can: close its session quiescently,
      // and let the next office mark it offline and resume it (see docs/dsh-acp-integration.md).
      if (w.dsh) {
        const session = w.dsh;
        w.dsh = undefined;
        try {
          session.close();
        } catch {
          // already gone
        }
      }
      if (keep && w.pty?.id) continue;
      // A restart only takes this one down because it runs in-process: the next office carries on its turn.
      if (keep && midTurn(w)) w.interrupted = true;
      try {
        w.pty?.kill();
      } catch {
        // ignore
      }
    }
    this.persist();
    if (keep) this.host.detach();
    else this.host.stop();
  }

  // ---------------------------------------------------------------------------

  private launch(w: Worker, prompt: string | undefined, resumeSessionId: string | undefined) {
    const { info } = w;
    // Its folder was deleted meanwhile: it waits, marked lost, for someone to rebuild it or send it home.
    if (this.checkLost(w)) {
      clockWork(info, 'exited');
      info.status = 'exited';
      this.emitUpdate(w);
      return;
    }
    // The new terminal starts with what the last one showed (on a resume), or with what was saved
    // when the office last stopped, so earlier output is still there to scroll back to and search.
    const restarted = !w.term;
    const before = w.term && w.ser ? terminalTail(w.term, w.ser, SCROLLBACK) : this.scrollback.load(info.id);
    const prelude = before ? `${before}\r\n${restarted ? RESTORED_NOTE : ''}` : undefined;
    const term = this.newTerm(w);
    if (prelude) {
      // Writes are parsed in order, so this lands before anything the new process prints.
      term.write(prelude, () => {
        if (w.term === term) w.fresh = term.registerMarker(0);
      });
    }

    const shell = defaultShell();
    const isShell = info.kind === 'shell';
    const provider = info.provider;
    const isClaude = !isShell && provider === 'claude';
    const isOpenCode = !isShell && provider === 'opencode';
    const isCodex = !isShell && provider === 'codex';
    const isGrok = !isShell && provider === 'grok';
    const isMuse = !isShell && provider === 'muse';
    const isDsh = !isShell && provider === 'dsh';
    const configured = !isShell && provider === this.defaultProvider;
    const station = DESK_BY_ID.get(info.deskId)?.station;
    const command = this.command(info);
    const commandPath = isShell ? undefined : configured ? this.agentPath : resolveCommand(command);
    let args = isShell ? (WIN && !process.env.SHELL ? [] : ['-l']) : configured ? [...this.agentArgs] : [];
    if (isClaude) {
      args.unshift('--settings', this.settingsPath);
      // The office's MCP server: its workers, to list, hire, send home and tell (see office-workers.ts).
      // Ahead of --settings, which ends the list --mcp-config takes.
      if (this.claudeMcp) args.unshift('--mcp-config', this.claudeMcp);
      // A model/effort chosen for this worker overrides whatever --agent-args set office-wide.
      if (info.model) args.push('--model', info.model);
      if (info.effort) args.push('--effort', info.effort);
      // The queue agent only ever adds to the queue: without these it can't touch the checkout's files.
      if (station === 'queue') args.push('--disallowedTools', ...QUEUE_AGENT_DISALLOWED_TOOLS);
      if (resumeSessionId) args.push('--resume', resumeSessionId);
      // `--` so a prompt like "- fix login" is never parsed as a CLI option.
      if (prompt) args.push('--', prompt);
    } else if (isOpenCode) {
      if (resumeSessionId || info.model) args = withoutOpenCodeModel(args);
      if (!resumeSessionId && info.model) args.push('--model', info.model);
      if (resumeSessionId) args.push('--session', resumeSessionId);
      if (prompt) args.push('--prompt', prompt);
    } else if (isCodex) {
      args.push(...codexHookArgs(this.codexHook), ...(this.mcpScript ? codexMcpArgs(this.mcpScript) : []), '--no-alt-screen');
      if (resumeSessionId) args.push('resume', resumeSessionId);
      if (prompt) args.push('--', prompt);
    } else if (isGrok) {
      args = withoutGrokLaunchArgs(args);
      args.push('--no-alt-screen', '--trust', '--leader-socket', this.grokSocket);
      if (resumeSessionId) {
        args.push('--resume', resumeSessionId);
      } else {
        if (!info.sessionId) info.sessionId = randomUUID();
        args.push('--session-id', info.sessionId);
        if (info.model) args.push('--model', info.model);
        if (info.effort) args.push('--effort', info.effort);
      }
      if (prompt) args.push('--', prompt);
    } else if (isMuse) {
      args = withoutMuseLaunchArgs(args);
      args.push('--trust-workspace');
      if (resumeSessionId) {
        args.push('resume', resumeSessionId);
        w.pendingPrompt = prompt;
      } else {
        if (info.model) args.push('--model', info.model);
        if (info.effort) args.push('--reasoning-effort', info.effort);
        if (prompt) args.push('--', prompt);
      }
    }
    if (isCodex) {
      w.codexTools.clear();
      w.codexPending.clear();
      w.codexPermissionUnknown = false;
    }
    if (isOpenCode || isCodex || isGrok || isMuse) {
      w.hookToken = randomBytes(16).toString('hex');
      w.openCodeError = false;
    }
    const env = childEnv();
    Object.assign(env, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      AGENT_OFFICE_WORKER_ID: info.id,
      AGENT_OFFICE_HOOK_URL: this.hook.url,
      AGENT_OFFICE_HOOK_TOKEN: w.hookToken,
    });
    // A board agent files, labels and merges with gh of its own, so it's told which repository the
    // boards are about: left to itself, gh works on a fork's `upstream` remote, not this floor's.
    if (station && this.forge === 'github') {
      const repo = workRepo(this.dir);
      if (repo) env.GH_REPO = repo;
    }
    if (isGrok) {
      env.GROK_HOME = this.grokHome;
      if (this.grokAuthPath) env.GROK_AUTH_PATH = this.grokAuthPath;
    }
    if (isMuse) {
      env.XDG_CONFIG_HOME = this.museConfigHome;
      env.XDG_DATA_HOME = this.museDataHome;
      env.XDG_STATE_HOME = this.museStateHome;
    }
    // Whichever agent it runs, a worker reaches the office's workers with office-workers, and a board
    // agent the queue with office-queue.
    if (this.officeBin) {
      // Windows spells it Path.
      const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      env[key] = [this.officeBin, env[key]].filter(Boolean).join(path.delimiter);
    }

    const cwd = this.cwd(info);
    // A workspace isn't a repository, but it's inside this floor's checkout: git run in it must not
    // find that checkout (and switch its branch, say) instead of saying it's no repository.
    if (info.repos?.length) env.GIT_CEILING_DIRECTORIES = [path.dirname(cwd), env.GIT_CEILING_DIRECTORIES].filter(Boolean).join(path.delimiter);
    if (w.owner && this.runAs) {
      if (isClaude && !this.runAs.claudeReady(w.owner)) {
        this.startFailed(w, `whoever hired ${info.name} (${info.createdBy}) isn't signed in to Claude — they can sign in under ☰ → 🔐 Your sign-ins, then press R here`);
        return;
      }
      this.runAs.apply(w.owner, env, [this.dir, cwd]);
    }
    if (isCodex) w.codexHome = codexHome(cwd, env);

    if (isDsh) {
      // No PTY and no argv for prompts or resume: the office owns an ACP connection instead, and
      // renders its updates into this same terminal (see dsh.ts).
      env.AGENT_OFFICE_DSH_PROFILE = this.dshProfile;
      const patch = writeDshPatch(this.dataDir);
      const dshArgv = dshArgs({ profile: this.dshProfile, patches: [patch], extra: args });
      const file = commandPath ?? shell;
      const dshArgsFinal = commandPath ? dshArgv : shellRun(['exec', command, ...dshArgv].map((a, i) => (i < 2 ? a : shq(a))).join(' '));
      this.launchDsh(w, term, { file, args: dshArgsFinal, cwd, env, resumeSessionId, prompt });
      this.emitUpdate(w);
      this.persist();
      return;
    }

    // The host keeps its own copy of the screen for the next office: it starts with the same history.
    const where = { cwd, env, cols: info.cols, rows: info.rows, prelude };
    let proc: Pty;
    try {
      if (isOpenCode) {
        env.AGENT_OFFICE_SESSION_ID = resumeSessionId ?? '';
        env.OPENCODE_CONFIG_CONTENT = mergeOpenCodeConfigContent(env.OPENCODE_CONFIG_CONTENT, openCodePluginSpecifier(this.openCodePlugin), this.mcpScript ? openCodeMcp(this.mcpScript) : undefined);
      }
      if (isShell) {
        proc = this.host.spawn({ file: shell, args, ...where });
      } else if (commandPath) {
        proc = this.host.spawn({ file: commandPath, args, ...where });
      } else {
        // Not found on PATH: let a login shell find it (nvm, asdf, ~/.local/bin ...).
        const line = ['exec', command, ...args].map((a, i) => (i < 2 ? a : shq(a))).join(' ');
        proc = this.host.spawn({ file: shell, args: shellRun(line), ...where });
      }
    } catch (err) {
      this.startFailed(w, (err as Error).message);
      return;
    }
    if (!isClaude && !isCodex && !isGrok && !isMuse) {
      clockWork(info, 'idle');
      info.status = 'idle';
    }
    this.follow(w, proc, term, resumeSessionId);
    this.emitUpdate(w);
    this.persist();
  }

  /**
   * Starts (or resumes) a DeepSeek Harness worker over ACP. The session renders its transcript into
   * the worker's terminal and reports status, acted-out actions, usage and its session id; the
   * office answers permission requests from whoever is typing (see dsh.ts).
   */
  private launchDsh(w: Worker, term: HeadlessTerminal, options: { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; resumeSessionId?: string; prompt?: string }) {
    const { info } = w;
    const session = new DshSession(
      {
        file: options.file,
        args: options.args,
        cwd: options.cwd,
        env: options.env,
        model: info.model,
        effort: info.effort,
        resumeSessionId: options.resumeSessionId,
        firstPrompt: options.prompt,
      },
      {
        output: (data) => {
          if (w.dsh !== session) return;
          term.write(data);
          w.outputAt = Date.now();
          w.screenDirty = true;
          w.unsaved = true;
          if (w.viewers.size) this.events.data(info.id, data, [...w.viewers.keys()]);
        },
        status: (status) => {
          if (w.dsh === session) this.setStatus(w, status);
        },
        action: (action) => {
          if (w.dsh !== session || info.action === action) return;
          info.action = action;
          this.emitUpdate(w);
        },
        usage: (usage) => {
          if (w.dsh !== session) return;
          info.usage = usage;
          this.emitUpdate(w);
          this.persist();
        },
        session: (sessionId) => {
          if (w.dsh !== session || info.sessionId === sessionId) return;
          info.sessionId = sessionId;
          this.emitUpdate(w);
          this.persist();
        },
        prompted: (text) => {
          // A line typed into the terminal: there are no hooks for DSH, so the card learns from here.
          if (w.dsh !== session) return;
          this.notePrompt(w, text);
          this.emitUpdate(w);
        },
        exit: (code, error, quiet) => this.dshExited(w, session, term, code, error, quiet),
      },
    );
    w.dsh = session;
    session.start();
  }

  /** A DeepSeek Harness child ended: while the office is up, its desk says so and R resumes it. */
  private dshExited(w: Worker, session: DshSession, term: HeadlessTerminal, code: number | null, error: string | undefined, quiet: boolean) {
    const { info } = w;
    if (w.dsh !== session || this.workers.get(info.id) !== w) return; // sent home: stay quiet
    w.dsh = undefined;
    // The office is going down: the next office marks this worker offline and resumes it, so its
    // status must stay as it was (see the restart difference in docs/dsh-acp-integration.md).
    if (quiet || this.closing) return;
    const note = error ? `\r\n\x1b[31m[DeepSeek Harness: ${terminalSafe(truncate(error, 300)).replace(/\n/g, ' ')}]\x1b[0m\r\n` : '';
    if (note) {
      term.write(note);
      if (w.viewers.size) this.events.data(info.id, note, [...w.viewers.keys()]);
    }
    // It never got as far as a session: most often `dsh` is missing, or the profile will not boot.
    if (error && !info.sessionId) this.events.toast(`Could not start ${this.command(info)}: ${truncate(error, 200)}`, 'error');
    info.exitCode = code ?? -1;
    info.status = 'exited';
    const hint = info.sessionId ? ' — press R to resume' : '';
    const msg = `\r\n\x1b[2m[${info.name} exited with code ${code ?? -1}${hint}]\x1b[0m\r\n`;
    term.write(msg);
    if (w.viewers.size) this.events.data(info.id, msg, [...w.viewers.keys()]);
    w.screenDirty = true;
    w.unsaved = true;
    this.emitUpdate(w);
    this.persist();
  }

  /** Takes back a terminal the host kept running while the office was down. */
  private adopt(w: Worker, adopted: Adopted, saved: NonNullable<Worker['saved']>) {
    const { info } = w;
    // It kept working through the restart: nothing to carry on.
    w.interrupted = false;
    info.cols = adopted.cols;
    info.rows = adopted.rows;
    const term = this.newTerm(w);
    // Scrollback and all, the history from before this run included: only what it prints from here
    // on can say it's stuck on a login.
    term.write(adopted.snapshot, () => {
      if (w.term === term) w.fresh = term.registerMarker(0);
    });
    this.setTitle(w, adopted.title);
    // A hook that came in since the office started already says how it's doing.
    if (info.status === 'offline') {
      clockWork(info, saved.status);
      info.status = saved.status;
      info.acked = saved.acked;
      info.waitingSince = saved.waitingSince;
    }
    if (info.provider === 'codex') w.codexHome = codexHome(this.cwd(info), childEnv());
    this.follow(w, adopted.pty, term, undefined);
    // A turn that ended while the office was down says so with its Stop hook, which retries until
    // the office is back. Claude's progress report, where it gives one, says a turn is still going.
    if (adopted.busy && info.provider === 'claude') this.onProgress(w, true);
    this.emitUpdate(w);
  }

  /** A fresh screen for a worker's terminal, reading Claude's progress and title off it. */
  private newTerm(w: Worker): HeadlessTerminal {
    const term = new headless.Terminal({ cols: w.info.cols, rows: w.info.rows, scrollback: SCROLLBACK, allowProposedApi: true });
    const ser = new serialize.SerializeAddon();
    term.loadAddon(ser as any);
    // OSC 9;4 progress (Claude Code emits it): 0 = idle, anything else = busy. Catches Esc-cancel,
    // which fires no Stop hook.
    if (w.info.provider === 'claude') {
      term.parser.registerOscHandler(9, (data: string) => {
        const m = /^4;(\d)/.exec(data);
        if (m) this.onProgress(w, m[1] !== '0');
        return true;
      });
    }
    term.onTitleChange((title: string) => this.setTitle(w, title));
    w.term?.dispose();
    w.term = term;
    w.ser = ser;
    w.snapshot = screenSnapshot(term, ser);
    w.lastLines = [];
    w.screenDirty = true;
    w.fresh = undefined;
    return term;
  }

  private setTitle(w: Worker, title: string) {
    const clean = title.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (clean && clean !== w.info.title && !/^(claude( code)?|grok( build)?|muse( code)?)$/i.test(clean)) {
      w.info.title = clean;
      this.emitUpdate(w);
    }
  }

  /** Shows a worker's terminal output as it comes, and deals with the process ending. */
  private follow(w: Worker, proc: Pty, term: HeadlessTerminal, resumeSessionId: string | undefined) {
    const { info } = w;
    const isClaude = info.kind === 'agent' && info.provider === 'claude';
    const isCodex = info.kind === 'agent' && info.provider === 'codex';
    const isGrok = info.kind === 'agent' && info.provider === 'grok';
    const isMuse = info.kind === 'agent' && info.provider === 'muse';
    w.pty = proc;
    proc.onData((data) => {
      term.write(data);
      w.outputAt = Date.now();
      w.screenDirty = true;
      w.unsaved = true;
      if (w.viewers.size) this.events.data(info.id, data, [...w.viewers.keys()]);
    });
    proc.onExit(({ exitCode, error, lost, gone }) => {
      if (w.pty !== proc || this.workers.get(info.id) !== w) return;
      w.pty = undefined;
      if (error) {
        this.startFailed(w, error);
        return;
      }
      // The terminal host died and took the process with it: nothing the worker did.
      if (lost && !this.closing) {
        if (midTurn(w)) w.interrupted = true;
        this.resume(info.id);
        return;
      }
      // The far end walked and may come back (a floor host dropping its socket). Unlike a lost
      // local host, this is not going to restart by itself, so relaunching would spin:
      // relaunch, seat, refuse, exit. Hold the worker offline and asleep for **R** instead.
      if (gone && !this.closing) {
        if (midTurn(w)) w.interrupted = true;
        this.holdOffline(w, 'The machine hosting this floor went away', term);
        return;
      }
      if (isCodex && !this.closing) this.scheduleScan(w);
      // Resuming a conversation Claude no longer has ("No conversation found") exits before Claude
      // ever starts. Start a fresh one rather than leave the worker asleep.
      if (isClaude && resumeSessionId && info.status === 'starting' && !this.closing) {
        this.events.toast(`${info.name}'s last conversation couldn't be resumed — starting a fresh one`, 'warn');
        this.launch(w, undefined, undefined);
        return;
      }
      info.exitCode = exitCode;
      clockWork(info, 'exited');
      info.status = 'exited';
      const hint = info.kind === 'shell' ? ' — press R to restart' : info.sessionId ? ' — press R to resume' : '';
      const msg = `\r\n\x1b[2m[${info.name} exited with code ${exitCode}${hint}]\x1b[0m\r\n`;
      term.write(msg);
      if (w.viewers.size) this.events.data(info.id, msg, [...w.viewers.keys()]);
      w.screenDirty = true;
      w.unsaved = true;
      this.emitUpdate(w);
      this.persist();
      void this.syncBranch(w);
    });
    // SessionStart fires as soon as Claude can take input. Still silent after a while means it is
    // blocked on a human: folder trust dialog, login, first-run onboarding. Flag it so it jumps.
    setTimeout(() => {
      if (info.status !== 'starting' || w.pty !== proc) return;
      if (isClaude || isCodex || isGrok || isMuse) {
        w.bootBlocked = true;
        info.activity = isCodex
          ? 'Open the terminal: complete login and review Office hooks in /hooks'
          : isGrok
            ? 'Open the terminal: complete login if Grok asks'
            : isMuse
              ? 'Open the terminal: complete login if Muse asks'
              : 'Waiting on a setup prompt (trust / login) — open the terminal';
        this.setStatus(w, 'needs_input');
      } else this.setStatus(w, 'idle');
    }, 12000);
  }

  private startFailed(w: Worker, message: string) {
    const what = this.command(w.info);
    const msg = `\r\n\x1b[31mFailed to start ${what}: ${message}\x1b[0m\r\n`;
    clockWork(w.info, 'exited');
    w.info.status = 'exited';
    w.info.exitCode = -1;
    w.term?.write(msg);
    if (w.viewers.size) this.events.data(w.info.id, msg, [...w.viewers.keys()]);
    w.screenDirty = true;
    w.unsaved = true;
    this.events.toast(`Could not start ${what}: ${message}`, 'error');
    this.emitUpdate(w);
  }

  /** What a worker's terminal runs: the shell, the configured agent command, or another provider's CLI. */
  private command(info: WorkerInfo): string {
    if (info.kind === 'shell') return defaultShell();
    return info.provider === this.defaultProvider ? this.agentCmd : info.provider ?? this.agentCmd;
  }

  /** Where a worker works: its worktree, a workspace for a worker across repositories, or the project itself. */
  private cwd(info: WorkerInfo): string {
    const rel = workspaceOf(info);
    return rel ? path.join(this.dir, rel) : this.dir;
  }

  /** Hooks fire in bursts (every tool call); one read a moment later covers the whole burst. */
  private scheduleScan(w: Worker) {
    if (w.scanTimer) return;
    w.scanTimer = setTimeout(() => {
      w.scanTimer = undefined;
      this.scanUsage(w);
    }, 300);
  }

  /** Picks up what the session logged since last time and books the difference. */
  private scanUsage(w: Worker) {
    if (w.info.kind === 'agent' && w.info.provider === 'codex') {
      if (this.workers.get(w.info.id) !== w || !w.codexTranscript || !w.codexHome || !w.info.sessionId) return;
      const usage = w.codexUsage.read(w.codexTranscript, w.info.sessionId, w.codexHome);
      if (usage && JSON.stringify(usage) !== JSON.stringify(w.info.usage)) {
        w.info.usage = usage;
        this.emitUpdate(w);
        this.persist();
      }
      return;
    }
    if (w.info.kind !== 'agent' || (w.info.provider !== 'claude' && w.info.provider !== 'custom') || !w.tracker.transcript || this.workers.get(w.info.id) !== w) return;
    try {
      if (!scanTracker(w.tracker)) return;
    } catch {
      return; // an unreadable transcript is retried on the next scan
    }
    const before = w.info.usage ?? zeroUsage();
    const after = trackerUsage(w.tracker);
    w.info.usage = after;
    this.ledger.add(addUsage(after, before, -1));
    this.emitUpdate(w);
    this.persist();
  }

  private onProgress(w: Worker, busy: boolean) {
    const s = w.info.status;
    if (busy && (s === 'idle' || s === 'done' || s === 'starting')) this.setStatus(w, 'working');
    // Progress stays busy while a permission prompt is open, so going idle from needs_input means the
    // turn ended without a Stop hook (the prompt was rejected or Esc'd).
    else if (!busy && (s === 'working' || (s === 'needs_input' && !w.bootBlocked))) this.setStatus(w, 'done');
  }

  private setStatus(w: Worker, status: WorkerStatus) {
    if (w.info.status === status) return;
    if (w.info.status === 'needs_input') w.leftNeedsInputAt = Date.now();
    clockWork(w.info, status);
    w.info.status = status;
    // Done, idle or asleep: it's not acting anything out any more.
    if (status !== 'working' && status !== 'needs_input') w.info.action = undefined;
    // Nobody is looking at the terminal right now -> raise the flag (the worker jumps). A worker at the
    // meeting table that ends its part is waiting on the meeting, not on anyone, so it stays quiet.
    if (status === 'done' || status === 'needs_input') {
      w.info.acked = status === 'done' && (w.viewers.size > 0 || !!w.info.meeting);
      w.info.waitingSince = Date.now();
    } else w.info.acked = true;
    this.emitUpdate(w);
    // What a restarted office picks the worker back up as, should its terminal outlive this one.
    if (w.pty?.id || w.dsh) this.persist();
    // At rest: it may have made a branch of its own this turn, and opened its PR from there.
    if (status === 'done' || status === 'idle') void this.syncBranch(w);
  }

  private syncViewers(w: Worker): boolean {
    const names = [...new Set(w.viewers.values())];
    const ids = [...w.viewers.keys()];
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((n, i) => n === b[i]);
    if (same(names, w.info.viewers) && same(ids, w.info.viewerIds)) return false;
    w.info.viewers = names;
    w.info.viewerIds = ids;
    return true;
  }

  private emitUpdate(w: Worker) {
    this.events.update({ ...w.info });
  }

  /** Full screens for every running worker — sent to people as they walk in. */
  fullScreens() {
    const out: { workerId: string; frame: NonNullable<ReturnType<typeof snapshotScreen>> }[] = [];
    for (const w of this.workers.values()) {
      if (!w.term) continue;
      const frame = snapshotScreen(w.term, []);
      if (frame) out.push({ workerId: w.info.id, frame });
    }
    return out;
  }

  private flushScreens() {
    const now = Date.now();
    for (const w of this.workers.values()) {
      if (!w.term) continue;
      // Diffs can be dropped for slow clients, so resend the whole screen now and then.
      if (now - w.keyframeAt > KEYFRAME_MS) {
        w.keyframeAt = now;
        w.lastLines = [];
        w.screenDirty = true;
      }
      if (!w.screenDirty) continue;
      w.screenDirty = false;
      this.checkBlocked(w);
      const frame = snapshotScreen(w.term, w.lastLines);
      if (frame) this.events.screen(w.info.id, frame);
    }
  }

  /**
   * Claude can sit at its prompt without being usable: stuck on a first-run screen, or not signed
   * in on this machine. Flag that as needing a human, and clear it once the screen moves on.
   */
  private checkBlocked(w: Worker) {
    if (w.info.kind !== 'agent' || !w.term || (w.info.provider !== 'claude' && w.info.provider !== 'custom')) return;
    const s = w.info.status;
    if (s !== 'starting' && s !== 'idle' && !(w.bootBlocked && s === 'needs_input')) return;
    // Only this run's output counts: a "Not logged in" in the scrollback from before is old news.
    const text = screenText(w.term, w.term.buffer.active.type === 'normal' ? Math.max(0, w.fresh?.line ?? 0) : 0);
    const loggedOut = NOT_LOGGED_IN.test(text);
    const blocked = loggedOut || (SETUP_PROMPT.test(text) && (s === 'starting' || w.bootBlocked));
    if (blocked && s !== 'needs_input') {
      w.bootBlocked = true;
      w.info.activity = loggedOut
        ? "Claude isn't signed in on this machine — open the terminal and type /login"
        : 'Waiting on a setup prompt (trust / login) — open the terminal';
      this.setStatus(w, 'needs_input');
    } else if (!blocked && w.bootBlocked && s === 'needs_input') {
      w.bootBlocked = false;
      w.info.activity = undefined;
      this.setStatus(w, 'idle');
    }
  }

  private writeHookSettings() {
    const events: [string, string | undefined][] = [
      ['SessionStart', undefined],
      ['UserPromptSubmit', undefined],
      ['Stop', undefined],
      ['Notification', undefined],
      ['PermissionRequest', undefined],
      ['PreToolUse', undefined],
      ['PostToolUse', undefined],
      ['PostToolUseFailure', undefined],
    ];
    // Minimal VPS images sometimes lack curl; the office's own node binary is always there.
    const nodeHook = path.join(this.dataDir, 'hook.cjs');
    writeFileSync(
      nodeHook,
      `const http = require('http');
const [event] = process.argv.slice(2);
let body = '';
process.stdin.on('data', (c) => (body += c));
process.stdin.on('end', () => {
  const url = new URL(process.env.AGENT_OFFICE_HOOK_URL + '/hooks/claude');
  url.searchParams.set('worker', process.env.AGENT_OFFICE_WORKER_ID);
  url.searchParams.set('event', event);
  const send = (tries) => {
    const req = http.request(url, { method: 'POST', timeout: 3000, headers: { authorization: 'Bearer ' + process.env.AGENT_OFFICE_HOOK_TOKEN, 'content-type': 'application/json' } }, (res) => res.resume());
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED' && tries > 1) setTimeout(() => send(tries - 1), 1000);
    });
    req.on('timeout', () => req.destroy());
    req.end(body);
  };
  send(${HOOK_TRIES});
});
`,
      { mode: 0o600 },
    );
    const hooks: Record<string, unknown[]> = {};
    for (const [event, matcher] of events) {
      const curl =
        `curl -sS -m 3 --retry ${HOOK_TRIES - 1} --retry-delay 1 --retry-connrefused -X POST -H "Authorization: Bearer $AGENT_OFFICE_HOOK_TOKEN" -H "Content-Type: application/json" ` +
        `--data-binary @- "$AGENT_OFFICE_HOOK_URL/hooks/claude?worker=$AGENT_OFFICE_WORKER_ID&event=${event}"`;
      const command =
        `if [ -z "$AGENT_OFFICE_WORKER_ID" ] || [ -z "$AGENT_OFFICE_HOOK_URL" ]; then exit 0; fi; ` +
        `if command -v curl >/dev/null 2>&1; then ${curl} >/dev/null 2>&1; ` +
        `else ${shq(process.execPath)} ${shq(nodeHook)} ${event} >/dev/null 2>&1; fi; true`;
      hooks[event] = [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] }];
    }
    // Looking at the office's workers doesn't need anyone's say-so; hiring and sending home still asks.
    const permissions = { allow: MCP_READ_ONLY };
    writeFileSync(this.settingsPath, JSON.stringify({ hooks, permissions }, null, 2), { mode: 0o600 });
  }

  /**
   * Writes the office-queue and office-workers commands into the data dir's bin/, each running its
   * script in bin/ with the office's own node, and returns that directory. Rewritten on every start,
   * so after an upgrade they run the new install's scripts.
   */
  private writeOfficeCommands(): string | undefined {
    const dir = path.join(this.dataDir, 'bin');
    let wrote = false;
    for (const [name, what] of [['office-queue', "Agent Office's task queue, for the board agents"], ['office-workers', "Agent Office's workers, for every worker"]]) {
      const script = binScript(`${name}.js`);
      if (!script) continue;
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, name);
      writeFileSync(file, `#!/bin/sh\n# ${what} (see bin/${name}.js).\nexec ${shq(process.execPath)} ${shq(script)} "$@"\n`, { mode: 0o700 });
      chmodSync(file, 0o700);
      // cmd.exe and PowerShell find it by PATHEXT; Git Bash (Claude Code's shell there) runs the sh one.
      if (WIN) writeFileSync(`${file}.cmd`, `@"${process.execPath}" "${script}" %*\r\n`);
      wrote = true;
    }
    return wrote ? dir : undefined;
  }

  private saveScrollback(w: Worker) {
    if (!w.term || !w.ser) return;
    w.unsaved = false;
    this.scrollback.save(w.info.id, terminalTail(w.term, w.ser, SCROLLBACK));
  }

  private persist() {
    const saved = [...this.workers.values()].map(({ info, owner, tracker, codexTranscript, hookToken, pty, bootBlocked, interrupted }) => ({
      id: info.id,
      owner,
      kind: info.kind,
      provider: info.provider,
      model: info.model,
      effort: info.effort,
      deskId: info.deskId,
      name: info.name,
      color: info.color,
      createdBy: info.createdBy,
      createdAt: info.createdAt,
      prompt: info.prompt,
      worktree: info.worktree,
      repos: info.repos,
      title: info.title,
      sessionId: info.sessionId,
      activity: info.activity,
      task: info.task,
      pr: info.pr,
      meeting: info.meeting,
      workedMs: workedMs(info),
      tracker: info.kind === 'agent' ? tracker : undefined,
      usage: info.provider === 'opencode' || info.provider === 'codex' || info.provider === 'dsh' ? info.usage : undefined,
      codexTranscript: info.provider === 'codex' ? codexTranscript : undefined,
      // A terminal still running in the host, to pick back up after a restart. Its hooks keep the token.
      hookToken,
      pty: pty?.id ? { id: pty.id, status: info.status, acked: info.acked, waitingSince: info.waitingSince } : undefined,
      // In the middle of something: if its terminal doesn't make it through a restart, it carries on after.
      midTurn: !this.stopping && (!!interrupted || midTurn({ info, bootBlocked })),
    }));
    try {
      writeFileSync(this.statePath, JSON.stringify(saved, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }

  private restore() {
    if (!existsSync(this.statePath)) return;
    try {
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8')) as (Partial<WorkerInfo> & { owner?: unknown; tracker?: unknown; codexTranscript?: unknown; hookToken?: unknown; pty?: any; midTurn?: unknown })[];
      for (const s of saved) {
        if (!s.id || !s.deskId || !DESK_BY_ID.has(s.deskId) || this.deskOccupied(s.deskId)) continue;
        const tracker = restoreTracker(s.tracker);
        const provider = s.kind === 'shell'
          ? undefined
          : s.provider === 'claude' || s.provider === 'opencode' || s.provider === 'codex' || s.provider === 'grok' || s.provider === 'muse' || s.provider === 'dsh' || s.provider === 'custom'
            ? s.provider
            : tracker.transcript
              ? 'claude'
              : this.defaultProvider;
        const info: WorkerInfo = {
          id: s.id,
          kind: s.kind === 'shell' ? 'shell' : 'agent',
          provider,
          model: provider === 'opencode' && isValidOpenCodeModel(s.model) ? s.model : provider === 'claude' && isClaudeModel(s.model) ? s.model : provider === 'grok' && isValidGrokModel(s.model) ? s.model : provider === 'muse' && isValidMuseModel(s.model) ? s.model : provider === 'dsh' && isValidDshModel(s.model) ? s.model : undefined,
          effort: (provider === 'claude' || provider === 'grok' || provider === 'muse' || provider === 'dsh') && isAgentEffort(s.effort) ? s.effort : undefined,
          deskId: s.deskId,
          name: s.name ?? 'Worker',
          color: s.color ?? COLORS[0],
          status: 'offline',
          acked: true,
          createdBy: s.createdBy ?? '?',
          createdAt: s.createdAt ?? Date.now(),
          prompt: s.prompt,
          worktree: s.worktree,
          repos: s.worktree ? validRepos(s.repos) : undefined,
          title: s.title,
          sessionId: s.sessionId,
          activity: s.activity,
          task: validTask(s.task),
          pr: s.pr && typeof s.pr.number === 'number' && typeof s.pr.url === 'string' ? { number: s.pr.number, url: s.pr.url } : undefined,
          usage: provider === 'opencode' || provider === 'codex' || provider === 'dsh' ? reportedUsage(s.usage) : (provider === 'claude' || provider === 'custom') && tracker.transcript ? trackerUsage(tracker) : undefined,
          cols: 100,
          rows: 30,
          viewers: [],
          viewerIds: [],
          meeting: typeof s.meeting === 'string' && DESK_BY_ID.get(s.deskId)?.room ? s.meeting : undefined,
          workedMs: typeof s.workedMs === 'number' && Number.isFinite(s.workedMs) && s.workedMs > 0 ? s.workedMs : undefined,
        };
        const w = newWorker(info, tracker, typeof s.hookToken === 'string' && s.hookToken ? s.hookToken : undefined);
        if (typeof s.owner === 'string' && s.owner) w.owner = s.owner;
        if (provider === 'codex' && typeof s.codexTranscript === 'string') w.codexTranscript = s.codexTranscript;
        w.screenDirty = false;
        if (typeof s.pty?.id === 'string') {
          const status: WorkerStatus = RUNNING.has(s.pty.status) ? s.pty.status : 'idle';
          w.saved = { ptyId: s.pty.id, status, acked: s.pty.acked !== false, waitingSince: typeof s.pty.waitingSince === 'number' ? s.pty.waitingSince : undefined };
        }
        // Mid-turn as the office went down: cut off, unless its terminal is picked back up still
        // running (adopt). An office from before midTurn only said so for a terminal in the host.
        w.interrupted = typeof s.midTurn === 'boolean' ? s.midTurn : s.pty?.status === 'working' || s.pty?.status === 'needs_input';
        if (info.prompt) w.prompts = [info.prompt.replace(/\s+/g, ' ').trim()];
        this.workers.set(info.id, w);
      }
    } catch {
      // corrupt state file: start fresh
    }
  }
}

// ---------------------------------------------------------------------------

/** In the middle of a turn: working, or asking something (not stuck on a trust or login screen). */
function midTurn({ info, bootBlocked }: Pick<Worker, 'info' | 'bootBlocked'>): boolean {
  return info.kind === 'agent' && (info.status === 'working' || (info.status === 'needs_input' && !bootBlocked));
}

function newWorker(info: WorkerInfo, tracker: UsageTracker, hookToken = randomBytes(16).toString('hex')): Worker {
  return {
    info,
    viewers: new Map(),
    screenDirty: true,
    lastLines: [],
    leftNeedsInputAt: 0,
    keyframeAt: 0,
    hookToken,
    codexUsage: new CodexUsageReader(),
    codexTools: new Map(),
    codexPending: new Set(),
    failStreak: 0,
    prompts: [],
    tools: [],
    toolsSinceNamed: 0,
    namedAt: 0,
    taskEpoch: 0,
    tracker,
  };
}

/** Where a Codex worker's sessions are logged, for reading its usage. */
function codexHome(cwd: string, env: NodeJS.ProcessEnv): string {
  return path.resolve(cwd, env.CODEX_HOME || path.join(env.HOME || homedir(), '.codex'));
}

function withoutOpenCodeModel(args: string[]): string[] {
  const clean: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--model' || arg === '-m') {
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if (arg.startsWith('--model=') || (arg.startsWith('-m') && arg.length > 2)) continue;
    clean.push(arg);
  }
  return clean;
}

/** The office's environment, minus anything that would make a child think it's a nested session. */
export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !scrubbed(k)) env[k] = v;
  return env;
}

function validTask(t: unknown): WorkerTask | undefined {
  const v = t as Partial<WorkerTask> | undefined;
  return typeof v?.name === 'string' && typeof v.summary === 'string' ? { name: v.name, summary: v.summary } : undefined;
}

function isOpenCodeHookEvent(value: unknown): value is OpenCodeStatusEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === 'string' && ['session', 'prompt', 'tool', 'permission', 'question', 'error'].includes(v.type)
    && typeof v.sessionId === 'string' && v.sessionId.length > 0
    && typeof v.status === 'string' && ['starting', 'working', 'needs_input', 'done'].includes(v.status)
    && (v.prompt === undefined || typeof v.prompt === 'string')
    && (v.tool === undefined || typeof v.tool === 'string')
    && (v.detail === undefined || typeof v.detail === 'string');
}

function snapshotScreen(term: HeadlessTerminal, last: string[]) {
  const buf = term.buffer.active;
  const cols = term.cols;
  const rows = term.rows;
  const full = last.length !== rows;
  const lines: Record<number, Run[]> = {};
  let changed = false;
  const cell = buf.getNullCell();
  for (let y = 0; y < rows; y++) {
    const line = buf.getLine(buf.viewportY + y);
    const runs: Run[] = [];
    if (line) {
      let cur: Run | null = null;
      for (let x = 0; x < cols; x++) {
        line.getCell(x, cell);
        const width = cell.getWidth();
        if (width === 0) continue;
        const ch = cell.getChars() || ' ';
        const fg = cell.isFgDefault() ? -1 : cell.isFgRGB() ? RGB_FLAG | cell.getFgColor() : cell.getFgColor();
        const bg = cell.isBgDefault() ? -1 : cell.isBgRGB() ? RGB_FLAG | cell.getBgColor() : cell.getBgColor();
        const flags = (cell.isBold() ? FLAG_BOLD : 0) | (cell.isInverse() ? FLAG_INVERSE : 0) | (cell.isDim() ? FLAG_DIM : 0);
        if (cur && cur[1] === fg && cur[2] === bg && cur[3] === flags) cur[0] += ch;
        else {
          cur = [ch, fg, bg, flags];
          runs.push(cur);
        }
      }
    }
    // Trim trailing default-styled whitespace to keep frames small.
    while (runs.length) {
      const r = runs[runs.length - 1];
      if (r[2] !== -1 || r[3] & FLAG_INVERSE) break;
      const trimmed = r[0].replace(/\s+$/, '');
      if (trimmed) {
        r[0] = trimmed;
        break;
      }
      runs.pop();
    }
    const key = JSON.stringify(runs);
    if (full || last[y] !== key) {
      lines[y] = runs;
      last[y] = key;
      changed = true;
    }
  }
  last.length = rows;
  if (!changed) return null;
  return { cols, rows, lines, full, cursor: [buf.cursorX, buf.cursorY] as [number, number] };
}

/** First-run screens Claude shows before it can take a prompt. */
const SETUP_PROMPT = /trust this folder|Do you trust the files|Select login method|Choose the text style|Press Enter to continue|Bypass Permissions mode/i;
const NOT_LOGGED_IN = /Not logged in\s*·\s*Run \/login|Invalid API key|Please run \/login/i;

/** The text on screen, leaving out rows above buffer row `from`. */
function screenText(term: HeadlessTerminal, from = 0): string {
  const buf = term.buffer.active;
  const out: string[] = [];
  for (let y = Math.max(0, from - buf.viewportY); y < term.rows; y++) out.push(buf.getLine(buf.viewportY + y)?.translateToString(true) ?? '');
  return out.join('\n');
}

/** A script in bin/ of the install this office runs from (src/server under tsx, dist/server/server built). */
function binScript(name: string): string | undefined {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++, dir = path.dirname(dir)) {
    const file = path.join(dir, 'bin', name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

const WIN = process.platform === 'win32';

/** The shell workers get when none is configured: $SHELL on Unix, cmd.exe on Windows. */
export function defaultShell(): string {
  return process.env.SHELL || (WIN ? process.env.COMSPEC || 'cmd.exe' : '/bin/bash');
}

/** How to have the default shell run one command line. */
function shellRun(line: string): string[] {
  return WIN && !process.env.SHELL ? ['/d', '/s', '/c', line] : ['-l', '-i', '-c', line];
}

export function resolveCommand(cmd: string): string | null {
  // Windows runs files by extension: `claude` is really claude.exe / claude.cmd. An npm shim with
  // no extension is a sh script the console can't run, so only take it when asked for by name.
  const exts = WIN && !path.extname(cmd) ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  const usable = (p: string): string | null => {
    for (const ext of exts) {
      try {
        accessSync(p + ext, constants.X_OK);
        return p + ext;
      } catch {
        // keep looking
      }
    }
    return null;
  };
  if (cmd.includes('/') || (WIN && cmd.includes('\\'))) {
    const found = usable(cmd);
    return found && path.resolve(found);
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const found = usable(path.join(dir, cmd));
    if (found) return found;
  }
  if (WIN && !process.env.SHELL) return null;
  try {
    const found = execFileSync(defaultShell(), ['-l', '-i', '-c', `command -v ${shq(cmd)}`], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split('\n')
      .pop();
    if (found && found.startsWith('/')) return found;
  } catch {
    // fall through
  }
  return null;
}

function describeTool(payload: any): string {
  const name = payload?.tool_name ?? 'tool';
  const input = payload?.tool_input ?? {};
  const detail = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.description ?? '';
  return truncate(detail ? `${name}: ${detail}` : String(name), 80);
}

function offlineBanner(info: WorkerInfo): string {
  const hint = info.kind === 'shell' ? ' Press R to restart it.' : info.sessionId ? ' Press R to resume the session.' : '';
  return `\x1b[2m${info.name} is not running.${hint}\x1b[0m\r\n`;
}

/** Runs a command without blocking the office (with `env`: as someone else); rejects with the last lines of its stderr. */
function run(cmd: string, args: string[], cwd: string, timeout = 30_000, env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024, env }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n').filter(Boolean).slice(-2).join(' ') || `${cmd} failed`));
      else resolve(stdout.trim());
    });
  });
}

/**
 * The folder each checkout gets in a workspace: its folder's name, made safe, with -2, -3… when two
 * checkouts share one (owner-a/api and owner-b/api).
 */
export function workspaceNames(dirs: string[]): string[] {
  const used = new Set<string>();
  return dirs.map((dir) => {
    let base = path.basename(path.resolve(dir)).replace(/[^\w.-]+/g, '-').replace(/^[.-]+/, '') || 'project';
    if (WORKSPACE_FILES.has(base)) base = `${base}-repo`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** Takes a workspace folder away once its worktrees are gone: only the brief the office wrote, never anything else left in it. */
function clearWorkspace(abs: string) {
  try {
    for (const name of readdirSync(abs)) if (WORKSPACE_FILES.has(name)) unlinkSync(path.join(abs, name));
    rmdirSync(abs);
  } catch {
    // already gone, or something else is in it: it stays
  }
}

/** The other repositories of a worker across repositories, as workers.json kept them. */
function validRepos(raw: unknown): WorkerRepo[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const repos = raw.flatMap((r): WorkerRepo[] => {
    const floor = str(r?.floor), name = str(r?.name), dir = str(r?.dir), rel = str(r?.path), branch = str(r?.branch), base = str(r?.base);
    if (!floor || !name || !dir || !rel || !branch || !base) return [];
    const pr = r.pr && typeof r.pr.number === 'number' && typeof r.pr.url === 'string' ? { number: r.pr.number, url: r.pr.url } : undefined;
    return [{ floor, name, repo: str(r.repo), dir, path: rel, branch, base, from: str(r.from), pr }];
  });
  return repos.length ? repos : undefined;
}

/** The list of a change's pull requests across repositories, for the description of the one at `self`. */
export function relatedBlock(prs: { repo?: string; url: string }[], self: string, branch: string): string {
  const lines = prs.map((p) => `- ${p.repo ? `**${p.repo}**: ` : ''}${prRef(p.url)}${p.url === self ? ' (this one)' : ''}`);
  return [RELATED_START, `**One change across ${prs.length} repositories**, each on \`${branch}\`: review and merge them together.`, '', ...lines, RELATED_END].join('\n');
}

/** A description with its list of related pull requests put in, or brought up to date. */
export function withRelated(body: string, block: string): string {
  const at = body.indexOf(RELATED_START);
  const end = at < 0 ? -1 : body.indexOf(RELATED_END, at);
  if (end >= 0) return body.slice(0, at) + block + body.slice(end + RELATED_END.length);
  return body.trim() ? `${body.trimEnd()}\n\n${block}` : block;
}

/**
 * A pull request title and body from what the worker was asked to do. The title is the issue's
 * title when the task came off the issues board, else the task's first line; the body carries the
 * task, the commits, a "Closes #n" when the task asked for one, and which desk it came from. With
 * `other`, it's for one of the other repositories of a worker across repositories: the issue is its
 * own floor's (`home`), so this one only mentions it.
 */
function draftPr(info: WorkerInfo, commits: string[], by: string, other?: { home?: string }): { title: string; body: string } {
  const task = (info.prompt ?? '').replace(/\r\n?/g, '\n').trim();
  const firstLine = task.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  // The issues board hands work over as: Work on GitHub issue #12: "Title".
  const issue = /\bissue #(\d+):\s*["“](.+?)["”]\.?\s*$/i.exec(firstLine);
  const title = truncate(issue?.[2] || firstLine.replace(/[.:;,]+$/, '') || commits[0]?.replace(/^\S+\s+/, '') || info.worktree?.branch || info.name, PR_TITLE_MAX);
  const closes = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[^\n]{0,40}?#(\d+)/i.exec(task)?.[1] ?? issue?.[1];
  const parts: string[] = [];
  if (task) parts.push(`## Task\n\n${task.length > PR_TASK_MAX ? `${task.slice(0, PR_TASK_MAX)}…` : task}`);
  parts.push(`## Commits\n\n${commits.map((c) => `- \`${c.slice(0, c.indexOf(' '))}\` ${c.slice(c.indexOf(' ') + 1)}`).join('\n')}`);
  if (closes && !other) parts.push(`Closes #${closes}`);
  else if (closes && other?.home) parts.push(`Part of ${other.home}#${closes}`);
  parts.push(`_Opened from Agent Office by ${by} · ${info.name} at ${DESK_BY_ID.get(info.deskId)?.label ?? info.deskId}_`);
  return { title, body: parts.join('\n\n') };
}

function truncate(s: string, n: number) {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function shq(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** How long a worker has spent working (ms), the stretch it's in now included. */
export function workedMs(info: WorkerInfo, now = Date.now()): number | undefined {
  const ms = (info.workedMs ?? 0) + (info.workingSince === undefined ? 0 : Math.max(0, now - info.workingSince));
  return ms > 0 ? ms : undefined;
}

/** What starting a worker whose worktree was deleted (see WorkerInfo.lost) says instead. */
function lostMessage(info: WorkerInfo): string {
  return `${info.name}'s worktree ${workspaceOf(info)} was deleted outside agent-office — rebuild it or send ${info.name} home from its desk`;
}

/** Keeps count of how long a worker has worked (WorkerInfo.workedMs) as it goes from its status into `next`. */
export function clockWork(info: WorkerInfo, next: WorkerStatus, now = Date.now()) {
  if (next === 'working') {
    info.workingSince ??= now;
    return;
  }
  if (info.workingSince === undefined) return;
  info.workedMs = workedMs(info, now);
  info.workingSince = undefined;
}
