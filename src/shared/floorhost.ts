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
export type ToOffice =
  | { t: 'hello'; token: string; hostId: FloorHostId; protocol: number; floors: string[] }
  /**
   * The floor-scoped subset of ClientMsg, verbatim: the host runs it against its own `Floor`, so the
   * office's dispatch and the host's are the same code. The payload is left as the union member of
   * `ClientMsg` rather than narrowed here, so a case that gains a field needs no change here.
   */
  | ({ floorId: string; seq: number; t: FloorCase } & Record<string, unknown>)
  | { t: 'config'; floorId: string; prompts: unknown; capacity: unknown; leaveOnMerge: boolean }
  | { t: 'bye'; floorId?: string; why?: string };

/**
 * The 43 `handleMessage` cases that call a method on a `Floor` (see FLOOR_CASES for the list).
 *
 * This list is asserted by tests/floorhost.test.ts — a 44th case added to the switch without a
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
 * Host → office. Whatever the floor's `FloorContext.emit` would have delivered locally goes over the
 * socket instead, subject to `droppable`.
 *
 * Every frame but `ping`/`pong` names its floor, because one connection carries N floors (decision 6).
 * `ready` carries the floor inside its own payload rather than alongside it, so one shape says
 * everything the office needs at the moment a floor appears on a connection.
 */
export type FromFloor =
  | { t: 'ready'; floor: FloorReady }
  | { t: 'leave'; floorId: string; why?: string }
  /** Whatever `ctx.emit` would have sent. `droppable` says what the office may shed under pressure. */
  | { t: 'event'; floorId: string; seq: number; droppable?: boolean; msg: unknown }
  /** A worker's terminal output, for whoever has that terminal open. */
  | { t: 'term.data'; floorId: string; workerId: string; data: string }
  | { t: 'report'; floorId: string; workerId: string; pr?: { number: number; url: string }; cost?: number; tokens?: number }
  | { t: 'refused'; floorId: string; workerId?: string; reason: string }
  /** Sent before the handshake finishes, to say why a connection was turned away. */
  | { t: 'refused'; why: string }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number };

const HOST_FRAME_TYPES = new Set(['hello', 'bye', 'config', 'bye']);
const HOST_CASES = new Set<string>(FLOOR_CASES);
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** Rejects anything that is not a frame this office understands, rather than trusting the sender. */
export function isToOffice(msg: unknown): msg is ToOffice {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.t !== 'string') return false;
  // A floor case and a control frame share the envelope, so both must carry floorId and a seq.
  if (HOST_CASES.has(m.t)) return typeof m.floorId === 'string' && typeof m.seq === 'number';
  if (!HOST_FRAME_TYPES.has(m.t)) return false;
  return m.t === 'hello' ? typeof m.token === 'string' && typeof m.protocol === 'number' : true;
}

export function isFromFloor(msg: unknown): msg is FromFloor {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.t !== 'string') return false;
  // Every frame but `ping`/`pong` names its floor, because one connection carries N floors (decision
  // 6). That floorId is the whole of what keeps two floors on one socket from bleeding into each
  // other, so it is checked rather than assumed.
  const addressed = typeof m.floorId === 'string';
  switch (m.t) {
    case 'ping':
    case 'pong':
      return typeof m.at === 'number';
    case 'event':
      return addressed && typeof m.seq === 'number';
    case 'ready': {
      const f = m.floor as Partial<FloorReady> | undefined;
      return !!f && typeof f.floorId === 'string' && typeof f.name === 'string' && typeof f.seats === 'number';
    }
    case 'leave':
      return addressed && (typeof m.why === 'string' || m.why === undefined);
    case 'refused':
      // Two shapes: addressed, naming why a hire was turned down; and unaddressed, why the
      // connection itself was refused before a floor was ever involved.
      return addressed ? typeof m.reason === 'string' : typeof m.why === 'string';
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
