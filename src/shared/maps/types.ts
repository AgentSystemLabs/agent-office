import type { DeskDef, SeatDef, StationKind } from '../layout.js';
import type { Bounds, Obstacles, Pt, Rect } from '../nav.js';

/*
 * Maps: what the building looks like inside. The office (world/office.ts) is built in code and is
 * the default; any other map is plain data, a MapConfig, which planMap (./index.ts) checks and turns
 * into a MapPlan, and a builder for its `style` (the castle's is world/castle.ts) puts up. A config
 * can come from this folder (the built-in ones, like ./castle.ts) or from a JSON file in the office's
 * `.agent-office/maps/` (see docs/maps.md). Every map places the same seats (the desks, the overflow
 * seats, the board agents' kiosks and the meeting chairs, by id), so workers, the queue and meetings
 * work the same on any of them, and a worker keeps its seat when the building changes maps.
 */

/** The styles there's a builder for (the client's world/styles.ts): a map's `style` is one of them. */
export const MAP_STYLES = ['castle'] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

/** The boards on the walls. */
export type BoardKey = 'issues' | 'queue' | 'pulls' | 'services';
export const BOARD_KEYS: readonly BoardKey[] = ['issues', 'queue', 'pulls', 'services'];

/** Somewhere on the floor, facing `rotY` (0 is +z, π/2 is +x). */
export interface Place {
  x: number;
  z: number;
  rotY?: number;
}

/** A board on a wall: its middle, the way it faces (0 is +z), and its size. */
export interface BoardPlace {
  x: number;
  y: number;
  z: number;
  rotY: number;
  width: number;
  height: number;
  /** What the sign over it says. */
  label?: string;
}

/**
 * A long table with seats down its sides: `x`, `z` is its middle, `length` how long it is along
 * `rotY` (0 runs along z). `seats` is how many a side, spaced evenly.
 */
export interface TableConfig {
  x: number;
  z: number;
  length: number;
  width?: number;
  rotY?: number;
  seats: number;
  /** Which of its long sides have seats: both (the default), or only the one toward the middle of the hall, or toward the walls. */
  sides?: 'both' | 'inner' | 'outer';
  /** What its seats are called: "West table, seat 2". */
  name?: string;
}

/**
 * A piece of the map that isn't a seat: a pillar, a banner, a brazier… `kind` is one the map's style
 * knows (see PROP_KINDS); what the rest means depends on it.
 */
export interface PropConfig {
  kind: string;
  x: number;
  z: number;
  /** Up off the floor (a banner, a window, a chandelier). */
  y?: number;
  rotY?: number;
  scale?: number;
  width?: number;
  height?: number;
  length?: number;
  color?: string;
  /** A torch or a brazier that lights the room (a few at most: see MAX_LIGHTS). */
  light?: boolean;
}

/**
 * A dungeon under the hall (see ./dungeon.ts): a vault dug out below its floor, stairs down into it
 * through an opening in the floor, and cells along its walls with iron bars across their fronts.
 * Where workers sent home can be locked up, if the map's `sendHome` says so.
 */
export interface DungeonConfig {
  /** The vault: its middle, its size (`width` along x, `length` along z), and how far below the hall's floor its floor is. */
  x: number;
  z: number;
  width: number;
  length: number;
  depth: number;
  /**
   * The stairs down: the middle of the top step's edge (a hole in the hall's floor opens over them),
   * the way down (`rotY`), and how wide they are. They go down at a steady slope to the vault's floor,
   * inside the vault.
   */
  stairs: { x: number; z: number; rotY: number; width?: number };
  /**
   * The cells: each one's front (the middle of its bars), which way the bars face (`rotY`, out into
   * the vault), how wide it is across the bars, and how deep behind them. There's a door in the
   * middle of the bars.
   */
  cells: { x: number; z: number; rotY: number; width: number; depth: number }[];
  /** Stone pillars holding up the vault. */
  pillars?: { x: number; z: number }[];
  /** Torches on its walls, burning toward `rotY`. */
  torches?: { x: number; z: number; rotY: number }[];
  /** Where the bones go once every cell is full: a heap of them. */
  ossuary?: { x: number; z: number } | null;
}

/**
 * Somewhere a send-home script can walk to: out through the `door` and away, the top of the dungeon
 * `stairs` or the foot of them down in the `dungeon`, the worker's own `cell` (its door), the
 * escort's `post`, or a spot in the hall (or, `below`, in the dungeon).
 */
export type SendHomePlace = 'door' | 'stairs' | 'dungeon' | 'cell' | 'post' | { x: number; z: number; below?: boolean };

/**
 * A step of what happens to a worker sent home (see SendHomeConfig.steps and docs/maps.md):
 * - `pack`: it packs its things into a box at its seat, and its laptop (or tome) shuts.
 * - `fetch`: the escort comes from its post to the worker (`run`: at a run).
 * - `say`: the worker, or its escort, says something (one of `text`, picked at random).
 * - `walk`: the worker walks `to` somewhere, the escort holding on to it if it has fetched it.
 * - `jail`: it's thrown into its cell, and the door's locked behind it: it's kept there, for good.
 * - `leave`: it's gone (shrinking away, wherever it is).
 * - `wait`: a pause, `seconds` long.
 * - `return`: the escort goes back to its post (the worker's done with meanwhile).
 */
export type SendHomeStep =
  | { do: 'pack' }
  | { do: 'fetch'; run?: boolean }
  | { do: 'say'; who?: 'worker' | 'escort'; text: string | string[] }
  | { do: 'walk'; to: SendHomePlace; run?: boolean }
  | { do: 'jail' }
  | { do: 'leave' }
  | { do: 'wait'; seconds: number }
  | { do: 'return' };

/**
 * What becomes of a worker sent home on this map, scripted as `steps` run one after another. Without
 * it, a worker packs up and walks out of the door.
 */
export interface SendHomeConfig {
  /** Who comes for it: stands at `post` (down in the dungeon, with `below`) until a worker's sent home, then goes and gets it. */
  escort?: { name?: string; post: Place & { below?: boolean }; color?: string } | null;
  steps: SendHomeStep[];
  /** In a cell: hours until it's starved to death (thinner and thinner on the way), and hours after that until it's bare bones. */
  starveHours?: number;
  rotHours?: number;
}

/** What a map is made of: see docs/maps.md for what each part does and how to write one. */
export interface MapConfig {
  /** Lowercase letters, digits and dashes: what the building's pick calls it. */
  id: string;
  name: string;
  /** One emoji for Settings. */
  icon?: string;
  description?: string;
  /** Another map's id to start from: everything given here replaces its part (objects are merged, lists replaced). */
  extends?: string;
  /** Which builder puts it up: 'castle' is the one there is. */
  style: string;
  /** The room: x from -width/2 to width/2, z from -length/2 to length/2, walls `height` high. */
  hall: { width: number; length: number; height: number };
  /** Where you stand when you arrive (and the throne's taken). */
  spawn?: Place;
  /** Just inside the way in and out, where workers come in and go home. */
  door: Place;
  /** Your seat of honour, on a dais against a wall. */
  throne?: (Place & { dais?: { width: number; depth: number; height: number; steps: number } | null; label?: string }) | null;
  /** Whoever stands by the throne and sends new workers out when you speak to them. */
  herald?: (Place & { name?: string; says?: string; ask?: string; button?: string }) | null;
  /** Where workers waiting on someone line up: the first spot, each next one `step` further on, `count` of them, facing `rotY`. */
  lineup?: { x: number; z: number; rotY: number; step: [number, number]; count: number } | null;
  /** Where the workers sit. The sides toward the middle of the hall fill first. */
  tables: TableConfig[];
  /** The board agents, each at a lectern: where the lectern is, and `rotY` from it to where the agent stands (it faces back across the lectern, into the hall). */
  stations: Record<StationKind, Place>;
  /** The meeting table: five chairs round it, the head of the table's on its `rotY` side (facing back across it), and the easel on the other. */
  council: Place;
  boards: Record<BoardKey, BoardPlace>;
  props?: PropConfig[];
  /** How the workers look here: an outfit, and how many minutes of work until they look worn out (0: they never do). */
  agents?: { outfit?: 'peasant' | 'none'; ageMinutes?: number };
  /** Colors: CSS colors for the stone, the floor, the carpet, the wood and the trim. */
  palette?: Partial<Record<'stone' | 'floor' | 'carpet' | 'wood' | 'trim', string>>;
  /** A dungeon under the hall, with cells to lock workers up in. */
  dungeon?: DungeonConfig | null;
  /** What happens to a worker sent home here: without it, it walks out of the door. */
  sendHome?: SendHomeConfig | null;
}

/** A board on a wall, as a map puts it. */
export interface BoardDef extends BoardPlace {
  label: string;
}

/** A map checked and worked out: where everything is, by id. */
export interface MapPlan {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** 'office' is the office built in code; any other is built from `config` by its style's builder. */
  style: 'office' | MapStyle;
  config?: MapConfig;
  bounds: Bounds;
  /** How high the walls are. */
  height: number;
  /** Where you stand when you arrive. */
  spawn: { x: number; y: number; z: number; rotY: number };
  /** The regular seats, then the overflow ones that only come out once they're all taken (the office's bean bags). */
  desks: DeskDef[];
  overflow: DeskDef[];
  stations: DeskDef[];
  meeting: DeskDef[];
  /** Everywhere a worker can be, by id. */
  byId: Map<string, DeskDef>;
  /** Where people can sit (the office's couches, the castle's throne). */
  seating: SeatDef[];
  seatingById: Map<string, SeatDef>;
  throne?: SeatDef;
  /** The dais the throne stands on (its front is 2.4 m in front of the throne, and the steps down go on from there). */
  dais?: { width: number; depth: number; height: number; steps: number };
  /** The spots workers waiting on someone stand in, first in line first. */
  lineup: { x: number; z: number; rotY: number }[];
  /** Who sends out new workers: where, what the card over them says, and what they ask and the button in their window. */
  herald?: { x: number; z: number; rotY: number; name: string; says: string; ask: string; button: string };
  door: { x: number; z: number };
  /** The tables as checked, with what was left out filled in: the sides with seats (1 is the table's right, -1 its left). */
  tables: { x: number; z: number; length: number; width: number; rotY: number; seats: number; sides: (1 | -1)[]; name: string }[];
  /** The meeting table's middle, and which side the head of the table is on (see MapConfig.council). */
  council?: { x: number; z: number; rotY: number };
  boards: Record<BoardKey, BoardDef>;
  /** What's in the way on the floor, for walking round it (the office has its own: OFFICE_NAV). */
  obstacles?: Obstacles;
  agents: { outfit: 'peasant' | 'none'; ageMinutes: number };
  /** The dungeon under the hall, worked out (see ./dungeon.ts). */
  dungeon?: DungeonPlan;
  /** What happens to a worker sent home, checked (see ./dungeon.ts): none, and it walks out of the door. */
  sendHome?: SendHomePlan;
}

/** A spot to sit or stand in, facing `rotY`, and how high its floor is. */
export interface Spot {
  x: number;
  y: number;
  z: number;
  rotY: number;
}

/** A cell in the dungeon, worked out: see DungeonConfig.cells. */
export interface CellPlan {
  /** The middle of its bars, and the way they face (out into the vault). */
  x: number;
  z: number;
  rotY: number;
  width: number;
  depth: number;
  /** Its door, in the middle of the bars: where the escort stands in front of it, and where its prisoner is thrown in from. */
  outside: Pt;
  threshold: Pt;
  /** Where its prisoners sit, the first to be locked up first. */
  spots: Spot[];
}

/** The dungeon under the hall, worked out from its config. */
export interface DungeonPlan {
  /** The vault. */
  bounds: Bounds;
  /** Its floor, below the hall's (negative), and its ceiling, the underside of the hall's floor. */
  floor: number;
  ceiling: number;
  /** The hole in the hall's floor over the stairs, and the rails round it. */
  opening: Rect;
  rails: Rect;
  /**
   * The stairs: a step at a time, its top and the floor it covers, from the top one down; where a
   * walker comes up to them in the hall (`top`) and gets off at the foot of them in the vault (`foot`).
   */
  steps: { top: number; rect: Rect }[];
  stairs: { rotY: number; width: number; top: Pt; start: Pt; end: Pt; foot: Pt };
  cells: CellPlan[];
  /** Every seat in every cell, in the order they fill: round the cells one seat each, then round again. */
  seats: { cell: number; spot: Spot }[];
  pillars: Pt[];
  torches: { x: number; z: number; rotY: number }[];
  ossuary: Pt | null;
  /** What's in the way down there, for walking round it. */
  obstacles: Obstacles;
}

export interface SendHomePlan {
  escort?: { name: string; color: string; post: Spot & { below: boolean } };
  steps: SendHomeStep[];
  /** Whoever's sent home is kept, locked up in the dungeon (its steps jail it). */
  keeps: boolean;
  /** How long until someone locked up has starved to death, and after that until they're bare bones (ms). */
  starveMs: number;
  rotMs: number;
}

/** What Settings lists: every map there is to pick, and the custom ones that didn't load. */
export interface MapChoice {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** From the office's `.agent-office/maps/` folder. */
  custom?: boolean;
  /** Why it can't be picked. */
  error?: string;
}
