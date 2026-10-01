// The page's store: what it knows about the office, kept up to date from the server's messages, and the
// topics it fires as that changes (store.on / store.emit).
//
// The fields declared here are the core: who you are, the people, the building's floors, and the floor
// you're on with its workers, their screens, its issues, pull requests and queue (./core.ts keeps them
// up to date). Everything else is a slice (./slices): a module that adds its own fields and topics to
// Store and Topics by module augmentation, sets where they start, and says what it takes in from each
// server message and from each floor you arrive on. The store runs the slices in the one order they're
// registered in (./slices/index.ts), and that order is the order their topics fire in.

import type { ChatLine, FloorInfo, FloorView, GhIssue, GhPull, GhState, Me, PeerInfo, ProjectInfo, ProjectsDirState, QueueState, QueueTask, RepoChoice, Run, ServerMsg, WorkerInfo } from '../../shared/protocol';
import { randomLook } from '../../shared/avatar';
import { AVATAR_COLORS, type Profile } from './persist';

/** A worker's terminal as its laptop shows it, put together from the office's 'screen' frames. */
export interface ScreenState {
  cols: number;
  rows: number;
  lines: Run[][];
  cursor: [number, number];
  version: number;
}

/**
 * What the store fires when something changes, for store.on. These are the core's; each slice adds its
 * own (`declare module '../store' { interface Topics { … } }`).
 */
export interface Topics {
  peers: true;
  chat: true;
  me: true;
  floors: true;
  projectsDir: true;
  repos: true;
  floor: true;
  project: true;
  workers: true;
  screens: true;
  issues: true;
  pulls: true;
  queue: true;
}

export type Topic = keyof Topics;

/** The server message of type `T`. */
export type MsgOf<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

/**
 * How a slice takes in a message (or the floor you arrived on): it changes the store's fields, and says
 * which topics that changed. Those fire once every slice has taken the message in.
 */
export type Take<M> = (s: Store, m: M) => readonly Topic[] | void;

/** A slice's handler for each server message it takes in, by the message's type. */
export type Handlers = { readonly [T in ServerMsg['t']]?: Take<MsgOf<T>> };

/** The store's methods, the ones slices add included. */
type Methods = { [K in keyof Store as Store[K] extends (...args: never[]) => unknown ? K : never]?: Store[K] };

/**
 * A piece of the store: some fields and topics (declared on Store and Topics by the slice's module
 * augmentation), where they start, and what changes them.
 */
export interface Slice {
  /** Sets its fields to where they start, as the store is made. */
  init?(s: Store): void;
  /** Methods it adds to the store (declared on Store with its fields), with the store as `this`. */
  readonly methods?: Methods & ThisType<Store>;
  /** What it takes in from each server message it cares about. */
  readonly on?: Handlers;
  /** What it takes in from each floor you arrive on (see Store.apply), in place of the last one's. */
  readonly enter?: Take<FloorView>;
  /**
   * On a message that brings a floor, its topics fire before the floor is taken in rather than after it:
   * the floor's own state hangs on it (the map: the floor's workers sit down in its seats, not the last one's).
   */
  readonly beforeFloor?: boolean;
}

/** The floor a message brings with it: you were let in (welcome), or you went to another floor (floor.enter). */
function floorOf(m: ServerMsg): FloorView | undefined {
  return m.t === 'welcome' || m.t === 'floor.enter' ? m : undefined;
}

/** The worker whose worktree branch a pull request came from, if it is still at a desk. */
export function workerForPull(workers: Iterable<WorkerInfo>, pr: { number: number; headRefName: string }): WorkerInfo | undefined {
  for (const w of workers) if (w.pr?.number === pr.number || (w.worktree && w.worktree.branch === pr.headRefName)) return w;
  return undefined;
}

export class Store {
  you = '';
  profile: Profile = { name: 'Guest', color: AVATAR_COLORS[1], look: randomLook() };
  peers = new Map<string, PeerInfo>();
  workers = new Map<string, WorkerInfo>();
  screens = new Map<string, ScreenState>();
  project: ProjectInfo | null = null;
  /** Every floor of the building, and the one you're on (null while there are none). */
  floors: FloorInfo[] = [];
  floor: string | null = null;
  /** Where the office clones new floors to. */
  projectsDir: ProjectsDirState = { dir: '', custom: false };
  /** The repositories the office's gh login can clone, once asked for (see floor.repos). */
  repos: { list: RepoChoice[]; error?: string; loading: boolean; at: number } = { list: [], loading: false, at: 0 };
  issues: GhState<GhIssue> = { items: [], fetchedAt: 0, loading: true };
  pulls: GhState<GhPull> = { items: [], fetchedAt: 0, loading: true };
  ice: RTCIceServer[] = [];
  chat: ChatLine[] = [];
  /** Whether this office can invite teammates (deployed with deploy/aws.sh). */
  invites = false;
  queue: QueueState = { tasks: [], maxWorkers: 0 };
  /** Who you're signed in as (see /api/whoami). */
  me: Me = { admin: false };
  private subs = new Map<Topic, Set<() => void>>();
  // The slices, and each message type's handlers in their order. Kept in # fields, which aren't among
  // the store's keys: those are its state (window.__office.store).
  readonly #slices: readonly Slice[];
  readonly #handlers = new Map<ServerMsg['t'], { slice: Slice; take: Take<ServerMsg> }[]>();

  /** A store made of the core and `slices`, which run in this order. */
  constructor(slices: readonly Slice[]) {
    this.#slices = slices;
    for (const slice of slices) {
      slice.init?.(this);
      // Not enumerable, like a class's own methods.
      for (const [name, fn] of Object.entries(slice.methods ?? {})) Object.defineProperty(this, name, { value: fn, writable: true, configurable: true });
      const on = slice.on ?? {};
      for (const t of Object.keys(on) as ServerMsg['t'][]) {
        let list = this.#handlers.get(t);
        if (!list) this.#handlers.set(t, (list = []));
        list.push({ slice, take: on[t] as Take<ServerMsg> });
      }
    }
  }

  on(topic: Topic, fn: () => void) {
    let set = this.subs.get(topic);
    if (!set) this.subs.set(topic, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit(topic: Topic) {
    this.subs.get(topic)?.forEach((fn) => fn());
  }

  /** The floor you're on. */
  currentFloor(): FloorInfo | undefined {
    return this.floors.find((f) => f.id === this.floor);
  }

  /** Whether someone is on your floor (people on other floors aren't in the room with you). */
  onMyFloor(peer: PeerInfo): boolean {
    return (peer.floor ?? null) === this.floor;
  }

  workerAtDesk(deskId: string): WorkerInfo | undefined {
    for (const w of this.workers.values()) if (w.deskId === deskId) return w;
    return undefined;
  }

  /** The queue task for an issue: the one on the queue if there is one, else the latest finished one. */
  taskForIssue(issue: number): QueueTask | undefined {
    const tasks = this.queue.tasks.filter((t) => t.issue === issue);
    return tasks.find((t) => t.status !== 'done') ?? tasks[tasks.length - 1];
  }

  /**
   * Takes in a server message: every slice that handles its type takes it in, in order, and then the
   * topics they changed fire. A message that brings a floor (welcome, floor.enter) has the floor taken
   * in between the two (see enter), after the topics of any slice the floor hangs on (beforeFloor).
   */
  apply(msg: ServerMsg) {
    const floor = floorOf(msg);
    const first: Topic[] = [];
    const then: Topic[] = [];
    for (const { slice, take } of this.#handlers.get(msg.t) ?? []) {
      const topics = take(this, msg);
      if (topics) (floor && slice.beforeFloor ? first : then).push(...topics);
    }
    if (floor) {
      for (const t of first) this.emit(t);
      this.enter(floor);
    }
    for (const t of then) this.emit(t);
  }

  /** Everything on the floor you just arrived on, in place of the last one's: every slice takes it in, then their topics fire. */
  private enter(v: FloorView) {
    const topics: Topic[] = [];
    for (const slice of this.#slices) {
      const changed = slice.enter?.(this, v);
      if (changed) topics.push(...changed);
    }
    for (const t of topics) this.emit(t);
  }
}
