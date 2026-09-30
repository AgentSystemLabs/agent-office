/**
 * The floor-host wire: what a member's machine and the office say to each other.
 *
 * Everything here is written from scratch. There is no runtime schema anywhere in the office to
 * borrow — `handleMessage`'s switch has no `default`, an unknown `t` is silently dropped, and every
 * case re-coerces its own fields — so the frames below validate themselves.
 *
 * Two shapes travel over the socket, and both are already JSON in the office:
 *
 *   office → host   the 44 messages `handleMessage` acts on a `Floor` with (see FLOOR_CASES)
 *   host → office   whatever the floor's `FloorContext.emit` would have delivered locally
 *
 * so the payload is `ClientMsg` and `ServerMsg` themselves rather than a new vocabulary. What is new
 * is the envelope: `seq` for ordering (finding 11), `droppable` for back-pressure, and `floorId` on
 * everything, because one connection carries N floors (decision 6).
 *
 * See docs/remote-agents-plan.md.
 */

/** Bumped when a frame's shape changes incompatibly. Sent in `hello`, refused on a mismatch. */
export const FLOORHOST_PROTOCOL = 1;

/** A frame id, for logging and for matching a `hello` to its `ready`. */
export type FloorHostId = string;

/** Where a floor's code is hosted, as its host reports it. */
export type HostForgeKind = 'github' | 'bitbucket';

/**
 * What a host tells the office about one floor it is serving. `ready` is per floor, not per socket:
 * a disconnect has to mark every floor it carried offline in a single pass, which it cannot do if it
 * only ever learned about one at a time.
 */
export interface FloorReady {
  floorId: string;
  /** The floor's name on the host, for the desk signs and the elevator. */
  name: string;
  /** How many workers this host will seat for this floor, declared once at pairing. */
  seats: number;
  /** Whether an automation hire may seat here. A person may always hire (decision 2). */
  accepting: boolean;
  /** The host's own worker ids, so the office can index them without the `workerFloor` scan (:256). */
  workers: { id: string; status: string; deskId: string }[];
  forge: HostForgeKind;
  /** The host's git identity, shown in the pairing dialog (decision 5). Never the office's. */
  gitIdentity?: string;
  /** The models this host can actually run, so the office never offers one it would refuse. */
  models?: string[];
}

/** Office → host. Everything a browser asked for, aimed at a floor. */
export type ToHost =
  | { t: 'hello'; token: string; hostId: FloorHostId; protocol: number; floors: string[] }
  /** The floor-scoped subset of ClientMsg, verbatim — see FLOOR_CASES for which 44. */
  | ({ floorId: string; seq: number } & FloorCase)
  | { t: 'config'; floorId: string; prompts: unknown; capacity: unknown; leaveOnMerge: boolean }
  | { t: 'bye'; floorId?: string; why?: string };

/**
 * The 44 `handleMessage` cases that call a method on a `Floor`. They travel verbatim: the host runs
 * them against its own `Floor`, so the office's dispatch and the host's are the same code.
 *
 * This list is asserted by tests/floorhost.test.ts — a 45th case added to the switch without a
 * decision about where it runs fails the build rather than silently staying office-side.
 */
export const FLOOR_CASES = [
  'ball.throw',
  'car.leave',
  'car.drive',
  'car.honk',
  'changes.commit',
  'changes.diff',
  'changes.discard',
  'changes.pr',
  'changes.unwatch',
  'changes.watch',
  'decor.add',
  'decor.remove',
  'decor.update',
  'desk.label',
  'floor.expand',
  'floor.shrink',
  'gh.close',
  'gh.comment',
  'gh.labels',
  'gh.merge',
  'gh.refresh',
  'jukebox.play',
  'jukebox.skip',
  'jukebox.stop',
  'meeting.start',
  'queue.add',
  'queue.clear',
  'queue.limit',
  'queue.move',
  'queue.remove',
  'queue.retry',
  'station.prompt',
  'term.input',
  'term.resize',
  'worker.attach',
  'worker.detach',
  'worker.kill',
  'worker.prompt',
  'worker.pr',
  'worker.rebuild',
  'worker.resume',
  'worker.spawn',
  'worker.worktree',
] as const;

export type FloorCase = (typeof FLOOR_CASES)[number];

/**
 * Host → office. The host's `FloorContext.emit` would have delivered these locally; over the socket
 * they are forwarded to whoever is in the office, subject to `droppable`.
 */
export type FromHost =
  | { t: 'ready'; floor: FloorReady }
  | { t: 'leave'; floorId: string; why?: string }
  /** Whatever `ctx.emit` would have sent. `droppable` says what the office may shed under pressure. */
  | { t: 'event'; floorId: string; seq: number; droppable?: boolean; msg: unknown }
  /** A worker's terminal output, for whoever has that terminal open. */
  | { t: 'term.data'; floorId: string; workerId: string; data: string }
  | { t: 'report'; floorId: string; workerId: string; pr?: { number: number; url: string }; cost?: number; tokens?: number }
  | { t: 'refused'; floorId: string; workerId: string; reason: string }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number };

const HOST_FRAME_TYPES = new Set(['hello', 'bye', 'config', 'bye']);
const HOST_CASES = new Set<string>(FLOOR_CASES);
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** Rejects anything that is not a frame this office understands, rather than trusting the sender. */
export function isToHost(msg: unknown): msg is ToHost {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.t !== 'string') return false;
  // A floor case and a control frame share the envelope, so both must carry floorId and a seq.
  if (HOST_CASES.has(m.t)) return typeof m.floorId === 'string' && typeof m.seq === 'number';
  if (!HOST_FRAME_TYPES.has(m.t)) return false;
  return m.t === 'hello' ? typeof m.token === 'string' && typeof m.protocol === 'number' : true;
}

export function isFromHost(msg: unknown): msg is FromHost {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.t !== 'string') return false;
  // Every frame names its floor, except the two that are about the socket itself. This is the whole
  // of decision 6's cost: it is what keeps two floors on one connection from bleeding into each other.
  const addressed = typeof m.floorId === 'string';
  switch (m.t) {
    case 'ping':
    case 'pong':
      return typeof m.at === 'number';
    case 'event':
      return addressed && typeof m.seq === 'number';
    case 'ready':
      return !!m.floor && typeof (m.floor as FloorReady).floorId === 'string';
    case 'leave':
    case 'refused':
      return addressed && (typeof m.why === 'string' || typeof m.reason === 'string');
    case 'term.data':
      return addressed && typeof m.workerId === 'string' && typeof m.data === 'string';
    case 'report':
      return addressed && typeof m.workerId === 'string';
    default:
      return false;
  }
}

/**
 * The payload cap, the same 2 MiB the office's own WebSocket uses. Terminal output and screen frames
 * are the only large frames; a host that exceeds this is misbehaving rather than busy.
 */
export const FLOORHOST_MAX_FRAME = MAX_FRAME_BYTES;

/**
 * Frames the office may shed rather than queue when a browser is slow. Screen frames and terminal
 * output are the two: both are re-sent on attach (a joining browser replays the last screen), so
 * dropping one loses a frame of animation and nothing else. Everything else — status, boards, chat —
 * is not droppable, because there is no later copy.
 */
export function isDroppable(t: string): boolean {
  return t === 'screen' || t === 'term.data' || t === 'dog' || t === 'token';
}

/**
 * Refusals the office makes on a hosted floor's behalf, named for whoever they are shown to. All of
 * these are about capacity or kind, never about who is asking (see the permission model in the plan):
 *
 *   'asleep'      the host is not connected — queued, never failed (finding 10)
 *   'seats'       the host has no free desk
 *   'not-accepting' an automation hire reached a floor whose owner has not opted in
 *   'offline'     the worker is held asleep until its host returns (finding 1)
 */
export type HostRefusal = 'asleep' | 'seats' | 'not-accepting' | 'offline';
