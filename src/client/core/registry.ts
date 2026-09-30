/**
 * The registries every part of the office plugs into, instead of being wired by hand into the middle
 * of main.ts: what happens on each server message, who gets a key press, what runs each frame, what
 * stops when you do something else, and what each kind of thing you can use does.
 *
 * Pure: nothing here touches the DOM or three.js, so it runs under node in the tests. The office's own
 * types (its messages, its key events, its hint bar) come in as type parameters (see context.ts).
 *
 * Every list here is copied when it changes rather than while it's walked, so a handler that adds or
 * removes one (itself included) mid-dispatch changes the next dispatch, not the one under way.
 */

/** A registration's handle: call it to take the registration back out. */
export type Off = () => void;

/** A list that's copied when it changes, so walking `items` is never disturbed by an add or a removal. */
class List<T> {
  items: readonly T[] = [];

  /** Adds `x` at the end, and returns how to take it back out. */
  add(x: T): Off {
    this.items = [...this.items, x];
    return () => {
      this.items = this.items.filter((y) => y !== x);
    };
  }
}

/** The list at `key` of `map`, made the first time it's wanted. */
function listAt<K, T>(map: Map<K, List<T>>, key: K): List<T> {
  let list = map.get(key);
  if (!list) map.set(key, (list = new List<T>()));
  return list;
}

// ---- Server messages ------------------------------------------------------------------------------

/** When a handler for a message type runs: before the store has applied the message, or after it. */
export type MessagePhase = 'before' | 'after';

interface MessageEntry<M> {
  fn: (m: M) => void;
}

/**
 * What happens on each server message. `dispatch` runs, in this order: the message type's `before`
 * handlers (with the store as it was), `apply` (the store takes the message in, and its topics fire),
 * every `onAny` handler (the routers), then the type's `after` handlers. Within each, handlers run in
 * the order they were registered.
 */
export class Messages<M extends { t: string }> {
  private readonly before = new Map<string, List<MessageEntry<M>>>();
  private readonly after = new Map<string, List<MessageEntry<M>>>();
  private readonly any = new List<MessageEntry<M>>();

  /** `apply` is the store taking a message in (store.apply), passed in so this stays pure. */
  constructor(private readonly apply: (m: M) => void) {}

  /** Runs `fn` on every message of type `t`, `before` the store applies it or (the default) `after`. */
  on<T extends M['t']>(t: T, fn: (m: Extract<M, { t: T }>) => void, phase: MessagePhase = 'after'): Off {
    return listAt(phase === 'before' ? this.before : this.after, t).add({ fn: fn as (m: M) => void });
  }

  /** Runs `fn` on every message, once the store has it and before the type's `after` handlers. */
  onAny(fn: (m: M) => void): Off {
    return this.any.add({ fn });
  }

  dispatch(m: M): void {
    for (const e of this.before.get(m.t)?.items ?? []) e.fn(m);
    this.apply(m);
    for (const e of this.any.items) e.fn(m);
    for (const e of this.after.get(m.t)?.items ?? []) e.fn(m);
  }
}

// ---- Keys -----------------------------------------------------------------------------------------

/** The part of a key press the registry looks at (a KeyboardEvent is one). */
export interface KeyPress {
  readonly code: string;
  readonly key: string;
  readonly repeat: boolean;
  preventDefault(): void;
}

/**
 * The stages a key press goes through before the bindings, in order: guards (nothing gets a key while
 * a window's open, say), then whatever you're in the middle of (the ladder, the tee, a car…), then the
 * emotes. A handler returns true when it took the key, which ends it there.
 */
export type KeyStage = 'guard' | 'activity' | 'emote';
export const KEY_STAGES: readonly KeyStage[] = ['guard', 'activity', 'emote'];

/** A key of the office's own, once no stage has taken it. */
export interface KeyBinding<E extends KeyPress = KeyPress> {
  /** The key(s) this is, by KeyboardEvent.code. A binding that has the code settles the key: nothing after it gets it, whether it acts or not. */
  code?: string | readonly string[];
  /** Or the character typed (KeyboardEvent.key), tried only when no binding has the code: `/` on any keyboard layout. */
  key?: string;
  /** Whether it acts right now. When it doesn't, the key still stops here, unhandled. */
  when?: () => boolean;
  /** False: while the key's held down, its repeats are taken (and count as handled) without running it again. */
  repeat?: boolean;
  /** Stop the browser doing its own thing with the key, whenever this binding takes it. */
  preventDefault?: boolean;
  /** Does what the key's for. Returning false says it didn't after all (the key stops here, unhandled). */
  run(e: E): boolean | void;
}

/**
 * Who took a key press: a stage, a binding that acted on it ('bound'), a binding that has the key but
 * didn't act ('claimed'), or nobody (null).
 */
export type KeyResult = KeyStage | 'bound' | 'claimed' | null;

interface KeyEntry<E> {
  fn: (e: E) => boolean;
}

function hasCode<E extends KeyPress>(b: KeyBinding<E>, code: string): boolean {
  return b.code !== undefined && (typeof b.code === 'string' ? b.code === code : b.code.includes(code));
}

/** Who gets a key press: the stages in order (see KeyStage), then the office's own key bindings. */
export class Keys<E extends KeyPress = KeyPress> {
  private readonly stages = new Map<KeyStage, List<KeyEntry<E>>>();
  private readonly bindings = new List<KeyBinding<E>>();

  /** `fn` gets each key press at `stage` (after the handlers registered there before it), and returns true when it took it. */
  add(stage: KeyStage, fn: (e: E) => boolean): Off {
    return listAt(this.stages, stage).add({ fn });
  }

  bind(b: KeyBinding<E>): Off {
    return this.bindings.add(b);
  }

  /** Hands a key press down the chain; see KeyResult for what comes back. */
  handle(e: E): KeyResult {
    for (const stage of KEY_STAGES) for (const h of this.stages.get(stage)?.items ?? []) if (h.fn(e)) return stage;
    const all = this.bindings.items;
    // A binding with the key's code has it outright; the character counts only for a code nobody has.
    const b = all.find((x) => hasCode(x, e.code)) ?? all.find((x) => x.code === undefined && x.key !== undefined && x.key === e.key);
    if (!b) return null;
    if (b.when && !b.when()) return 'claimed';
    if (b.preventDefault) e.preventDefault();
    if (e.repeat && b.repeat === false) return 'bound';
    return b.run(e) === false ? 'claimed' : 'bound';
  }
}

// ---- The frame ------------------------------------------------------------------------------------

/**
 * The phases of a frame, in the order they run (see frame() in core/loop.ts, which runs them all). Within a
 * phase, callbacks run in the order they were registered: the office's own before any feature's.
 *
 * - pre: before anything moves: the frame rate, coffee and the view's shake, then drinks
 * - steer: where you're headed on your own (walking over to someone)
 * - vehicles: what you might be riding moves first (the cars)
 * - move: you move
 * - moved: what where you've got to does to you (a lap timed, a car shoving you, a pole's hole)
 * - play: games and what they hold you in (the arcade, the tee, the dart board)
 * - me: your character, your hands and the camera, what you hear, and telling the office where you are
 * - others: everyone and everything else that moves (people, cars' engines, workers, the dog, the ball)
 * - world: the building and what's in it (its doors and floors, smoke breaks, particles, a picture being hung)
 * - env: the sky, the weather and the light, then what's lit by it (the roof's strobes)
 * - aim: what you're pointing at, and the hint bar
 * - hud: the panels that follow what people are doing
 * - render: drawing the frame
 */
export const TICK_PHASES = ['pre', 'steer', 'vehicles', 'move', 'moved', 'play', 'me', 'others', 'world', 'env', 'aim', 'hud', 'render'] as const;
export type TickPhase = (typeof TICK_PHASES)[number];

/** What each tick gets about the frame it's in. */
export interface Frame {
  /** Seconds since the last frame, as it was. */
  readonly delta: number;
  /** Seconds since the last frame, at most 0.1 (after a stall, the world doesn't leap). */
  readonly dt: number;
  /** Seconds since the loop started. */
  readonly t: number;
  /** performance.now() at the start of the frame. */
  readonly now: number;
}

interface TickEntry {
  fn: (f: Frame) => void;
}

/** What runs each frame, phase by phase (see TICK_PHASES). */
export class Ticks {
  private readonly phases = new Map<TickPhase, List<TickEntry>>();

  add(phase: TickPhase, fn: (f: Frame) => void): Off {
    if (!TICK_PHASES.includes(phase)) throw new Error(`No such frame phase: ${phase}`);
    return listAt(this.phases, phase).add({ fn });
  }

  run(f: Frame): void {
    for (const phase of TICK_PHASES) for (const e of this.phases.get(phase)?.items ?? []) e.fn(f);
  }
}

// ---- Activities -----------------------------------------------------------------------------------

/**
 * Something you can be in the middle of that takes over the controls (hanging a picture, the ladder,
 * the golf tee…). `Why` names what's making you stop (see Activities.stopAll), `E` is a key press and
 * `El` is where the hint bar draws.
 */
export interface Activity<Why extends string = string, E = unknown, El = unknown> {
  readonly id: string;
  active(): boolean;
  /** Stops it because of `why`. Only called while it's active; it may decide `why` isn't a reason to stop. */
  stop(why: Why): void;
  /** Keys while it's active: true when it took the key. */
  key?(e: E): boolean;
  /** Draws the hint bar while it's active. */
  hint?(el: El): void;
  /** The camera's its own while it's active (over your shoulder at the tee, say): no crosshair, and you're in view. */
  readonly takesCamera?: boolean;
  /** Your hands are busy out of sight while it's active (on the club, a dart, the wheel): none drawn in first person. */
  readonly hidesHands?: boolean;
  /** Both your hands are on it while it's active (the club): your character holds nothing else (the coffee mug). */
  readonly bothHands?: boolean;
}

/** The flags an activity can have, for Activities.any. */
export type ActivityFlag = 'takesCamera' | 'hidesHands' | 'bothHands';

/**
 * What you can be in the middle of. They're kept in a declared order (the constructor's `order`, then
 * any others in the order they were added), which is the order they get keys in, the first one's the
 * hint bar's, and the order they stop in.
 */
export class Activities<Why extends string = string, E = unknown, El = unknown> {
  private list: readonly Activity<Why, E, El>[] = [];
  private added: readonly Activity<Why, E, El>[] = [];

  constructor(private readonly order: readonly string[] = []) {}

  add(a: Activity<Why, E, El>): Off {
    if (this.added.some((x) => x.id === a.id)) throw new Error(`Activity ${a.id} is already registered`);
    this.added = [...this.added, a];
    this.sort();
    return () => {
      this.added = this.added.filter((x) => x !== a);
      this.sort();
    };
  }

  private sort() {
    const rank = (a: Activity<Why, E, El>) => {
      const i = this.order.indexOf(a.id);
      return i < 0 ? this.order.length + this.added.indexOf(a) : i;
    };
    this.list = [...this.added].sort((a, b) => rank(a) - rank(b));
  }

  /** Every activity, in order, active or not. */
  all(): readonly Activity<Why, E, El>[] {
    return this.list;
  }

  /** Whether the activity `id` is going on. */
  running(id: string): boolean {
    return !!this.list.find((a) => a.id === id)?.active();
  }

  /** The first activity going on (that `match` says yes to), in order. */
  current(match?: (a: Activity<Why, E, El>) => boolean): Activity<Why, E, El> | undefined {
    return this.list.find((a) => a.active() && (!match || match(a)));
  }

  /** Whether you're in the middle of anything. */
  busy(): boolean {
    return this.list.some((a) => a.active());
  }

  /** Whether anything going on has `flag`. */
  any(flag: ActivityFlag): boolean {
    return this.list.some((a) => !!a[flag] && a.active());
  }

  /** Stops everything going on (but `except`) because of `why`, in order. Each decides for itself whether `why` stops it. */
  stopAll(why: Why, except: readonly string[] = []): void {
    for (const a of this.list) if (!except.includes(a.id) && a.active()) a.stop(why);
  }

  /** Stops the activity `id` alone, if it's going on, because of `why` (it decides whether that stops it). */
  stop(id: string, why: Why): void {
    const a = this.list.find((x) => x.id === id);
    if (a?.active()) a.stop(why);
  }

  /** Offers a key press to what's going on, in order: true when one took it. */
  key(e: E): boolean {
    return this.list.some((a) => !!a.key && a.active() && a.key(e));
  }
}

// ---- Your view -------------------------------------------------------------------------------------

/**
 * A filter the frame's drawn through (the drunk vision): `begin` before the frame's drawn, true when
 * it's on this frame, and then `end` once it's drawn.
 */
export interface FrameFilter {
  begin(): boolean;
  end(f: Frame): void;
}

/**
 * What something you can do makes of you and your view while it's going on: holding on to the ladder,
 * the view narrowing at the dart board or widening down a pole, the telescope or a game having the
 * screen to itself, the drunk vision. The office's own ticks (moving you, the building, drawing the
 * frame) ask each effect, in the order they were added. `G` is what you can hold on to.
 */
export interface ViewEffect<G = unknown> {
  /** What you're holding on to (the ladder, a pole), or null. */
  grip?(): G | null;
  /** The field of view (degrees) as this has it, given what it is so far. */
  fov?(fov: number): number;
  /** Runs each frame once the view's field of view is set. */
  update?(): void;
  /** It has the screen to itself right now (the telescope, a game up close): your hands aren't drawn over it. */
  covers?(): boolean;
  /** Draws the frame through this. */
  filter?: FrameFilter;
}

/** How what you're doing changes you and your view each frame (see ViewEffect). */
export class View<G = unknown> {
  private readonly effects = new List<ViewEffect<G>>();

  add(e: ViewEffect<G>): Off {
    return this.effects.add(e);
  }

  /** What you're holding on to: the first effect's that has you holding on to something, else null. */
  grip(): G | null {
    for (const e of this.effects.items) {
      const g = e.grip?.() ?? null;
      if (g !== null) return g;
    }
    return null;
  }

  /** The field of view, from `fov` through every effect's, in order. */
  fov(fov: number): number {
    for (const e of this.effects.items) if (e.fov) fov = e.fov(fov);
    return fov;
  }

  update(): void {
    for (const e of this.effects.items) e.update?.();
  }

  /** Whether anything has the screen to itself. */
  covered(): boolean {
    for (const e of this.effects.items) if (e.covers?.()) return true;
    return false;
  }

  /** The filters that are on this frame (kept, so drawing one allocates nothing). */
  private readonly on: FrameFilter[] = [];

  /** Draws the frame (`draw`) through every filter that's on, the first one outermost. */
  draw(f: Frame, draw: () => void): void {
    const on = this.on;
    on.length = 0;
    for (const e of this.effects.items) if (e.filter?.begin()) on.push(e.filter);
    draw();
    for (let i = on.length - 1; i >= 0; i--) on[i].end(f);
  }
}

// ---- Things you can use ---------------------------------------------------------------------------

/** The types the office's interactions are about: what you use, its hint, the keys, and the note you're pointing at. */
export interface InteractionTypes {
  it: { kind: string };
  hint: unknown;
  key: string;
  note: unknown;
}

/** One kind of thing you can use: how close you have to be, what the hint bar says about it, and what its keys do. */
export interface InteractionDef<T extends InteractionTypes> {
  /** How close (meters from your eyes) you must be to use it by aiming at it. */
  readonly reach: number;
  hint(it: T['it']): T['hint'];
  /** A key pressed (or the mouse clicked, as E) at it. `note` is the issue note you're pointing at, on the issues board. */
  use(it: T['it'], key: T['key'], note: T['note']): void;
}

/** What each kind of thing you can use does, one definition per kind. */
export class Interactions<T extends InteractionTypes> {
  private readonly defs = new Map<T['it']['kind'], InteractionDef<T>>();

  define(kind: T['it']['kind'], def: InteractionDef<T>): Off {
    if (this.defs.has(kind)) throw new Error(`Interaction ${kind} is already defined`);
    this.defs.set(kind, def);
    return () => {
      if (this.defs.get(kind) === def) this.defs.delete(kind);
    };
  }

  private def(kind: T['it']['kind']): InteractionDef<T> {
    const d = this.defs.get(kind);
    if (!d) throw new Error(`No interaction is defined for ${kind}`);
    return d;
  }

  has(kind: T['it']['kind']): boolean {
    return this.defs.has(kind);
  }

  /** The kinds defined so far. */
  kinds(): T['it']['kind'][] {
    return [...this.defs.keys()];
  }

  /** Which of `all` have no definition. */
  missing(all: readonly T['it']['kind'][]): T['it']['kind'][] {
    return all.filter((k) => !this.defs.has(k));
  }

  reach(kind: T['it']['kind']): number {
    return this.def(kind).reach;
  }

  hint(it: T['it']): T['hint'] {
    return this.def(it.kind).hint(it);
  }

  use(it: T['it'], key: T['key'], note: T['note']): void {
    this.def(it.kind).use(it, key, note);
  }
}

// ---- Things to do when something happens -----------------------------------------------------------

/** Things to do when something happens (a window opening, say), in the order they were added. */
export class Hooks {
  private readonly list = new List<() => void>();

  add(fn: () => void): Off {
    return this.list.add(fn);
  }

  run(): void {
    for (const fn of this.list.items) fn();
  }
}

// ---- What else there is to use ----------------------------------------------------------------------

/** One part of the office with things of its own to use (the pictures, the dog, the ball): `I` is one of them, `O` what the aim can land on. */
export interface UsableSource<I, O> {
  /** What there is to use of it right now. */
  usable(): readonly I[];
  /** What the aim can land on that isn't in the building itself (the dog walks about on its own), if anything. */
  pickable?(): O;
}

/**
 * What there is to use on the office's own map besides the building's own things, from the parts that
 * come and go or move about in it, in the order they were added: what each has to use, and what the
 * aim can land on that isn't the building.
 */
export class Usables<I, O> {
  private readonly sources = new List<UsableSource<I, O>>();

  add(s: UsableSource<I, O>): Off {
    return this.sources.add(s);
  }

  /** What each source has to use right now, a list each, in order. */
  lists(): (readonly I[])[] {
    return this.sources.items.map((s) => s.usable());
  }

  /** What the aim can land on besides the building, in order. */
  pickables(): O[] {
    const out: O[] = [];
    for (const s of this.sources.items) if (s.pickable) out.push(s.pickable());
    return out;
  }
}
