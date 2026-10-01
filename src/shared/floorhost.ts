/**
 * The floor-host wire: what a member's machine and the office say to each other.
 *
 * Everything here is written from scratch. There is no runtime schema anywhere in the office to
 * borrow — `handleMessage`'s switch has no `default`, an unknown `t` is silently dropped, and every
 * case re-coerces its own fields — so the frames below validate themselves.
 *
 * Two shapes travel over the socket, and both are already JSON in the office:
 *
 *   office → host   the 54 messages `handleMessage` acts on a `Floor` (FLOOR_CASES), plus the three
 *                   it reaches another way (HOST_CALLS)
 *   host → office   whatever the floor's `FloorContext.emit` would have delivered locally
 *
 * so the payload is `ClientMsg` and `ServerMsg` themselves rather than a new vocabulary. What is new
 * is the envelope: `seq` for ordering (finding 11), `droppable` for back-pressure, and `floorId` on
 * everything, because one connection carries N floors (decision 6).
 *
 * See docs/remote-agents-plan.md.
 */

import type { AgentProvider } from './protocol.js';

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
  /**
   * The branch this host's checkout is on, and the agent CLIs it has installed.
   *
   * Both are facts only that machine has, and both are needed the moment someone walks onto the floor
   * from the office: the branch names the floor they rode into, and the providers are the choices the
   * hire dialog offers. Without them the office would have to guess, and a floor that guesses where it
   * is — or what it can run — is worse than one that says nothing. The office fills them in from here
   * rather than holding its own copy, because this is the machine that owns the disk.
   */
  branch?: string;
  providers?: AgentProvider[];
  /**
   * Where this machine keeps its checkouts, so the office can say where a floor would live on it.
   *
   * A hosted floor's `dir` is a path on this machine and the office cannot invent one — but the
   * convention is the one the office already uses when it clones (`<projects>/owner/repo`), so a
   * machine that says where its projects go makes `agent-office hosts add-floor` answerable without
   * anyone having to know the far machine's layout. It is a hint for the CLI, never a path the office
   * reads: it is stored beside the machine's name, not used to open anything.
   */
  projectsDir?: string;
}

/**
 * Calls the office makes that are **not** `ClientMsg` cases, because it reaches them some other way:
 * `/api/search` over HTTP, and two it calls itself while handling another message. A hosted floor has
 * to round-trip them like the rest, so they travel, and nothing else about them changes.
 */
export const HOST_CALLS = ['worker.search', 'queue.dropIssue', 'gh.claim'] as const;

export const FLOOR_CASES = [
  'ball.left',
  'ball.take',
  'ball.throw',
  'car.enter',
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
  'jukebox.place',
  'jukebox.play',
  'jukebox.skip',
  'jukebox.stop',
  'meeting.clear',
  'meeting.start',
  'meeting.stop',
  'queue.add',
  'queue.clear',
  'queue.limit',
  'queue.move',
  'queue.remove',
  'queue.retry',
  'station.prompt',
  'term.input',
  'tv.pause',
  'tv.play',
  'tv.seek',
  'tv.stop',
  'term.resize',
  'worker.attach',
  'worker.detach',
  'worker.helper',
  'worker.kill',
  'worker.prompt',
  'worker.pr',
  'worker.rebuild',
  'worker.resume',
  'worker.spawn',
  'worker.worktree',
] as const;

export type FloorCase = (typeof FLOOR_CASES)[number];

/** A call the office makes that is not a `ClientMsg` case, but still travels. */
export type HostCall = (typeof HOST_CALLS)[number];

/** Office → host. Everything a browser asked for, aimed at a floor. */
export type ToOffice =
  /**
   * The floor-scoped subset of ClientMsg, verbatim: the host runs it against its own `Floor`, so the
   * office's dispatch and the host's are the same code. The payload is left as the union member of
   * `ClientMsg` rather than narrowed here, so a case that gains a field needs no change here.
   */
  | ({ floorId: string; seq: number; t: FloorCase | HostCall } & Record<string, unknown>)
  /**
   * The office's answer to a hello: the token to keep (empty when the machine already had one), and
   * the floors it wants this machine to serve, with the path on *this* machine for each. The office
   * holds those paths to identify the floors and never reads them.
   */
  | { t: 'welcome'; hostId: string; token: string; floors: { id: string; dir: string; name: string }[] }
  | { t: 'bye'; floorId?: string; why?: string };

/**
 * The 50 `handleMessage` cases that call a method on a `Floor`.
 *
 * This list is the authority, and tests/floorhost.test.ts cross-checks it against `server.ts`. Two
 * of them — `ball.take` and `car.enter` — share a case body with a sibling (`ball.throw`,
 * `car.leave`), which is exactly the shape a scan of the switch gets wrong: the body line names only
 * one of the pair, so the other is missed. They were missed here first, and the check now looks for
 * a group of labels rather than a single one.
 *
 * A case added to the switch without a decision about where it runs should fail the build rather
 * than silently staying office-side.
 */

/**
 * Host → office. Whatever the floor's `FloorContext.emit` would have delivered locally goes over the
 * socket instead, subject to `droppable`.
 *
 * Every frame but `ping`/`pong` names its floor, because one connection carries N floors (decision 6).
 * `ready` carries the floor inside its own payload rather than alongside it, so one shape says
 * everything the office needs at the moment a floor appears on a connection.
 */
export type FromFloor =
  /**
   * The first frame, from the machine. One that has paired before presents its `token`; one pairing
   * for the first time presents the `code` from the office instead, so nobody has to carry a token
   * between machines. The office answers with `welcome`.
   */
  | { t: 'hello'; hostId: FloorHostId; protocol: number; token?: string; code?: string; name?: string; owner?: string; projectsDir?: string }
  | { t: 'ready'; floor: FloorReady }
  | { t: 'leave'; floorId: string; why?: string }
  /** Whatever `ctx.emit` would have sent. `droppable` says what the office may shed under pressure. */
  | { t: 'event'; floorId: string; seq: number; droppable?: boolean; clients?: string[]; msg: unknown }
  /** A worker's terminal output, for whoever has that terminal open. */
  | { t: 'term.data'; floorId: string; workerId: string; data: string }
  | { t: 'report'; floorId: string; workerId: string; pr?: { number: number; url: string }; cost?: number; tokens?: number }
  /**
   * A call's **value**, for the calls whose result the office branches on. A refusal is the separate
   * `refused` frame: a method that returns a `string` has failed and is refusing, and anything else is
   * the answer. That is the office's own convention (`if (typeof r === 'string') return warn(c, r)`),
   * so the two sides agree on what a result is without needing a second rule.
   */
  | { t: 'result'; floorId: string; seq: number; value: unknown }
  | { t: 'refused'; floorId: string; workerId?: string; reason: string; seq?: number }
  /** Sent before the handshake finishes, to say why a connection was turned away. */
  | { t: 'refused'; why: string }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number };

// The frames the office sends that are not floor cases: the handshake and a goodbye.
const OFFICE_FRAME_TYPES = new Set(['welcome', 'bye']);
// The frames a machine sends that are not floor cases.
const HOST_FRAME_TYPES = new Set(['hello', 'ping', 'pong']);
const HOST_CASES = new Set<string>([...FLOOR_CASES, ...HOST_CALLS]);
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

/** Rejects anything that is not a frame this office understands, rather than trusting the sender. */
export function isToOffice(msg: unknown): msg is ToOffice {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (typeof m.t !== 'string') return false;
  // A floor case and a control frame share the envelope, so both must carry floorId and a seq.
  if (HOST_CASES.has(m.t)) return typeof m.floorId === 'string' && typeof m.seq === 'number';
  if (!OFFICE_FRAME_TYPES.has(m.t)) return false;
  if (m.t === 'welcome') {
    return typeof m.hostId === 'string' && typeof m.token === 'string' && Array.isArray(m.floors);
  }
  return true;
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
    case 'result':
      return typeof m.floorId === 'string' && typeof m.seq === 'number' && 'value' in m;
    case 'hello':
      return typeof m.protocol === 'number' && (typeof m.token === 'string' || typeof m.code === 'string');
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
