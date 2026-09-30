/**
 * What the office may ask of a floor, wherever that floor runs.
 *
 * `Floor` is the implementation that runs on this machine. `RemoteFloor` (coming with the floor
 * hosts) implements the same surface by shipping the request over the socket instead of calling it,
 * which is why the shape here is deliberately the *union* of what `server.ts` calls on a floor —
 * nothing more. A method here exists because a `handleMessage` case needs it, not because the class
 * happens to have it.
 *
 * Why an interface rather than moving the 43 floor-scoped cases into a function: those cases span
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
  GhLabel,
  GhMergeMethod,
  MeetingRequest,
  MeetingState,
  TerminalHit,
  WorkerInfo,
  WorkerKind,
  WorktreeCleanup,
  WorktreeState,
} from '../shared/protocol.js';
import type { BallState } from '../shared/hoop.js';
import type { CarPose, CarSeat, CarState } from '../shared/garage.js';
import type { Decoration } from '../shared/decor.js';
import type { JukeboxState } from '../shared/jukebox.js';
import type { DeskLabel } from '../shared/floorplan.js';
import type { Landed } from './leave-on-merge.js';
import type { ForgeAs } from './signins.js';
import type { OpenedPr, RepoSource } from './workers.js';

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
  refresh(): Promise<void>;
  claim(issue: number, as?: ForgeAs): Promise<string | undefined>;
  merge(n: number, method: GhMergeMethod, deleteBranch: boolean, auto: boolean, as?: ForgeAs): Promise<string | undefined>;
  comment(kind: 'issue' | 'pull', n: number, body: string, as?: ForgeAs): Promise<{ comment?: GhComment; error?: string }>;
  close(kind: 'issue' | 'pull', n: number, opts: { comment?: string; reason?: GhCloseReason; deleteBranch?: boolean }, as?: ForgeAs): Promise<string | undefined>;
  setLabels(kind: 'issue' | 'pull', n: number, add: string[], remove: string[], as?: ForgeAs): Promise<{ labels?: GhLabel[]; error?: string }>;
}

/** The workers' desks, and the terminals on them. */
export interface FloorWorkers {
  list(): WorkerInfo[];
  get(id: string): WorkerInfo | undefined;
  ownerOf(id: string): string | undefined;
  deskOccupied(deskId: string): boolean;

  // Hires and sends home. Each returns `string` for a refusal the caller shows the person asking.
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
  ): WorkerInfo | string;
  /** A board agent on a station desk: told what it is there for before its first request. */
  station(deskId: string, by: string, text: string, owner?: string): { info: WorkerInfo; hired: boolean } | string;
  resume(id: string, prompt?: string): string | undefined;
  prompt(id: string, text: string, by?: string): string | undefined;
  kill(id: string, cleanup?: WorktreeCleanup): Promise<{ note?: string; error?: string }>;

  /** The terminal. `attach` replays the last screen, which is how a joining browser catches up. */
  attach(id: string, clientId: string, name: string): { data: string; cols: number; rows: number } | undefined;
  detach(id: string, clientId: string): void;
  write(id: string, data: string, by: string): void;
  resize(id: string, cols: number, rows: number): void;
  search(needle: string, perWorker: number): { hits: TerminalHit[]; more: boolean };

  rebuild(id: string): Promise<{ rebuilt?: boolean; note?: string; error?: string }>;
  inspectWorktree(id: string): Promise<WorktreeState | undefined>;
  /** Opens the worker's pull request with the floor's own `gh`, as the host's git identity. */
  openPr(id: string, by: string, as?: ForgeAs): Promise<{ prs: OpenedPr[]; failed: string[] } | string>;
}

/** The task queue. Per floor, so a hosted floor's queue is the member's. */
export interface FloorQueue {
  state(): unknown;
  add(prompt: string, by: string, title?: string, issue?: number, provider?: AgentProvider, model?: string, effort?: AgentEffort, owner?: string): string | undefined;
  remove(taskId: string): void;
  /** -1 moves it up, +1 down. */
  move(taskId: string, delta: -1 | 1): void;
  retry(taskId: string): string | undefined;
  clear(): void;
  setLimit(n: number): void;
  dropIssue(issue: number): boolean;
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
  diff(workerId: string, filePath: string, repo?: string): Promise<{ diff: string; truncated: boolean } | string>;
  commit(workerId: string, message: string, who: string, env?: Record<string, string>, repo?: string): Promise<string | undefined>;
  discard(workerId: string, filePath: string | undefined, who: string, repo?: string): Promise<string | undefined>;
  pullRequest(workerId: string, title: string, body: string, who: string, env?: Record<string, string>, repo?: string): Promise<string | undefined>;
}

/** The signs over the desks, and how far the back office is built out. */
export interface FloorPlan {
  label(deskId: string, text: unknown, color: unknown, by: string): { label?: DeskLabel; old?: DeskLabel } | string;
  expand(): string[] | string;
  /** Takes a predicate rather than reading the desks itself, so a hosted floor can answer from its
   *  own roster: the office never reads a hosted floor's desks directly. */
  shrink(taken: (deskId: string) => boolean): string[] | string;
  /** How far the back office is built out, so the office knows which desks exist to hire at. */
  readonly wing: number;
}

/** Pictures on the walls. */
export interface FloorDecor {
  list(): Decoration[];
  add(input: unknown, by: string): Decoration | string;
  update(id: string, patch: unknown): Decoration | string;
  remove(id: string): Decoration | undefined;
}

/** The room's music, the ball game, the cars, and the meeting room. */
export interface FloorRoom {
  play(input: { track?: unknown; url?: unknown }, by: string): { changed: boolean } | { error: string };
  skip(by: string): void;
  stop(by: string): boolean;
  title(): string;
  state(): JukeboxState;
}

export interface FloorCourt {
  take(id: string): boolean;
  throw(id: string, s: { x: number; y: number; z: number; vx: number; vy: number; vz: number }): boolean;
  state(): BallState;
}

export interface FloorGarage {
  enter(id: string, car: number, seat: CarSeat): boolean;
  leave(id: string): boolean;
  drive(id: string, car: number, pose: CarPose): CarPose | undefined;
  honk(id: string): number | undefined;
  state(): CarState[];
}

export interface FloorMeetings {
  start(req: MeetingRequest, by: string, owner?: string): string | undefined;
  stop(by: string): string | undefined;
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
