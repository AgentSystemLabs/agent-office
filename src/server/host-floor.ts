import http from 'node:http';
import { Floor, type FloorContext } from './floor.js';
import { Ledger } from './usage.js';
import type { Capacity } from './machine.js';
import type { FloorDef } from './building.js';
import { PROMPTS, type PromptId } from '../shared/prompts.js';
import type {
  AgentChoice,
  AgentEffort,
  AgentProvider,
  ChangesState,
  ForgeKind,
  PeerInfo,
  ServerMsg,
  WorkerInfo,
} from '../shared/protocol.js';
import type { FromFloor, ToOffice } from '../shared/floorhost.js';

/**
 * The host machine's side of the connection: a real `Floor` per floor the office asked for, and the
 * socket to report into.
 *
 * This is what makes "hosting a floor" mean something. The `Floor` here is the *same class* the office
 * runs for its own floors — its own `WorkerManager`, `TaskQueue`, `Forge` and `Changes`, on this disk,
 * with this machine's sign-ins. Nothing about a floor forks for being hosted; only the `FloorContext`
 * differs, and it differs in one way: what would have gone to people in the same process goes up the
 * socket instead.
 *
 * Which members are local and which cross the wire is the answer to decision 9, and the split is the
 * security story:
 *
 *   **local**     `agentCmd`, `agentArgs`, `dshProfile`, `hook`, `ledger`, `capacity`, `prompts`,
 *                 `leaveOnMerge`. This machine's own settings; a floor cannot be built without them.
 *   **upward**    `emit`, `toast`, `termData`, `changes`, `workerChanged`, `pullsChanged`. Everything
 *                 a floor would have said to the room goes over the socket, so the office and its
 *                 people see the floor as they always have.
 *   **withheld**  `runAs` and `forgeAs`, both per-account **sign-ins**. Deliberately absent: a hosted
 *                 floor runs on this machine's own, and the office cannot hand it anyone's
 *                 credentials. `floor(id)` is withheld for the same kind of reason — a worker here
 *                 must not reach into a checkout on the office's disk (finding 9).
 */

/** This machine's own settings, as the host command discovered them. */
export interface HostSettings {
  dataDir: string;
  agentCmd: string;
  agentArgs: string[];
  dshProfile: string;
}

/** What a host floor needs: this machine, and a way to report to the office. */
interface HostParts extends HostSettings {
  hookUrl: string;
  /** How many workers this machine will seat across its floors. Declared by the host, at pairing. */
  seats: number;
  ledger: Ledger;
  capacity: Capacity;
  prompts: { text(id: PromptId): string; agent(): AgentChoice | undefined };
  /** Sends a frame up. Rebound when the connection opens. */
  send: (msg: FromFloor) => void;
}

/** Runs the floors this machine is serving, and answers the office's calls against them. */
export class HostFloors {
  readonly floors = new Map<string, Floor>();
  private names = new Map<string, string>();
  /** Which floor each worker is on, kept as they change (see floorOf). */
  private byWorker = new Map<string, Floor>();

  constructor(private parts: HostParts) {}

  /**
   * The floor a worker sits on. Worker ids are unique per machine, and the index is kept as workers
   * come and go, so this is a map lookup. The hook listener calls it on every agent event, which is
   * the busiest path here, and a scan of every floor per request was the wrong shape for it.
   */
  floorOf(workerId: string): Floor | undefined {
    const known = this.byWorker.get(workerId);
    if (known) return known;
    // A worker the index has not heard of yet (the first report before any change): find it once and
    // remember, so the scan happens at most once per worker rather than once per event.
    for (const f of this.floors.values()) {
      if (f.workers.get(workerId)) {
        this.byWorker.set(workerId, f);
        return f;
      }
    }
    return undefined;
  }

  /** The workers of the floor a worker is on, for the hook listener. */
  workersOf(workerId: string): import('./workers.js').WorkerManager | undefined {
    return this.floorOf(workerId)?.workers;
  }

  /**
   * Opens the floors the office asked for and reports each one ready. A floor whose checkout is not on
   * this machine is skipped and said so, rather than announced and then failing every call.
   */
  async open(wanted: { id: string; dir: string; name: string }[]) {
    // In parallel: a machine serving k floors would otherwise come online in the sum of their open
    // times, and none of them depends on another.
    await Promise.allSettled(
      wanted.map(async (want) => {
        this.names.set(want.id, want.name);
        const def: FloorDef = { id: want.id, name: want.name, dir: want.dir, palette: 0, addedBy: 'the office', addedAt: Date.now() };
        try {
          const floor = new Floor(def, this.context(want.id, want.name));
          this.floors.set(want.id, floor);
          await floor.ready;
          this.report(want.id, floor);
        } catch (err) {
          // Dropped from the map, not only reported: leaving a half-open floor here would apply later
          // calls to a floor the office has already been told is gone.
          const broken = this.floors.get(want.id);
          this.floors.delete(want.id);
          this.names.delete(want.id);
          broken?.shutdown();
          this.parts.send({ t: 'leave', floorId: want.id, why: (err as Error).message });
        }
      }),
    );
  }

  /**
   * The room state, which the office cannot read from here any other way.
   *
   * An office-side floor is asked for these directly, so nothing ever emits them; a hosted one has to
   * be told, or the office's picture of the jukebox, the ball, the cars, the walls and the back office
   * never changes from its empty default.
   */
  private reportRooms(floorId: string, floor: Floor) {
    const state = (t: string, body: Record<string, unknown>) =>
      this.parts.send({ t: 'event', floorId, seq: 0, msg: { t, ...body } });
    state('plan', { state: floor.plan.state() });
    state('decor', { state: floor.decor.list() });
    state('jukebox', { state: floor.jukebox.state() });
    state('ball', { state: floor.court.state() });
    state('cars', { state: floor.garage.state() });
    state('meeting', { state: floor.meetings.state() });
    state('tv', { state: floor.tv.state() });
    // The two boards and the dungeon joined them when riding onto a hosted floor became a thing: the
    // office builds the view someone walks into out of exactly these, so a board or a jail that is
    // read but never reported is a room that arrives empty for no reason anyone can see.
    state('gh.issues', { state: floor.forge.issues.state });
    state('gh.pulls', { state: floor.forge.pulls.state });
    state('jail', { state: floor.jail.state() });
  }

  /**
   * Where this machine keeps its checkouts. Kept as the office would see it — a real path on this
   * disk — because it is only ever a suggestion for the office's `hosts add-floor`, which has no way
   * to look here.
   */
  projectsDir: string = '';

  /** Tells the office a floor is up, with its seats and whoever is already on it. */
  private report(floorId: string, floor: Floor) {
    this.reportRooms(floorId, floor);
    for (const w of floor.workers.list()) this.byWorker.set(w.id, floor);
    this.parts.send({
      t: 'ready',
      floor: {
        floorId,
        name: this.names.get(floorId) ?? floorId,
        // A finite number, always: `Infinity` is not JSON, and an office that received `null` here
        // would read it as a machine that seats nobody. This machine's own ceiling, not the office's —
        // the office applies its own `--max-workers` on top (decision 3).
        seats: this.parts.seats,
        accepting: false,
        // This machine's own identity: commits from here are attributed to whoever runs it, which is
        // the point of a hosted floor running on their sign-ins (decision 5).
        forge: floor.forge.kind,
        // Only this machine knows these: which branch its checkout is on, and which agent CLIs are
        // actually installed here. The office needs both to describe the floor to someone who rides
        // into it from here, and it cannot work either out from its own disk.
        branch: floor.project.branch,
        providers: floor.project.agentProviders,
        projectsDir: this.projectsDir,
        workers: floor.workers.list().map((w) => ({ id: w.id, status: w.status, deskId: w.deskId })),
      },
    });
  }

  /**
   * The floor's context: this machine for everything it owns, the socket for everything the room would
   * have seen. `runAs` and `forgeAs` are absent on purpose — that absence is the guarantee that a
   * hosted floor can only ever run on the host's own sign-ins.
   */
  private context(floorId: string, name: string): FloorContext {
    const parts = this.parts;
    const up = (msg: ServerMsg, droppable = false) => parts.send({ t: 'event', floorId, seq: 0, droppable, msg });
    return {
      agentCmd: parts.agentCmd,
      agentArgs: parts.agentArgs,
      dshProfile: parts.dshProfile,
      hook: { url: parts.hookUrl, token: '' },
      ledger: parts.ledger,
      capacity: parts.capacity,
      prompts: parts.prompts,
      forgeAs: (_owner: string | undefined, _kind: ForgeKind) => undefined,
      emit: (_floor: Floor, msg: ServerMsg, droppable?: boolean) => up(msg, droppable === true),
      toast: (_floor: Floor, text: string, level?: 'info' | 'warn' | 'error') => up({ t: 'toast', text, level: level ?? 'info' }),
      termData: (workerId: string, data: string, _viewers: string[]) => parts.send({ t: 'term.data', floorId, workerId, data }),
      changes: (state: ChangesState, clients: string[]) => parts.send({ t: 'event', floorId, seq: 0, clients, msg: { t: 'changes', state } }),
      workerChanged: (_floor: Floor, w: WorkerInfo | string) => {
        // Keep the worker index current here, which is the one place a worker's arrival and departure
        // is announced.
        if (typeof w === 'string') this.byWorker.delete(w);
        else {
          const home = this.floors.get(floorId);
          if (home) this.byWorker.set(w.id, home);
        }
        up(typeof w === 'string' ? { t: 'worker.remove', workerId: w } : { t: 'worker.update', worker: w });
      },
      // Presence is office-side by nature. This machine does not know who is in the room, and the
      // office tells it nothing about them, so a floor here counts nobody.
      people: (_floor: Floor) => 0,
      peers: (_floor: Floor): PeerInfo[] => [],
      leaveOnMerge: () => false,
      // Another floor of the building is not reachable from here, deliberately: a worker on a hosted
      // floor must not reach into a checkout on the office's disk (finding 9).
      floor: (_id: string) => undefined,
      pullsChanged: (_floor: Floor) => {},
      lent: (_floor: Floor) => false,
      locksUp: () => false,
    };
  }

  /** Runs one of the office's calls against the floor it names. */
  async call(msg: ToOffice) {
    if (!('floorId' in msg) || typeof msg.floorId !== 'string') return;
    const floorId = msg.floorId;
    const floor = this.floors.get(floorId);
    const seq = 'seq' in msg && typeof msg.seq === 'number' ? msg.seq : undefined;
    if (seq === undefined) return;
    if (!floor) {
      this.parts.send({ t: 'refused', floorId, reason: 'that floor is not open on this machine', seq });
      return;
    }
    try {
      const value = await this.apply(floor, msg);
      // A method returning a `string` has failed — that is the office's own convention — so it is a
      // refusal. Anything else is the answer, and it travels whole: a `WorkerInfo`, a `Decoration`, a
      // `{ prs }`, a `string[]`. Flattening those to a string is how the office came to dereference
      // `undefined` at twenty call sites.
      if (typeof value === 'string') this.parts.send({ t: 'refused', floorId, reason: value, seq });
      else this.parts.send({ t: 'result', floorId, seq, value: value ?? null });
      // Some calls change a room, and the office has no event to hear it by — its own Floor reads
      // those states directly. A hosted floor must say so, or the office's copy goes stale forever.
      this.reportRooms(floorId, floor);
    } catch (err) {
      this.parts.send({ t: 'refused', floorId, reason: (err as Error).message, seq });
    }
  }

  /** The floor cases, each against this machine's own floor. */
  private async apply(floor: Floor, msg: ToOffice): Promise<unknown> {
    const m = msg as unknown as Record<string, unknown>;
    const s = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : '');
    const num = (k: string) => (Number.isFinite(Number(m[k])) ? Number(m[k]) : 0);
    switch (msg.t) {
      case 'worker.spawn':
        return await floor.workers.spawn(s('deskId'), s('by'), s('prompt') || undefined, m.worktree === true, m.kind as never, m.provider as never, s('model') || undefined, m.effort as never, undefined, s('owner') || undefined);
      case 'worker.resume':
        return await floor.workers.resume(s('workerId'), s('prompt') || undefined);
      case 'worker.prompt':
        return await floor.workers.prompt(s('workerId'), s('text'), s('by') || undefined);
      case 'worker.kill': {
        return floor.sendHome(s('workerId'), m.cleanup as never);
      }
      case 'worker.attach':
        return await floor.workers.attach(s('workerId'), s('clientId'), s('name'));
      case 'worker.detach':
        floor.workers.detach(s('workerId'), s('clientId'));
        return undefined;
      case 'worker.rebuild':
        return await floor.workers.rebuild(s('workerId'));
      case 'worker.worktree':
        return await floor.workers.inspectWorktree(s('workerId'));
      case 'worker.pr':
        return await floor.workers.openPr(s('workerId'), s('by'));
      case 'station.prompt':
        return await floor.workers.station(s('deskId'), s('by'), s('text'), s('owner') || undefined);
      // A helper to walk over to a worker here. The host owns the walk as well as the hire, since the
      // route is between this floor's own desks, and the office only hears that it happened.
      case 'worker.helper':
        return await floor.workers.sendHelper(s('hostId'), s('by'), m.provider as never, s('model') || undefined, m.effort as never, s('owner') || undefined);
      case 'worker.search':
        return (await floor.workers.search(s('needle'), num('perWorker') || 0)) as never;

      // The terminal: keystrokes and resizes are fire-and-forget, and the office never waits on them.
      case 'term.input':
        floor.workers.write(s('workerId'), s('data'), s('by'));
        return undefined;
      case 'term.resize':
        floor.workers.resize(s('workerId'), num('cols') || 80, num('rows') || 24);
        return undefined;

      case 'queue.add':
        return await floor.queue.add(s('prompt'), s('by'), s('title') || undefined, m.issue as number | undefined, m.provider as AgentProvider | undefined, s('model') || undefined, m.effort as AgentEffort | undefined, s('owner') || undefined);
      case 'queue.remove':
        return await floor.queue.remove(s('taskId'));
      case 'queue.move':
        floor.queue.move(s('taskId'), num('delta') < 0 ? -1 : 1);
        return undefined;
      case 'queue.retry':
        return await floor.queue.retry(s('taskId'));
      case 'queue.dropIssue':
        return (await floor.queue.dropIssue(num('issue'))) as never;
      case 'queue.clear':
        floor.queue.clear();
        return undefined;
      case 'queue.limit':
        floor.queue.setLimit(num('maxWorkers'));
        return undefined;

      // The forge: this machine's own `gh`, as this machine's user.
      case 'gh.refresh':
        await floor.forge.refresh();
        return undefined;
      case 'gh.claim':
        return await floor.forge.claim(num('issue'));
      case 'gh.merge':
        return await floor.forge.merge(num('n'), m.method as never, m.deleteBranch === true, m.auto === true);
      case 'gh.comment':
        return (await floor.forge.comment(m.kind as never, num('n'), s('body'))).error;
      case 'gh.close':
        return await floor.forge.close(m.kind as never, num('n'), (m.opts ?? {}) as never);
      case 'gh.labels':
        return (await floor.forge.setLabels(m.kind as never, num('n'), (m.add ?? []) as string[], (m.remove ?? []) as string[])).error;

      case 'changes.watch':
        floor.changes.watch(s('workerId'), s('clientId'));
        return undefined;
      case 'changes.unwatch':
        floor.changes.unwatch(s('workerId'), s('clientId'));
        return undefined;
      case 'changes.diff':
        return await floor.changes.diff(s('workerId'), s('filePath'));
      case 'changes.commit':
        return await floor.changes.commit(s('workerId'), s('message'), s('who'));
      case 'changes.discard':
        return await floor.changes.discard(s('workerId'), s('filePath') || undefined, s('who'));
      case 'changes.pr':
        return await floor.changes.pullRequest(s('workerId'), s('title'), s('body'), s('who'));

      case 'desk.label':
        return await floor.plan.label(s('deskId'), m.text, m.color, s('by'));
      case 'floor.expand':
        return await floor.plan.expand();
      case 'floor.shrink':
        return await floor.plan.shrink((id) => floor.workers.deskOccupied(id));
      case 'decor.add':
        return await floor.decor.add(m.input, s('by'));
      case 'decor.update':
        return await floor.decor.update(s('id'), m.patch);
      case 'decor.remove':
        return await floor.decor.remove(s('id'));

      case 'jukebox.play':
        return await floor.jukebox.play({ track: m.track, url: m.url }, s('by'));
      case 'jukebox.place':
        return await floor.jukebox.place(m.spot);
      case 'jukebox.skip':
        floor.jukebox.skip(s('by'));
        return undefined;
      case 'jukebox.stop':
        return await floor.jukebox.stop(s('by'));
      case 'ball.take':
        return await floor.court.take(s('clientId'));
      // The ball rides with the people on the floor, so it is the host's to put back under the hoop
      // when someone leaves. The office asks, because the office is the one that knows they left.
      case 'ball.left':
        return floor.court.left(s('clientId'));
      case 'ball.throw':
        return await floor.court.throw(s('clientId'), m as never);
      case 'car.enter':
        return await floor.garage.enter(s('clientId'), num('car'), m.seat as never);
      case 'car.leave':
        return await floor.garage.leave(s('clientId'));
      case 'car.drive':
        return await floor.garage.drive(s('clientId'), num('car'), m as never);
      case 'car.honk':
        return await floor.garage.honk(s('clientId'));

      // A meeting needs the room's people, which this machine does not know. Refused by kind, and the
      // office refuses it too: a hosted floor cannot hold one.
      case 'tv.play':
        return await floor.tv.play((m.input ?? {}) as { url?: unknown; position?: unknown }, s('by'));
      case 'tv.pause':
        return await floor.tv.pause(m.position, s('by'));
      case 'tv.seek':
        return await floor.tv.seek(m.position, s('by'));
      case 'tv.stop':
        return await floor.tv.stop(s('by'));

      case 'meeting.start':
      case 'meeting.stop':
      case 'meeting.clear':
        // A meeting needs the room's people, which this machine does not know. Refused by kind; the
        // office refuses it too.
        return 'a meeting needs everyone in one building';

      default:
        return `this machine does not serve ${String(msg.t)}`;
    }
  }

  shutdown() {
    for (const floor of this.floors.values()) floor.shutdown();
    this.floors.clear();
  }
}

/**
 * A refusal, when the method returned one.
 *
 * The office's convention, and therefore the wire's: a floor method that returns a `string` has
 * failed, and anything else is its result — the value travels as it is.
 */

/**
 * The hook listener for this machine's workers.
 *
 * Loopback only, and it never leaves this machine: the endpoint `launch` puts in a worker's
 * environment is `http://127.0.0.1:<port>` here, so a worker's status reports reach the host process
 * that started it. Nothing is forwarded, so there is nothing to attribute across the socket — which is
 * why decision 7's question about whose token a forwarded hook carries has no subject.
 *
 * A path this does not serve answers 404 rather than pretending. That includes the office's own
 * `/office/*` MCP endpoints, which live beside the office and are not here: an agent's office tools
 * are unavailable on a hosted floor rather than silently wrong.
 */
/** The paths a worker's status reports arrive on. One constant, not a fresh array per request. */
const HOOK_PATHS = new Set(['/hooks/claude', '/hooks/opencode', '/hooks/codex', '/hooks/grok', '/hooks/muse']);

export function startHooks(
  /** The workers of a floor, by worker id. A lookup rather than the floors themselves, so the hook
   *  server can be started before the floors are open — which it must be, since a worker's environment
   *  needs its URL before any worker starts. */
  workersOf: (workerId: string) => import('./workers.js').WorkerManager | undefined,
): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(async (req, res) => {
    const done = (code: number) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end('{}');
    };
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://127.0.0.1');
    } catch {
      return done(400);
    }
    if (req.method !== 'POST' || !HOOK_PATHS.has(url.pathname)) return done(404);
    let payload: unknown = {};
    try {
      const raw = await readBody(req);
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      // The office is permissive here too: a Claude event with a bad body still counts as the event.
      if (url.pathname !== '/hooks/claude') return done(400);
    }
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const workerId = url.searchParams.get('worker') ?? '';
    const workers = workersOf(workerId);
    if (!workers) return done(401);
    const event = url.searchParams.get('event') ?? '';
    const ok =
      url.pathname === '/hooks/opencode'
        ? workers.handleOpenCodeHook(workerId, token, payload)
        : url.pathname === '/hooks/codex'
          ? workers.handleCodexHook(workerId, token, event, payload)
          : url.pathname === '/hooks/grok'
            ? workers.handleGrokHook(workerId, token, event, payload)
            : url.pathname === '/hooks/muse'
              ? workers.handleMuseHook(workerId, token, event, payload)
              : workers.handleHook(workerId, token, event, payload);
    return done(ok ? 200 : 401);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

function readBody(req: http.IncomingMessage, limit = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * The parts a host floor needs, with this machine's own settings.
 *
 * No budget and no worker limit of its own: the office counts hosted workers against its own
 * `--max-workers` (decision 3), so a machine that enforced a second limit would refuse work the office
 * had already decided it had room for. `capacity` therefore always has room.
 */
export function hostParts(opts: HostSettings, send: (msg: FromFloor) => void, hookUrl: string, seats = 0): HostParts {
  // No mkdir here: a constructor with a filesystem side effect is a surprise, and the directory is
  // made once by the command that owns it.
  return {
    ...opts,
    hookUrl,
    seats: Math.max(0, Math.floor(seats)),
    send,
    ledger: new Ledger(opts.dataDir, { pauseHiring: false }, () => {}, () => {}),
    capacity: { full: () => undefined, room: () => Infinity },
    prompts: {
      // This machine has no ⚙️ Settings of its own, so the office's shipped defaults apply. Sending
      // the office's *edited* prompts here is not built: a hosted floor uses the prompts in the box.
      text: (id: PromptId) => PROMPTS[id].text,
      agent: () => undefined,
    },
  };
}
