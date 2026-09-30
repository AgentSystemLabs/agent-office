import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { AgentChoice, AgentEffort, AgentProvider, TerminalHit, WorkerInfo, WorkerKind, WorkerRepo, WorkerStatus } from '../../shared/protocol.js';
import { AGENT_PROVIDERS, takesEffort, takesModel } from '../../shared/providers.js';
import { Worktrees, workspaceOf, type WorktreeCleanup, type WorktreeState } from '../worktrees.js';
import { DESK_BY_ID, STATION_AGENT, deskBuilt } from '../../shared/layout.js';
import { stationBrief } from '../stations.js';
import type { PromptSource } from '../prompts.js';
import type { GhAs } from '../signins.js';
import type { ServiceOwner } from '../services.js';
import { addUsage, newTracker, scanTracker, trackerUsage, zeroUsage, type Ledger } from '../usage.js';
import { PtyHost, SCROLLBACK, type Adopted, type Pty } from '../ptys.js';
import { configuredProvider, validateWorkerEffort, validateWorkerModel } from '../agents.js';
import { ScrollbackStore, searchTerminal, terminalTail } from '../history.js';
import { DSH_PROFILE_DEFAULT } from '../dsh.js';
import { DropStore } from '../drops.js';
import type { Capacity } from '../machine.js';
import { PROVIDERS, providerAdapter, titleNoise, type LaunchPlan, type ProviderFloor } from '../providers/index.js';
import { launchAcp } from './acp.js';
import { clockWork } from './clock.js';
import { childEnv } from './env.js';
import { midTurn } from './lifecycle.js';
import { restoreWorkers, saveWorkers } from './persist.js';
import { WorkerPrs } from './pr.js';
import { WIN, binScript, defaultShell, resolveCommand, shellRun, shq, writeOfficeCommands } from './process.js';
import { CARRY_ON_PROMPT, WorkerTasks } from './tasks.js';
import { flushScreens, fullScreens, newTerm, offlineBanner, screenText, type HeadlessTerminal } from './terminal.js';
import type { HookEnv, OpenedPr, RepoSource, RunAs, Worker, WorkerContext, WorkerEvents, WorkerHandle } from './types.js';
import { clamp, safeEq, truncate } from './util.js';
import { COLORS, NAMES, newWorker } from './worker.js';
import { WorkerTrees, lostMessage } from './worktree.js';

const SCREEN_INTERVAL_MS = 250;
/** How often a steady typist's "last typed" time is refreshed for everyone. */
const TYPED_REFRESH_MS = 15_000;
/** The most other repositories one worker can take on (see WorkerInfo.repos). */
export const MAX_REPOS = 8;
/** How often every worker's transcript is checked for new spend, on top of the hook-driven checks. */
const USAGE_SCAN_MS = 10_000;
/** How often a terminal with new output is saved to disk, so even a crash loses at most this much. */
const SAVE_SCROLLBACK_MS = 15_000;
/** Between a worker's saved scrollback and what it prints after the office restarted. */
const RESTORED_NOTE = '\x1b[2m──── the office restarted · earlier output above ────\x1b[0m\r\n';

export class WorkerManager {
  private workers = new Map<string, Worker>();
  private statePath: string;
  private trees: Worktrees;
  private agentPath: string | null = null;
  readonly defaultProvider: AgentProvider;
  /** What each provider set up on this floor, for its launches (see ProviderAdapter.prepare). */
  private setups: Partial<Record<AgentProvider, unknown>> = {};
  /** Where the office-queue and office-workers commands are, for the workers' PATH (see writeOfficeCommands). */
  private officeBin: string | undefined;
  private screenTimer: NodeJS.Timeout;
  /** The office is shutting down: workers exiting now are being stopped, not failing to resume. */
  private closing = false;
  /** Closing for good (Ctrl+C), not restarting: whatever the workers were doing is stopped on purpose. */
  private stopping = false;
  /** What the workers' modules share of this manager (see WorkerContext). */
  private ctx: WorkerContext;
  private tasks: WorkerTasks;
  private worktrees: WorkerTrees;
  private prs: WorkerPrs;
  private usageTimer: NodeJS.Timeout;
  /** Runs the workers' terminals outside the office, so they outlive a restart of it (see ptys.ts). */
  private host: PtyHost;
  /** Each worker's terminal on disk, so a restart doesn't wipe it (see history.ts). */
  private scrollback: ScrollbackStore;
  private drops: DropStore;
  private saveTimer: NodeJS.Timeout;
  /** How many rows the floor's back office is built out: its desks past that aren't there to hire at (see WING). */
  wing: () => number = () => 0;

  constructor(
    private dir: string,
    dataDir: string,
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
    dshProfile: string = DSH_PROFILE_DEFAULT,
  ) {
    this.defaultProvider = configuredProvider(agentCmd);
    this.trees = new Worktrees(dir);
    this.statePath = path.join(dataDir, 'workers.json');
    // bin/office-workers.js is also the office's MCP server, for the agents that take one.
    const floor: ProviderFloor = { dataDir, mcpScript: binScript('office-workers.js'), dshProfile };
    for (const p of AGENT_PROVIDERS) this.setups[p] = PROVIDERS[p].prepare?.(floor);
    this.officeBin = writeOfficeCommands(dataDir);
    this.agentPath = resolveCommand(agentCmd);
    const self = this;
    this.ctx = {
      dir,
      trees: this.trees,
      workers: this.workers,
      events,
      prompts,
      get closing() {
        return self.closing;
      },
      emit: (w) => this.emitUpdate(w),
      persist: () => this.persist(),
      setStatus: (w, status) => this.setStatus(w, status),
      resume: (id, prompt) => this.resume(id, prompt),
      cwd: (info) => this.cwd(info),
      command: (info) => this.command(info),
      notePrompt: (w, prompt) => this.tasks.notePrompt(w, prompt),
      syncBranch: (w) => this.worktrees.syncBranch(w),
    };
    // Tasks are named by Claude Code, the office's own --agent when that's it.
    const claude = this.defaultProvider === 'claude' ? this.agentPath : resolveCommand('claude');
    this.tasks = new WorkerTasks(this.ctx, claude, childEnv());
    this.worktrees = new WorkerTrees(this.ctx);
    this.prs = new WorkerPrs(this.ctx);
    this.host = new PtyHost(dataDir, () => this.events.toast("The workers' terminal host stopped — resuming them", 'warn'));
    this.scrollback = new ScrollbackStore(dataDir);
    this.drops = new DropStore(dataDir);
    restoreWorkers(this.statePath, this.workers, this.defaultProvider, (deskId) => this.deskOccupied(deskId));
    this.scrollback.prune(new Set(this.workers.keys()));
    this.drops.prune(new Set(this.workers.keys()));
    // A session may have ended (and written its final tally) while the office was down.
    for (const w of this.workers.values()) this.scanUsage(w);
    this.screenTimer = setInterval(() => flushScreens(this.workers.values(), this.events, (w) => this.checkBlocked(w)), SCREEN_INTERVAL_MS);
    this.usageTimer = setInterval(() => {
      for (const w of this.workers.values()) {
        this.scanUsage(w);
        this.worktrees.watchFolder(w);
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
    for (const w of this.workers.values()) this.worktrees.checkLost(w);
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
   * Hires a worker at a desk. `meeting` seats one at the meeting room's table instead, for that meeting
   * (see meetings.ts), in the meeting's own worktree, which everyone at the table shares. `repos` are
   * other floors' repositories a worker in its own worktree works in too (see makeWorkspace).
   */
  spawn(deskId: string, by: string, prompt?: string, worktree = false, kind: WorkerKind = 'agent', provider?: AgentProvider, model?: string, effort?: AgentEffort, meeting?: { id: string; worktree?: WorkerInfo['worktree'] }, owner?: string, repos: RepoSource[] = [], via?: 'herald'): WorkerInfo | string {
    // Nobody picked (a board agent, say): the office's default worker, model and effort included.
    if (kind === 'agent' && provider === undefined) ({ provider, model, effort } = this.officeDefault);
    const selectedProvider = kind === 'agent' ? provider : undefined;
    const modelError = validateWorkerModel(kind, selectedProvider, model);
    if (modelError) return modelError;
    const effortError = validateWorkerEffort(kind, selectedProvider, effort);
    if (effortError) return effortError;
    const seat = DESK_BY_ID.get(deskId);
    if (!seat) return 'Unknown desk';
    if (!deskBuilt(seat, this.wing())) return `${seat.label} isn't built yet: expand the back office first`;
    if (this.deskOccupied(deskId)) return seat.station ? `The ${STATION_AGENT[seat.station].name} is already there` : `That ${seat.beanbag ? 'bean bag' : 'desk'} is taken`;
    if (kind === 'shell' && seat.station) return 'A board agent is always an agent, not a shell';
    if (seat.station && !prompt?.trim()) return 'Tell the board agent what to do';
    if (!seat.room !== !meeting) return seat.room ? 'Only a meeting seats workers at the meeting table: call one in the meeting room' : 'A meeting seats its workers at the meeting table';
    if (meeting && (kind !== 'agent' || worktree)) return 'A meeting seats agents, in its own worktree';
    if (repos.length && (kind !== 'agent' || !worktree || seat.station || meeting)) return 'Only a worker in its own worktree can work in other repositories too';
    if (repos.length > MAX_REPOS) return `A worker can take on at most ${MAX_REPOS} other repositories`;
    if (kind === 'shell' && provider !== undefined) return 'Shell workers do not have an agent provider';
    if (kind === 'agent' && selectedProvider === 'custom' && this.defaultProvider !== 'custom') return 'Custom is not the configured agent provider';
    if (kind === 'agent') {
      const paused = this.ledger.hiringPaused;
      if (paused) return paused;
    }
    const signIn = providerAdapter(selectedProvider)?.signIn;
    if (owner && signIn && this.runAs && !this.runAs.claudeReady(owner)) return this.runAs.why(signIn);
    const full = this.capacity?.full();
    if (full) return full;
    const used = new Set([...this.workers.values()].map((w) => w.info.name.replace(/ 🐚$/, '')));
    const agent = seat.station && STATION_AGENT[seat.station];
    const name = agent ? agent.name : (NAMES.find((n) => !used.has(n)) ?? `Worker ${this.workers.size + 1}`);
    const id = randomBytes(6).toString('hex');
    let wt: WorkerInfo['worktree'] = meeting?.worktree;
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
      model: takesModel(selectedProvider) ? model : undefined,
      effort: takesEffort(selectedProvider) ? effort : undefined,
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
    };
    const w = newWorker(info, newTracker());
    w.owner = owner;
    this.workers.set(id, w);
    if (info.prompt) this.tasks.notePrompt(w, info.prompt);
    // A board agent is told what it's there for ahead of its first request (which is what shows).
    this.launch(w, seat.station && info.prompt ? `${stationBrief(seat.station, this.prompts)}\n\n${info.prompt}` : info.prompt, undefined);
    this.persist();
    return info;
  }

  /** The workspace of a worker across repositories (see WorkerTrees.makeWorkspace). */
  private makeWorkspace(slug: string, repos: RepoSource[]): { worktree: NonNullable<WorkerInfo['worktree']>; repos: WorkerRepo[]; notes: string[] } | string {
    return this.worktrees.makeWorkspace(slug, repos);
  }

  /** Starts a worker that isn't running again, carrying on its session, with `prompt` as its next message. */
  resume(id: string, prompt?: string): string | undefined {
    const w = this.workers.get(id);
    if (!w) return 'No such worker';
    if (w.pty || w.dsh) return 'Worker is already running';
    if (this.worktrees.checkLost(w, true)) return lostMessage(w.info);
    clockWork(w.info, 'starting');
    w.info.status = 'starting';
    w.info.exitCode = undefined;
    const station = DESK_BY_ID.get(w.info.deskId)?.station;
    // A board agent with no session to carry on starts over, so it needs telling what it's for again.
    const first = prompt && station && !w.info.sessionId ? `${stationBrief(station, this.prompts)}\n\n${prompt}` : prompt;
    if (prompt) {
      w.info.activity = truncate(prompt, 80);
      this.tasks.notePrompt(w, prompt);
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

  /** Starts every worker that isn't running: nobody should be found asleep at their desk. */
  wakeAll() {
    // A DeepSeek Harness worker has no PTY but is still running: only the ones that are gone wake up.
    for (const w of this.workers.values()) if (!w.pty && !w.dsh) this.resume(w.info.id);
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
    this.tasks.forget(id);
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
    return this.worktrees.sendHome(w.info, cleanup, landed, landedRepos);
  }

  /**
   * Whether any worktree of a worker across repositories holds work its merged pull requests didn't
   * deliver (`landed` and `landedRepos`, as for kill): then it doesn't go home by itself yet.
   */
  holdsWork(id: string, landed?: string, landedRepos?: Record<string, string | undefined>): Promise<boolean> {
    return this.worktrees.holdsWork(id, landed, landedRepos);
  }

  /** What a worker's worktree holds, so whoever sends it home knows what deleting it would lose. */
  inspectWorktree(id: string): Promise<WorktreeState | undefined> {
    return this.worktrees.inspect(id);
  }

  /** Every worker's worktree branch, looked at again (see WorkerTrees.syncBranch): for when new pull requests may have come in. */
  syncBranches(): Promise<void> {
    return this.worktrees.syncAll();
  }

  /** Puts a lost worker's worktree back and starts it again (see WorkerTrees.rebuild). */
  rebuild(id: string): Promise<{ rebuilt?: boolean; note?: string; error?: string }> {
    return this.worktrees.rebuild(id);
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
      this.tasks.notePrompt(w, clean);
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
    this.tasks.notePrompt(w, clean);
    if (by) w.info.lastInput = { by, at: Date.now() };
    this.emitUpdate(w);
    return undefined;
  }

  /**
   * Pushes a worktree worker's branch and opens a pull request for it, with a title and body
   * drafted from its task, as `as` (whoever pressed the button) or else the office. Resolves to the
   * PR, or to a message saying why there is none. The branch may already have an open PR (a second
   * press, or one opened by hand): that one is used. A worker across repositories gets one in each
   * repository it committed to (see WorkerPrs).
   */
  openPr(id: string, by: string, as?: GhAs): Promise<{ prs: OpenedPr[]; failed: string[] } | string> {
    return this.prs.openPr(id, by, as);
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

  /** Claude Code hook callback (a custom --agent that speaks Claude Code's hooks reports here too). */
  handleHook(workerId: string, token: string, event: string, payload: any): boolean {
    return this.handleProviderHook('claude', workerId, token, event, payload);
  }

  /** Native Codex lifecycle hooks register the root rollout for bounded metric reads. */
  handleCodexHook(workerId: string, token: string, event: string, payload: unknown): boolean {
    return this.handleProviderHook('codex', workerId, token, event, payload);
  }

  /** Grok lifecycle hooks, isolated under the office's GROK_HOME so they never edit ~/.grok. */
  handleGrokHook(workerId: string, token: string, event: string, payload: unknown): boolean {
    return this.handleProviderHook('grok', workerId, token, event, payload);
  }

  /** Muse lifecycle hooks, isolated under the office's XDG dirs so they never edit ~/.config/muse. */
  handleMuseHook(workerId: string, token: string, event: string, payload: unknown): boolean {
    return this.handleProviderHook('muse', workerId, token, event, payload);
  }

  /** OpenCode plugin callback. The plugin has already filtered child sessions before this bridge. */
  handleOpenCodeHook(workerId: string, token: string, payload: unknown): boolean {
    return this.handleProviderHook('opencode', workerId, token, '', payload);
  }

  /**
   * An event on the hook route /hooks/`route` (see ProviderAdapter.hook): taken only from a running
   * agent whose provider reports there, with its hook token. Says whether it was taken.
   */
  handleProviderHook(route: AgentProvider, workerId: string, token: string, event: string, payload: unknown): boolean {
    const hook = providerAdapter(route)?.hook;
    const w = this.workers.get(workerId);
    const own = w && providerAdapter(w.info.provider);
    if (!hook || !w || !w.pty || w.info.kind !== 'agent' || !own || (own.hooksAs ?? own.id) !== route || !safeEq(token, w.hookToken)) return false;
    return hook.handle(this.handleOf(w), event, payload);
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
    if (this.worktrees.checkLost(w)) {
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
    const adapter = isShell ? undefined : providerAdapter(info.provider);
    const configured = !isShell && info.provider === this.defaultProvider;
    const station = DESK_BY_ID.get(info.deskId)?.station;
    const command = this.command(info);
    const commandPath = isShell ? undefined : configured ? this.agentPath : resolveCommand(command);
    const base = isShell ? (WIN && !process.env.SHELL ? [] : ['-l']) : configured ? [...this.agentArgs] : [];
    // Its provider's command line, and anything it sets for this run (see ProviderAdapter.launch).
    const plan: LaunchPlan = adapter ? adapter.launch({ h: this.handleOf(w), args: base, prompt, resumeSessionId, station, setup: this.setups[adapter.id] }) : { args: base };
    const { args } = plan;
    if (plan.rotateToken) w.hookToken = randomBytes(16).toString('hex');
    const env = childEnv();
    Object.assign(env, {
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      AGENT_OFFICE_WORKER_ID: info.id,
      AGENT_OFFICE_HOOK_URL: this.hook.url,
      AGENT_OFFICE_HOOK_TOKEN: w.hookToken,
    });
    Object.assign(env, plan.env);
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
      if (adapter?.signIn && !this.runAs.claudeReady(w.owner)) {
        this.startFailed(w, `whoever hired ${info.name} (${info.createdBy}) isn't signed in to Claude — they can sign in under ☰ → 🔐 Your sign-ins, then press R here`);
        return;
      }
      this.runAs.apply(w.owner, env, [this.dir, cwd]);
    }
    adapter?.usage?.locate?.(this.handleOf(w), cwd, env);

    if (adapter?.transport === 'acp') {
      // No PTY and no argv for prompts or resume: the office owns an ACP connection instead, and
      // renders its updates into this same terminal (see dsh.ts).
      const file = commandPath ?? shell;
      const acpArgs = commandPath ? args : shellRun(['exec', command, ...args].map((a, i) => (i < 2 ? a : shq(a))).join(' '));
      launchAcp(this.ctx, w, term, { file, args: acpArgs, cwd, env, resumeSessionId, prompt });
      this.emitUpdate(w);
      this.persist();
      return;
    }

    // The host keeps its own copy of the screen for the next office: it starts with the same history.
    const where = { cwd, env, cols: info.cols, rows: info.rows, prelude };
    let proc: Pty;
    try {
      plan.finishEnv?.(env);
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
    // One that says itself when it's up (see ProviderAdapter.bootHint) starts out 'starting'.
    if (!adapter?.bootHint) {
      clockWork(info, 'idle');
      info.status = 'idle';
    }
    this.follow(w, proc, term, resumeSessionId);
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
    const adapter = providerAdapter(info.provider);
    const locate = adapter?.usage?.locate;
    if (locate) locate(this.handleOf(w), this.cwd(info), childEnv());
    this.follow(w, adopted.pty, term, undefined);
    // A turn that ended while the office was down says so with its Stop hook, which retries until
    // the office is back. Claude's progress report, where it gives one, says a turn is still going.
    if (adopted.busy && adapter?.screen?.progress) this.onProgress(w, true);
    this.emitUpdate(w);
  }

  /** A fresh screen for a worker's terminal, reading its progress reports (Claude's) and title off it. */
  private newTerm(w: Worker): HeadlessTerminal {
    return newTerm(w, {
      progress: providerAdapter(w.info.provider)?.screen?.progress ? (busy) => this.onProgress(w, busy) : undefined,
      title: (title) => this.setTitle(w, title),
    });
  }

  private setTitle(w: Worker, title: string) {
    const clean = title.replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (clean && clean !== w.info.title && !titleNoise(clean)) {
      w.info.title = clean;
      this.emitUpdate(w);
    }
  }

  /** Shows a worker's terminal output as it comes, and deals with the process ending. */
  private follow(w: Worker, proc: Pty, term: HeadlessTerminal, resumeSessionId: string | undefined) {
    const { info } = w;
    const adapter = info.kind === 'agent' ? providerAdapter(info.provider) : undefined;
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
        if (midTurn(w)) w.interrupted = true;
        this.resume(info.id);
        return;
      }
      if (adapter?.usage?.scanOnExit && !this.closing) this.scheduleScan(w);
      // Resuming a conversation Claude no longer has ("No conversation found") exits before Claude
      // ever starts. Start a fresh one rather than leave the worker asleep.
      if (adapter?.freshIfResumeFails && resumeSessionId && info.status === 'starting' && !this.closing) {
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
      void this.worktrees.syncBranch(w);
    });
    // SessionStart fires as soon as Claude can take input. Still silent after a while means it is
    // blocked on a human: folder trust dialog, login, first-run onboarding. Flag it so it jumps.
    setTimeout(() => {
      if (info.status !== 'starting' || w.pty !== proc) return;
      if (adapter?.bootHint) {
        w.bootBlocked = true;
        info.activity = adapter.bootHint;
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
    const usage = w.info.kind === 'agent' ? providerAdapter(w.info.provider)?.usage : undefined;
    if (usage?.scan) {
      if (this.workers.get(w.info.id) === w) usage.scan(this.handleOf(w));
      return;
    }
    if (!usage?.transcript || !w.tracker.transcript || this.workers.get(w.info.id) !== w) return;
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
    if (status === 'done' || status === 'idle') void this.worktrees.syncBranch(w);
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

  /** What a worker's provider adapter is handed of it (see WorkerHandle): made once, kept on the worker. */
  private handleOf(w: Worker): WorkerHandle {
    return (w.handle ??= {
      get info() {
        return w.info;
      },
      get state() {
        return w.state;
      },
      get running() {
        return !!w.pty;
      },
      get bootBlocked() {
        return !!w.bootBlocked;
      },
      set bootBlocked(v) {
        w.bootBlocked = v;
      },
      get leftNeedsInputAt() {
        return w.leftNeedsInputAt;
      },
      set leftNeedsInputAt(v) {
        w.leftNeedsInputAt = v;
      },
      get failStreak() {
        return w.failStreak;
      },
      set failStreak(v) {
        w.failStreak = v;
      },
      get tracker() {
        return w.tracker;
      },
      get pendingPrompt() {
        return w.pendingPrompt;
      },
      set pendingPrompt(v) {
        w.pendingPrompt = v;
      },
      setStatus: (status) => this.setStatus(w, status),
      emit: () => this.emitUpdate(w),
      persist: () => this.persist(),
      notePrompt: (prompt) => this.tasks.notePrompt(w, prompt),
      noteTool: (tool) => this.tasks.noteTool(w, tool),
      clearTask: () => this.tasks.clear(w),
      scheduleScan: () => this.scheduleScan(w),
      prompt: (text) => this.prompt(w.info.id, text),
    });
  }

  /** Full screens for every running worker — sent to people as they walk in. */
  fullScreens() {
    return fullScreens(this.workers.values());
  }

  /**
   * An agent can sit at its prompt without being usable: Claude stuck on a first-run screen, or not
   * signed in on this machine (see ProviderAdapter.screen). Flag that as needing a human, and clear
   * it once the screen moves on.
   */
  private checkBlocked(w: Worker) {
    const blockedBy = w.info.kind === 'agent' ? providerAdapter(w.info.provider)?.screen?.blocked : undefined;
    if (!w.term || !blockedBy) return;
    const s = w.info.status;
    if (s !== 'starting' && s !== 'idle' && !(w.bootBlocked && s === 'needs_input')) return;
    // Only this run's output counts: a "Not logged in" in the scrollback from before is old news.
    const text = screenText(w.term, w.term.buffer.active.type === 'normal' ? Math.max(0, w.fresh?.line ?? 0) : 0);
    const blocked = blockedBy(text, s === 'starting' || !!w.bootBlocked);
    if (blocked && s !== 'needs_input') {
      w.bootBlocked = true;
      w.info.activity = blocked;
      this.setStatus(w, 'needs_input');
    } else if (!blocked && w.bootBlocked && s === 'needs_input') {
      w.bootBlocked = false;
      w.info.activity = undefined;
      this.setStatus(w, 'idle');
    }
  }

  private saveScrollback(w: Worker) {
    if (!w.term || !w.ser) return;
    w.unsaved = false;
    this.scrollback.save(w.info.id, terminalTail(w.term, w.ser, SCROLLBACK));
  }

  private persist() {
    saveWorkers(this.statePath, this.workers.values(), this.stopping);
  }
}
