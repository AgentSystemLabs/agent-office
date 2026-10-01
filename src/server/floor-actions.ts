/**
 * What the office may ask of a floor, wherever that floor runs.
 *
 * `Floor` is the implementation that runs on this machine. `RemoteFloor` (coming with the floor
 * hosts) implements the same surface by shipping the request over the socket instead of calling it,
 * which is why the shape here is deliberately the *union* of what `server.ts` calls on a floor —
 * nothing more. A method here exists because a `handleMessage` case needs it, not because the class
 * happens to have it.
 *
 * Why an interface rather than moving the 50 floor-scoped cases into a function: those cases span
 * ~900 lines inside a switch that closes over a dozen office-side accessors (`here`, `worker`,
 * `withForge`, `warn`, `toastFloor`, `planChanged`, `floors`, `DESK_BY_ID`, `CLEANUPS`). Extracting
 * them is a large mechanical diff into a file where every line is load-bearing. This way the call
 * sites do not change at all — they already read `floor.workers.spawn(...)` — and only the object
 * behind `floor` becomes either a local `Floor` or a proxy.
 *
 * Split deliberately:
 *
 *   - **reads** return a value, so a hosted floor answers from its last known state;
 *   - **writes** return `string` for a refusal the caller shows, which is how the office already
 *     handles every failure (a refusal names the machine, never the person: see the permission model).
 *
 * See docs/remote-agents-plan.md, seam 2.
 */

import type {
  AgentEffort,
  AgentProvider,
  ChangesState,
  ForgeKind,
  GhCloseReason,
  GhComment,
  GhIssue,
  GhLabel,
  GhMergeMethod,
  GhPull,
  GhState,
  JailState,
  MeetingRequest,
  MeetingState,
  ProjectInfo,
  QueueState,
  ServerMsg,
  TerminalHit,
  WorkerInfo,
  WorkerKind,
  WorktreeCleanup,
  WorktreeState,
} from '../shared/protocol.js';
import type { BallState } from '../shared/hoop.js';
import type { CarPose, CarSeat, CarState } from '../shared/garage.js';
import type { Decoration } from '../shared/decor.js';
import type { JukeboxSpot, JukeboxState } from '../shared/jukebox.js';
import type { TvState } from '../shared/tv.js';
import type { DeskLabel, FloorPlan as SharedFloorPlan } from '../shared/floorplan.js';
import type { Landed } from './leave-on-merge.js';
import type { ForgeAs } from './signins.js';
import type { OpenedPr, RepoSource } from './workers.js';

/**
 * A value that may have had to cross a network to get here.
 *
 * A floor running in this process returns the value; a floor hosted on a member's machine returns a
 * promise, because the answer came over that machine's socket. Callers `await` either way, and
 * awaiting something that is not a promise is a no-op — so an office-side floor pays nothing for the
 * possibility, and neither signature has to lie about what it does.
 *
 * Only the calls whose **result the office branches on** are Awaitable. Everything else is either a
 * plain read (answered from the mirror the host streams upward, so it stays synchronous) or a write
 * nobody reads the answer to (shipped and forgotten, with the outcome arriving later as an event).
 */
export type Awaitable<T> = T | Promise<T>;

/** A seat: one desk, either free or taken. What a hire looks at before it happens. */
export interface FloorSeat {
  deskId: string;
  occupied: boolean;
}

/**
 * The forge: issues and pull requests, read with the floor's own CLI. On a hosted floor this runs on
 * the member's machine, so the office holds a mirror of the state rather than asking for it.
 */
export interface FloorForge {
  readonly kind: ForgeKind;
  /**
   * The two boards, as whoever just walked in sees them. Reads, answered from the `gh.issues` and
   * `gh.pulls` events the floor emits whenever a board changes — which a hosted floor emits upward
   * like everything else, so this costs no round trip either.
   */
  readonly issues: { readonly items: GhIssue[]; readonly state: GhState<GhIssue> };
  readonly pulls: { readonly items: GhPull[]; readonly state: GhState<GhPull> };
  refresh(): Awaitable<void>;
  claim(issue: number, as?: ForgeAs): Awaitable<string | undefined>;
  merge(n: number, method: GhMergeMethod, deleteBranch: boolean, auto: boolean, as?: ForgeAs): Awaitable<string | undefined>;
  comment(kind: 'issue' | 'pull', n: number, body: string, as?: ForgeAs): Awaitable<{ comment?: GhComment; error?: string }>;
  close(kind: 'issue' | 'pull', n: number, opts: { comment?: string; reason?: GhCloseReason; deleteBranch?: boolean }, as?: ForgeAs): Awaitable<string | undefined>;
  setLabels(kind: 'issue' | 'pull', n: number, add: string[], remove: string[], as?: ForgeAs): Awaitable<{ labels?: GhLabel[]; error?: string }>;
}

/** The workers' desks, and the terminals on them. */
export interface FloorWorkers {
  // Reads: answered from the roster and worker updates the floor streams upward, so a hosted floor
  // costs no round trip for any of them.
  list(): WorkerInfo[];
  get(id: string): WorkerInfo | undefined;
  ownerOf(id: string): string | undefined;
  deskOccupied(deskId: string): boolean;
  /** Someone left the floor (or the office): every terminal they were watching stops watching. */
  detachAll(clientId: string): void;
  /**
   * The terminals currently filling the screen, for whoever just arrived. Empty on a hosted floor:
   * those terminals are on the far machine, so a joining browser asks for one with `attach` and is
   * sent the host's own screen. Sending an empty list is honest; inventing frames would not be.
   */
  fullScreens(): { workerId: string; frame: Omit<Extract<ServerMsg, { t: 'screen' }>, 't' | 'workerId' | 'full'> }[];
  /** A worker whose process ended while nobody was here gets up as you walk in. */
  wakeAll(): void;
  /** What an agent hire starts on when nobody picked: this floor's own setting, or its machine's. */
  readonly officeDefault: { provider: AgentProvider };

  // Hires and sends home. Each returns a refusal the caller shows, so each is awaited.
  spawn(
    deskId: string,
    by: string,
    prompt?: string,
    worktree?: boolean,
    kind?: WorkerKind,
    provider?: AgentProvider,
    model?: string,
    effort?: AgentEffort,
    meeting?: { id: string; worktree?: WorkerInfo['worktree'] },
    owner?: string,
    repos?: RepoSource[],
    via?: 'herald',
  ): Awaitable<WorkerInfo | string>;
  /** A board agent on a station desk: told what it is there for before its first request. */
  station(deskId: string, by: string, text: string, owner?: string): Awaitable<{ info: WorkerInfo; hired: boolean } | string>;
  /**
   * Walks a helper over to a worker (see server/helpers.ts): it works in that worker's checkout, so
   * it is seated at no desk of its own and owns nothing. Returns the refusal to show, or the helper.
   */
  sendHelper(
    hostId: string,
    by: string,
    provider?: AgentProvider,
    model?: string,
    effort?: AgentEffort,
    owner?: string,
  ): Awaitable<WorkerInfo | string>;
  resume(id: string, prompt?: string): Awaitable<string | undefined>;
  prompt(id: string, text: string, by?: string): Awaitable<string | undefined>;
  kill(id: string, cleanup?: WorktreeCleanup): Promise<{ note?: string; error?: string }>;

  /** The terminal. `attach` replays the last screen, which is how a joining browser catches up. */
  attach(id: string, clientId: string, name: string): Awaitable<{ data: string; cols: number; rows: number } | undefined>;
  detach(id: string, clientId: string): void;
  write(id: string, data: string, by: string): void;
  resize(id: string, cols: number, rows: number): void;
  search(needle: string, perWorker: number): Awaitable<{ hits: TerminalHit[]; more: boolean }>;

  rebuild(id: string): Promise<{ rebuilt?: boolean; note?: string; error?: string }>;
  inspectWorktree(id: string): Promise<WorktreeState | undefined>;
  /** Opens the worker's pull request with the floor's own `gh`, as the host's git identity. */
  openPr(id: string, by: string, as?: ForgeAs): Promise<{ prs: OpenedPr[]; failed: string[] } | string>;
}

/** The task queue. Per floor, so a hosted floor's queue is the member's. */
export interface FloorQueue {
  state(): QueueState;
  add(prompt: string, by: string, title?: string, issue?: number, provider?: AgentProvider, model?: string, effort?: AgentEffort, owner?: string): Awaitable<string | undefined>;
  /** The office reads the refusal, so this one is awaited. */
  remove(taskId: string): Awaitable<string | undefined>;
  /** -1 moves it up, +1 down. Nobody reads the answer. */
  move(taskId: string, delta: -1 | 1): void;
  retry(taskId: string): Awaitable<string | undefined>;
  clear(): void;
  setLimit(n: number): void;
  dropIssue(issue: number): Awaitable<boolean>;
}

/**
 * What a worker changed, served from the worktree on the floor's own disk.
 *
 * `watch` returns nothing and pushes: the Changes window is a poll on the floor's own timer, and the
 * state reaches the browser through `FloorContext.changes(state, clients)`. Over a host socket that
 * is an `event` frame carrying `changes`, so the seam is the emitter, not a return value — which is
 * why there is nothing for a proxy to fabricate here.
 */
export interface FloorChanges {
  watch(workerId: string, clientId: string, repo?: string): void;
  unwatch(workerId: string, clientId: string, repo?: string): void;
  /** Someone left the floor (or the office): every worker's Changes window they had open closes. */
  unwatchAll(clientId: string): void;
  diff(workerId: string, filePath: string, repo?: string): Promise<{ diff: string; truncated: boolean } | string>;
  commit(workerId: string, message: string, who: string, env?: Record<string, string>, repo?: string): Promise<string | undefined>;
  discard(workerId: string, filePath: string | undefined, who: string, repo?: string): Promise<string | undefined>;
  pullRequest(workerId: string, title: string, body: string, who: string, env?: Record<string, string>, repo?: string): Promise<string | undefined>;
}

/** The signs over the desks, and how far the back office is built out. */
export interface FloorPlan {
  label(deskId: string, text: unknown, color: unknown, by: string): Awaitable<{ label?: DeskLabel; old?: DeskLabel } | string>;
  expand(): Awaitable<string[] | string>;
  /** Takes a predicate rather than reading the desks itself, so a hosted floor can answer from its
   *  own roster: the office never reads a hosted floor's desks directly. */
  shrink(taken: (deskId: string) => boolean): Awaitable<string[] | string>;
  /** How far the back office is built out, so the office knows which desks exist to hire at. */
  readonly wing: number;
  /** The whole plan, for whoever just walked in. Mirrored on a hosted floor, like the rest. */
  state(): SharedFloorPlan;
}

/** Pictures on the walls. */
export interface FloorDecor {
  list(): Decoration[];
  add(input: unknown, by: string): Awaitable<Decoration | string>;
  update(id: string, patch: unknown): Awaitable<Decoration | string>;
  remove(id: string): Awaitable<Decoration | undefined>;
}

/** The room's music, the ball game, the cars, and the meeting room. */
export interface FloorRoom {
  play(input: { track?: unknown; url?: unknown }, by: string): Awaitable<{ changed: boolean } | { error: string }>;
  /** Puts a specific track in a specific spot on the list, or says why it could not. */
  place(spot: unknown): Awaitable<JukeboxSpot | string>;
  skip(by: string): void;
  stop(by: string): Awaitable<boolean>;
  title(): string;
  state(): JukeboxState;
}

export interface FloorCourt {
  // The office branches on these (does the ball change hands), so they are awaited.
  take(id: string): Awaitable<boolean>;
  throw(id: string, s: { x: number; y: number; z: number; vx: number; vy: number; vz: number }): Awaitable<boolean>;
  /** They got off the floor and the ball had to drop back under the hoop. Whether it did. */
  left(id: string): Awaitable<boolean>;
  state(): BallState;
}

export interface FloorGarage {
  // The office branches on enter/leave (did the client get in), so those are awaited. drive and honk
  // are read too, by the browser.
  enter(id: string, car: number, seat: CarSeat): Awaitable<boolean>;
  leave(id: string): Awaitable<boolean>;
  drive(id: string, car: number, pose: CarPose): Awaitable<CarPose | undefined>;
  honk(id: string): Awaitable<number | undefined>;
  state(): CarState[];
}

/** The lounge TV. */
export interface FloorTv {
  play(input: { url?: unknown; position?: unknown }, by: string): Awaitable<{ changed: boolean } | { error: string }>;
  pause(position: unknown, by: string): Awaitable<boolean>;
  seek(position: unknown, by: string): Awaitable<boolean>;
  stop(by: string): Awaitable<boolean>;
  /** What is on it, for the toast. Mirrored from the `tv` event, like the rest of the TV's state. */
  title(): string;
  state(): TvState;
}

export interface FloorMeetings {
  start(req: MeetingRequest, by: string, owner?: string): Awaitable<string | undefined>;
  stop(by: string): Awaitable<string | undefined>;
  /** Forgets the meetings before the last one. A refusal is shown, so it is awaited. */
  clear(by: string): Awaitable<string | undefined>;
  state(): MeetingState;
}

/**
 * The whole surface. `Floor` satisfies it structurally — nothing in the class changes, and TypeScript
 * checks that claim at the assignment in floor.ts.
 */
export interface FloorActions {
  readonly id: string;
  readonly def: { id: string; name: string; dir: string; repo?: string };
  /** Where the checkout is. Empty for a hosted floor, which the office must never touch. */
  readonly dir: string;
  /** Which forge this floor reads its boards from, and the CLI that does it. */
  readonly forge: FloorForge;
  /**
   * What the floor's checkout is a project for, for whoever walks in. A hosted floor cannot report its
   * own `dir`, so it answers from what the office already holds — the name the building gave it — with
   * the fields only a machine on that disk could know left empty.
   */
  readonly project: ProjectInfo | null;

  readonly workers: FloorWorkers;
  readonly queue: FloorQueue;
  readonly changes: FloorChanges;
  readonly plan: FloorPlan;
  readonly decor: FloorDecor;
  /** The room's music. */
  readonly jukebox: FloorRoom;
  readonly court: FloorCourt;
  readonly garage: FloorGarage;
  readonly meetings: FloorMeetings;
  readonly tv: FloorTv;
  /** Workers sent home and locked up, on a map that has one. */
  readonly jail: { state(): JailState };

  /**
   * Why this floor cannot do `feature`, or `undefined` if it can — naming the machine when it cannot.
   *
   * The whiteboard, the dog and the docs are files in a floor's own data directory, so they are not on
   * this surface at all: a hosted floor is *unable* to be asked for them, which is a stronger guarantee
   * than answering a refusal, and it is why the office can never be made to read a checkout on someone
   * else's disk. This is the other half — how the office says so out loud, by name, rather than
   * letting the feature look broken. A floor in this process always answers `undefined`.
   */
  refuses(feature: 'the whiteboard' | 'the dog' | 'the docs'): string | undefined;

  /** Someone arrived on this floor. Presence, so it stays office-side even for a hosted floor. */
  arrived(): void;
  /** A pull request merged on this floor: the gong, and whatever leaves on merge. */
  merged(n: number, by?: string): void;
  landed(worker: WorkerInfo): Landed | undefined;
  sendLandedHome(): void;
  sendHome(workerId: string, cleanup?: WorktreeCleanup): Promise<{ note?: string; error?: string }>;
}

/**
 * Whether a floor is hosted, and whether its machine is currently reachable. Both are questions the
 * office asks before it refuses anything, because every refusal here is about capacity or kind
 * (HostRefusal) and never about who asked.
 */
export interface FloorHostState {
  /** The floor runs on another machine. */
  hosted: boolean;
  /** That machine is not connected right now. A task aimed here stays queued, never failed. */
  reachable: boolean;
  /** Named for whoever is told why a hire was refused. */
  machine: string;
}

/**
 * Where a floor's action surface meets the wire, the split is worth stating once:
 *
 *   **synchronous** — `workers.list/get/ownerOf/deskOccupied`, `queue.state`, `forge.pulls`,
 *   `decor.list`, `plan.wing`, `jukebox.state`, `court.state`, `garage.state`. The floor streams
 *   these upward as they change, so the office already holds them and a read costs no round trip.
 *
 *   **Awaitable** — the calls whose result the office branches on: every hire and its refusal, a
 *   queue add, a merge, a label change, a sign. A floor in this process returns the value; a hosted
 *   one returns a promise. Both are awaited, and awaiting a plain value is a no-op, so neither has to
 *   lie about what it does.
 *
 *   **void** — writes nobody reads the answer to: a keystroke, a resize, a honk, a whiteboard stroke.
 *   Shipped and forgotten, with the outcome arriving later as an event.
 *
 * Three features are **not on this surface at all**, because they are files in the floor's own data
 * directory and the office must never read a hosted floor's checkout: the whiteboard, the dog and the
 * docs. `RemoteFloor` refuses them by name, which is honest; making them RPCs would put every
 * whiteboard stroke on the wire, and that is a latency question worth measuring before designing.
 */
