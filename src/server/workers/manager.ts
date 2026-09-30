import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import type { AgentChoice, AgentEffort, AgentProvider, TerminalHit, WorkerInfo, WorkerKind, WorkerRepo, WorkerStatus } from '../../shared/protocol.js';
import { AGENT_PROVIDERS, takesEffort, takesModel } from '../../shared/providers.js';
import { WORKSPACE_FILES, WORKTREES_DIR, Worktrees, describeWork, workspaceOf, type WorktreeCleanup, type WorktreeRef, type WorktreeState } from '../worktrees.js';
import { DESK_BY_ID, STATION_AGENT, deskBuilt } from '../../shared/layout.js';
import { stationBrief } from '../stations.js';
import { officePrompt, type PromptSource } from '../prompts.js';
import { isBusy } from '../../shared/status.js';
import { gh } from '../github.js';
import type { GhAs } from '../signins.js';
import type { ServiceOwner } from '../services.js';
import { TaskNamer, fallbackTask } from '../tasks.js';
import { addUsage, newTracker, scanTracker, trackerUsage, zeroUsage, type Ledger } from '../usage.js';
import { PtyHost, SCROLLBACK, type Adopted, type Pty } from '../ptys.js';
import { configuredProvider, validateWorkerEffort, validateWorkerModel } from '../agents.js';
import { ScrollbackStore, searchTerminal, terminalTail } from '../history.js';
import { DSH_PROFILE_DEFAULT, DshSession, terminalSafe } from '../dsh.js';
import { DropStore } from '../drops.js';
import { screenSnapshot } from '../screen.js';
import type { Capacity } from '../machine.js';
import { PROVIDERS, providerAdapter, titleNoise, type LaunchPlan, type ProviderFloor } from '../providers/index.js';
import { clockWork } from './clock.js';
import { childEnv } from './env.js';
import { WIN, binScript, defaultShell, resolveCommand, run, shellRun, shq } from './process.js';
import { createPr, draftPr, findOpenPr, relatedBlock, withRelated } from './pr.js';
import { offlineBanner, screenText, snapshotScreen, type HeadlessTerminal } from './terminal.js';
import { midTurn } from './lifecycle.js';
import { restoreWorkers, saveWorkers } from './persist.js';
import type { HookEnv, OpenedPr, RepoSource, RunAs, Worker, WorkerEvents, WorkerHandle, Worktree } from './types.js';
import { clamp, safeEq, truncate } from './util.js';
import { COLORS, NAMES, newWorker } from './worker.js';
import { clearWorkspace, lostMessage, originRepo, workspaceNames } from './worktree.js';

const SCREEN_INTERVAL_MS = 250;
const KEYFRAME_MS = 8000;
/** How often a steady typist's "last typed" time is refreshed for everyone. */
const TYPED_REFRESH_MS = 15_000;
/** How many of a worker's latest prompts and tool calls the task namer sees. */
const TASK_PROMPTS = 5;
const TASK_TOOLS = 10;
/** While a worker works, refresh its task summary after this many tool calls, at most this often. */
const TASK_REFRESH_TOOLS = 8;
const TASK_REFRESH_MS = 90_000;
/** The most other repositories one worker can take on (see WorkerInfo.repos). */
export const MAX_REPOS = 8;
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
    dshProfile: string = DSH_PROFILE_DEFAULT,
  ) {
    this.defaultProvider = configuredProvider(agentCmd);
    this.trees = new Worktrees(dir);
    this.statePath = path.join(dataDir, 'workers.json');
    // bin/office-workers.js is also the office's MCP server, for the agents that take one.
    const floor: ProviderFloor = { dataDir, mcpScript: binScript('office-workers.js'), dshProfile };
    for (const p of AGENT_PROVIDERS) this.setups[p] = PROVIDERS[p].prepare?.(floor);
    this.officeBin = this.writeOfficeCommands();
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
    restoreWorkers(this.statePath, this.workers, this.defaultProvider, (deskId) => this.deskOccupied(deskId));
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
    if (info.prompt) this.notePrompt(w, info.prompt);
    // A board agent is told what it's there for ahead of its first request (which is what shows).
    this.launch(w, seat.station && info.prompt ? `${stationBrief(seat.station, this.prompts)}\n\n${info.prompt}` : info.prompt, undefined);
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
    const first = prompt && station && !w.info.sessionId ? `${stationBrief(station, this.prompts)}\n\n${prompt}` : prompt;
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
  async openPr(id: string, by: string, as?: GhAs): Promise<{ prs: OpenedPr[]; failed: string[] } | string> {
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
      const open = await findOpenPr(branch, cwd);
      if (open) {
        info.pr = open;
        this.persist();
        return { prs: [{ ...open, existed: true, dirty }], failed: [] };
      }
      await run('git', ['push', '-u', 'origin', branch], cwd, 90_000, as?.env);
      const base = await this.pushedBranch([wt.from, this.trees.currentBranch()], branch);
      const { title, body } = draftPr(info, commits, by);
      const { number, url } = await createPr(branch, base, title, body, cwd, as);
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
  private async openPrs(w: Worker, by: string, as?: GhAs): Promise<{ prs: OpenedPr[]; failed: string[] } | string> {
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
          const known = p.pr ?? (await findOpenPr(p.branch, cwd));
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
          const pr = await createPr(p.branch, base, title, body, cwd, as);
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
            const body = await gh(['pr', 'view', p.url, '--json', 'body', '--jq', '.body'], p.cwd, 30_000, as?.env);
            const next = withRelated(body, relatedBlock(prs, p.url, wt.branch));
            if (next !== body) await gh(['pr', 'edit', p.url, '--body', next], p.cwd, 60_000, as?.env);
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

  /** A new message for the worker: show it right away, and have its task (re)named. */
  private notePrompt(w: Worker, prompt: string) {
    if (w.info.kind !== 'agent') return;
    const clean = prompt.replace(/\s+/g, ' ').trim();
    // Bare slash commands (/model, /compact), repeats and the office's own carry-on aren't new work.
    if (!clean || /^\/\S+$/.test(clean) || w.prompts.at(-1) === clean || clean === CARRY_ON_PROMPT) return;
    w.prompts = [...w.prompts, clean].slice(-TASK_PROMPTS);
    const hadTask = !!w.info.task;
    if (!hadTask) w.info.task = fallbackTask(clean);
    if (!providerAdapter(w.info.provider)?.namesTasks) return;
    // "yes", "go ahead", "2": a reply within the same task, not worth a new name.
    if (hadTask && clean.length < 16) return;
    this.nameTask(w);
  }

  private noteTool(w: Worker, tool: string) {
    if (!providerAdapter(w.info.provider)?.namesTasks) return;
    w.tools = [...w.tools, tool].slice(-TASK_TOOLS);
    w.toolsSinceNamed++;
    if (w.info.task && w.toolsSinceNamed >= TASK_REFRESH_TOOLS && Date.now() - w.namedAt > TASK_REFRESH_MS) this.nameTask(w);
  }

  private nameTask(w: Worker) {
    if (!providerAdapter(w.info.provider)?.namesTasks) return;
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
      this.launchDsh(w, term, { file, args: acpArgs, cwd, env, resumeSessionId, prompt });
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
    const adapter = providerAdapter(info.provider);
    const locate = adapter?.usage?.locate;
    if (locate) locate(this.handleOf(w), this.cwd(info), childEnv());
    this.follow(w, adopted.pty, term, undefined);
    // A turn that ended while the office was down says so with its Stop hook, which retries until
    // the office is back. Claude's progress report, where it gives one, says a turn is still going.
    if (adopted.busy && adapter?.screen?.progress) this.onProgress(w, true);
    this.emitUpdate(w);
  }

  /** A fresh screen for a worker's terminal, reading Claude's progress and title off it. */
  private newTerm(w: Worker): HeadlessTerminal {
    const term = new headless.Terminal({ cols: w.info.cols, rows: w.info.rows, scrollback: SCROLLBACK, allowProposedApi: true });
    const ser = new serialize.SerializeAddon();
    term.loadAddon(ser as any);
    // OSC 9;4 progress (Claude Code emits it): 0 = idle, anything else = busy. Catches Esc-cancel,
    // which fires no Stop hook.
    if (providerAdapter(w.info.provider)?.screen?.progress) {
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
      void this.syncBranch(w);
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
      notePrompt: (prompt) => this.notePrompt(w, prompt),
      noteTool: (tool) => this.noteTool(w, tool),
      clearTask: () => this.clearTask(w),
      scheduleScan: () => this.scheduleScan(w),
      prompt: (text) => this.prompt(w.info.id, text),
    });
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
    saveWorkers(this.statePath, this.workers.values(), this.stopping);
  }
}
