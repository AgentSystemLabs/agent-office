import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, accessSync, constants } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import { homedir } from 'node:os';
import { CodexUsageReader } from './codex-usage.js';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import type { AgentProvider, Run, TerminalHit, WorkerInfo, WorkerKind, WorkerStatus, WorkerTask } from '../shared/protocol.js';
import { FLAG_BOLD, FLAG_DIM, FLAG_INVERSE, RGB_FLAG } from '../shared/protocol.js';
import { Worktrees, describeWork, type WorktreeCleanup, type WorktreeState } from './worktrees.js';
import { DESK_BY_ID, STATION_AGENT } from '../shared/layout.js';
import { stationBrief } from './stations.js';
import { isBusy } from '../shared/status.js';
import { gh } from './github.js';
import type { ServiceOwner } from './services.js';
import { TaskNamer, fallbackTask } from './tasks.js';
import { addUsage, newTracker, restoreTracker, scanTracker, trackerUsage, zeroUsage, type Ledger, type UsageTracker } from './usage.js';
import { PtyHost, SCROLLBACK, type Adopted, type Pty } from './ptys.js';
import { codexHookArgs, normalizeCodexHook, writeCodexHook } from './codex.js';
import { reportedUsage } from './reported-usage.js';
import { configuredProvider, isValidOpenCodeModel, validateWorkerModel } from './agents.js';
import { mergeOpenCodeConfigContent, openCodePluginSpecifier, writeOpenCodePlugin, type OpenCodeStatusEvent } from './opencode.js';
import { ScrollbackStore, searchTerminal, terminalTail } from './history.js';

type HeadlessTerminal = InstanceType<typeof headless.Terminal>;

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

export interface HookEnv {
  url: string;
  token: string;
}

interface Worker {
  info: WorkerInfo;
  pty?: Pty;
  term?: HeadlessTerminal;
  ser?: InstanceType<typeof serialize.SerializeAddon>;
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
  saved?: { ptyId: string; status: WorkerStatus; acked: boolean };
  /** Output since its scrollback was last saved to disk. */
  unsaved?: boolean;
  /** Where this run's own output starts, below the scrollback carried over from before. */
  fresh?: { readonly line: number };
}

export interface WorkerEvents {
  update(info: WorkerInfo): void;
  remove(workerId: string): void;
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
  private screenTimer: NodeJS.Timeout;
  /** The office is shutting down: workers exiting now are being stopped, not failing to resume. */
  private closing = false;
  private namer: TaskNamer;
  private usageTimer: NodeJS.Timeout;
  /** Runs the workers' terminals outside the office, so they outlive a restart of it (see ptys.ts). */
  private host: PtyHost;
  /** Each worker's terminal on disk, so a restart doesn't wipe it (see history.ts). */
  private scrollback: ScrollbackStore;
  private saveTimer: NodeJS.Timeout;

  constructor(
    private dir: string,
    private dataDir: string,
    private agentCmd: string,
    private agentArgs: string[],
    private hook: HookEnv,
    private events: WorkerEvents,
    private ledger: Ledger,
  ) {
    this.defaultProvider = configuredProvider(agentCmd);
    this.trees = new Worktrees(dir);
    this.statePath = path.join(dataDir, 'workers.json');
    this.settingsPath = path.join(dataDir, 'claude-hooks.json');
    this.writeHookSettings();
    this.openCodePlugin = writeOpenCodePlugin(dataDir);
    this.codexHook = writeCodexHook(dataDir);
    this.agentPath = resolveCommand(agentCmd);
    const claude = this.defaultProvider === 'claude' ? this.agentPath : resolveCommand('claude');
    this.namer = new TaskNamer(claude, childEnv(), (id, task, ctx) => {
      const w = this.workers.get(id);
      if (!w || w.taskEpoch !== ctx.epoch) return;
      w.info.task = task;
      this.emitUpdate(w);
      this.persist();
    });
    this.host = new PtyHost(dataDir, () => this.events.toast("The workers' terminal host stopped — resuming them", 'warn'));
    this.scrollback = new ScrollbackStore(dataDir);
    this.restore();
    this.scrollback.prune(new Set(this.workers.keys()));
    // A session may have ended (and written its final tally) while the office was down.
    for (const w of this.workers.values()) this.scanUsage(w);
    this.screenTimer = setInterval(() => this.flushScreens(), SCREEN_INTERVAL_MS);
    this.usageTimer = setInterval(() => {
      for (const w of this.workers.values()) this.scanUsage(w);
    }, USAGE_SCAN_MS);
    this.saveTimer = setInterval(() => {
      for (const w of this.workers.values()) if (w.unsaved) this.saveScrollback(w);
    }, SAVE_SCROLLBACK_MS);
  }

  /**
   * Picks every worker whose terminal outlived the last office (a dev-server reload, an upgrade)
   * back up where it is, mid-turn or not. Whoever else was at a desk when the office stopped (a
   * restart, a crash) gets straight back to work. Call once, before anyone can walk in.
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
    this.wakeAll();
  }

  get resolvedAgent(): string | null {
    return this.agentPath;
  }

  list(): WorkerInfo[] {
    return [...this.workers.values()].map((w) => w.info);
  }

  get(id: string): WorkerInfo | undefined {
    return this.workers.get(id)?.info;
  }

  /** Each worker's terminal process and directory, to tell whose servers are whose. */
  owners(): ServiceOwner[] {
    return [...this.workers.values()].map((w) => ({
      workerId: w.info.id,
      pid: w.pty?.pid,
      agent: w.info.kind === 'agent',
      cwd: w.info.worktree ? path.join(this.dir, w.info.worktree.path) : this.dir,
      root: this.dir,
    }));
  }

  deskOccupied(deskId: string): boolean {
    for (const w of this.workers.values()) if (w.info.deskId === deskId) return true;
    return false;
  }

  spawn(deskId: string, by: string, prompt?: string, worktree = false, kind: WorkerKind = 'agent', provider?: AgentProvider, model?: string): WorkerInfo | string {
    const selectedProvider = kind === 'agent' ? provider ?? this.defaultProvider : undefined;
    const modelError = validateWorkerModel(kind, selectedProvider, model);
    if (modelError) return modelError;
    const seat = DESK_BY_ID.get(deskId);
    if (!seat) return 'Unknown desk';
    if (this.deskOccupied(deskId)) return seat.station ? `The ${STATION_AGENT[seat.station].name} is already there` : `That ${seat.beanbag ? 'bean bag' : 'desk'} is taken`;
    if (kind === 'shell' && seat.station) return 'A board agent is always an agent, not a shell';
    if (seat.station && !prompt?.trim()) return 'Tell the board agent what to do';
    if (kind === 'shell' && provider !== undefined) return 'Shell workers do not have an agent provider';
    if (kind === 'agent' && selectedProvider === 'custom' && this.defaultProvider !== 'custom') return 'Custom is not the configured agent provider';
    if (kind === 'agent') {
      const paused = this.ledger.hiringPaused;
      if (paused) return paused;
    }
    const used = new Set([...this.workers.values()].map((w) => w.info.name.replace(/ 🐚$/, '')));
    const agent = seat.station && STATION_AGENT[seat.station];
    const name = agent ? agent.name : (NAMES.find((n) => !used.has(n)) ?? `Worker ${this.workers.size + 1}`);
    const id = randomBytes(6).toString('hex');
    let wt: WorkerInfo['worktree'];
    if (worktree) {
      const made = this.trees.create(`${name.toLowerCase()}-${id.slice(0, 4)}`);
      if (typeof made === 'string') return made;
      wt = made;
    }
    const info: WorkerInfo = {
      id,
      kind,
      provider: selectedProvider,
      model: selectedProvider === 'opencode' ? model : undefined,
      deskId,
      name: kind === 'shell' ? `${name} 🐚` : name,
      color: kind === 'shell' ? '#8d99ae' : agent ? agent.color : COLORS[Math.floor(Math.random() * COLORS.length)],
      status: 'starting',
      acked: true,
      createdBy: by,
      createdAt: Date.now(),
      prompt: kind === 'shell' ? undefined : prompt?.trim() || undefined,
      worktree: wt,
      cols: 100,
      rows: 30,
      viewers: [],
      activity: prompt ? truncate(prompt, 80) : undefined,
    };
    const w = newWorker(info, newTracker());
    this.workers.set(id, w);
    if (info.prompt) this.notePrompt(w, info.prompt);
    // A board agent is told what it's there for ahead of its first request (which is what shows).
    this.launch(w, seat.station && info.prompt ? `${stationBrief(seat.station)}\n\n${info.prompt}` : info.prompt, undefined);
    this.persist();
    return info;
  }

  /** Starts a worker that isn't running again, carrying on its session, with `prompt` as its next message. */
  resume(id: string, prompt?: string): string | undefined {
    const w = this.workers.get(id);
    if (!w) return 'No such worker';
    if (w.pty) return 'Worker is already running';
    w.info.status = 'starting';
    w.info.exitCode = undefined;
    const station = DESK_BY_ID.get(w.info.deskId)?.station;
    // A board agent with no session to carry on starts over, so it needs telling what it's for again.
    const first = prompt && station && !w.info.sessionId ? `${stationBrief(station)}\n\n${prompt}` : prompt;
    if (prompt) {
      w.info.activity = truncate(prompt, 80);
      this.notePrompt(w, prompt);
    }
    this.launch(w, first, w.info.sessionId);
    return undefined;
  }

  /**
   * A request for the agent standing by a board (see STATIONS): typed into its session, which is woken
   * up with it if it's asleep, or it's hired there with it when nobody is. Returns what went wrong, or
   * the agent and whether it was just hired.
   */
  station(deskId: string, by: string, text: string): { info: WorkerInfo; hired: boolean } | string {
    if (!DESK_BY_ID.get(deskId)?.station) return 'There is no agent to ask there';
    const clean = text.replace(/\r\n?/g, '\n').trim();
    if (!clean) return 'Empty prompt';
    const w = [...this.workers.values()].find((x) => x.info.deskId === deskId);
    if (!w) {
      const info = this.spawn(deskId, by, clean);
      return typeof info === 'string' ? info : { info, hired: true };
    }
    // Typed into the question it's asking, the prompt would answer it.
    if (w.info.status === 'needs_input') return `The ${w.info.name} is waiting on an answer in its terminal`;
    if (!w.pty) w.info.lastInput = { by, at: Date.now() };
    const err = w.pty ? this.prompt(w.info.id, clean, by) : this.resume(w.info.id, clean);
    return err ?? { info: w.info, hired: false };
  }

  /** The worker whose terminal holds this hook token: how a worker proves it's asking for itself. */
  authenticate(id: string, token: string): WorkerInfo | undefined {
    const w = this.workers.get(id);
    return w?.pty && token && safeEq(token, w.hookToken) ? w.info : undefined;
  }

  /** Starts every worker that isn't running: nobody should be found asleep at their desk. */
  wakeAll() {
    for (const w of this.workers.values()) if (!w.pty) this.resume(w.info.id);
  }

  /**
   * Sends a worker home. For one with its own worktree, `cleanup` says what becomes of it; with no
   * choice given, the worktree and branch go only when they hold no work. Resolves once that's done,
   * with a line for the team about the worktree.
   */
  async kill(id: string, cleanup?: WorktreeCleanup): Promise<{ note?: string; error?: string }> {
    const w = this.workers.get(id);
    if (!w) return {};
    this.workers.delete(id);
    this.namer.forget(id);
    clearTimeout(w.scanTimer);
    const proc = w.pty;
    w.pty = undefined; // so the exit handler knows this worker is gone and stays quiet
    try {
      proc?.kill();
    } catch {
      // already gone
    }
    w.term?.dispose();
    this.scrollback.remove(id);
    this.events.remove(id);
    this.persist();
    const wt = w.info.worktree;
    if (!wt) return {};
    const name = w.info.name;
    if (!cleanup) {
      const work = describeWork(await this.trees.inspect(wt));
      if (work) return { note: `Kept ${name}'s worktree and branch ${wt.branch} — it has ${work}` };
      cleanup = 'all';
    }
    if (cleanup === 'keep') return { note: `Kept ${name}'s worktree and branch ${wt.branch}` };
    const error = await this.trees.remove(wt, cleanup);
    if (error) return { error: `Couldn't delete ${name}'s worktree: ${error}` };
    return { note: cleanup === 'all' ? `Deleted ${name}'s worktree and branch ${wt.branch}` : `Deleted ${name}'s worktree and kept branch ${wt.branch}` };
  }

  /** What a worker's worktree holds, so whoever sends it home knows what deleting it would lose. */
  inspectWorktree(id: string): Promise<WorktreeState | undefined> {
    const wt = this.workers.get(id)?.info.worktree;
    return wt ? this.trees.inspect(wt) : Promise.resolve(undefined);
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
    const data = w.ser ? w.ser.serialize({ scrollback: SCROLLBACK }) : offlineBanner(w.info);
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
    if (!w?.pty) return;
    w.pty.write(data);
    let changed = this.typed(w, by);
    if (w.info.status === 'needs_input' && w.info.acked === false) {
      w.info.acked = true;
      changed = true;
    }
    if (changed) this.emitUpdate(w);
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
   * drafted from its task. Resolves to the PR, or to a message saying why there is none. The
   * branch may already have an open PR (a second press, or one opened by hand): that one is used.
   */
  async openPr(id: string, by: string): Promise<{ number: number; url: string; existed: boolean; dirty: boolean } | string> {
    const w = this.workers.get(id);
    if (!w) return 'No such worker';
    const { info } = w;
    const wt = info.worktree;
    if (!wt) return `${info.name} works in the main checkout — only workers with their own worktree can open a PR`;
    if (info.prOpening) return `${info.name}'s pull request is already being opened`;
    if (isBusy(info.status)) {
      return `${info.name} is still ${info.status === 'needs_input' ? 'waiting on input' : info.status} — wait until it's done`;
    }
    const cwd = path.join(this.dir, wt.path);
    if (!existsSync(cwd)) return `${info.name}'s worktree is gone (${wt.path})`;
    info.prOpening = true;
    this.emitUpdate(w);
    try {
      const commits = (await run('git', ['log', '--reverse', '--format=%h %s', `${wt.base}..${wt.branch}`], cwd)).split('\n').filter(Boolean);
      const dirty = (await run('git', ['status', '--porcelain'], cwd)) !== '';
      if (!commits.length) return dirty ? `${info.name} hasn't committed anything yet — ask it to commit first` : `${info.name} has no commits on ${wt.branch} yet`;
      const open = await findOpenPr(wt.branch, cwd);
      if (open) {
        info.pr = open;
        this.persist();
        return { ...open, existed: true, dirty };
      }
      await run('git', ['push', '-u', 'origin', wt.branch], cwd, 90_000);
      const base = await this.pushedBranch([wt.from, this.trees.currentBranch()], wt.branch);
      const { title, body } = draftPr(info, commits, by);
      const out = await gh(['pr', 'create', '--head', wt.branch, ...(base ? ['--base', base] : []), '--title', title, '--body', body], cwd, 60_000);
      const url = out.trim().split('\n').pop() ?? '';
      const number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
      if (!number) throw new Error(`gh did not return a pull request URL (${truncate(out, 120)})`);
      info.pr = { number, url };
      this.persist();
      return { number, url, existed: false, dirty };
    } catch (err) {
      return `Couldn't open a PR for ${info.name}: ${(err as Error).message}`;
    } finally {
      info.prOpening = false;
      // The worker may have been sent home meanwhile; an update would bring it back as a ghost.
      if (this.workers.get(id) === w) this.emitUpdate(w);
    }
  }

  /** The first of these branches that exists on origin, for a PR base. None: gh picks the default branch. */
  private async pushedBranch(candidates: (string | undefined)[], not: string): Promise<string | undefined> {
    for (const c of candidates) {
      if (!c || c === not) continue;
      try {
        await run('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${c}`], this.dir);
        return c;
      } catch {
        // not on the remote (or never fetched)
      }
    }
    return undefined;
  }

  resize(id: string, cols: number, rows: number) {
    const w = this.workers.get(id);
    if (!w?.pty || !w.term) return;
    cols = clamp(Math.floor(cols), 20, 400);
    rows = clamp(Math.floor(rows), 5, 200);
    if (cols === w.info.cols && rows === w.info.rows) return;
    w.info.cols = cols;
    w.info.rows = rows;
    try {
      w.pty.resize(cols, rows);
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
        if (payload?.source === 'clear') this.clearTask(w);
        if (w.info.status === 'starting' || (w.bootBlocked && w.info.status === 'needs_input')) {
          w.bootBlocked = false;
          this.setStatus(w, 'idle');
        }
        break;
      case 'UserPromptSubmit':
        w.bootBlocked = false;
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
          this.noteTool(w, w.info.activity);
          if (w.info.status !== 'working') this.setStatus(w, 'working');
          else this.emitUpdate(w);
        }
        break;
      case 'PostToolUse':
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
        if (report.prompt) {
          w.info.activity = truncate(report.prompt, 80);
          this.notePrompt(w, report.prompt);
        }
        this.setStatus(w, 'working');
        break;
      case 'PreToolUse':
        w.info.activity = report.tool ? truncate(report.tool, 80) : 'Using a tool';
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
      this.notePrompt(w, payload.prompt);
    } else if (payload.tool) {
      w.info.activity = truncate(payload.tool, 80);
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
    // Bare slash commands (/model, /compact) and repeats aren't new work.
    if (!clean || /^\/\S+$/.test(clean) || w.prompts.at(-1) === clean) return;
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
    clearInterval(this.screenTimer);
    clearInterval(this.usageTimer);
    clearInterval(this.saveTimer);
    for (const w of this.workers.values()) {
      clearTimeout(w.scanTimer);
      this.scanUsage(w);
      // Before the process goes, so the next office shows what it was doing, not how it was stopped.
      if (w.unsaved) this.saveScrollback(w);
      if (keep && w.pty?.id) continue;
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

    const shell = process.env.SHELL || '/bin/bash';
    const isShell = info.kind === 'shell';
    const provider = info.provider;
    const isClaude = !isShell && provider === 'claude';
    const isOpenCode = !isShell && provider === 'opencode';
    const isCodex = !isShell && provider === 'codex';
    const configured = !isShell && provider === this.defaultProvider;
    const command = this.command(info);
    const commandPath = isShell ? undefined : configured ? this.agentPath : resolveCommand(command);
    let args = isShell ? ['-l'] : configured ? [...this.agentArgs] : [];
    if (isClaude) {
      args.unshift('--settings', this.settingsPath);
      if (resumeSessionId) args.push('--resume', resumeSessionId);
      // `--` so a prompt like "- fix login" is never parsed as a CLI option.
      if (prompt) args.push('--', prompt);
    } else if (isOpenCode) {
      if (resumeSessionId || info.model) args = withoutOpenCodeModel(args);
      if (!resumeSessionId && info.model) args.push('--model', info.model);
      if (resumeSessionId) args.push('--session', resumeSessionId);
      if (prompt) args.push('--prompt', prompt);
    } else if (isCodex) {
      args.push(...codexHookArgs(this.codexHook), '--no-alt-screen');
      if (resumeSessionId) args.push('resume', resumeSessionId);
      if (prompt) args.push('--', prompt);
    }
    if (isCodex) {
      w.codexTools.clear();
      w.codexPending.clear();
      w.codexPermissionUnknown = false;
    }
    if (isOpenCode || isCodex) {
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

    const cwd = this.cwd(info);
    if (isCodex) w.codexHome = codexHome(cwd, env);
    // The host keeps its own copy of the screen for the next office: it starts with the same history.
    const where = { cwd, env, cols: info.cols, rows: info.rows, prelude };
    let proc: Pty;
    try {
      if (!existsSync(cwd)) throw new Error(`working directory is gone: ${cwd}`);
      if (isOpenCode) {
        env.AGENT_OFFICE_SESSION_ID = resumeSessionId ?? '';
        env.OPENCODE_CONFIG_CONTENT = mergeOpenCodeConfigContent(env.OPENCODE_CONFIG_CONTENT, openCodePluginSpecifier(this.openCodePlugin));
      }
      if (isShell) {
        proc = this.host.spawn({ file: shell, args, ...where });
      } else if (commandPath) {
        proc = this.host.spawn({ file: commandPath, args, ...where });
      } else {
        // Not found on PATH: let a login shell find it (nvm, asdf, ~/.local/bin ...).
        const line = ['exec', command, ...args].map((a, i) => (i < 2 ? a : shq(a))).join(' ');
        proc = this.host.spawn({ file: shell, args: ['-l', '-i', '-c', line], ...where });
      }
    } catch (err) {
      this.startFailed(w, (err as Error).message);
      return;
    }
    if (!isClaude && !isCodex) info.status = 'idle';
    this.follow(w, proc, term, resumeSessionId);
    this.emitUpdate(w);
    this.persist();
  }

  /** Takes back a terminal the host kept running while the office was down. */
  private adopt(w: Worker, adopted: Adopted, saved: NonNullable<Worker['saved']>) {
    const { info } = w;
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
      info.status = saved.status;
      info.acked = saved.acked;
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
    w.lastLines = [];
    w.screenDirty = true;
    w.fresh = undefined;
    return term;
  }

  private setTitle(w: Worker, title: string) {
    const clean = title.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (clean && clean !== w.info.title && !/^claude( code)?$/i.test(clean)) {
      w.info.title = clean;
      this.emitUpdate(w);
    }
  }

  /** Shows a worker's terminal output as it comes, and deals with the process ending. */
  private follow(w: Worker, proc: Pty, term: HeadlessTerminal, resumeSessionId: string | undefined) {
    const { info } = w;
    const isClaude = info.kind === 'agent' && info.provider === 'claude';
    const isCodex = info.kind === 'agent' && info.provider === 'codex';
    w.pty = proc;
    proc.onData((data) => {
      term.write(data);
      w.screenDirty = true;
      w.unsaved = true;
      if (w.viewers.size) this.events.data(info.id, data, [...w.viewers.keys()]);
    });
    proc.onExit(({ exitCode, error, lost }) => {
      if (w.pty !== proc || this.workers.get(info.id) !== w) return;
      w.pty = undefined;
      if (error) {
        this.startFailed(w, error);
        return;
      }
      // The terminal host died and took the process with it: nothing the worker did.
      if (lost && !this.closing) {
        this.resume(info.id);
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
      info.status = 'exited';
      const hint = info.kind === 'shell' ? ' — press R to restart' : info.sessionId ? ' — press R to resume' : '';
      const msg = `\r\n\x1b[2m[${info.name} exited with code ${exitCode}${hint}]\x1b[0m\r\n`;
      term.write(msg);
      if (w.viewers.size) this.events.data(info.id, msg, [...w.viewers.keys()]);
      w.screenDirty = true;
      w.unsaved = true;
      this.emitUpdate(w);
      this.persist();
    });
    // SessionStart fires as soon as Claude can take input. Still silent after a while means it is
    // blocked on a human: folder trust dialog, login, first-run onboarding. Flag it so it jumps.
    setTimeout(() => {
      if (info.status !== 'starting' || w.pty !== proc) return;
      if (isClaude || isCodex) {
        w.bootBlocked = true;
        info.activity = isCodex
          ? 'Open the terminal: complete login and review Office hooks in /hooks'
          : 'Waiting on a setup prompt (trust / login) — open the terminal';
        this.setStatus(w, 'needs_input');
      } else this.setStatus(w, 'idle');
    }, 12000);
  }

  private startFailed(w: Worker, message: string) {
    const what = this.command(w.info);
    const msg = `\r\n\x1b[31mFailed to start ${what}: ${message}\x1b[0m\r\n`;
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
    if (info.kind === 'shell') return process.env.SHELL || '/bin/bash';
    return info.provider === this.defaultProvider ? this.agentCmd : info.provider ?? this.agentCmd;
  }

  private cwd(info: WorkerInfo): string {
    return info.worktree ? path.join(this.dir, info.worktree.path) : this.dir;
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
    w.info.status = status;
    // Nobody is looking at the terminal right now -> raise the flag (the worker jumps).
    if (status === 'done' || status === 'needs_input') w.info.acked = w.viewers.size > 0 && status === 'done';
    else w.info.acked = true;
    this.emitUpdate(w);
    // What a restarted office picks the worker back up as, should its terminal outlive this one.
    if (w.pty?.id) this.persist();
  }

  private syncViewers(w: Worker): boolean {
    const names = [...new Set(w.viewers.values())];
    const same = names.length === w.info.viewers.length && names.every((n, i) => n === w.info.viewers[i]);
    if (same) return false;
    w.info.viewers = names;
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
    writeFileSync(this.settingsPath, JSON.stringify({ hooks }, null, 2), { mode: 0o600 });
  }

  private saveScrollback(w: Worker) {
    if (!w.term || !w.ser) return;
    w.unsaved = false;
    this.scrollback.save(w.info.id, terminalTail(w.term, w.ser, SCROLLBACK));
  }

  private persist() {
    const saved = [...this.workers.values()].map(({ info, tracker, codexTranscript, hookToken, pty }) => ({
      id: info.id,
      kind: info.kind,
      provider: info.provider,
      model: info.model,
      deskId: info.deskId,
      name: info.name,
      color: info.color,
      createdBy: info.createdBy,
      createdAt: info.createdAt,
      prompt: info.prompt,
      worktree: info.worktree,
      title: info.title,
      sessionId: info.sessionId,
      activity: info.activity,
      task: info.task,
      pr: info.pr,
      tracker: info.kind === 'agent' ? tracker : undefined,
      usage: info.provider === 'opencode' || info.provider === 'codex' ? info.usage : undefined,
      codexTranscript: info.provider === 'codex' ? codexTranscript : undefined,
      // A terminal still running in the host, to pick back up after a restart. Its hooks keep the token.
      hookToken,
      pty: pty?.id ? { id: pty.id, status: info.status, acked: info.acked } : undefined,
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
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8')) as (Partial<WorkerInfo> & { tracker?: unknown; codexTranscript?: unknown; hookToken?: unknown; pty?: any })[];
      for (const s of saved) {
        if (!s.id || !s.deskId || !DESK_BY_ID.has(s.deskId) || this.deskOccupied(s.deskId)) continue;
        const tracker = restoreTracker(s.tracker);
        const provider = s.kind === 'shell'
          ? undefined
          : s.provider === 'claude' || s.provider === 'opencode' || s.provider === 'codex' || s.provider === 'custom'
            ? s.provider
            : tracker.transcript
              ? 'claude'
              : this.defaultProvider;
        const info: WorkerInfo = {
          id: s.id,
          kind: s.kind === 'shell' ? 'shell' : 'agent',
          provider,
          model: provider === 'opencode' && isValidOpenCodeModel(s.model) ? s.model : undefined,
          deskId: s.deskId,
          name: s.name ?? 'Worker',
          color: s.color ?? COLORS[0],
          status: 'offline',
          acked: true,
          createdBy: s.createdBy ?? '?',
          createdAt: s.createdAt ?? Date.now(),
          prompt: s.prompt,
          worktree: s.worktree,
          title: s.title,
          sessionId: s.sessionId,
          activity: s.activity,
          task: validTask(s.task),
          pr: s.pr && typeof s.pr.number === 'number' && typeof s.pr.url === 'string' ? { number: s.pr.number, url: s.pr.url } : undefined,
          usage: provider === 'opencode' || provider === 'codex' ? reportedUsage(s.usage) : (provider === 'claude' || provider === 'custom') && tracker.transcript ? trackerUsage(tracker) : undefined,
          cols: 100,
          rows: 30,
          viewers: [],
        };
        const w = newWorker(info, tracker, typeof s.hookToken === 'string' && s.hookToken ? s.hookToken : undefined);
        if (provider === 'codex' && typeof s.codexTranscript === 'string') w.codexTranscript = s.codexTranscript;
        w.screenDirty = false;
        if (typeof s.pty?.id === 'string') {
          const status: WorkerStatus = RUNNING.has(s.pty.status) ? s.pty.status : 'idle';
          w.saved = { ptyId: s.pty.id, status, acked: s.pty.acked !== false };
        }
        if (info.prompt) w.prompts = [info.prompt.replace(/\s+/g, ' ').trim()];
        this.workers.set(info.id, w);
      }
    } catch {
      // corrupt state file: start fresh
    }
  }
}

// ---------------------------------------------------------------------------

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

export function resolveCommand(cmd: string): string | null {
  if (cmd.includes('/')) {
    try {
      accessSync(cmd, constants.X_OK);
      return path.resolve(cmd);
    } catch {
      return null;
    }
  }
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch {
      // keep looking
    }
  }
  try {
    const shell = process.env.SHELL || '/bin/bash';
    const found = execFileSync(shell, ['-l', '-i', '-c', `command -v ${shq(cmd)}`], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
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

/** Runs a command without blocking the office; rejects with the last lines of its stderr. */
function run(cmd: string, args: string[], cwd: string, timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n').filter(Boolean).slice(-2).join(' ') || `${cmd} failed`));
      else resolve(stdout.trim());
    });
  });
}

async function findOpenPr(branch: string, cwd: string): Promise<{ number: number; url: string } | undefined> {
  const out = await gh(['pr', 'list', '--head', branch, '--state', 'open', '--limit', '1', '--json', 'number,url'], cwd);
  const found = (JSON.parse(out || '[]') as { number: number; url: string }[])[0];
  return found ? { number: found.number, url: found.url } : undefined;
}

/**
 * A pull request title and body from what the worker was asked to do. The title is the issue's
 * title when the task came off the issues board, else the task's first line; the body carries the
 * task, the commits, a "Closes #n" when the task asked for one, and which desk it came from.
 */
function draftPr(info: WorkerInfo, commits: string[], by: string): { title: string; body: string } {
  const task = (info.prompt ?? '').replace(/\r\n?/g, '\n').trim();
  const firstLine = task.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  // The issues board hands work over as: Work on GitHub issue #12: "Title".
  const issue = /\bissue #(\d+):\s*["“](.+?)["”]\.?\s*$/i.exec(firstLine);
  const title = truncate(issue?.[2] || firstLine.replace(/[.:;,]+$/, '') || commits[0]?.replace(/^\S+\s+/, '') || info.worktree?.branch || info.name, PR_TITLE_MAX);
  const closes = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b[^\n]{0,40}?#(\d+)/i.exec(task)?.[1] ?? issue?.[1];
  const parts: string[] = [];
  if (task) parts.push(`## Task\n\n${task.length > PR_TASK_MAX ? `${task.slice(0, PR_TASK_MAX)}…` : task}`);
  parts.push(`## Commits\n\n${commits.map((c) => `- \`${c.slice(0, c.indexOf(' '))}\` ${c.slice(c.indexOf(' ') + 1)}`).join('\n')}`);
  if (closes) parts.push(`Closes #${closes}`);
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

function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
