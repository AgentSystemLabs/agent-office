import { BEANBAGS, BOARDS, DESKS, ELEVATOR, ELEVATOR_CAR, EXIT_DOOR, FLOOR, MEETING_SEATS, SEATING, STATIONS, STATION_AGENT, WALL_HEIGHT, WING_DESKS, seatHere, seatPlace, type DeskDef, type SeatDef, type SeatPlace, type StationKind } from '../layout.js';
import type { Circle, Rect } from '../nav.js';
import { CASTLE } from './castle.js';
import { MapError, isObj, num, str } from './check.js';
import { overlaps, planDungeon, planSendHome } from './dungeon.js';
import { boxFootprint, isPropKind, propFootprint, propTop } from './props.js';
import { BOARD_KEYS, MAP_STYLES, type BoardDef, type BoardKey, type MapChoice, type MapConfig, type MapPlan, type MapStyle, type TableConfig } from './types.js';

export * from './types.js';
export { DUNGEON_SLAB, SEND_HOME_STEPS, dungeonClear, levelRoute, prisonSeat, wasting } from './dungeon.js';

/** The office: built in code (world/office/), and what the building is until someone picks another map. */
export const OFFICE_MAP = 'office';
/** The maps that come with the office, besides the office itself. */
export const BUILTIN_MAPS: readonly MapConfig[] = [CASTLE];

const STATION_KINDS: readonly StationKind[] = ['issues', 'pulls', 'queue'];
/** How far in from a table's edge a seat's place setting is; the worker sits 0.85 out from it (see deskSeat), on the bench. */
const PLACE_IN = 0.35;
/** How far out from a table's edge the middle of the bench down that side is. */
export const BENCH_OUT = 0.52;
/**
 * The round meeting table: how big it is, how far out the chairs' place settings and the chairs are,
 * and how far behind it (away from the head of the table) the easel with the meeting's board stands.
 */
export const COUNCIL = { radius: 1.15, height: 0.78, place: 0.5, chairs: 1.35, easel: 2.5 } as const;
/** The throne's footprint. */
export const THRONE_SIZE = { width: 1.9, depth: 1.9 } as const;

export { MapError } from './check.js';

/** The most tables, seats a side and props a map can have: plenty for a hall, and not so many a browser chokes building it. */
export const MAP_LIMITS = { tables: 40, seats: 12, props: 400 } as const;
/** The dais a throne stands on when its map doesn't say. */
export const DEFAULT_DAIS = { width: 8, depth: 4.5, height: 0.9, steps: 3 } as const;

const DEFAULT_BOARD_LABEL: Record<BoardKey, string> = { issues: 'Issues', queue: '📋 Task queue', pulls: 'Pull Requests', services: '🌐 Services' };

// ---- The office -----------------------------------------------------------------------------------

/**
 * Every map's desks, by id: the office's room, then its back office (see WING), which is only there to
 * sit at on a floor built out that far (deskBuilt), on whichever map, so a worker hired there has a
 * seat on every map.
 */
const MAP_DESKS: DeskDef[] = [...DESKS, ...WING_DESKS];

function officePlan(): MapPlan {
  const byId = new Map([...MAP_DESKS, ...BEANBAGS, ...STATIONS, ...MEETING_SEATS].map((d) => [d.id, d]));
  const boards = {} as Record<BoardKey, BoardDef>;
  for (const k of BOARD_KEYS) boards[k] = { ...BOARDS[k] };
  return {
    id: OFFICE_MAP,
    name: 'Office',
    icon: '🏢',
    description: 'The office: desks, a lounge, the boss’s loft upstairs, a floor for every project, and a bar on the roof.',
    style: 'office',
    bounds: { ...FLOOR },
    height: WALL_HEIGHT,
    spawn: { x: ELEVATOR.x, y: 0, z: (ELEVATOR_CAR.minZ + ELEVATOR_CAR.maxZ) / 2, rotY: 0 },
    desks: MAP_DESKS,
    overflow: BEANBAGS,
    stations: STATIONS,
    meeting: MEETING_SEATS,
    byId,
    seating: SEATING,
    seatingById: new Map(SEATING.map((s) => [s.id, s])),
    lineup: [],
    door: { x: FLOOR.minX + 0.45, z: EXIT_DOOR.u },
    tables: [],
    boards,
    agents: { outfit: 'none', ageMinutes: 0 },
  };
}

export const OFFICE_PLAN: MapPlan = officePlan();

// ---- Checking a map ---------------------------------------------------------------------------------

/** Keys a JSON object could use to reach an object's prototype, which a merge skips. */
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/** `over` on top of `base`: objects merged key by key, anything else (lists included, and null) replaced. */
export function mergeConfig<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (UNSAFE.has(k)) continue;
    out[k] = Object.hasOwn(out, k) ? mergeConfig(out[k], v) : v;
  }
  return out as T;
}

/**
 * The whole config of `config`, with whatever it `extends` filled in under it (a chain of them, at
 * most a few deep). `known` finds a map by id: the built-in ones and the other custom ones.
 */
export function resolveConfig(config: MapConfig, known: (id: string) => MapConfig | undefined): MapConfig {
  let out: MapConfig = config;
  const seen = new Set([config.id]);
  for (let parent = config.extends; parent; ) {
    if (seen.has(parent)) throw new MapError(`it extends itself (through ${parent})`);
    if (seen.size > 5) throw new MapError('it extends too many maps in a row');
    seen.add(parent);
    const base = known(parent);
    if (!base) throw new MapError(parent === OFFICE_MAP ? 'the office is built in code, so a map can’t extend it: extend "castle" instead' : `it extends "${parent}", which there’s no map called`);
    out = mergeConfig(base, { ...out, extends: base.extends });
    parent = base.extends;
  }
  return { ...out, extends: config.extends };
}

/**
 * Checks a map's config is complete and sane, and works out where everything goes. `input` is
 * whatever a file had in it: nothing is taken on trust, least of all that it's a MapConfig.
 */
export function planMap(input: unknown): MapPlan {
  if (!isObj(input)) throw new MapError('it isn’t a JSON object');
  const c = input as unknown as MapConfig;
  if (typeof c.id !== 'string' || c.id.length > 40 || !/^[a-z0-9][a-z0-9-]*$/.test(c.id)) throw new MapError('its id should be up to 40 lowercase letters, digits and dashes');
  const id = c.id;
  if (id === OFFICE_MAP) throw new MapError('"office" is the office’s own id');
  const name = str(c.name, 'name', 40);
  if (!(MAP_STYLES as readonly string[]).includes(c.style)) throw new MapError(`its style "${String(c.style)}" isn’t one there’s a builder for (${MAP_STYLES.join(', ')})`);
  if (!isObj(c.hall)) throw new MapError('it needs a hall: { width, length, height }');
  const width = num(c.hall.width, 'hall.width', 8, 110);
  const length = num(c.hall.length, 'hall.length', 8, 110);
  const height = num(c.hall.height, 'hall.height', 4, 40);
  const bounds = { minX: -width / 2, maxX: width / 2, minZ: -length / 2, maxZ: length / 2 };
  const inside = (x: number, z: number, what: string, margin = 0.2) => {
    if (x < bounds.minX + margin || x > bounds.maxX - margin || z < bounds.minZ + margin || z > bounds.maxZ - margin) throw new MapError(`${what} (${x.toFixed(1)}, ${z.toFixed(1)}) is outside the hall`);
  };
  const place = (p: unknown, what: string): { x: number; z: number; rotY: number } => {
    if (!isObj(p)) throw new MapError(`it needs ${what}: { x, z }`);
    const x = num(p.x, `${what}.x`);
    const z = num(p.z, `${what}.z`);
    const rotY = p.rotY === undefined ? 0 : num(p.rotY, `${what}.rotY`);
    inside(x, z, what);
    return { x, z, rotY };
  };
  /** An optional number: undefined when it's left out, else checked like num. */
  const opt = (v: unknown, what: string, min: number, max: number) => (v === undefined ? undefined : num(v, what, min, max));
  const rects: Rect[] = [];
  const circles: Circle[] = [];

  // The seats at the tables: every table's side toward the middle of the hall first, then the far sides.
  if (!Array.isArray(c.tables) || !c.tables.length) throw new MapError('it needs tables for the workers to sit at');
  if (c.tables.length > MAP_LIMITS.tables) throw new MapError(`it has ${c.tables.length} tables, and a map can have ${MAP_LIMITS.tables}`);
  const inner: { def: Omit<DeskDef, 'id' | 'label'>; table: string }[] = [];
  const outer: typeof inner = [];
  const tables: MapPlan['tables'] = [];
  c.tables.forEach((t: TableConfig, i) => {
    const what = `tables[${i}]`;
    if (!isObj(t)) throw new MapError(`${what} should be { x, z, length, seats }`);
    const x = num(t.x, `${what}.x`);
    const z = num(t.z, `${what}.z`);
    const len = num(t.length, `${what}.length`, 1, 100);
    const w = t.width === undefined ? 1.4 : num(t.width, `${what}.width`, 0.6, 4);
    const r = t.rotY === undefined ? 0 : num(t.rotY, `${what}.rotY`);
    const n = num(t.seats, `${what}.seats`, 1, MAP_LIMITS.seats);
    if (!Number.isInteger(n)) throw new MapError(`${what}.seats should be a whole number`);
    const along = [Math.sin(r), Math.cos(r)];
    const right = [Math.cos(r), -Math.sin(r)];
    for (const end of [-1, 1]) inside(x + (along[0] * len * end) / 2, z + (along[1] * len * end) / 2, `the end of ${what}`);
    // The side facing the middle of the hall is the inner one.
    const rightInner = right[0] * x + right[1] * z <= 0;
    const sides = t.sides ?? 'both';
    if (sides !== 'both' && sides !== 'inner' && sides !== 'outer') throw new MapError(`${what}.sides should be "both", "inner" or "outer"`);
    const table = typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 40) : `Table ${i + 1}`;
    rects.push(boxFootprint(x, z, w, len, r));
    const seated: (1 | -1)[] = [];
    tables.push({ x, z, length: len, width: w, rotY: r, seats: n, sides: seated, name: table });
    for (const s of [1, -1] as const) {
      const isInner = (s === 1) === rightInner;
      if (sides !== 'both' && (sides === 'inner') !== isInner) continue;
      seated.push(s);
      const nx = right[0] * s;
      const nz = right[1] * s;
      // The bench down that side, all of it (and whoever sits on it) inside the hall.
      rects.push(boxFootprint(x + nx * (w / 2 + BENCH_OUT), z + nz * (w / 2 + BENCH_OUT), 0.42, len - 0.2, r));
      for (const end of [-1, 1]) inside(x + nx * (w / 2 + BENCH_OUT + 0.22) + (along[0] * (len - 0.2) * end) / 2, z + nz * (w / 2 + BENCH_OUT + 0.22) + (along[1] * (len - 0.2) * end) / 2, `the bench along ${what}`, 0);
      const out = w / 2 - PLACE_IN;
      for (let k = 0; k < n; k++) {
        const t0 = (k - (n - 1) / 2) * (len / n);
        const def = { x: x + along[0] * t0 + nx * out, z: z + along[1] * t0 + nz * out, rotY: Math.atan2(nx, nz) };
        (isInner ? inner : outer).push({ def, table });
      }
    }
  });
  const all = [...inner, ...outer];
  const need = MAP_DESKS.length + BEANBAGS.length;
  if (all.length < need) throw new MapError(`its tables seat ${all.length}, and a map needs ${need} (${MAP_DESKS.length} seats and ${BEANBAGS.length} more for when they’re all taken)`);
  const counts = new Map<string, number>();
  const named = all.slice(0, need).map(({ def, table }) => {
    const k = (counts.get(table) ?? 0) + 1;
    counts.set(table, k);
    return { ...def, label: `${table}, seat ${k}` };
  });
  const desks: DeskDef[] = named.slice(0, MAP_DESKS.length).map((d, i) => ({ ...d, id: MAP_DESKS[i].id }));
  const overflow: DeskDef[] = named.slice(MAP_DESKS.length).map((d, i) => ({ ...d, id: BEANBAGS[i].id }));

  // The board agents' lecterns.
  if (!isObj(c.stations)) throw new MapError('it needs stations: where the Issues, PR and Queue agents stand');
  const stations: DeskDef[] = STATION_KINDS.map((kind) => {
    const p = place(c.stations[kind], `stations.${kind}`);
    const def = { id: `station-${kind}`, station: kind, x: p.x, z: p.z, rotY: p.rotY, label: STATION_AGENT[kind].name };
    // The agent stands behind its lectern: that's in the hall too.
    inside(p.x + Math.sin(p.rotY) * 0.9, p.z + Math.cos(p.rotY) * 0.9, `where the ${STATION_AGENT[kind].name} stands`, 0);
    // The lectern, and the agent standing behind it.
    const corners = [-1, 1].flatMap((t) => [-0.25, 0.9].map((s) => [p.x + Math.cos(p.rotY) * t * 0.4 + Math.sin(p.rotY) * s, p.z - Math.sin(p.rotY) * t * 0.4 + Math.cos(p.rotY) * s]));
    rects.push([Math.min(...corners.map((q) => q[0])), Math.max(...corners.map((q) => q[0])), Math.min(...corners.map((q) => q[1])), Math.max(...corners.map((q) => q[1]))]);
    return def;
  });

  // The meeting table: five chairs round it, the head of the table first.
  const council = place(c.council, 'council');
  const meeting: DeskDef[] = MEETING_SEATS.map((m, i) => {
    const a = council.rotY + (i * Math.PI * 2) / MEETING_SEATS.length;
    const def = { id: m.id, room: true, x: council.x + Math.sin(a) * COUNCIL.place, z: council.z + Math.cos(a) * COUNCIL.place, rotY: a, label: m.label };
    circles.push([council.x + Math.sin(a) * COUNCIL.chairs, council.z + Math.cos(a) * COUNCIL.chairs, 0.28]);
    return def;
  });
  circles.push([council.x, council.z, COUNCIL.radius]);
  const ex = council.x - Math.sin(council.rotY) * COUNCIL.easel;
  const ez = council.z - Math.cos(council.rotY) * COUNCIL.easel;
  inside(ex, ez, 'the council’s easel');
  rects.push(boxFootprint(ex, ez, 2.6, 0.5, council.rotY));

  // The boards on the walls.
  if (!isObj(c.boards)) throw new MapError('it needs boards: issues, queue, pulls and services');
  const boards = {} as Record<BoardKey, BoardDef>;
  for (const k of BOARD_KEYS) {
    const b = c.boards[k];
    if (!isObj(b)) throw new MapError(`it needs boards.${k}: { x, y, z, rotY, width, height }`);
    boards[k] = {
      x: num(b.x, `boards.${k}.x`, bounds.minX, bounds.maxX),
      y: num(b.y, `boards.${k}.y`, 0.5, height),
      z: num(b.z, `boards.${k}.z`, bounds.minZ, bounds.maxZ),
      rotY: num(b.rotY, `boards.${k}.rotY`),
      width: num(b.width, `boards.${k}.width`, 1, 12),
      height: num(b.height, `boards.${k}.height`, 0.8, 8),
      label: typeof b.label === 'string' && b.label.trim() ? b.label.trim().slice(0, 40) : DEFAULT_BOARD_LABEL[k],
    };
  }

  // The throne, the Hand beside it, and the line in front of it.
  // Each of these can be left out (or set to null, to take away one a map it extends has).
  const seating: SeatDef[] = [];
  let throne: SeatDef | undefined;
  let dais: MapPlan['dais'];
  if (c.throne != null) {
    const p = place(c.throne, 'throne');
    const d = c.throne.dais;
    if (d != null && !isObj(d)) throw new MapError('throne.dais should be { width, depth, height, steps }');
    dais = d
      ? {
          width: num(d.width, 'throne.dais.width', 2, 40),
          depth: num(d.depth, 'throne.dais.depth', 2.6, 20),
          height: num(d.height, 'throne.dais.height', 0, 3),
          steps: num(d.steps, 'throne.dais.steps', 0, 10),
        }
      : { ...DEFAULT_DAIS };
    if (!Number.isInteger(dais.steps)) throw new MapError('throne.dais.steps should be a whole number');
    const label = typeof c.throne.label === 'string' && c.throne.label.trim() ? c.throne.label.trim().slice(0, 40) : '👑 Throne';
    throne = { id: 'throne', label, x: p.x, y: dais.height, z: p.z, rotY: p.rotY, places: [0], hips: 0.74, depth: 0.12, out: 1.1 };
    seating.push(throne);
    rects.push(boxFootprint(p.x, p.z - Math.cos(p.rotY) * 0.2, THRONE_SIZE.width, THRONE_SIZE.depth, p.rotY));
  }
  let herald: MapPlan['herald'];
  let heraldAt: Circle | undefined;
  if (c.herald != null) {
    const p = place(c.herald, 'herald');
    const text = (v: unknown, max: number, dflt: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : dflt);
    herald = {
      ...p,
      name: text(c.herald.name, 40, 'Herald'),
      says: text(c.herald.says, 80, 'Speak to me to send out a new worker'),
      ask: text(c.herald.ask, 80, 'What should they work on?'),
      button: text(c.herald.button, 30, 'Send them out'),
    };
    heraldAt = [p.x, p.z, 0.35];
    circles.push(heraldAt);
  }
  const lineup: MapPlan['lineup'] = [];
  if (c.lineup != null) {
    const l = c.lineup;
    if (!isObj(l) || !Array.isArray(l.step)) throw new MapError('lineup should be { x, z, rotY, step: [dx, dz], count }');
    const count = num(l.count, 'lineup.count', 1, 30);
    if (!Number.isInteger(count)) throw new MapError('lineup.count should be a whole number');
    const [dx, dz] = [num(l.step[0], 'lineup.step[0]', -5, 5), num(l.step[1], 'lineup.step[1]', -5, 5)];
    for (let i = 0; i < count; i++) {
      const x = num(l.x, 'lineup.x') + dx * i;
      const z = num(l.z, 'lineup.z') + dz * i;
      inside(x, z, `lineup spot ${i + 1}`);
      lineup.push({ x, z, rotY: num(l.rotY, 'lineup.rotY') });
    }
  }

  // Everything else.
  const props = c.props ?? [];
  if (!Array.isArray(props)) throw new MapError('props should be a list');
  if (props.length > MAP_LIMITS.props) throw new MapError(`it has ${props.length} props, and a map can have ${MAP_LIMITS.props}`);
  props.forEach((p, i) => {
    const what = `props[${i}]`;
    if (!isObj(p) || typeof p.kind !== 'string') throw new MapError(`${what} should be { kind, x, z }`);
    if (!isPropKind(p.kind)) throw new MapError(`${what} is a "${p.kind}", which isn’t a kind of prop there is`);
    inside(num(p.x, `${what}.x`), num(p.z, `${what}.z`), `${what} (a ${p.kind})`, 0);
    // Everything the builder reads, in sizes it can build.
    opt(p.y, `${what}.y`, 0, 100);
    opt(p.rotY, `${what}.rotY`, -1e4, 1e4);
    opt(p.scale, `${what}.scale`, 0.2, 5);
    opt(p.width, `${what}.width`, 0.3, 20);
    opt(p.height, `${what}.height`, 0.3, 20);
    opt(p.length, `${what}.length`, 0.3, 120);
    if (p.light !== undefined && typeof p.light !== 'boolean') throw new MapError(`${what}.light should be true or false`);
    // What hangs on a wall, or from the roof, has to fit under the walls' top.
    const top = propTop(p);
    if (top > height) throw new MapError(`props[${i}] (a ${p.kind}) reaches ${top.toFixed(1)} m up, over the hall's ${height} m walls: lower its y, or raise hall.height`);
    const f = propFootprint(p);
    if (f?.rect) rects.push(f.rect);
    if (f?.circle) circles.push(f.circle);
  });
  if (props.filter((p) => p.kind === 'gong').length > 1) throw new MapError('it has more than one gong');

  // The dungeon under the hall: the hole in the floor over its stairs, with rails round it, has to be clear.
  const dungeon = c.dungeon == null ? undefined : planDungeon(c.dungeon, bounds);
  if (dungeon) {
    const [x0, x1, z0, z1] = dungeon.rails;
    const hit = rects.some((r) => overlaps(r, dungeon.rails)) || circles.some(([cx, cz, r]) => Math.hypot(cx - Math.max(x0, Math.min(x1, cx)), cz - Math.max(z0, Math.min(z1, cz))) < r);
    if (hit) throw new MapError('the dungeon stairs come up through something in the hall (a table, a bench, a pillar or the like): move them, or it');
    rects.push(dungeon.rails);
  }

  if (c.palette != null) {
    if (!isObj(c.palette)) throw new MapError('palette should be { stone, floor, carpet, wood, trim }');
    for (const [k, v] of Object.entries(c.palette)) if (typeof v !== 'string' || v.length > 40) throw new MapError(`palette.${k} should be a CSS color`);
  }
  const door = place(c.door, 'door');
  const spawn = c.spawn ? place(c.spawn, 'spawn') : { x: door.x, z: door.z, rotY: Math.atan2(-door.x, -door.z) };
  // Where people and workers stand has to be clear of what's in the way (the herald's own spot aside).
  const free = (x: number, z: number) => !rects.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1) && !circles.some((o) => o !== heraldAt && Math.hypot(x - o[0], z - o[1]) < o[2]);
  const clear = (x: number, z: number, what: string) => {
    if (!free(x, z)) throw new MapError(`${what} (${x.toFixed(1)}, ${z.toFixed(1)}) is inside something: a table, a bench, a pillar or the like`);
  };
  lineup.forEach((s, i) => clear(s.x, s.z, `lineup spot ${i + 1}`));
  if (herald) clear(herald.x, herald.z, 'the herald');
  clear(spawn.x, spawn.z, 'spawn');
  clear(door.x, door.z, 'door');
  if (dungeon) clear(dungeon.stairs.top[0], dungeon.stairs.top[1], 'the way onto the dungeon stairs');
  const sendHome = planSendHome(c.sendHome, bounds, free, dungeon);
  const outfit = c.agents?.outfit === 'peasant' ? 'peasant' : 'none';
  const ageMinutes = c.agents?.ageMinutes === undefined ? 0 : num(c.agents.ageMinutes, 'agents.ageMinutes', 0, 100000);
  const byId = new Map([...desks, ...overflow, ...stations, ...meeting].map((d) => [d.id, d]));
  for (const d of byId.values()) inside(d.x, d.z, d.label);
  return {
    id,
    name,
    icon: typeof c.icon === 'string' && c.icon.trim() ? c.icon.trim().slice(0, 8) : '🗺️',
    description: typeof c.description === 'string' ? c.description.slice(0, 400) : '',
    style: c.style as MapStyle,
    config: c,
    bounds,
    height,
    spawn: { ...spawn, y: 0 },
    desks,
    overflow,
    stations,
    meeting,
    byId,
    seating,
    seatingById: new Map(seating.map((s) => [s.id, s])),
    throne,
    dais,
    lineup,
    herald,
    door,
    tables,
    council,
    boards,
    obstacles: { rects, circles },
    agents: { outfit, ageMinutes },
    ...(dungeon ? { dungeon } : {}),
    ...(sendHome ? { sendHome } : {}),
  };
}

// ---- Which maps there are -------------------------------------------------------------------------

/** A custom map read from a file, checked: its config if it can be used, else why not. */
export interface CustomMap {
  file: string;
  config?: MapConfig;
  error?: string;
}

/**
 * Checks the custom maps (JSON from the office's .agent-office/maps/) against the built-in ones and
 * each other: each comes back with its whole config (what it extends filled in), or why it can't be used.
 */
export function checkCustomMaps(files: { file: string; json: unknown }[]): CustomMap[] {
  const raw = new Map<string, MapConfig>();
  const out: CustomMap[] = files.map(({ file, json }) => {
    if (!isObj(json)) return { file, error: 'it isn’t a JSON object' };
    const id = json.id;
    if (typeof id !== 'string') return { file, error: 'it needs an id' };
    if (id === OFFICE_MAP || BUILTIN_MAPS.some((m) => m.id === id)) return { file, error: `"${id}" is a built-in map’s id: pick another, and "extends": "${id}" to start from it` };
    if (raw.has(id)) return { file, error: `another file has the id "${id}" too` };
    raw.set(id, json as unknown as MapConfig);
    return { file, config: json as unknown as MapConfig };
  });
  const known = (id: string) => raw.get(id) ?? BUILTIN_MAPS.find((m) => m.id === id);
  return out.map((m) => {
    if (!m.config) return m;
    try {
      const config = resolveConfig(m.config, known);
      planMap(config);
      return { file: m.file, config };
    } catch (e) {
      return { file: m.file, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** Every map there is to pick, the office first, and the custom ones that won't load with why. */
export function mapChoices(custom: readonly CustomMap[] = []): MapChoice[] {
  const plan = (c: MapConfig) => planOf(c.id, custom);
  return [
    { id: OFFICE_PLAN.id, name: OFFICE_PLAN.name, icon: OFFICE_PLAN.icon, description: OFFICE_PLAN.description },
    ...BUILTIN_MAPS.map((c) => plan(c)).map((p) => ({ id: p.id, name: p.name, icon: p.icon, description: p.description })),
    ...custom.map((m) => {
      if (!m.config) return { id: m.file, name: m.file, icon: '⚠️', description: '', custom: true, error: m.error };
      const p = plan(m.config);
      return { id: p.id, name: p.name, icon: p.icon, description: p.description, custom: true };
    }),
  ];
}

const plans = new Map<string, { config: MapConfig; key: string; plan: MapPlan }>();

/**
 * The plan of the map `id`: the office, a built-in map, or a custom one (already checked, see
 * checkCustomMaps). Anything else, or one that won't load, is the office.
 */
export function planOf(id: string | undefined, custom: readonly CustomMap[] = []): MapPlan {
  if (!id || id === OFFICE_MAP) return OFFICE_PLAN;
  const config = custom.find((m) => m.config?.id === id)?.config ?? BUILTIN_MAPS.find((m) => m.id === id);
  if (!config) return OFFICE_PLAN;
  const hit = plans.get(id);
  // The same config as last time (it's asked for often): no need to look any closer.
  if (hit?.config === config) return hit.plan;
  const key = JSON.stringify(config);
  if (hit?.key === key) {
    hit.config = config;
    return hit.plan;
  }
  try {
    const plan = planMap(config);
    plans.set(id, { config, key, plan });
    return plan;
  } catch {
    return OFFICE_PLAN;
  }
}

/** Whether `id` names a map that can be picked. */
export function isMapChoice(id: unknown, custom: readonly CustomMap[] = []): id is string {
  return typeof id === 'string' && (id === OFFICE_MAP || BUILTIN_MAPS.some((m) => m.id === id) || custom.some((m) => m.config?.id === id));
}

/** The place a peer's `seat` names on `plan` (see seatAt), or undefined if there's no such place. */
export function seatOn(plan: MapPlan, key: string): SeatPlace | undefined {
  const m = /^([\w-]+):(\d+)$/.exec(key);
  const seat = m ? plan.seatingById.get(m[1]) : undefined;
  const i = Number(m?.[2]);
  return seat && i < seat.places.length ? seatPlace(seat, i) : undefined;
}

/** The place `key` names on `plan`, if it's somewhere you can sit from where you are (see seatHere): up on the roof, or down on a floor. */
export function seatHereOn(plan: MapPlan, key: string, onRoof: boolean): SeatPlace | undefined {
  if (plan.style === 'office' || onRoof) return seatHere(key, onRoof);
  return seatOn(plan, key);
}
