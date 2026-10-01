import type { AgentEffort, AgentProvider, ForgeKind, FloorInfo, GhComment, GhIssue, GhLabel, GhPull, GhState, JailState, MeetingRequest, MeetingState, ProjectInfo, QueueState, TerminalHit, WorkerInfo, WorkerKind, WorktreeCleanup, WorktreeState } from '../shared/protocol.js';
import type { BallState } from '../shared/hoop.js';
import type { CarPose, CarSeat, CarState } from '../shared/garage.js';
import type { Decoration } from '../shared/decor.js';
import type { JukeboxSpot, JukeboxState } from '../shared/jukebox.js';
import { tvTitle, TV_OFF, type TvState } from '../shared/tv.js';
import type { DeskLabel, FloorPlan } from '../shared/floorplan.js';
import { EMPTY_PLAN } from '../shared/floorplan.js';
import type { Landed } from './leave-on-merge.js';
import type { ForgeAs } from './signins.js';
import type { OpenedPr, RepoSource } from './workers.js';
import type { FloorActions, FloorChanges, FloorCourt, FloorDecor, FloorForge, FloorGarage, FloorMeetings, FloorPlan as FloorPlanActions, FloorQueue, FloorRoom, FloorTv, FloorWorkers } from './floor-actions.js';
import type { HostRegistry, HostSocket } from './floor-hosts.js';
import type { FromFloor, ToOffice } from '../shared/floorhost.js';

/** What a board looks like before the host has said anything about it. */
const EMPTY_GH: GhState<never> = { items: [], fetchedAt: 0, loading: false };

/** How long a call waits for the host before it is treated as gone. Deliberately generous: the answer
 * to most of these touches a disk on the far end, and a slow machine is not a broken one. */
const CALL_TIMEOUT_MS = 20_000;

export class HostGone extends Error {
  constructor(readonly floorId: string, readonly machine: string) {
    super(`${machine} is not answering`);
  }
}

/** One in-flight call, waiting for the host to answer it. */
interface Pending {
  floorId: string;
  resolve(value: unknown): void;
  reject(err: Error): void;
  timer: NodeJS.Timeout;
}

/**
 * A floor that runs on someone else's machine.
 *
 * The office holds this where it would otherwise hold a `Floor`, and calls exactly the same methods —
 * `server.ts` does not know the difference. What changes is where the work happens: a call is shipped
 * over that machine's socket instead of run here, and the answer comes back the same way.
 *
 * Three kinds of method, three behaviours, and the difference matters:
 *
 *   **writes** ship a frame and wait for the reply. The reply is either the result or a refusal
 *   `string`, which is how every other refusal in the office already reports itself.
 *
 *   **reads** do not ship at all. The host streams worker updates and board state upward the moment
 *   they change, so the office already holds them and `list()` or `queue.state()` costs nothing. This
 *   is why the last known state is kept here rather than fetched on demand.
 *
 *   **events** (`changes.watch` and friends) ship and return nothing, because they push. What comes
 *   back is an `event` frame, delivered by `FloorContext.changes` on the host's side.
 *
 * **A sleeping machine is a refusal, never a failure.** Every call here resolves to a message naming
 * it, and the queue is told to keep the task (finding 10). Nothing throws at the caller, because a
 * laptop in a bag is not an error.
 *
 * **Three things are refused outright** rather than proxied: the whiteboard, the dog and the docs.
 * All three are files in the floor's own data directory, so serving them would mean the office
 * reading a checkout it must never touch. Refusing with the machine's name is honest; proxying every
 * whiteboard stroke across the internet is a latency question that has not been measured yet, and
 * that is worth measuring before designing (see docs/remote-agents-plan.md, "the gaps").
 */
export class RemoteFloor implements FloorActions {
  readonly dir: string;
  private seq = 0;
  private pending = new Map<number, Pending>();
  /** The last thing each read returned, kept so a read never has to cross the socket. */
  private mirror = new Map<string, unknown>();
  /**
   * The workers the office knows about, by id, filled by the `worker.update` events the host streams.
   * `ready` names ids only, so a roster of ids is not a roster of workers: the offices's reads answer
   * from here, and a worker the host has not described yet is simply not listed.
   */
  private known = new Map<string, WorkerInfo>();
  /** Set on disconnect; only a fresh ready announcement makes the floor callable again. */
  private gone = false;
  /** The worker ids the host says are on this floor. Names, not descriptions (see `known`). */
  private roster = new Set<string>();

  constructor(
    readonly id: string,
    /**
     * The machine's name, so every refusal can name it. Read through the registry rather than kept,
     * because a floor is registered from the building before its machine has necessarily paired.
     */
    machine: string,
    readonly hostId: string,
    private registry: HostRegistry,
    /** The floor's identity, as the host announced it. Named so refusals and the elevator can use it. */
    readonly def: { id: string; name: string; dir: string; repo?: string; palette: number; addedBy: string; addedAt: number },
    /** What the host's `ready` frame said, kept here so the office can describe the floor it is in. */
    private announced: { branch?: string; providers: AgentProvider[]; forge: ForgeKind } = { providers: [], forge: 'github' },
  ) {
    // The office keeps this for identity, and must never use it: it is a path on the host.
    this.dir = '';
    this.fallbackName = machine;
    this.onGone = () => this.dropPending();
  }

  /**
   * What the floor is, for whoever rides into it: the name the building gave it, and the branch and
   * agent CLIs the host itself reported in `ready`.
   *
   * `dir` is empty on purpose. The office must never hold a path on the host that it could be tempted
   * to read, so a hosted floor says where it is by naming the machine instead — which is also the only
   * part of the answer a person standing in the room actually wants. Everything the host did not
   * report is left unset rather than guessed: a floor that claims a branch or an agent it has not got
   * is worse than one that admits it does not know.
   */
  get project(): ProjectInfo {
    return {
      name: this.def.repo ?? this.def.name,
      dir: '',
      branch: this.announced.branch,
      agentCmd: '',
      defaultProvider: this.announced.providers[0] ?? 'claude',
      agentProviders: this.announced.providers,
    };
  }

  /** The machine's name, as it is now. */
  private get machine(): string {
    return this.registry.nameOf(this.hostId) ?? this.fallbackName;
  }

  /** The issues board, as the host last streamed it. */
  private get issues(): GhState<GhIssue> {
    return this.last<GhState<GhIssue>>('gh.issues', EMPTY_GH as GhState<GhIssue>);
  }

  /** The pulls board, as the host last streamed it. */
  private get pulls(): GhState<GhPull> {
    return this.last<GhState<GhPull>>('gh.pulls', EMPTY_GH as GhState<GhPull>);
  }

  /** Which forge the host said this floor reads from, as of its last `ready`. */
  get hostForge(): ForgeKind {
    return this.announced.forge;
  }

  private readonly fallbackName: string;

  /** Called when the socket carrying this floor closes. Every floor it had, in one pass. */
  onGone: (floorId: string) => void = () => {};

  /** Whether this floor's machine is answering right now. */
  get reachable(): boolean {
    return !this.gone && this.registry.isReachable(this.id);
  }

  private dropPending() {
    this.gone = true;
    for (const [n, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new HostGone(p.floorId, this.machine));
      this.pending.delete(n);
    }
  }

  /**
   * The host's frame arrived: settle whatever it answers, fill the mirror, or drop it.
   *
   * A call is settled by exactly one frame — `result` carrying its value, or `refused` carrying why —
   * so a caller never hears a half-answer, and never waits out a timeout for an answer that came.
   *
   * The mirror is keyed by the **event `t`** the floor emitted, and every read names that event. That
   * is the fix for a bug worth remembering: an earlier version keyed reads by composite names
   * (`decor.list`, `jukebox.state`) that no emitted event ever matched, so seven of eight reads
   * silently returned their empty default while the office kept streaming that state anyway.
   */
  deliver(msg: FromFloor) {
    if (msg.t === 'ready') {
      if (msg.floor.floorId !== this.id) return;
      this.gone = false;
      // Ids only, so this is a roster and not a description. A worker the host has not described yet
      // is not listed: better an incomplete list than one invented from an id.
      this.roster = new Set((msg.floor.workers ?? []).map((w) => w.id));
      for (const id of this.known.keys()) if (!this.roster.has(id)) this.known.delete(id);
      // The same frame is where the host says which branch it is on and which agents it has, which is
      // what `project` and `officeDefault` answer from. Recorded here rather than in the constructor,
      // because the office registers a hosted floor from the building long before its machine pairs.
      this.announced = { branch: msg.floor.branch, providers: msg.floor.providers ?? [], forge: msg.floor.forge };
      return;
    }
    // An unaddressed refusal (no floor) is about the connection, not a call, so it never settles one.
    const refusal = msg.t === 'refused' && 'reason' in msg ? msg : undefined;
    if (!('floorId' in msg) || msg.floorId !== this.id) return;
    // Event sequence numbers belong to the host's stream, not our RPC counter.
    const seq = refusal ? refusal.seq : msg.t === 'result' ? msg.seq : undefined;
    if (typeof seq === 'number') {
      const pending = this.pending.get(seq);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(seq);
        // A refusal names the machine, which is the one thing every refusal in this feature promises
        // (see floor-actions.ts). An empty reason is not a refusal at all: it is the host saying that a
        // call whose result nobody branches on worked, so it resolves to nothing, not to a warning.
        if (refusal) pending.resolve(refusal.reason ? `${this.machine} refused: ${refusal.reason}` : undefined);
        else if (msg.t === 'result') pending.resolve(msg.value);
        else pending.resolve(msg);
        return;
      }
    }
    if (msg.t !== 'event') return;
    // Whatever the floor would have emitted locally, remembered under the event's own name so the
    // reads can find it. Worker updates are kept apart from the mirror: they describe a worker rather
    // than a floor's furniture, and the office asks for them by id.
    const payload = msg.msg as { t?: string; worker?: WorkerInfo; workerId?: string; state?: unknown; items?: unknown; plan?: unknown; ball?: unknown; cars?: unknown } | undefined;
    if (!payload?.t) return;
    if (payload.t === 'worker.update' && payload.worker) {
      this.known.set(payload.worker.id, payload.worker);
      this.roster.add(payload.worker.id);
    } else if (payload.t === 'worker.remove' && payload.workerId) {
      this.known.delete(payload.workerId);
      this.roster.delete(payload.workerId);
    } else {
      // What a read answers with is the payload, not the frame around it: a `queue` event carries
      // `{ t: 'queue', state }`, and `queue.state()` must return the state.
      this.mirror.set(payload.t, payload.state ?? payload.items ?? payload.plan ?? payload.ball ?? payload.cars ?? payload);
    }
  }

  private socket(): HostSocket | undefined {
    return this.gone ? undefined : this.registry.serves(this.id);
  }

  /**
   * Ships a call and waits for its answer. Resolves to the host's reply, or to a refusal naming the
   * machine when there is nobody home. Never rejects for an ordinary disconnection — that is a
   * refusal, and the office's callers all handle a string already.
   */
  private async call(t: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const socket = this.socket();
    if (!socket) return `${this.machine} is asleep`;
    const seq = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        resolve(`${this.machine} did not answer in time`);
      }, CALL_TIMEOUT_MS);
      this.pending.set(seq, { floorId: this.id, resolve, reject: () => resolve(`${this.machine} is asleep`), timer });
      socket.send({ t: t as ToOffice['t'], floorId: this.id, seq, ...payload } as unknown as ToOffice);
    });
  }

  /** A read, answered from what the host has already streamed. */
  private last<T>(key: string, empty: T): T {
    return (this.mirror.get(key) as T) ?? empty;
  }

  // --- identity: enough for the elevator panel, and nothing more -------------------------------------------------

  info(): FloorInfo {
    return {
      id: this.id,
      name: this.def.name,
      repo: this.def.repo,
      // A hosted floor's checkout is on the other machine. Empty here on purpose: the office must not
      // hold a path it could be tempted to read.
      dir: '',
      branch: this.announced.branch,
      palette: this.def.palette,
      addedBy: this.def.addedBy,
      addedAt: this.def.addedAt,
      workers: this.roster.size,
      busy: 0,
      waiting: 0,
      // Presence and the back office are office-side facts about the room, not the machine: nobody
      // here counts, and the wing is whatever the host last announced.
      people: 0,
      wing: this.last<{ wing?: number }>('plan', {}).wing ?? 0,
      // Named wherever a refusal will be, so nobody has to guess whose machine they are hiring on.
      host: { id: this.hostId, name: this.machine, reachable: this.reachable },
    };
  }

  // --- the surface server.ts calls. Writes ship; reads are mirrored; events push. -----------------------------

  get workers(): FloorWorkers {
    const remote = this;
    return {
      list: () => [...remote.known.values()],
      get: (id) => remote.known.get(id),
      ownerOf: (id) => remote.known.get(id)?.createdBy,
      deskOccupied: (deskId) => [...remote.known.values()].some((w) => w.deskId === deskId),

      // Somebody left the floor (or the office). They never attached to a terminal here — `attach` is
      // a call to the host, which is what put them on it — so there is nothing to detach. Saying so
      // rather than shipping a frame the host would answer with a refusal for an id it never knew.
      detachAll: () => {},

      // Empty, and for the same reason: the terminal is on the far machine, so what is on it is
      // whatever `attach` last sent. A joining browser asks for that, and gets the host's own screen.
      fullScreens: () => [],

      // The host resumes its own workers when it opens a floor, which it did before anyone could have
      // ridden in here — so there is nothing for the office to wake.
      wakeAll: () => {},

      // What a hire starts on when nobody picked: the first agent this machine actually has. Asking the
      // host would be the only other way to know it, and the host applies this one anyway when it is
      // left undefined (workers.ts), so naming it here only keeps the office from guessing harder.
      get officeDefault() {
        return { provider: remote.announced.providers[0] ?? ('claude' as AgentProvider) };
      },

      spawn: async (deskId, by, prompt, worktree, kind, provider, model, effort, meeting, owner, repos) =>
        (await remote.call('worker.spawn', {
          deskId, by, prompt, worktree, kind, provider, model, effort,
          meeting, owner, repos, providers: remote.announced.providers,
        })) as WorkerInfo | string,

      station: async (deskId, by, text, owner) => (await remote.call('station.prompt', { deskId, by, text, owner })) as { info: WorkerInfo; hired: boolean } | string,
      // A helper is a worker like any other, so it ships to the host the same way a hire does.
      sendHelper: async (hostId, by, provider, model, effort, owner) => (await remote.call('worker.helper', { hostId, by, provider, model, effort, owner })) as WorkerInfo | string,
      resume: async (id, prompt) => String((await remote.call('worker.resume', { workerId: id, prompt })) ?? ''),
      prompt: async (id, text, by) => String((await remote.call('worker.prompt', { workerId: id, text, by })) ?? ''),
      kill: async (id, cleanup) => {
        const result = await remote.call('worker.kill', { workerId: id, cleanup });
        return typeof result === 'string' ? { error: result } : (result ?? {}) as { note?: string; error?: string };
      },

      // The viewer and the typist travel with the call: the host registers who is watching a terminal
      // and who typed into it, and an anonymous viewer there is a viewer nobody can see.
      attach: async (id, clientId, name) => (await remote.call('worker.attach', { workerId: id, clientId, name })) as { data: string; cols: number; rows: number } | undefined,
      detach: (id, clientId) => void remote.call('worker.detach', { workerId: id, clientId }),
      write: (id, data, by) => void remote.call('term.input', { workerId: id, data, by }),
      resize: (id, cols, rows) => void remote.call('term.resize', { workerId: id, cols, rows }),
      search: async (needle, perWorker) => (await remote.call('worker.search', { needle, perWorker })) as { hits: TerminalHit[]; more: boolean },

      rebuild: async (id) => (await remote.call('worker.rebuild', { workerId: id })) as { rebuilt?: boolean; note?: string; error?: string },
      inspectWorktree: async (id) => (await remote.call('worker.worktree', { workerId: id })) as WorktreeState | undefined,
      openPr: async (id, by, as) => (await remote.call('worker.pr', { workerId: id, by, env: as?.env })) as { prs: OpenedPr[]; failed: string[] } | string,
    };
  }

  get queue(): FloorQueue {
    const remote = this;
    return {
      state: () => remote.last<QueueState>('queue', { tasks: [], maxWorkers: 0 }),
      add: async (prompt, by, title, issue, provider, model, effort, owner) => String((await remote.call('queue.add', { prompt, by, title, issue, provider, model, effort, owner })) ?? ''),
      remove: async (taskId) => void (await remote.call('queue.remove', { taskId })),
      move: async (taskId, delta) => void (await remote.call('queue.move', { taskId, delta })),
      retry: async (taskId) => String((await remote.call('queue.retry', { taskId })) ?? ''),
      clear: () => void remote.call('queue.clear'),
      setLimit: (n) => void remote.call('queue.limit', { maxWorkers: n }),
      dropIssue: async (issue) => Boolean((await remote.call('queue.dropIssue', { issue })) ?? false),
    };
  }

  get forge(): FloorForge {
    const remote = this;
    return {
      // The boards come off the `gh.issues` and `gh.pulls` events the floor emits, which reach here
      // through `deliver` and the mirror like every other read. The kind is the host's own, from the
      // `ready` frame, rather than assumed: a floor on Bitbucket is not a floor on GitHub.
      get kind() {
        return remote.hostForge;
      },
      // `items` and `state` are two views of one mirror read, so they cannot disagree.
      issues: { get items() { return remote.issues.items; }, get state() { return remote.issues; } },
      pulls: { get items() { return remote.pulls.items; }, get state() { return remote.pulls; } },
      refresh: () => void remote.call('gh.refresh'),
      claim: async (issue) => String((await remote.call('gh.claim', { issue })) ?? ''),
      merge: async (n, method, deleteBranch, auto, as) => (await remote.call('gh.merge', { n, method, deleteBranch, auto, env: as?.env })) as string | undefined,
      comment: async (kind, n, body, as) => (await remote.call('gh.comment', { kind, n, body, env: as?.env })) as { comment?: GhComment; error?: string },
      close: async (kind, n, opts, as) => (await remote.call('gh.close', { kind, n, opts, env: as?.env })) as string | undefined,
      setLabels: async (kind, n, add, remove, as) => (await remote.call('gh.labels', { kind, n, add, remove, env: as?.env })) as { labels?: GhLabel[]; error?: string },
    };
  }

  get changes(): FloorChanges {
    const remote = this;
    return {
      // These push rather than return, so there is nothing to wait for: the host answers with `changes`
      // frames and the office forwards them to whoever has the window open.
      watch: (workerId, clientId) => void remote.call('changes.watch', { workerId, clientId }),
      unwatch: (workerId, clientId) => void remote.call('changes.unwatch', { workerId, clientId }),
      // As with `detachAll`: the office opened these windows with `watch`, which is a call to the
      // host, so they are the host's to close and they close when the client goes away there.
      unwatchAll: () => {},
      diff: async (workerId, filePath, repo) => (await remote.call('changes.diff', { workerId, filePath, repo })) as { diff: string; truncated: boolean } | string,
      commit: async (workerId, message, who, env, repo) => (await remote.call('changes.commit', { workerId, message, who, env, repo })) as string | undefined,
      discard: async (workerId, filePath, who, repo) => (await remote.call('changes.discard', { workerId, filePath, who, repo })) as string | undefined,
      pullRequest: async (workerId, title, body, who, env, repo) => (await remote.call('changes.pr', { workerId, title, body, who, env, repo })) as string | undefined,
    };
  }

  get plan(): FloorPlanActions {
    const remote = this;
    return {
      label: async (deskId, text, color, by) => (await remote.call('desk.label', { deskId, text, color, by })) as { label?: DeskLabel; old?: DeskLabel } | string,
      expand: async () => (await remote.call('floor.expand')) as string[] | string,
      shrink: async () => (await remote.call('floor.shrink')) as string[] | string,
      get wing() {
        return remote.last<{ wing?: number }>('plan', {}).wing ?? 0;
      },
      // The whole plan, for whoever walks in. The host streams the same `plan` event that `wing` is
      // read from, so this is the same value the office has been holding — it just hands it over
      // whole rather than picking one number out of it.
      state: () => remote.last<FloorPlan>('plan', EMPTY_PLAN),
    };
  }

  get decor(): FloorDecor {
    const remote = this;
    return {
      list: () => remote.last<Decoration[]>('decor', []),
      add: async (input, by) => (await remote.call('decor.add', { input, by })) as Decoration | string,
      update: async (id, patch) => (await remote.call('decor.update', { id, patch })) as Decoration | string,
      remove: async (id) => (await remote.call('decor.remove', { id })) as Decoration | undefined,
    };
  }

  get jukebox(): FloorRoom {
    const remote = this;
    return {
      play: async (input, by) => (await remote.call('jukebox.play', { input, by })) as { changed: boolean } | { error: string },
      place: async (spot) => (await remote.call('jukebox.place', { spot })) as JukeboxSpot | string,
      skip: async (by) => void (await remote.call('jukebox.skip', { by })),
      stop: async (by) => Boolean((await remote.call('jukebox.stop', { by })) ?? false),
      title: () => remote.last<{ title?: string }>('jukebox', {}).title ?? '',
      // A floor whose host has said nothing yet: the jukebox is off, and nothing is on it.
      state: () => remote.last<JukeboxState>('jukebox', { on: false, track: '', startedAt: 0, elapsed: 0 }),
    };
  }

  get court(): FloorCourt {
    const remote = this;
    return {
      take: async (id) => Boolean((await remote.call('ball.take', { clientId: id })) ?? false),
      throw: async (id, v) => Boolean((await remote.call('ball.throw', { clientId: id, ...v })) ?? false),
      // The ball is on the host with everyone else on that floor, so a ride out of here is its
      // business, not the office's. It answers whether the ball actually had to drop.
      left: async (id) => Boolean((await remote.call('ball.left', { clientId: id })) ?? false),
      state: () => remote.last<BallState>('ball', {}),
    };
  }

  get garage(): FloorGarage {
    const remote = this;
    return {
      enter: async (id, car, seat) => Boolean((await remote.call('car.enter', { clientId: id, car, seat })) ?? false),
      leave: async (id) => Boolean((await remote.call('car.leave', { clientId: id })) ?? false),
      drive: async (id, car, pose) => (await remote.call('car.drive', { clientId: id, car, ...pose })) as CarPose | undefined,
      honk: async (id) => (await remote.call('car.honk', { clientId: id })) as number | undefined,
      state: () => remote.last<CarState[]>('cars', []),
    };
  }

  get tv(): FloorTv {
    const remote = this;
    return {
      play: async (input, by) => (await remote.call('tv.play', { input, by })) as { changed: boolean } | { error: string },
      pause: async (position, by) => Boolean(await remote.call('tv.pause', { position, by })),
      seek: async (position, by) => Boolean(await remote.call('tv.seek', { position, by })),
      stop: async (by) => Boolean(await remote.call('tv.stop', { by })),
      // Read from the `tv` event the host emits as its state changes — the same state a local floor
      // derives its title from, so there is nothing to ask the host for.
      title: () => tvTitle(remote.last<TvState>('tv', TV_OFF).url),
      state: () => remote.last<TvState>('tv', TV_OFF),
    };
  }

  get meetings(): FloorMeetings {
    const remote = this;
    return {
      start: async (req: MeetingRequest, by, owner) => String((await remote.call('meeting.start', { req, by, owner })) ?? ''),
      stop: async (by) => String((await remote.call('meeting.stop', { by })) ?? ''),
      // A meeting is refused by kind on a hosted floor — the room's people are in the office, not here
      // — so this asks the host only so the refusal is the host's own words rather than a guess.
      clear: async (by) => String((await remote.call('meeting.clear', { by })) ?? ''),
      state: () => remote.last<MeetingState>('meeting', { current: null, past: [] }),
    };
  }

  get jail(): { state(): JailState } {
    const remote = this;
    return {
      // Nobody here is sent to the dungeon: a worker goes home from its own machine, and the jail is a
      // file on that disk. So there are no prisoners, and the view says so rather than inventing any.
      state: () => remote.last<JailState>('jail', { prisoners: [], bones: 0 }),
    };
  }

  // --- presence and merges stay office-side: they are about the room, not the machine. -----------------------

  arrived(): void {}
  merged(n: number, by?: string): void {
    void this.call('gh.merge', { n, by, notify: true });
  }
  landed(): Landed | undefined {
    return undefined;
  }
  sendLandedHome(): void {}
  sendHome(workerId: string, cleanup?: WorktreeCleanup): Promise<{ note?: string; error?: string }> {
    return this.workers.kill(workerId, cleanup);
  }

  /**
   * The whiteboard, the dog and the docs are files in this floor's own data directory, so they are not
   * on the surface at all and there is nothing here to call. This is how the office says so out loud,
   * by name: a gap the user can read beats a feature that silently does nothing.
   */
  refuses(feature: 'the whiteboard' | 'the dog' | 'the docs'): string {
    return `${feature} is on ${this.machine}, which hosts this floor`;
  }
}
