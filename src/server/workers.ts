import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, accessSync, constants } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import path from 'node:path';
import * as pty from '@lydell/node-pty';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import type { AgentProvider, Run, WorkerInfo, WorkerKind, WorkerStatus, WorkerTask } from '../shared/protocol.js';
import { FLAG_BOLD, FLAG_DIM, FLAG_INVERSE, RGB_FLAG } from '../shared/protocol.js';
import { Worktrees, describeWork, type WorktreeCleanup, type WorktreeState } from './worktrees.js';
import { DESK_BY_ID } from '../shared/layout.js';
import { gh } from './github.js';
import type { ServiceOwner } from './services.js';
import { TaskNamer, fallbackTask } from './tasks.js';
import { addUsage, newTracker, restoreTracker, scanTracker, trackerUsage, zeroUsage, type Ledger, type UsageTracker } from './usage.js';
import { configuredProvider, isValidOpenCodeModel, validateWorkerModel } from './agents.js';
import { mergeOpenCodeConfigContent, openCodePluginSpecifier, writeOpenCodePlugin, type OpenCodeHookEvent } from './opencode.js';

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
  'NO_COLOR', 'FORCE_COLOR', 'VSCODE_INJECTION', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION',
]);
const SCRUB_PREFIXES = ['CLAUDE_CODE_SESSION', 'CLAUDE_CODE_CHILD', 'CLAUDE_CODE_MESSAGING', 'NEBULA_', 'AGENT_OFFICE_'];
const scrubbed = (k: string) => SCRUB_ENV.has(k) || SCRUB_PREFIXES.some((p) => k.startsWith(p));

const SCROLLBACK = 3000;
const SCREEN_INTERVAL_MS = 250;
const LATE_PROMPT_GRACE_MS = 5000;
const KEYFRAME_MS = 8000;
/** How many of a worker's latest prompts and tool calls the task namer sees. */
const TASK_PROMPTS = 5;
const TASK_TOOLS = 10;
/** While a worker works, refresh its task summary after this many tool calls, at most this often. */
const TASK_REFRESH_TOOLS = 8;
const TASK_REFRESH_MS = 90_000;
const PR_TITLE_MAX = 72;
const PR_TASK_MAX = 2500;
/** How often every worker's transcript is checked for new spend, on top of the hook-driven checks. */
const USAGE_SCAN_MS = 10_000;

export interface HookEnv {
  url: string;
  token: string;
}

interface Worker {
  info: WorkerInfo;
  pty?: pty.IPty;
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
  private screenTimer: NodeJS.Timeout;
  /** The office is shutting down: workers exiting now are being stopped, not failing to resume. */
  private closing = false;
  private namer: TaskNamer;
  private usageTimer: NodeJS.Timeout;

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
    this.agentPath = resolveCommand(agentCmd);
    const claude = this.defaultProvider === 'claude' ? this.agentPath : resolveCommand('claude');
    this.namer = new TaskNamer(claude, childEnv(), (id, task, ctx) => {
      const w = this.workers.get(id);
      if (!w || w.taskEpoch !== ctx.epoch) return;
      w.info.task = task;
      this.emitUpdate(w);
      this.persist();
    });
    this.restore();
    // A session may have ended (and written its final tally) while the office was down.
    for (const w of this.workers.values()) this.scanUsage(w);
    this.screenTimer = setInterval(() => this.flushScreens(), SCREEN_INTERVAL_MS);
    this.usageTimer = setInterval(() => {
      for (const w of this.workers.values()) this.scanUsage(w);
    }, USAGE_SCAN_MS);
    // Whoever was at a desk when the office stopped (a restart, a crash, a dev-server reload) gets
    // straight back to work.
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
    if (!DESK_BY_ID.has(deskId)) return 'Unknown desk';
    if (this.deskOccupied(deskId)) return 'That desk is taken';
    if (kind === 'shell' && provider !== undefined) return 'Shell workers do not have an agent provider';
    if (kind === 'agent' && selectedProvider === 'custom' && this.defaultProvider !== 'custom') return 'Custom is not the configured agent provider';
    if (kind === 'agent') {
      const paused = this.ledger.hiringPaused;
      if (paused) return paused;
    }
    const used = new Set([...this.workers.values()].map((w) => w.info.name.replace(/ 🐚$/, '')));
    const name = NAMES.find((n) => !used.has(n)) ?? `Worker ${this.workers.size + 1}`;
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
      color: kind === 'shell' ? '#8d99ae' : COLORS[Math.floor(Math.random() * COLORS.length)],
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
    this.launch(w, info.prompt, undefined);
    this.persist();
    return info;
  }

  resume(id: string): string | undefined {
    const w = this.workers.get(id);
    if (!w) return 'No such worker';
    if (w.pty) return 'Worker is already running';
    w.info.status = 'starting';
    w.info.exitCode = undefined;
    this.launch(w, undefined, w.info.sessionId);
    return undefined;
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

  write(id: string, data: string) {
    const w = this.workers.get(id);
    if (!w?.pty) return;
    w.pty.write(data);
    if (w.info.status === 'needs_input' && w.info.acked === false) {
      w.info.acked = true;
      this.emitUpdate(w);
    }
  }

  /** Types a prompt into the agent's input box and submits it. */
  prompt(id: string, text: string): string | undefined {
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
    if (info.status === 'starting' || info.status === 'working' || info.status === 'needs_input') {
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
    if (!w || !w.pty || w.info.kind !== 'agent' || w.info.provider === 'opencode' || !safeEq(token, w.hookToken)) return false;
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

  /** OpenCode plugin callback. The plugin has already filtered child sessions before this bridge. */
  handleOpenCodeHook(workerId: string, token: string, payload: unknown): boolean {
    const w = this.workers.get(workerId);
    if (!w || !w.pty || w.info.kind !== 'agent' || w.info.provider !== 'opencode' || !safeEq(token, w.hookToken)) return false;
    if (!isOpenCodeHookEvent(payload)) return false;
    if (w.info.sessionId && w.info.sessionId !== payload.sessionId && !(payload.type === 'session' && payload.status === 'starting')) return false;
    if (!w.info.sessionId || (payload.type === 'session' && payload.status === 'starting' && w.info.sessionId !== payload.sessionId)) {
      const switching = !!w.info.sessionId;
      w.info.sessionId = payload.sessionId;
      if (switching) {
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
    if (w.info.provider === 'opencode') return;
    // "yes", "go ahead", "2": a reply within the same task, not worth a new name.
    if (hadTask && clean.length < 16) return;
    this.nameTask(w);
  }

  private noteTool(w: Worker, tool: string) {
    if (w.info.provider === 'opencode') return;
    w.tools = [...w.tools, tool].slice(-TASK_TOOLS);
    w.toolsSinceNamed++;
    if (w.info.task && w.toolsSinceNamed >= TASK_REFRESH_TOOLS && Date.now() - w.namedAt > TASK_REFRESH_MS) this.nameTask(w);
  }

  private nameTask(w: Worker) {
    if (w.info.provider === 'opencode') return;
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

  shutdown() {
    this.closing = true;
    clearInterval(this.screenTimer);
    clearInterval(this.usageTimer);
    for (const w of this.workers.values()) {
      try {
        w.pty?.kill();
      } catch {
        // ignore
      }
    }
    this.persist();
  }

  // ---------------------------------------------------------------------------

  private launch(w: Worker, prompt: string | undefined, resumeSessionId: string | undefined) {
    const { info } = w;
    const term = new headless.Terminal({ cols: info.cols, rows: info.rows, scrollback: SCROLLBACK, allowProposedApi: true });
    const ser = new serialize.SerializeAddon();
    term.loadAddon(ser as any);
    // OSC 9;4 progress (Claude Code emits it): 0 = idle, anything else = busy. Catches Esc-cancel,
    // which fires no Stop hook.
    if (info.provider === 'claude') {
      term.parser.registerOscHandler(9, (data: string) => {
        const m = /^4;(\d)/.exec(data);
        if (m) this.onProgress(w, m[1] !== '0');
        return true;
      });
    }
    term.onTitleChange((title: string) => {
      const clean = title.replace(/^[^\p{L}\p{N}]+/u, '').trim();
      if (clean && clean !== info.title && !/^claude( code)?$/i.test(clean)) {
        info.title = clean;
        this.emitUpdate(w);
      }
    });
    w.term?.dispose();
    w.term = term;
    w.ser = ser;
    w.lastLines = [];
    w.screenDirty = true;

    const shell = process.env.SHELL || '/bin/bash';
    const isShell = info.kind === 'shell';
    const provider = info.provider;
    const isClaude = !isShell && provider === 'claude';
    const isOpenCode = !isShell && provider === 'opencode';
    const configured = !isShell && provider === this.defaultProvider;
    const command = isShell ? shell : configured ? this.agentCmd : provider ?? this.agentCmd;
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
    }
    if (isOpenCode) {
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

    const cwd = info.worktree ? path.join(this.dir, info.worktree.path) : this.dir;
    let proc: pty.IPty;
    try {
      if (!existsSync(cwd)) throw new Error(`working directory is gone: ${cwd}`);
      if (isOpenCode) {
        env.AGENT_OFFICE_SESSION_ID = resumeSessionId ?? '';
        env.OPENCODE_CONFIG_CONTENT = mergeOpenCodeConfigContent(env.OPENCODE_CONFIG_CONTENT, openCodePluginSpecifier(this.openCodePlugin));
      }
      if (isShell) {
        proc = pty.spawn(shell, args, { name: 'xterm-256color', cols: info.cols, rows: info.rows, cwd, env });
      } else if (commandPath) {
        proc = pty.spawn(commandPath, args, { name: 'xterm-256color', cols: info.cols, rows: info.rows, cwd, env });
      } else {
        // Not found on PATH: let a login shell find it (nvm, asdf, ~/.local/bin ...).
        const line = ['exec', command, ...args].map((a, i) => (i < 2 ? a : shq(a))).join(' ');
        proc = pty.spawn(shell, ['-l', '-i', '-c', line], { name: 'xterm-256color', cols: info.cols, rows: info.rows, cwd, env });
      }
    } catch (err) {
      info.status = 'exited';
      info.exitCode = -1;
      const what = isShell ? shell : command;
      term.write(`\r\n\x1b[31mFailed to start ${what}: ${(err as Error).message}\x1b[0m\r\n`);
      this.events.toast(`Could not start ${what}: ${(err as Error).message}`, 'error');
      this.emitUpdate(w);
      return;
    }
    w.pty = proc;
    if (!isClaude) info.status = 'idle';

    proc.onData((data) => {
      term.write(data);
      w.screenDirty = true;
      if (w.viewers.size) this.events.data(info.id, data, [...w.viewers.keys()]);
    });
    proc.onExit(({ exitCode }) => {
      if (w.pty !== proc || this.workers.get(info.id) !== w) return;
      w.pty = undefined;
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
      this.emitUpdate(w);
      this.persist();
    });
    // SessionStart fires as soon as Claude can take input. Still silent after a while means it is
    // blocked on a human: folder trust dialog, login, first-run onboarding. Flag it so it jumps.
    setTimeout(() => {
      if (info.status !== 'starting' || w.pty !== proc) return;
      if (isClaude) {
        w.bootBlocked = true;
        info.activity = 'Waiting on a setup prompt (trust / login) — open the terminal';
        this.setStatus(w, 'needs_input');
      } else this.setStatus(w, 'idle');
    }, 12000);
    this.emitUpdate(w);
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
    if (w.info.kind !== 'agent' || w.info.provider === 'opencode' || !w.tracker.transcript || this.workers.get(w.info.id) !== w) return;
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
    if (w.info.kind !== 'agent' || !w.term) return;
    const s = w.info.status;
    if (s !== 'starting' && s !== 'idle' && !(w.bootBlocked && s === 'needs_input')) return;
    const text = screenText(w.term);
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
  const req = http.request(url, { method: 'POST', timeout: 3000, headers: { authorization: 'Bearer ' + process.env.AGENT_OFFICE_HOOK_TOKEN, 'content-type': 'application/json' } }, (res) => res.resume());
  req.on('error', () => {});
  req.on('timeout', () => req.destroy());
  req.end(body);
});
`,
      { mode: 0o600 },
    );
    const hooks: Record<string, unknown[]> = {};
    for (const [event, matcher] of events) {
      const curl =
        `curl -sS -m 3 -X POST -H "Authorization: Bearer $AGENT_OFFICE_HOOK_TOKEN" -H "Content-Type: application/json" ` +
        `--data-binary @- "$AGENT_OFFICE_HOOK_URL/hooks/claude?worker=$AGENT_OFFICE_WORKER_ID&event=${event}"`;
      const command =
        `if [ -z "$AGENT_OFFICE_WORKER_ID" ] || [ -z "$AGENT_OFFICE_HOOK_URL" ]; then exit 0; fi; ` +
        `if command -v curl >/dev/null 2>&1; then ${curl} >/dev/null 2>&1; ` +
        `else ${shq(process.execPath)} ${shq(nodeHook)} ${event} >/dev/null 2>&1; fi; true`;
      hooks[event] = [{ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command }] }];
    }
    writeFileSync(this.settingsPath, JSON.stringify({ hooks }, null, 2), { mode: 0o600 });
  }

  private persist() {
    const saved = [...this.workers.values()].map(({ info, tracker }) => ({
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
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8')) as (Partial<WorkerInfo> & { tracker?: unknown })[];
      for (const s of saved) {
        if (!s.id || !s.deskId || !DESK_BY_ID.has(s.deskId) || this.deskOccupied(s.deskId)) continue;
        const tracker = restoreTracker(s.tracker);
        const provider = s.kind === 'shell'
          ? undefined
          : s.provider === 'claude' || s.provider === 'opencode' || s.provider === 'custom'
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
          usage: provider !== 'opencode' && tracker.transcript ? trackerUsage(tracker) : undefined,
          cols: 100,
          rows: 30,
          viewers: [],
        };
        const w = newWorker(info, tracker);
        w.screenDirty = false;
        if (info.prompt) w.prompts = [info.prompt.replace(/\s+/g, ' ').trim()];
        this.workers.set(info.id, w);
      }
    } catch {
      // corrupt state file: start fresh
    }
  }
}

// ---------------------------------------------------------------------------

function newWorker(info: WorkerInfo, tracker: UsageTracker): Worker {
  return {
    info,
    viewers: new Map(),
    screenDirty: true,
    lastLines: [],
    leftNeedsInputAt: 0,
    keyframeAt: 0,
    hookToken: randomBytes(16).toString('hex'),
    prompts: [],
    tools: [],
    toolsSinceNamed: 0,
    namedAt: 0,
    taskEpoch: 0,
    tracker,
  };
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
function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !scrubbed(k)) env[k] = v;
  return env;
}

function validTask(t: unknown): WorkerTask | undefined {
  const v = t as Partial<WorkerTask> | undefined;
  return typeof v?.name === 'string' && typeof v.summary === 'string' ? { name: v.name, summary: v.summary } : undefined;
}

function isOpenCodeHookEvent(value: unknown): value is OpenCodeHookEvent {
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

function screenText(term: HeadlessTerminal): string {
  const buf = term.buffer.active;
  const out: string[] = [];
  for (let y = 0; y < term.rows; y++) out.push(buf.getLine(buf.viewportY + y)?.translateToString(true) ?? '');
  return out.join('\n');
}

function resolveCommand(cmd: string): string | null {
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
