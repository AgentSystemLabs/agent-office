import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { MEETING_SEATS } from '../shared/layout.js';
import { MAX_MEETING_BUDGET, MEETING_NOTES_DIR, MEETING_PATTERNS, TOKENS_PER_SEAT, isMeetingPattern, meetingRecord, outputProblem, slugify } from '../shared/meetings.js';
import { fmtTokens, isAgentEffort, isAgentProvider, tokensOf, type AgentChoice, type AgentEffort, type AgentProvider, type Meeting, type MeetingRecord, type MeetingRequest, type MeetingState, type MeetingTurn, type WorkerInfo, type WorkerStatus } from '../shared/protocol.js';
import { validateWorkerEffort, validateWorkerModel } from './agents.js';
import { gitError, type WorktreeRef, type WorktreeState } from './worktrees.js';
import { PROMPTS, fillPrompt, type PromptId, type PromptVars } from '../shared/prompts.js';

const execFileP = promisify(execFile);

/** What the meeting room needs from the worker manager. Narrow on purpose, so a test can fake it. */
export interface MeetingWorkers {
  readonly defaultProvider: AgentProvider;
  /** What a meeting seats when whoever calls it doesn't pick (⚙️ Settings); the default provider without it. */
  readonly officeDefault?: AgentChoice;
  list(): WorkerInfo[];
  /** Seats an agent at a chair of the meeting table, for meeting `meeting`, in its worktree when it has one. */
  seat(deskId: string, by: string, prompt: string, provider: AgentProvider, model: string | undefined, effort: AgentEffort | undefined, meeting: { id: string; worktree?: Meeting['worktree'] }, owner?: string): WorkerInfo | string;
  prompt(id: string, text: string, by?: string): string | undefined;
  /** Keys into its terminal: Esc, to stop what it's doing. */
  write(id: string, data: string, by: string): void;
  kill(id: string): Promise<{ note?: string; error?: string }>;
}

/** Git for the meeting's own worktree: made when it starts, tidied away once everyone has gone home. */
export interface MeetingTrees {
  /** `note` says when commits the project has were left out of it (see Worktrees.create). */
  create(slug: string): (Required<Omit<WorktreeRef, 'made'>> & { from?: string; note?: string }) | string;
  inspect(wt: WorktreeRef): Promise<WorktreeState>;
  remove(wt: WorktreeRef, cleanup: 'worktree' | 'all'): Promise<string | undefined>;
}

export interface MeetingEvents {
  update(state: MeetingState): void;
  toast(text: string, level: 'info' | 'warn' | 'error'): void;
  /** Why nobody may be hired right now (today's budget is spent), if that's so. */
  hiringPaused(): string | undefined;
  /** Posts the review panel's review on its pull request. Resolves to the review's URL. */
  postReview(pr: number, file: string, owner?: string): Promise<string>;
  /** One of the office's prompts as it has it now (rewritten in ⚙️ Settings, or the default). */
  prompt?(id: PromptId): string;
}

const PUMP_MS = 3000;
/** A part handed to a worker that sits ready this long without starting on it is handed over again, once. */
const START_GRACE_MS = 60_000;
/** How much of the output file the board in the room shows. */
const PREVIEW_CHARS = 6000;
const PAST_MAX = 20;
const PROMPT_MAX = 20_000;
const ROLE_MAX = 40;
const PARTS_MAX = 100;
/** Who the office types a meeting's prompts as. */
const BY = 'the meeting room';
/** What a red team or a reviewer writes when it has nothing to report. */
const NOTHING = /^\W*no findings\b/i;

/** Ready for its next part: not starting up, busy, waiting on someone, or asleep. */
const ready = (s: WorkerStatus) => s === 'idle' || s === 'done';

/** A part of a round, before it's handed over. */
interface Part {
  seat: number;
  doing: string;
  file: string;
  /** What the worker is told to do, after the "Round n of m" line. */
  ask: string;
}

/**
 * The meeting room. A meeting seats 2–5 agents round the table, each with a role, and runs them
 * through the rounds of its pattern (shared/meetings.ts): in each step every worker with a part gets
 * it as a prompt, and the step is over when each of them has ended its turn with its part written to
 * the file it names. Checking the files, not the talk, is what moves a meeting on. It ends when the
 * output file is written, and stops early, saying why, when it runs over its token budget, when a
 * worker won't write its part, or when a worker leaves.
 *
 * Everyone at the table shares the meeting's own git worktree (in a git project). When it's done,
 * the office commits the output there, or for a review panel posts it on the pull request. The
 * workers stay at the table to be looked at until the room is cleared or the next meeting is called.
 */
export class MeetingRoom {
  private current: Meeting | null = null;
  private past: MeetingRecord[] = [];
  private statePath: string;
  private timer: NodeJS.Timeout;
  private pumping = false;
  private again = false;
  /** Token counts changed: told everyone on the next tick rather than on every worker update. */
  private dirty = false;
  private closing = false;
  /** When each handed-over part's worker was first seen ready without having started on it. */
  private readySince = new Map<MeetingTurn, number>();

  constructor(
    /** The project's checkout. */
    private dir: string,
    private dataDir: string,
    private workers: MeetingWorkers,
    /** Git worktrees, in a project that's a git repository. */
    private trees: MeetingTrees | undefined,
    private events: MeetingEvents,
  ) {
    this.statePath = path.join(dataDir, 'meetings.json');
    this.restore();
    this.timer = setInterval(() => this.tick(), PUMP_MS);
  }

  state(): MeetingState {
    return { current: this.current && { ...this.current, seats: this.current.seats.map((s) => ({ ...s })), turns: this.current.turns.map((t) => ({ ...t })) }, past: this.past.slice() };
  }

  /** Calls a meeting. Returns why it couldn't, or undefined once everyone is sitting down. */
  /** `owner` is the account calling it: the workers run on its sign-ins, and a review panel's review is posted as it. */
  start(req: MeetingRequest, by: string, owner?: string): string | undefined {
    if (this.current?.status === 'running') return `The meeting room is busy with “${this.current.title}”: stop that meeting first`;
    if (!isMeetingPattern(req.pattern)) return 'Unknown meeting pattern';
    const pattern = MEETING_PATTERNS[req.pattern];
    const paused = this.events.hiringPaused();
    if (paused) return paused;
    const prompt = String(req.prompt ?? '').replace(/\r\n?/g, '\n').trim().slice(0, PROMPT_MAX);
    if (!prompt) return 'Say what the meeting is about';
    // Nobody picked: the office's default worker, model and effort included.
    const picked = req.provider !== undefined ? { provider: req.provider, model: req.model, effort: req.effort } : (this.workers.officeDefault ?? { provider: this.workers.defaultProvider });
    const provider = picked.provider;
    if (!isAgentProvider(provider) || (provider === 'custom' && this.workers.defaultProvider !== 'custom')) return 'Unknown agent provider';
    const model = provider === 'claude' || provider === 'opencode' || provider === 'grok' || provider === 'muse' || provider === 'dsh' ? picked.model || undefined : undefined;
    const effort = (provider === 'claude' || provider === 'grok' || provider === 'muse' || provider === 'dsh') && isAgentEffort(picked.effort) ? picked.effort : undefined;
    const bad = validateWorkerModel('agent', provider, model) ?? validateWorkerEffort('agent', provider, effort);
    if (bad) return bad;

    const given = Array.isArray(req.roles) ? req.roles.map((r) => String(r ?? '').replace(/\s+/g, ' ').trim().slice(0, ROLE_MAX)) : [];
    const count = given.length || pattern.seats.default;
    if (count < pattern.seats.min || count > Math.min(pattern.seats.max, MEETING_SEATS.length)) {
      return pattern.seats.min === pattern.seats.max ? `A ${pattern.label} meeting seats ${pattern.seats.min} workers` : `A ${pattern.label} meeting seats ${pattern.seats.min} to ${pattern.seats.max} workers`;
    }
    const roles = numbered(Array.from({ length: count }, (_, i) => given[i] || pattern.roles[i] || `Worker ${i + 1}`));

    const pr = Number.isInteger(req.pr) && (req.pr as number) > 0 ? (req.pr as number) : undefined;
    if (pattern.needs === 'pr' && pr === undefined) return 'A review panel needs a pull request to review';
    const parts = (Array.isArray(req.parts) ? req.parts : []).map((p) => String(p ?? '').trim()).filter(Boolean).slice(0, PARTS_MAX);
    if (pattern.needs === 'parts' && parts.length < count - 1) return `List at least ${count - 1} part${count === 2 ? '' : 's'} for the mappers, one per line (or seat fewer workers)`;
    const issue = Number.isInteger(req.issue) && (req.issue as number) > 0 ? (req.issue as number) : undefined;
    const rounds = clamp(Math.floor(Number(req.rounds) || pattern.rounds.default), pattern.rounds.min, pattern.rounds.max);
    const budget = clamp(Math.floor(Number(req.budget) || count * TOKENS_PER_SEAT), 50_000, MAX_MEETING_BUDGET);
    const title = (String(req.title ?? '').replace(/\s+/g, ' ').trim() || (pr !== undefined && req.pattern === 'review' ? `Review of PR #${pr}` : firstLine(prompt))).slice(0, 100);
    const id = randomBytes(4).toString('hex');
    const slug = slugify(title, 32);
    const output = String(req.output ?? '').trim() || pattern.output(slug, pr);
    const outputBad = outputProblem(output);
    if (outputBad) return outputBad;

    // The last meeting's workers make room: they go home, and their worktree is tidied away after them.
    const last = this.current;
    if (last) void this.dismiss(last);
    const busy = MEETING_SEATS.slice(0, count).find((d) => this.workers.list().some((w) => w.deskId === d.id));
    if (busy) return 'Someone is still sitting at the meeting table';

    let worktree: Meeting['worktree'];
    if (this.trees) {
      const made = this.trees.create(`meeting-${slug}-${id.slice(0, 4)}`);
      if (typeof made === 'string') return made;
      const { note, ...ref } = made;
      worktree = ref;
      if (note) this.events.toast(`🌿 The meeting's worktree ${note}`, 'info');
    }
    const m: Meeting = {
      id,
      pattern: req.pattern,
      title,
      prompt,
      output,
      seats: roles.map((role, i) => ({ role, deskId: MEETING_SEATS[i].id })),
      parts: pattern.needs === 'parts' ? parts : undefined,
      pr,
      issue,
      provider,
      model,
      effort,
      rounds,
      round: 1,
      step: 1,
      turns: [],
      budget,
      tokens: 0,
      cost: 0,
      costKnown: true,
      status: 'running',
      calledBy: by,
      ...(owner ? { owner } : {}),
      startedAt: Date.now(),
      worktree,
      // Without git, the notes go with the floor's other state.
      notes: worktree ? MEETING_NOTES_DIR : `.agent-office/meetings/${id}`,
    };
    mkdirSync(path.join(this.cwd(m), m.notes), { recursive: true });
    const first = this.plan(m, 1, 1) ?? [];
    for (let i = 0; i < m.seats.length; i++) {
      const part = first.find((p) => p.seat === i);
      const text = `${this.brief(m, i)}\n\n${part ? this.ask(m, part) : this.say('meeting.wait')}`;
      const w = this.workers.seat(m.seats[i].deskId, `${by} (meeting)`, text, provider, model, effort, { id, worktree }, owner);
      if (typeof w === 'string') {
        for (const s of m.seats) if (s.workerId) void this.workers.kill(s.workerId);
        if (worktree && this.trees) void this.trees.remove(worktree, 'all');
        return w;
      }
      m.seats[i].workerId = w.id;
      m.seats[i].workerName = w.name;
    }
    const now = Date.now();
    m.turns = first.map((p) => ({ seat: p.seat, doing: p.doing, file: p.file, state: 'sent', sentAt: now }));
    if (last) this.archive(last);
    this.current = m;
    this.changed();
    this.events.toast(`🤝 ${by} called a ${pattern.label} meeting: “${title}” (${count} workers, ${rounds} round${rounds === 1 ? '' : 's'} at most, ${fmtTokens(budget)} tokens)`, 'info');
    return undefined;
  }

  /** Stops the meeting that's running. Its workers stay at the table. */
  stop(by: string): string | undefined {
    const m = this.current;
    if (!m || m.status !== 'running') return 'No meeting is on';
    this.halt(m, `stopped by ${by}`);
    return undefined;
  }

  /** Sends the last meeting's workers home and clears the table. */
  clear(by: string): string | undefined {
    const m = this.current;
    if (!m) return 'Nobody is in the meeting room';
    if (m.status === 'running') return 'The meeting is still on: stop it first';
    this.events.toast(`🤝 ${by} cleared the meeting room`, 'info');
    void this.dismiss(m);
    this.archive(m);
    this.current = null;
    this.changed();
    return undefined;
  }

  /** A worker changed: cheap unless it's at the table. */
  onWorker(info: WorkerInfo) {
    if (info.meeting && info.meeting === this.current?.id) this.pump();
  }

  onWorkerGone(workerId: string) {
    if (this.current?.seats.some((s) => s.workerId === workerId)) this.pump();
  }

  pump() {
    if (this.closing) return;
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.again = false;
        this.run();
      } while (this.again);
    } finally {
      this.pumping = false;
    }
  }

  shutdown() {
    this.closing = true;
    clearInterval(this.timer);
    this.persist();
  }

  // ---------------------------------------------------------------------------

  private tick() {
    const m = this.current;
    if (m?.status === 'running' && this.readPreview(m)) this.dirty = true;
    this.pump();
    if (this.dirty) this.changed();
  }

  private run() {
    const m = this.current;
    if (!m) return;
    const byId = new Map(this.workers.list().map((w) => [w.id, w]));
    if (this.tally(m, byId)) this.dirty = true;
    if (m.status !== 'running') {
      // Everyone went home one by one: tidy the worktree away after them.
      if (!m.cleared && m.seats.every((s) => !s.workerId || !byId.has(s.workerId))) void this.dismiss(m);
      return;
    }
    for (const s of m.seats) {
      const w = s.workerId ? byId.get(s.workerId) : undefined;
      if (!w) return this.halt(m, `the ${s.role} (${s.workerName ?? 'its worker'}) was sent home`);
      if (w.status === 'exited') return this.halt(m, `the ${s.role}'s agent (${w.name}) exited`);
    }
    if (m.tokens > m.budget) return this.halt(m, `over budget: ${fmtTokens(m.tokens)} of ${fmtTokens(m.budget)} tokens`);
    let changed = false;
    for (const t of m.turns) {
      changed = this.advance(m, t, byId.get(m.seats[t.seat].workerId!)!) || changed;
      if (m.status !== 'running') return;
    }
    if (m.turns.every((t) => t.state === 'done')) {
      this.next(m);
      changed = true;
      this.again = true;
    }
    if (changed) this.changed();
  }

  /** Moves one worker's part along. Returns whether anything changed. */
  private advance(m: Meeting, t: MeetingTurn, w: WorkerInfo): boolean {
    const now = Date.now();
    const seat = m.seats[t.seat];
    const retry = () => {
      t.retried = true;
      this.readySince.delete(t);
      return this.workers.prompt(w.id, this.say('meeting.nudge', { file: path.join(this.cwd(m), t.file) }), BY);
    };
    switch (t.state) {
      case 'waiting': {
        if (!ready(w.status)) return false;
        const part = this.plan(m, m.round, m.step)?.find((p) => p.seat === t.seat);
        if (!part || this.workers.prompt(w.id, this.ask(m, part), BY)) return false;
        t.state = 'sent';
        t.sentAt = now;
        return true;
      }
      case 'sent': {
        if (w.status === 'working') {
          t.state = 'working';
          this.readySince.delete(t);
          return true;
        }
        if (!ready(w.status)) {
          this.readySince.delete(t);
          return false;
        }
        // Written without our seeing it work (the office restarted in between): that counts.
        if (this.written(m, t)) {
          t.state = 'done';
          return true;
        }
        const since = this.readySince.get(t) ?? now;
        this.readySince.set(t, since);
        if (now - since < START_GRACE_MS) return false;
        if (t.retried) {
          this.halt(m, `the ${seat.role} (${seat.workerName}) never started on its part of round ${m.round}`);
          return true;
        }
        const part = this.plan(m, m.round, m.step)?.find((p) => p.seat === t.seat);
        t.retried = true;
        this.readySince.delete(t);
        if (part) this.workers.prompt(w.id, this.ask(m, part), BY);
        return true;
      }
      case 'working': {
        if (!ready(w.status)) return false;
        if (this.written(m, t)) {
          t.state = 'done';
          return true;
        }
        if (t.retried) {
          const last = this.isLast(m, m.round);
          this.halt(m, last && t.file === m.output ? `reached its round limit without writing ${m.output}: the ${seat.role} ended the last round without it` : `the ${seat.role} (${seat.workerName}) ended round ${m.round} without writing ${t.file}`);
          return true;
        }
        retry();
        t.state = 'sent';
        return true;
      }
      default:
        return false;
    }
  }

  /** Every part of the step is written: on to the next step, the next round, or the end. */
  private next(m: Meeting) {
    // Red / blue: the red team found nothing more to fix, so blue writes it up this round.
    if (m.pattern === 'redblue' && m.step === 1 && NOTHING.test(this.head(m, m.turns[0]?.file))) m.lastRound = m.round;
    const more = this.plan(m, m.round, m.step + 1);
    if (more) {
      m.step++;
      m.turns = more.map((p) => ({ seat: p.seat, doing: p.doing, file: p.file, state: 'waiting' }));
      return;
    }
    if (this.isLast(m, m.round)) return this.finish(m);
    m.round++;
    m.step = 1;
    m.turns = (this.plan(m, m.round, 1) ?? []).map((p) => ({ seat: p.seat, doing: p.doing, file: p.file, state: 'waiting' }));
  }

  private isLast(m: Meeting, round: number): boolean {
    return round >= m.rounds || m.lastRound === round;
  }

  /** The output is written. Commit it on the meeting's branch, or post the review on its pull request. */
  private finish(m: Meeting) {
    m.status = 'done';
    m.finishedAt = Date.now();
    m.turns = [];
    this.readPreview(m);
    this.keepNotes(m);
    const p = MEETING_PATTERNS[m.pattern];
    this.events.toast(`🤝 The ${p.label} meeting on “${m.title}” is done: it wrote ${m.output}`, 'info');
    const cwd = this.cwd(m);
    if (m.pattern === 'review' && m.pr !== undefined) {
      const pr = m.pr;
      void this.events.postReview(pr, path.join(cwd, m.output), m.owner).then(
        (url) => {
          m.review = { url };
          this.events.toast(`🔍 Posted the panel's review on PR #${pr}`, 'info');
          this.changed();
        },
        (err) => {
          m.review = { error: (err as Error).message };
          this.events.toast(`Couldn't post the panel's review on PR #${pr}: ${m.review.error}`, 'warn');
          this.changed();
        },
      );
    } else if (m.worktree) {
      void commitAll(cwd, `${m.title}\n\n${p.label} meeting in Agent Office, called by ${m.calledBy}. Output: ${m.output}`, m.notes).then(
        (sha) => {
          m.commit = sha;
          this.changed();
        },
        (err) => {
          this.events.toast(`Couldn't commit ${m.output} on ${m.worktree!.branch}: ${gitError(err)}`, 'warn');
          this.changed();
        },
      );
    }
  }

  /** Stops the meeting short, saying why. Whoever is still busy is told to stop (Esc). */
  private halt(m: Meeting, reason: string) {
    if (m.status !== 'running') return;
    m.status = 'stopped';
    m.reason = reason;
    m.finishedAt = Date.now();
    const busy = new Set(this.workers.list().filter((w) => w.status === 'working' || w.status === 'needs_input').map((w) => w.id));
    for (const s of m.seats) if (s.workerId && busy.has(s.workerId)) this.workers.write(s.workerId, '\x1b', BY);
    this.readPreview(m);
    this.keepNotes(m);
    this.events.toast(`⛔ The meeting on “${m.title}” stopped in round ${m.round}: ${reason}`, 'warn');
    this.changed();
  }

  /**
   * Sends a meeting's workers home, then tidies its worktree away: the branch stays when the output
   * was committed on it, and everything stays when something is left uncommitted.
   */
  private async dismiss(m: Meeting) {
    if (m.cleared) return;
    m.cleared = true;
    const here = new Set(this.workers.list().map((w) => w.id));
    await Promise.all(m.seats.filter((s) => s.workerId && here.has(s.workerId)).map((s) => this.workers.kill(s.workerId!)));
    const wt = m.worktree;
    if (!wt || !this.trees) return this.persist();
    // Kept with the floor's state already (keepNotes): the notes, and a review panel's review, which
    // is on the pull request now, go, so they don't count as work left behind.
    const cwd = this.cwd(m);
    const own = path.resolve(this.dir, '.agent-office', 'worktrees') + path.sep;
    for (const leftover of [m.notes, m.pattern === 'review' ? m.output : undefined]) {
      const abs = leftover && path.resolve(cwd, leftover);
      if (abs && abs.startsWith(own)) rmSync(abs, { recursive: true, force: true });
    }
    const state = await this.trees.inspect(wt);
    if (state.error || state.dirty) {
      this.events.toast(`Kept the “${m.title}” meeting's worktree and branch ${wt.branch}: ${state.error ?? `${state.dirty} uncommitted change${state.dirty === 1 ? '' : 's'}`}`, 'info');
    } else {
      const err = await this.trees.remove(wt, state.ahead ? 'worktree' : 'all');
      if (err) this.events.toast(`Couldn't tidy away the meeting's worktree: ${err}`, 'warn');
    }
    this.persist();
  }

  /** Puts a finished meeting on the list of earlier ones. */
  private archive(m: Meeting) {
    this.past = [meetingRecord(m), ...this.past.filter((r) => r.id !== m.id)].slice(0, PAST_MAX);
  }

  /** Adds up what the workers at the table have used. Returns whether it changed. */
  private tally(m: Meeting, byId: Map<string, WorkerInfo>): boolean {
    let tokens = 0;
    let cost = 0;
    let known = true;
    for (const s of m.seats) {
      const w = s.workerId ? byId.get(s.workerId) : undefined;
      // A worker sent home took its figures with it: keep the last ones seen.
      if (w?.usage) {
        s.tokens = tokensOf(w.usage);
        s.cost = w.usage.costKnown === false || (w.provider === 'codex' && w.usage.costKnown !== true) ? undefined : w.usage.cost;
      }
      tokens += s.tokens ?? 0;
      if (s.tokens && s.cost === undefined) known = false;
      cost += s.cost ?? 0;
    }
    if (tokens === m.tokens && cost === m.cost && known === m.costKnown) return false;
    m.tokens = tokens;
    m.cost = cost;
    m.costKnown = known;
    return true;
  }

  // --- The patterns ----------------------------------------------------------

  /** What every worker is told when it sits down, ahead of its first part. */
  private brief(m: Meeting, i: number): string {
    const p = MEETING_PATTERNS[m.pattern];
    const role = m.seats[i].role;
    const others = m.seats.filter((_, j) => j !== i).map((s) => `the ${s.role}`);
    const head = m.seats[0].role;
    const how: Record<Meeting['pattern'], string> = {
      debate: `Round 1: everyone proposes an answer. Each round after that until the last: everyone reads the others' latest notes, critiques them and revises their own. Last round: the ${head} writes the decision.`,
      lead: `Round 1: the ${head} splits the task into a part for each of the others and writes the plan. Round 2: each of them does their part. Round 3: the ${head} merges the work, checks it and writes it up.`,
      mapreduce: `Round 1: each mapper does the task over its own parts. Round 2: the ${head} combines what they found into one result.`,
      redblue: `Each round the Red team attacks the change (bugs, security holes, edge cases) and the Blue team fixes what holds up. The ${head} writes it all up in the last round, which comes early if Red finds nothing more.`,
      review: `Round 1: each reviewer reviews the pull request through their own lens. Round 2: the ${head} merges the reviews into one, which the office posts on the pull request.`,
    };
    const where = !m.worktree
      ? `You're in the project's folder, which other people use too: don't commit, push or switch branches.`
      : m.pattern === 'review'
        ? `This is a review: don't change, commit or push anything in the checkout. The only files you write are your notes${i === 0 ? ` and ${m.output}` : ''}.`
        : `You all share one git worktree, on the branch ${m.worktree.branch}. Don't commit, push or switch branches: when the meeting is over, the office commits ${m.output}, with whatever else was changed, there.`;
    // The worktree sits inside the project's own folder, where a search can wander off to.
    const inside = m.worktree ? ` The whole project is checked out in your working directory: read and write files there, by paths inside it, and never in a folder above it.` : '';
    return this.say('meeting.brief', {
      title: m.title,
      role,
      pattern: p.label,
      others: list(others),
      how: how[m.pattern],
      about: m.prompt,
      pullRequest: m.pr !== undefined ? `The pull request is #${m.pr}: read it with gh pr view ${m.pr} and gh pr diff ${m.pr}.` : '',
      issue: m.issue !== undefined ? `It comes from GitHub issue #${m.issue}: gh issue view ${m.issue} --comments.` : '',
      cwd: this.cwd(m),
      notes: path.join(this.cwd(m), m.notes),
      output: m.output,
      outputPath: path.join(this.cwd(m), m.output),
      rounds: `${m.rounds} round${m.rounds === 1 ? '' : 's'}`,
      budget: fmtTokens(m.budget),
      where: where + inside,
    });
  }

  /** One of the office's prompts, filled in. */
  private say(id: PromptId, vars: PromptVars = {}): string {
    return fillPrompt(this.events.prompt?.(id) ?? PROMPTS[id].text, vars);
  }

  /** A part, as the prompt that hands it over. */
  private ask(m: Meeting, part: Part): string {
    return `Round ${m.round} of ${m.rounds}, ${part.doing}. ${part.ask}`;
  }

  /** The parts of step `step` of round `round`, or null when that round has no such step. */
  private plan(m: Meeting, round: number, step: number): Part[] | null {
    const n = m.seats.length;
    // Parts name their files by full path: a worktree sits inside the project's own folder, and an
    // agent can take a relative path to be the project's (and then it's asked about writing outside).
    const A = (rel: string) => path.join(this.cwd(m), rel);
    const note = (r: number, i: number) => `${m.notes}/r${r}-${i + 1}-${slugify(m.seats[i].role, 24)}.md`;
    const notes = (r: number, seats: number[]) => seats.map((i) => A(note(r, i))).join(', ');
    const all = m.seats.map((_, i) => i);
    const last = this.isLast(m, round);
    switch (m.pattern) {
      case 'debate': {
        if (step > 1) return null;
        if (last) {
          return [{ seat: 0, doing: 'writing the decision', file: m.output, ask: this.say('meeting.debate.decide', { notes: A(m.notes), lastNotes: notes(round - 1, all), output: A(m.output) }) }];
        }
        if (round === 1) return all.map((i) => ({ seat: i, doing: 'proposing', file: note(1, i), ask: this.say('meeting.debate.propose', { role: m.seats[i].role, file: A(note(1, i)) }) }));
        return all.map((i) => ({
          seat: i,
          doing: 'critiquing',
          file: note(round, i),
          ask: this.say('meeting.debate.critique', { previousRound: round - 1, theirNotes: notes(round - 1, all.filter((j) => j !== i)), file: A(note(round, i)) }),
        }));
      }
      case 'lead': {
        const team = all.slice(1);
        if (step > 1) return null;
        const plan = `${m.notes}/plan.md`;
        if (round === 1) {
          const parts = `${team.length} part${team.length === 1 ? '' : 's'}`;
          return [{ seat: 0, doing: 'planning', file: plan, ask: this.say('meeting.lead.plan', { parts, team: list(team.map((i) => `the ${m.seats[i].role}`)), exampleRole: m.seats[team[0]].role, file: A(plan) }) }];
        }
        if (round === 2) {
          return team.map((i) => ({ seat: i, doing: 'doing their part', file: note(2, i), ask: this.say('meeting.lead.part', { plan: A(plan), role: m.seats[i].role, lead: m.seats[0].role, file: A(note(2, i)) }) }));
        }
        return [{ seat: 0, doing: 'merging the work', file: m.output, ask: this.say('meeting.lead.merge', { reports: notes(2, team), output: A(m.output) }) }];
      }
      case 'mapreduce': {
        if (step > 1) return null;
        const mappers = all.slice(1);
        if (round === 1) {
          return mappers.map((i, k) => {
            const mine = (m.parts ?? []).filter((_, j) => j % mappers.length === k);
            return { seat: i, doing: 'mapping', file: note(1, i), ask: this.say('meeting.mapreduce.map', { parts: mine.map((x) => `- ${x}`).join('\n'), file: A(note(1, i)) }) };
          });
        }
        return [{ seat: 0, doing: 'reducing', file: m.output, ask: this.say('meeting.mapreduce.reduce', { results: notes(1, mappers), output: A(m.output) }) }];
      }
      case 'redblue': {
        const [blue, red] = [0, 1];
        const redNote = `${m.notes}/r${round}-red.md`;
        const blueNote = `${m.notes}/r${round}-blue.md`;
        if (step === 1) {
          const before = round > 1 ? ` The Blue team's fixes from round ${round - 1} are in ${A(`${m.notes}/r${round - 1}-blue.md`)}: check them first, then keep looking.` : '';
          return [{ seat: red, doing: 'attacking', file: redNote, ask: this.say('meeting.redblue.attack', { previousFixes: before, file: A(redNote) }) }];
        }
        if (step > 2) return null;
        if (m.lastRound === round) {
          return [{ seat: blue, doing: 'writing it up', file: m.output, ask: this.say('meeting.redblue.writeup', { findings: A(redNote), notes: A(m.notes), output: A(m.output) }) }];
        }
        const wrap = last ? ` This is the last round: once you've fixed things, also write ${A(m.output)}: every finding from every round (${A(m.notes)}/), what was fixed and how, and what's still open. That file is the meeting's output.` : '';
        return [{ seat: blue, doing: last ? 'fixing and writing it up' : 'fixing', file: last ? m.output : blueNote, ask: this.say('meeting.redblue.fix', { findings: A(redNote), file: A(blueNote), lastRound: wrap, output: A(m.output) }) }];
      }
      case 'review': {
        if (step > 1) return null;
        if (round === 1) {
          return all.map((i) => ({
            seat: i,
            doing: 'reviewing',
            file: note(1, i),
            ask: this.say('meeting.review.review', { pr: m.pr, role: m.seats[i].role, file: A(note(1, i)) }),
          }));
        }
        return [{ seat: 0, doing: 'writing the review', file: m.output, ask: this.say('meeting.review.combine', { findings: notes(1, all), exampleRole: m.seats[1]?.role ?? 'Security', output: A(m.output) }) }];
      }
    }
  }

  // --- Files -----------------------------------------------------------------

  private cwd(m: Meeting): string {
    return m.worktree ? path.join(this.dir, m.worktree.path) : this.dir;
  }

  /** Whether a part's file is there, with something in it, written since the part was handed over. */
  private written(m: Meeting, t: MeetingTurn): boolean {
    try {
      const st = statSync(path.join(this.cwd(m), t.file));
      return st.isFile() && st.size > 0 && st.mtimeMs >= (t.sentAt ?? 0) - 2000;
    } catch {
      return false;
    }
  }

  /** The first line of a notes file with something on it ('' when there's no such file). */
  private head(m: Meeting, file: string | undefined): string {
    if (!file) return '';
    try {
      return readStart(path.join(this.cwd(m), file), 400).split('\n').find((l) => l.trim()) ?? '';
    } catch {
      return '';
    }
  }

  /** Reads what's written of the output so far, for the board in the room. Returns whether it changed. */
  private readPreview(m: Meeting): boolean {
    let text: string | undefined;
    try {
      text = readStart(path.join(this.cwd(m), m.output), PREVIEW_CHARS * 2).slice(0, PREVIEW_CHARS);
    } catch {
      text = undefined;
    }
    if (text === m.preview) return false;
    m.preview = text;
    return true;
  }

  /** Copies the meeting's notes and output next to the floor's other state, where they outlive its worktree. */
  private keepNotes(m: Meeting) {
    try {
      const to = path.join(this.dataDir, 'meetings', m.id);
      const from = path.join(this.cwd(m), m.notes);
      if (path.resolve(from) !== path.resolve(to) && existsSync(from)) cpSync(from, to, { recursive: true });
      const out = path.join(this.cwd(m), m.output);
      if (existsSync(out)) cpSync(out, path.join(to, `output-${path.basename(m.output)}`));
    } catch {
      // the notes are a courtesy; the meeting is over either way
    }
  }

  private changed() {
    this.dirty = false;
    this.persist();
    this.events.update(this.state());
  }

  private persist() {
    try {
      writeFileSync(this.statePath, JSON.stringify({ current: this.current, past: this.past }, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }

  private restore() {
    if (!existsSync(this.statePath)) return;
    try {
      const saved = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<MeetingState>;
      if (Array.isArray(saved.past)) this.past = saved.past.filter((r) => r && typeof r.id === 'string' && typeof r.summary === 'string').slice(0, PAST_MAX);
      const m = saved.current;
      // The workers at the table outlive a restart of the office, so a meeting carries on where it was.
      if (m && typeof m.id === 'string' && isMeetingPattern(m.pattern) && Array.isArray(m.seats) && Array.isArray(m.turns)) this.current = m;
    } catch {
      // corrupt state file: an empty room
    }
  }
}

/**
 * Commits everything in a checkout but `leaveOut` (the notes); resolves to the commit's short hash, or
 * undefined when there was nothing to commit.
 */
async function commitAll(cwd: string, message: string, leaveOut: string): Promise<string | undefined> {
  const git = async (args: string[]) => (await execFileP('git', args, { cwd, encoding: 'utf8', timeout: 60_000 })).stdout.trim();
  await git(['add', '-A', '--', '.', `:(exclude)${leaveOut}`]);
  if (!(await git(['diff', '--cached', '--name-only']))) return undefined;
  await git(['commit', '-q', '-m', message]);
  return git(['rev-parse', '--short', 'HEAD']);
}

/** The start of a file, at most `bytes` of it. */
function readStart(file: string, bytes: number): string {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString('utf8').replace(/�+$/, '');
  } finally {
    closeSync(fd);
  }
}

/** Roles that repeat get numbered, so each worker at the table has one of its own: Engineer 1, Engineer 2. */
function numbered(roles: string[]): string[] {
  const seen = new Map<string, number>();
  const count = new Map<string, number>();
  for (const r of roles) count.set(r.toLowerCase(), (count.get(r.toLowerCase()) ?? 0) + 1);
  return roles.map((r) => {
    const key = r.toLowerCase();
    if ((count.get(key) ?? 0) < 2) return r;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return `${r} ${n}`;
  });
}

/** "a", "a and b", "a, b and c". */
function list(xs: string[]): string {
  return xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function firstLine(s: string): string {
  return s.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
